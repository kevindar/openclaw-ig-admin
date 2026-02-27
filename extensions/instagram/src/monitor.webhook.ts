import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  createDedupeCache,
  readJsonBodyWithLimit,
  registerWebhookTarget,
  requestBodyErrorToText,
  resolveWebhookTargets,
} from "openclaw/plugin-sdk";
import type { ResolvedInstagramAccount } from "./accounts.js";
import type { IGWebhookMessaging, IGWebhookPayload } from "./api.js";
import type { InstagramRuntimeEnv } from "./monitor.js";

const IG_WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const IG_WEBHOOK_RATE_LIMIT_MAX_REQUESTS = 120;
const IG_WEBHOOK_REPLAY_WINDOW_MS = 5 * 60_000;

type WebhookRateLimitState = { count: number; windowStartMs: number };

export type InstagramWebhookTarget = {
  pageAccessToken: string;
  pageId: string;
  account: ResolvedInstagramAccount;
  config: OpenClawConfig;
  runtime: InstagramRuntimeEnv;
  core: unknown;
  verifyToken: string;
  appSecret: string;
  path: string;
  apiVersion?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type InstagramWebhookProcessMessaging = (params: {
  messaging: IGWebhookMessaging;
  target: InstagramWebhookTarget;
}) => Promise<void>;

const webhookTargets = new Map<string, InstagramWebhookTarget[]>();
const webhookRateLimits = new Map<string, WebhookRateLimitState>();
const recentWebhookEvents = createDedupeCache({
  ttlMs: IG_WEBHOOK_REPLAY_WINDOW_MS,
  maxSize: 5000,
});

function isWebhookRateLimited(key: string, nowMs: number): boolean {
  const state = webhookRateLimits.get(key);
  if (!state || nowMs - state.windowStartMs >= IG_WEBHOOK_RATE_LIMIT_WINDOW_MS) {
    webhookRateLimits.set(key, { count: 1, windowStartMs: nowMs });
    return false;
  }
  state.count += 1;
  return state.count > IG_WEBHOOK_RATE_LIMIT_MAX_REQUESTS;
}

function isReplayEvent(mid: string, nowMs: number): boolean {
  return recentWebhookEvents.check(`msg:${mid}`, nowMs);
}

/**
 * Verify the X-Hub-Signature-256 header from Facebook.
 */
function verifySignature(appSecret: string, rawBody: string, signature: string): boolean {
  if (!signature.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signature.slice(7);
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function registerInstagramWebhookTarget(target: InstagramWebhookTarget): () => void {
  return registerWebhookTarget(webhookTargets, target).unregister;
}

/**
 * Handle incoming HTTP requests for Instagram webhooks.
 * Supports both GET (verification challenge) and POST (event delivery).
 */
export async function handleInstagramWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  processMessaging: InstagramWebhookProcessMessaging,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { targets } = resolved;

  // Facebook webhook verification (GET with hub.challenge)
  if (req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && challenge) {
      const matched = targets.find((t) => t.verifyToken === token);
      if (matched) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end(challenge);
        return true;
      }
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }

    res.statusCode = 400;
    res.end("Bad Request");
    return true;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return true;
  }

  const path = req.url ?? "<unknown>";
  const rateLimitKey = `${path}:${req.socket.remoteAddress ?? "unknown"}`;
  const nowMs = Date.now();

  if (isWebhookRateLimited(rateLimitKey, nowMs)) {
    res.statusCode = 429;
    res.end("Too Many Requests");
    return true;
  }

  const body = await readJsonBodyWithLimit(req, {
    maxBytes: 1024 * 1024,
    timeoutMs: 30_000,
    emptyObjectOnEmpty: false,
  });
  if (!body.ok) {
    res.statusCode =
      body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
    res.end(
      body.code === "PAYLOAD_TOO_LARGE"
        ? requestBodyErrorToText("PAYLOAD_TOO_LARGE")
        : body.code === "REQUEST_BODY_TIMEOUT"
          ? requestBodyErrorToText("REQUEST_BODY_TIMEOUT")
          : "Bad Request",
    );
    return true;
  }

  // Verify signature if app secret is configured
  const signatureHeader = String(req.headers["x-hub-signature-256"] ?? "");
  const rawBodyStr = JSON.stringify(body.value);

  const target = targets.find((t) => {
    if (!t.appSecret) {
      return true;
    }
    return verifySignature(t.appSecret, rawBodyStr, signatureHeader);
  });

  if (!target) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return true;
  }

  const payload = body.value as IGWebhookPayload;
  if (payload.object !== "instagram") {
    // Respond 200 to avoid Facebook retries for non-Instagram events
    res.statusCode = 200;
    res.end("EVENT_RECEIVED");
    return true;
  }

  // Respond immediately to prevent Facebook timeout and retries
  res.statusCode = 200;
  res.end("EVENT_RECEIVED");

  target.statusSink?.({ lastInboundAt: Date.now() });

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      // Skip echo messages (sent by our own page)
      if (messaging.message?.is_echo) {
        continue;
      }
      // Skip deleted messages
      if (messaging.message?.is_deleted) {
        continue;
      }
      // Deduplicate by message ID
      const mid = messaging.message?.mid ?? messaging.postback?.mid;
      if (mid && isReplayEvent(mid, nowMs)) {
        continue;
      }

      processMessaging({ messaging, target }).catch((err) => {
        target.runtime.error?.(
          `[${target.account.accountId}] Instagram webhook failed: ${String(err)}`,
        );
      });
    }
  }

  return true;
}
