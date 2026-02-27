/**
 * Instagram Messaging API client (via Facebook Graph API / Messenger Platform)
 * @see https://developers.facebook.com/docs/messenger-platform/instagram
 */

const GRAPH_API_BASE = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v21.0";

export type IGSendMessageParams = {
  recipientId: string;
  text: string;
};

export type IGSendImageParams = {
  recipientId: string;
  imageUrl: string;
};

export type IGSendResult = {
  recipient_id: string;
  message_id: string;
};

export type IGWebhookEntry = {
  id: string;
  time: number;
  messaging: IGWebhookMessaging[];
};

export type IGWebhookMessaging = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload?: { url?: string };
    }>;
    is_deleted?: boolean;
    is_echo?: boolean;
    is_unsupported?: boolean;
    quick_reply?: { payload: string };
    reply_to?: { mid?: string; story?: { url?: string; id?: string } };
  };
  postback?: {
    mid?: string;
    title: string;
    payload: string;
  };
  read?: { mid: string };
  reaction?: {
    mid: string;
    action: "react" | "unreact";
    reaction?: string;
    emoji?: string;
  };
};

export type IGWebhookPayload = {
  object: string;
  entry: IGWebhookEntry[];
};

export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: number,
    public readonly errorSubcode?: number,
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

function buildApiUrl(pageId: string, endpoint: string, apiVersion?: string): string {
  const version = apiVersion ?? DEFAULT_API_VERSION;
  return `${GRAPH_API_BASE}/${version}/${pageId}/${endpoint}`;
}

export async function sendTextMessage(
  pageAccessToken: string,
  pageId: string,
  params: IGSendMessageParams,
  apiVersion?: string,
): Promise<IGSendResult> {
  const url = buildApiUrl(pageId, "messages", apiVersion);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: params.recipientId },
      message: { text: params.text },
    }),
  });

  const data = (await response.json()) as Record<string, unknown>;

  if (data.error) {
    const err = data.error as Record<string, unknown>;
    throw new InstagramApiError(
      String(err.message ?? "Instagram API error"),
      err.code as number | undefined,
      err.error_subcode as number | undefined,
    );
  }

  return data as unknown as IGSendResult;
}

export async function sendImageMessage(
  pageAccessToken: string,
  pageId: string,
  params: IGSendImageParams,
  apiVersion?: string,
): Promise<IGSendResult> {
  const url = buildApiUrl(pageId, "messages", apiVersion);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: params.recipientId },
      message: {
        attachment: {
          type: "image",
          payload: { url: params.imageUrl },
        },
      },
    }),
  });

  const data = (await response.json()) as Record<string, unknown>;

  if (data.error) {
    const err = data.error as Record<string, unknown>;
    throw new InstagramApiError(
      String(err.message ?? "Instagram API error"),
      err.code as number | undefined,
      err.error_subcode as number | undefined,
    );
  }

  return data as unknown as IGSendResult;
}

/**
 * Send typing indicator (sender action)
 */
export async function sendTypingOn(
  pageAccessToken: string,
  pageId: string,
  recipientId: string,
  apiVersion?: string,
): Promise<void> {
  const url = buildApiUrl(pageId, "messages", apiVersion);
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: "typing_on",
    }),
  });
}
