import type { FeishuBridgeConfig } from "./bridge.js";

function readBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function readNumber(value: string | undefined): number | undefined {
  if (!value || !value.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function loadFeishuBridgeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): FeishuBridgeConfig {
  return {
    enabled: readBoolean(env.FEISHU_ENABLED),
    baseTaskUrl: env.FEISHU_BASE_TASK_URL?.trim(),
    progressThrottlePercent: readNumber(env.FEISHU_PROGRESS_THROTTLE_PERCENT),
    relaySecret: env.FEISHU_RELAY_SECRET?.trim(),
    relayMaxSkewSeconds: readNumber(env.FEISHU_RELAY_MAX_SKEW_SECONDS),
    relayNonceTtlSeconds: readNumber(env.FEISHU_RELAY_NONCE_TTL_SECONDS),
    webhookVerificationToken: env.FEISHU_WEBHOOK_VERIFICATION_TOKEN?.trim(),
    webhookEncryptKey: env.FEISHU_WEBHOOK_ENCRYPT_KEY?.trim(),
    webhookMaxSkewSeconds: readNumber(env.FEISHU_WEBHOOK_MAX_SKEW_SECONDS),
    webhookDedupTtlSeconds: readNumber(env.FEISHU_WEBHOOK_DEDUP_TTL_SECONDS),
    webhookDedupFilePath: env.FEISHU_WEBHOOK_DEDUP_FILE?.trim(),
    deliveryMaxRetries: readNumber(env.FEISHU_DELIVERY_MAX_RETRIES),
    deliveryRetryBaseMs: readNumber(env.FEISHU_DELIVERY_RETRY_BASE_MS),
    deliveryRetryMaxMs: readNumber(env.FEISHU_DELIVERY_RETRY_MAX_MS),
    appId: env.FEISHU_APP_ID?.trim(),
    appSecret: env.FEISHU_APP_SECRET?.trim(),
    tenantAccessToken: env.FEISHU_TENANT_ACCESS_TOKEN?.trim(),
    apiBaseUrl: env.FEISHU_API_BASE_URL?.trim(),
    mode:
      env.FEISHU_MODE?.trim() === "live"
        ? "live"
        : env.FEISHU_MODE?.trim() === "mock"
          ? "mock"
          : undefined,
    messageFormat:
      env.FEISHU_MESSAGE_FORMAT?.trim() === "card-live"
        ? "card-live"
        : env.FEISHU_MESSAGE_FORMAT?.trim() === "card"
          ? "card"
          : env.FEISHU_MESSAGE_FORMAT?.trim() === "text"
            ? "text"
            : undefined,
    finalSummaryMode:
      env.FEISHU_FINAL_SUMMARY_MODE?.trim() === "complete"
        ? "complete"
        : env.FEISHU_FINAL_SUMMARY_MODE?.trim() === "failed"
          ? "failed"
          : env.FEISHU_FINAL_SUMMARY_MODE?.trim() === "both"
            ? "both"
            : env.FEISHU_FINAL_SUMMARY_MODE?.trim() === "none"
              ? "none"
              : undefined,
  };
}
