import type {
  FeishuBridgeConfig,
  FeishuBridgeDelivery,
  FeishuDeliveryReceipt,
  FeishuOutboundMessage,
} from "./bridge.js";

interface TokenCache {
  value: string;
  expiresAt: number;
}

interface FeishuTenantAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuSendMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id?: string;
    root_id?: string;
    thread_id?: string;
  };
}

type FeishuReceiveIdType = "chat_id" | "open_id" | "union_id";

function resolveApiBaseUrl(config: FeishuBridgeConfig): string {
  return (config.apiBaseUrl || "https://open.feishu.cn/open-apis").replace(/\/$/, "");
}

function resolveReceiveTarget(rawTarget: string): {
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
} {
  let value = rawTarget.trim().replace(/^(feishu|lark):/i, "").trim();

  if (/^(chat|group):/i.test(value)) {
    return {
      receiveId: value.replace(/^(chat|group):/i, "").trim(),
      receiveIdType: "chat_id",
    };
  }
  if (/^(user|dm):/i.test(value)) {
    return {
      receiveId: value.replace(/^(user|dm):/i, "").trim(),
      receiveIdType: "open_id",
    };
  }
  if (/^oc_/i.test(value)) {
    return { receiveId: value, receiveIdType: "chat_id" };
  }
  if (/^ou_/i.test(value)) {
    return { receiveId: value, receiveIdType: "open_id" };
  }
  if (/^on_/i.test(value)) {
    return { receiveId: value, receiveIdType: "union_id" };
  }
  return { receiveId: value, receiveIdType: "chat_id" };
}

function resolveMessagePayload(message: FeishuOutboundMessage): {
  msgType: "text" | "interactive";
  content: string;
} {
  if (message.card) {
    return {
      msgType: "interactive",
      content: JSON.stringify(message.card),
    };
  }
  return {
    msgType: "text",
    content: JSON.stringify({
      text: message.text,
    }),
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const until = Date.parse(value);
  if (Number.isFinite(until)) {
    return Math.max(0, until - Date.now());
  }
  return null;
}

export class FeishuApiDelivery implements FeishuBridgeDelivery {
  private readonly config: FeishuBridgeConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: FeishuBridgeConfig) {
    this.config = config;
  }

  private isLive(): boolean {
    return this.config.enabled !== false && this.config.mode === "live";
  }

  private retryLimit(): number {
    return Math.max(0, this.config.deliveryMaxRetries ?? 2);
  }

  private retryBaseMs(): number {
    return Math.max(0, this.config.deliveryRetryBaseMs ?? 300);
  }

  private retryMaxMs(): number {
    return Math.max(this.retryBaseMs(), this.config.deliveryRetryMaxMs ?? 5_000);
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private computeRetryDelay(attempt: number, retryAfterHeader: string | null): number {
    const hinted = parseRetryAfter(retryAfterHeader);
    if (hinted !== null) return Math.min(hinted, this.retryMaxMs());
    const delay = this.retryBaseMs() * 2 ** attempt;
    return Math.min(delay, this.retryMaxMs());
  }

  private async fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
    const maxRetries = this.retryLimit();

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(input, init);
        if (response.ok || !isRetryableStatus(response.status) || attempt >= maxRetries) {
          return response;
        }
        await this.sleep(this.computeRetryDelay(attempt, response.headers.get("retry-after")));
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        await this.sleep(this.computeRetryDelay(attempt, null));
      }
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.config.tenantAccessToken) return this.config.tenantAccessToken;
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.value;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error(
        "Feishu live delivery requires tenantAccessToken or appId/appSecret"
      );
    }

    const response = await this.fetchWithRetry(
      `${resolveApiBaseUrl(this.config)}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Feishu tenant access token: ${response.status} ${response.statusText}`
      );
    }

    const json = (await response.json()) as FeishuTenantAccessTokenResponse;
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`Feishu token API error: ${json.msg || json.code}`);
    }

    this.tokenCache = {
      value: json.tenant_access_token,
      expiresAt: Date.now() + Math.max((json.expire ?? 7_200) - 60, 60) * 1_000,
    };

    return json.tenant_access_token;
  }

  async send(message: FeishuOutboundMessage): Promise<FeishuDeliveryReceipt | void> {
    if (!this.isLive()) return;
    if (!message.target.chatId) {
      throw new Error("Feishu outbound message missing chatId");
    }

    const token = await this.getTenantAccessToken();
    const payload = resolveMessagePayload(message);
    const target = resolveReceiveTarget(message.target.chatId);
    const response = await this.fetchWithRetry(
      `${resolveApiBaseUrl(this.config)}/im/v1/messages?receive_id_type=${target.receiveIdType}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: target.receiveId,
          msg_type: payload.msgType,
          content: payload.content,
          reply_in_thread: Boolean(message.target.threadId || message.target.rootMessageId),
          root_id: message.target.rootMessageId,
          reply_to_message_id: message.target.replyToMessageId,
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Failed to send Feishu message: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ""
        }`
      );
    }

    const json = (await response.json()) as FeishuSendMessageResponse;
    if (json.code !== 0) {
      throw new Error(`Feishu send message error: ${json.msg || json.code}`);
    }

    return {
      messageId: json.data?.message_id,
      rootId: json.data?.root_id,
      threadId: json.data?.thread_id,
    };
  }

  async update(
    messageId: string,
    message: FeishuOutboundMessage
  ): Promise<FeishuDeliveryReceipt | void> {
    if (!this.isLive()) return;
    if (!messageId.trim()) {
      throw new Error("Feishu outbound update missing messageId");
    }

    const token = await this.getTenantAccessToken();
    const payload = resolveMessagePayload(message);
    const response = await this.fetchWithRetry(
      `${resolveApiBaseUrl(this.config)}/im/v1/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: payload.content,
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Failed to update Feishu message: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ""
        }`
      );
    }

    const json = (await response.json()) as FeishuSendMessageResponse;
    if (json.code !== 0) {
      throw new Error(`Feishu update message error: ${json.msg || json.code}`);
    }

    return {
      messageId: json.data?.message_id ?? messageId,
      rootId: json.data?.root_id,
      threadId: json.data?.thread_id,
    };
  }
}
