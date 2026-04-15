/**
 * Property 2: HMAC 签名验证往返
 *
 * For any random secret, timestamp, and rawBody, signPayload output should
 * equal recomputing HMAC-SHA256 on "timestamp.rawBody".
 *
 * **Validates: Requirements 2.2**
 *
 * Feature: lobster-executor-real, Property 2: HMAC 签名验证往返
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { signPayload, createCallbackHeaders } from "./hmac-signer.js";

/* ─── Arbitraries ─── */

/** Non-empty string for HMAC secret */
const arbSecret = fc.string({ minLength: 1, maxLength: 128 });

/** ISO-like timestamp string */
const arbTimestamp = fc
  .date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2100-01-01T00:00:00.000Z"),
  })
  .map((d) => d.toISOString());

/** Arbitrary raw body (JSON-like content) */
const arbRawBody = fc.string({ minLength: 0, maxLength: 2048 });

/** Non-empty executor ID */
const arbExecutorId = fc.string({ minLength: 1, maxLength: 64 });

/* ─── Tests ─── */

describe("Property 2: HMAC 签名验证往返", () => {
  it("signPayload matches independent HMAC-SHA256 computation", () => {
    fc.assert(
      fc.property(arbSecret, arbTimestamp, arbRawBody, (secret, timestamp, rawBody) => {
        const result = signPayload(secret, timestamp, rawBody);

        const expected = createHmac("sha256", secret)
          .update(`${timestamp}.${rawBody}`)
          .digest("hex");

        expect(result).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("createCallbackHeaders returns all three required header keys", () => {
    fc.assert(
      fc.property(arbExecutorId, arbSecret, arbRawBody, (executorId, secret, rawBody) => {
        const headers = createCallbackHeaders(executorId, secret, rawBody);

        expect(headers).toHaveProperty("x-cube-executor-signature");
        expect(headers).toHaveProperty("x-cube-executor-timestamp");
        expect(headers).toHaveProperty("x-cube-executor-id");
        expect(headers["x-cube-executor-id"]).toBe(executorId);
      }),
      { numRuns: 200 },
    );
  });

  it("createCallbackHeaders signature matches independent HMAC computation", () => {
    fc.assert(
      fc.property(arbExecutorId, arbSecret, arbRawBody, (executorId, secret, rawBody) => {
        const fixedDate = new Date("2025-01-15T10:30:00.000Z");
        const headers = createCallbackHeaders(executorId, secret, rawBody, () => fixedDate);

        const timestamp = headers["x-cube-executor-timestamp"];
        const expected = createHmac("sha256", secret)
          .update(`${timestamp}.${rawBody}`)
          .digest("hex");

        expect(headers["x-cube-executor-signature"]).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});
