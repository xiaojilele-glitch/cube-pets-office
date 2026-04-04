import { createHmac } from "node:crypto";

/**
 * Compute HMAC-SHA256 signature over "timestamp.rawBody".
 * Consistent with `ExecutorCallbackAuth.signedPayload` format.
 */
export function signPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

/**
 * Build the three callback headers required by Cube Brain:
 *  - x-cube-executor-signature
 *  - x-cube-executor-timestamp
 *  - x-cube-executor-id
 */
export function createCallbackHeaders(
  executorId: string,
  secret: string,
  rawBody: string,
  now?: () => Date,
): Record<string, string> {
  const timestamp = (now?.() ?? new Date()).toISOString();
  const signature = signPayload(secret, timestamp, rawBody);

  return {
    "x-cube-executor-signature": signature,
    "x-cube-executor-timestamp": timestamp,
    "x-cube-executor-id": executorId,
  };
}
