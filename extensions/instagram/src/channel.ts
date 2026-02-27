import type {
  ChannelAccountSnapshot,
  ChannelDock,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  buildChannelConfigSchema,
  buildTokenChannelStatusSummary,
  chunkTextForOutbound,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatAllowFromLowercase,
  normalizeAccountId,
  resolveChannelAccountConfigBasePath,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import {
  listInstagramAccountIds,
  resolveDefaultInstagramAccountId,
  resolveInstagramAccount,
  type ResolvedInstagramAccount,
} from "./accounts.js";
import { InstagramConfigSchema } from "./config-schema.js";
import { sendMessageInstagram } from "./send.js";

const meta = {
  id: "instagram",
  label: "Instagram",
  selectionLabel: "Instagram (Messenger Platform)",
  docsPath: "/channels/instagram",
  docsLabel: "instagram",
  blurb: "Instagram DM via Facebook Messenger Platform.",
  aliases: ["ig"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeInstagramMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^(instagram|ig):/i, "");
}

export const instagramDock: ChannelDock = {
  id: "instagram",
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 1000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveInstagramAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^(instagram|ig):/i }),
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const instagramPlugin: ChannelPlugin<ResolvedInstagramAccount> = {
  id: "instagram",
  meta,
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.instagram"] },
  configSchema: buildChannelConfigSchema(InstagramConfigSchema),
  config: {
    listAccountIds: (cfg) => listInstagramAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveInstagramAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultInstagramAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "instagram",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "instagram",
        accountId,
        clearBaseFields: ["pageAccessToken", "tokenFile", "pageId", "name"],
      }),
    isConfigured: (account) => Boolean(account.pageAccessToken?.trim() && account.pageId?.trim()),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.pageAccessToken?.trim() && account.pageId?.trim()),
      tokenSource: account.tokenSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveInstagramAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^(instagram|ig):/i }),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const basePath = resolveChannelAccountConfigBasePath({
        cfg,
        channelKey: "instagram",
        accountId: resolvedAccountId,
      });
      return {
        policy: account.config.dmPolicy ?? "allowlist",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: "Use openclaw config to manage Instagram allowlist",
        normalizeEntry: (raw) => raw.replace(/^(instagram|ig):/i, ""),
      };
    },
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeInstagramMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          return false;
        }
        return /^\d{3,}$/.test(trimmed);
      },
      hint: "<IGSID>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveInstagramAccount({ cfg, accountId });
      const q = query?.trim().toLowerCase() || "";
      const peers = Array.from(
        new Set(
          (account.config.allowFrom ?? [])
            .map((entry) => String(entry).trim())
            .filter((entry) => Boolean(entry) && entry !== "*")
            .map((entry) => entry.replace(/^(instagram|ig):/i, "")),
        ),
      )
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
      return peers;
    },
    listGroups: async () => [],
  },
  outbound: {
    deliveryMode: "direct",
    chunker: chunkTextForOutbound,
    chunkerMode: "text",
    textChunkLimit: 1000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const result = await sendMessageInstagram(to, text, {
        accountId: accountId ?? undefined,
        cfg,
      });
      return {
        channel: "instagram",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const result = await sendMessageInstagram(to, text, {
        accountId: accountId ?? undefined,
        cfg,
        mediaUrl,
      });
      return {
        channel: "instagram",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => buildTokenChannelStatusSummary(snapshot),
    buildAccountSnapshot: ({ account, runtime }) => {
      const configured = Boolean(account.pageAccessToken?.trim() && account.pageId?.trim());
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        tokenSource: account.tokenSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        mode: "webhook",
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.config.dmPolicy ?? "allowlist",
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const pageAccessToken = account.pageAccessToken.trim();
      const pageId = account.pageId.trim();

      if (!pageAccessToken || !pageId) {
        throw new Error("Instagram requires pageAccessToken and pageId");
      }

      const verifyToken =
        account.config.webhookVerifyToken ??
        process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ??
        "";
      const appSecret =
        account.config.appSecret ??
        process.env.INSTAGRAM_APP_SECRET ??
        "";

      if (!verifyToken) {
        throw new Error("Instagram requires webhookVerifyToken for webhook verification");
      }

      ctx.log?.info(`[${account.accountId}] starting Instagram webhook provider`);

      const { monitorInstagramProvider } = await import("./monitor.js");
      return monitorInstagramProvider({
        pageAccessToken,
        pageId,
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        verifyToken,
        appSecret,
        webhookPath: account.config.webhookPath,
        apiVersion: account.config.apiVersion,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
  },
};
