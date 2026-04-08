import { createCallbackHeaders } from "./hmac-signer.js";
import type { ExecutorEvent } from "../../../shared/executor/contracts.js";

export interface CallbackConfig {
  secret: string;
  executorId: string;
  maxRetries: number;
  baseDelayMs: number;
}

const DEFAULT_CONFIG: Pick<CallbackConfig, "maxRetries" | "baseDelayMs"> = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

type FetchFn = typeof globalThis.fetch;

export class CallbackSender {
  private readonly config: CallbackConfig;
  private readonly fetchFn: FetchFn;

  constructor(
    config: Partial<CallbackConfig> & Pick<CallbackConfig, "secret" | "executorId">,
    fetchFn?: FetchFn,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  /**
   * Serialize event, sign with HMAC, and POST to eventsUrl.
   * Never throws — callback failure must not block Job execution.
   */
  async send(eventsUrl: string, event: ExecutorEvent): Promise<void> {
    try {
      const body = JSON.stringify({ event });
      const headers = createCallbackHeaders(
        this.config.executorId,
        this.config.secret,
        body,
      );
      headers["content-type"] = "application/json";

      await this.sendWithRetry(eventsUrl, body, headers);
    } catch (err) {
      // Top-level safety net — should never reach here since sendWithRetry
      // already swallows, but guard against unexpected errors in serialization etc.
      console.warn(
        `[CallbackSender] Unexpected error sending event ${event.type} to ${eventsUrl}:`,
        err,
      );
    }
  }

  private async sendWithRetry(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<void> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          method: "POST",
          headers,
          body,
        });

        if (res.ok) return;

        // Non-2xx is treated as a failure worth retrying
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      } catch (err) {
        if (attempt < this.config.maxRetries) {
          const delayMs = this.config.baseDelayMs * 2 ** attempt;
          console.warn(
            `[CallbackSender] Attempt ${attempt + 1}/${this.config.maxRetries + 1} failed, retrying in ${delayMs}ms:`,
            (err as Error).message,
          );
          await this.sleep(delayMs);
        } else {
          console.warn(
            `[CallbackSender] All ${this.config.maxRetries + 1} attempts exhausted for ${url}:`,
            (err as Error).message,
          );
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
