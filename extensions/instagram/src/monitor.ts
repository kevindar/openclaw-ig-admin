import type { IncomingMessage, ServerResponse } from "node:http";
import type { MarkdownTableMode, OpenClawConfig, OutboundReplyPayload } from "openclaw/plugin-sdk";
import {
  createReplyPrefixOptions,
  resolveOutboundMediaUrls,
  resolveWebhookPath,
  sendMediaWithLeadingCaption,
} from "openclaw/plugin-sdk";
import type { ResolvedInstagramAccount } from "./accounts.js";
import type { IGWebhookMessaging } from "./api.js";
import { sendTextMessage, sendImageMessage } from "./api.js";
import {
  handleInstagramWebhookRequest as handleInstagramWebhookRequestInternal,
  registerInstagramWebhookTarget as registerInstagramWebhookTargetInternal,
  type InstagramWebhookTarget,
} from "./monitor.webhook.js";
import { getInstagramRuntime } from "./runtime.js";

export type InstagramRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type InstagramMonitorOptions = {
  pageAccessToken: string;
  pageId: string;
  account: ResolvedInstagramAccount;
  config: OpenClawConfig;
  runtime: InstagramRuntimeEnv;
  abortSignal: AbortSignal;
  verifyToken: string;
  appSecret: string;
  webhookPath?: string;
  apiVersion?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type InstagramMonitorResult = {
  stop: () => void;
};

const IG_TEXT_LIMIT = 1000;

type IGCoreRuntime = ReturnType<typeof getInstagramRuntime>;

function logVerbose(core: IGCoreRuntime, runtime: InstagramRuntimeEnv, message: string): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(`[instagram] ${message}`);
  }
}

export function registerInstagramWebhookTarget(target: InstagramWebhookTarget): () => void {
  return registerInstagramWebhookTargetInternal(target);
}

export async function handleInstagramWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  return handleInstagramWebhookRequestInternal(req, res, async ({ messaging, target }) => {
    await processMessaging(
      messaging,
      target.pageAccessToken,
      target.pageId,
      target.account,
      target.config,
      target.runtime,
      target.core as IGCoreRuntime,
      target.apiVersion,
      target.statusSink,
    );
  });
}

async function processMessaging(
  messaging: IGWebhookMessaging,
  pageAccessToken: string,
  pageId: string,
  account: ResolvedInstagramAccount,
  config: OpenClawConfig,
  runtime: InstagramRuntimeEnv,
  core: IGCoreRuntime,
  apiVersion?: string,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
): Promise<void> {
  const senderId = messaging.sender.id;

  // Handle text messages
  if (messaging.message?.text) {
    await handleTextMessage(
      messaging,
      pageAccessToken,
      pageId,
      account,
      config,
      runtime,
      core,
      apiVersion,
      statusSink,
    );
    return;
  }

  // Handle postbacks (ice breakers, buttons)
  if (messaging.postback) {
    await handlePostback(
      messaging,
      pageAccessToken,
      pageId,
      account,
      config,
      runtime,
      core,
      apiVersion,
      statusSink,
    );
    return;
  }

  // Handle media messages (image attachments)
  if (messaging.message?.attachments?.length) {
    await handleMediaMessage(
      messaging,
      pageAccessToken,
      pageId,
      account,
      config,
      runtime,
      core,
      apiVersion,
      statusSink,
    );
    return;
  }

  logVerbose(
    core,
    runtime,
    `ignored messaging event from ${senderId} (no text/postback/attachment)`,
  );
}

async function handleTextMessage(
  messaging: IGWebhookMessaging,
  pageAccessToken: string,
  pageId: string,
  account: ResolvedInstagramAccount,
  config: OpenClawConfig,
  runtime: InstagramRuntimeEnv,
  core: IGCoreRuntime,
  apiVersion?: string,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
): Promise<void> {
  const text = messaging.message?.text?.trim();
  if (!text) {
    return;
  }

  await processMessageWithPipeline({
    messaging,
    pageAccessToken,
    pageId,
    account,
    config,
    runtime,
    core,
    text,
    apiVersion,
    statusSink,
  });
}

async function handlePostback(
  messaging: IGWebhookMessaging,
  pageAccessToken: string,
  pageId: string,
  account: ResolvedInstagramAccount,
  config: OpenClawConfig,
  runtime: InstagramRuntimeEnv,
  core: IGCoreRuntime,
  apiVersion?: string,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
): Promise<void> {
  const text = messaging.postback?.payload ?? messaging.postback?.title ?? "";
  if (!text.trim()) {
    return;
  }

  await processMessageWithPipeline({
    messaging,
    pageAccessToken,
    pageId,
    account,
    config,
    runtime,
    core,
    text: text.trim(),
    apiVersion,
    statusSink,
  });
}

async function handleMediaMessage(
  messaging: IGWebhookMessaging,
  pageAccessToken: string,
  pageId: string,
  account: ResolvedInstagramAccount,
  config: OpenClawConfig,
  runtime: InstagramRuntimeEnv,
  core: IGCoreRuntime,
  apiVersion?: string,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
): Promise<void> {
  const attachments = messaging.message?.attachments ?? [];
  const imageUrl = attachments.find((a) => a.type === "image")?.payload?.url;

  let mediaPath: string | undefined;
  let mediaType: string | undefined;

  if (imageUrl) {
    try {
      const maxBytes = 8 * 1024 * 1024;
      const fetched = await core.channel.media.fetchRemoteMedia({ url: imageUrl, maxBytes });
      const saved = await core.channel.media.saveMediaBuffer(
        fetched.buffer,
        fetched.contentType,
        "inbound",
        maxBytes,
      );
      mediaPath = saved.path;
      mediaType = saved.contentType;
    } catch (err) {
      runtime.error?.(`[${account.accountId}] Failed to download Instagram image: ${String(err)}`);
    }
  }

  const captionText = messaging.message?.text ?? (mediaPath ? "<media:image>" : "");

  await processMessageWithPipeline({
    messaging,
    pageAccessToken,
    pageId,
    account,
    config,
    runtime,
    core,
    text: captionText,
    mediaPath,
    mediaType,
    apiVersion,
    statusSink,
  });
}

async function processMessageWithPipeline(params: {
  messaging: IGWebhookMessaging;
  pageAccessToken: string;
  pageId: string;
  account: ResolvedInstagramAccount;
  config: OpenClawConfig;
  runtime: InstagramRuntimeEnv;
  core: IGCoreRuntime;
  text: string;
  mediaPath?: string;
  mediaType?: string;
  apiVersion?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const {
    messaging,
    pageAccessToken,
    pageId,
    account,
    config,
    runtime,
    core,
    text,
    mediaPath,
    mediaType,
    apiVersion,
    statusSink,
  } = params;

  const senderId = messaging.sender.id;
  const mid = messaging.message?.mid ?? messaging.postback?.mid ?? "";
  const timestamp = messaging.timestamp;

  // Instagram DM is always direct (no groups)
  const isGroup = false;
  const chatId = senderId;

  const dmPolicy = account.config.dmPolicy ?? "allowlist";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));

  // DM access control
  if (dmPolicy === "disabled") {
    logVerbose(core, runtime, `Blocked Instagram DM from ${senderId} (dmPolicy=disabled)`);
    return;
  }

  if (dmPolicy === "allowlist") {
    const isAllowed =
      configAllowFrom.length === 0 ||
      configAllowFrom.includes("*") ||
      configAllowFrom.includes(senderId);

    if (!isAllowed) {
      logVerbose(
        core,
        runtime,
        `Blocked Instagram DM from ${senderId} (not in allowlist)`,
      );
      return;
    }
  }

  const rawBody = text || (mediaPath ? "<media:image>" : "");
  const fromLabel = `ig:${senderId}`;

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "instagram",
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: chatId,
    },
  });

  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Instagram",
    from: fromLabel,
    timestamp: timestamp ? timestamp * 1000 : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `instagram:${senderId}`,
    To: `instagram:${pageId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: fromLabel,
    SenderName: undefined,
    SenderId: senderId,
    CommandAuthorized: true,
    Provider: "instagram",
    Surface: "instagram",
    MessageSid: mid,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
    OriginatingChannel: "instagram",
    OriginatingTo: `instagram:${pageId}`,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err: unknown) => {
      runtime.error?.(`instagram: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "instagram",
    accountId: account.accountId,
  });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "instagram",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload: OutboundReplyPayload) => {
        await deliverInstagramReply({
          payload,
          pageAccessToken,
          pageId,
          recipientId: senderId,
          runtime,
          core,
          config,
          accountId: account.accountId,
          apiVersion,
          statusSink,
          tableMode,
        });
      },
      onError: (err: unknown, info: { kind: string }) => {
        runtime.error?.(
          `[${account.accountId}] Instagram ${info.kind} reply failed: ${String(err)}`,
        );
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

async function deliverInstagramReply(params: {
  payload: OutboundReplyPayload;
  pageAccessToken: string;
  pageId: string;
  recipientId: string;
  runtime: InstagramRuntimeEnv;
  core: IGCoreRuntime;
  config: OpenClawConfig;
  accountId?: string;
  apiVersion?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  tableMode?: MarkdownTableMode;
}): Promise<void> {
  const {
    payload,
    pageAccessToken,
    pageId,
    recipientId,
    runtime,
    core,
    config,
    accountId,
    apiVersion,
    statusSink,
  } = params;
  const tableMode = params.tableMode ?? "text";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  const sentMedia = await sendMediaWithLeadingCaption({
    mediaUrls: resolveOutboundMediaUrls(payload),
    caption: text,
    send: async ({ mediaUrl }) => {
      await sendImageMessage(pageAccessToken, pageId, { recipientId, imageUrl: mediaUrl }, apiVersion);
      statusSink?.({ lastOutboundAt: Date.now() });
    },
    onError: (error) => {
      runtime.error?.(`Instagram image send failed: ${String(error)}`);
    },
  });
  if (sentMedia) {
    return;
  }

  if (text) {
    const chunkMode = core.channel.text.resolveChunkMode(config, "instagram", accountId);
    const chunks = core.channel.text.chunkMarkdownTextWithMode(text, IG_TEXT_LIMIT, chunkMode);
    for (const chunk of chunks) {
      try {
        await sendTextMessage(
          pageAccessToken,
          pageId,
          { recipientId, text: chunk },
          apiVersion,
        );
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`Instagram message send failed: ${String(err)}`);
      }
    }
  }
}

export async function monitorInstagramProvider(
  options: InstagramMonitorOptions,
): Promise<InstagramMonitorResult> {
  const {
    pageAccessToken,
    pageId,
    account,
    config,
    runtime,
    abortSignal,
    verifyToken,
    appSecret,
    webhookPath,
    apiVersion,
    statusSink,
  } = options;

  const core = getInstagramRuntime();

  const path = resolveWebhookPath({
    webhookPath,
    webhookUrl: undefined,
    defaultPath: `/webhook/instagram/${account.accountId}`,
  });
  if (!path) {
    throw new Error("Instagram webhookPath could not be derived");
  }

  const unregister = registerInstagramWebhookTarget({
    pageAccessToken,
    pageId,
    account,
    config,
    runtime,
    core,
    path,
    verifyToken,
    appSecret,
    apiVersion,
    statusSink: (patch) => statusSink?.(patch),
  });

  const stopHandlers: Array<() => void> = [unregister];

  abortSignal.addEventListener("abort", () => {
    for (const handler of stopHandlers) {
      handler();
    }
  }, { once: true });

  runtime.log?.(`[${account.accountId}] Instagram webhook registered at ${path}`);

  return {
    stop: () => {
      for (const handler of stopHandlers) {
        handler();
      }
    },
  };
}
