import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveInstagramAccount } from "./accounts.js";
import { sendTextMessage, sendImageMessage } from "./api.js";

export type InstagramSendOptions = {
  pageAccessToken?: string;
  pageId?: string;
  accountId?: string;
  cfg?: OpenClawConfig;
  mediaUrl?: string;
  apiVersion?: string;
};

export type InstagramSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

function resolveSendContext(options: InstagramSendOptions): {
  pageAccessToken: string;
  pageId: string;
  apiVersion?: string;
} {
  if (options.cfg) {
    const account = resolveInstagramAccount({
      cfg: options.cfg,
      accountId: options.accountId,
    });
    return {
      pageAccessToken: options.pageAccessToken || account.pageAccessToken,
      pageId: options.pageId || account.pageId,
      apiVersion: options.apiVersion ?? account.config.apiVersion,
    };
  }

  return {
    pageAccessToken: options.pageAccessToken ?? "",
    pageId: options.pageId ?? "",
    apiVersion: options.apiVersion,
  };
}

export async function sendMessageInstagram(
  recipientId: string,
  text: string,
  options: InstagramSendOptions = {},
): Promise<InstagramSendResult> {
  const { pageAccessToken, pageId, apiVersion } = resolveSendContext(options);

  if (!pageAccessToken) {
    return { ok: false, error: "No Instagram page access token configured" };
  }
  if (!pageId) {
    return { ok: false, error: "No Instagram page ID configured" };
  }
  if (!recipientId?.trim()) {
    return { ok: false, error: "No recipient ID provided" };
  }

  if (options.mediaUrl) {
    return sendImageInstagram(recipientId, options.mediaUrl, options);
  }

  try {
    const result = await sendTextMessage(
      pageAccessToken,
      pageId,
      { recipientId: recipientId.trim(), text: text.slice(0, 1000) },
      apiVersion,
    );
    return { ok: true, messageId: result.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendImageInstagram(
  recipientId: string,
  imageUrl: string,
  options: InstagramSendOptions = {},
): Promise<InstagramSendResult> {
  const { pageAccessToken, pageId, apiVersion } = resolveSendContext(options);

  if (!pageAccessToken) {
    return { ok: false, error: "No Instagram page access token configured" };
  }
  if (!pageId) {
    return { ok: false, error: "No Instagram page ID configured" };
  }
  if (!recipientId?.trim()) {
    return { ok: false, error: "No recipient ID provided" };
  }
  if (!imageUrl?.trim()) {
    return { ok: false, error: "No image URL provided" };
  }

  try {
    const result = await sendImageMessage(
      pageAccessToken,
      pageId,
      { recipientId: recipientId.trim(), imageUrl: imageUrl.trim() },
      apiVersion,
    );
    return { ok: true, messageId: result.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
