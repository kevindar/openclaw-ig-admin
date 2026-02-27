export type InstagramAccountConfig = {
  name?: string;
  enabled?: boolean;
  /** Facebook Page Access Token with instagram_manage_messages permission. */
  pageAccessToken?: string;
  /** Path to file containing the page access token. */
  tokenFile?: string;
  /** Facebook Page ID linked to the Instagram Professional account. */
  pageId?: string;
  /** Webhook verify token (shared secret for Facebook webhook verification). */
  webhookVerifyToken?: string;
  /** App secret for webhook signature verification (X-Hub-Signature-256). */
  appSecret?: string;
  /** Webhook path on the gateway HTTP server. */
  webhookPath?: string;
  /** Graph API version (default: v21.0). */
  apiVersion?: string;
  /** Direct message access policy (default: allowlist). */
  dmPolicy?: "allowlist" | "open" | "disabled";
  /** Allowlist for DM senders (Instagram-scoped IDs). */
  allowFrom?: Array<string | number>;
};

export type InstagramConfig = {
  accounts?: Record<string, InstagramAccountConfig>;
  defaultAccount?: string;
} & InstagramAccountConfig;

export type InstagramTokenSource = "env" | "config" | "configFile" | "none";

export type ResolvedInstagramAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  pageAccessToken: string;
  pageId: string;
  tokenSource: InstagramTokenSource;
  config: InstagramAccountConfig;
};
