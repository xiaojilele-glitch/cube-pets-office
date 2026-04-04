/**
 * Property tests for CredentialInjector module.
 *
 * Feature: ai-enabled-sandbox
 * - Property 2: 凭证解析与覆盖优先级
 * - Property 3: 凭证验证拒绝无效输入
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  resolveAICredentials,
  buildAIEnvVars,
  validateCredentials,
  CredentialValidationError,
} from "../credential-injector.js";

/* ─── Arbitraries ─── */

/** Non-empty string for credential values */
const arbCredValue = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

/** Optional credential value: either a non-empty string or undefined */
const arbOptionalCred = fc.option(arbCredValue, { nil: undefined });

/** Valid API key: non-empty and length > 8 */
const arbValidApiKey = fc
  .string({ minLength: 9, maxLength: 80 })
  .filter((s) => s.trim().length > 0 && s.length > 8);

/** Invalid API key: empty or length ≤ 8 */
const arbInvalidApiKey = fc.oneof(
  fc.constant(""),
  fc.string({ minLength: 1, maxLength: 8 }),
);

/* ─── Property 2: 凭证解析与覆盖优先级 ─── */

describe("Property 2: 凭证解析与覆盖优先级", () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * For any combination of host env vars and payload.llmConfig,
   * resolveAICredentials should follow priority: payload.llmConfig
   * values take precedence over host env vars. Output env var array
   * should use AI_ prefix.
   */

  it("payload.llmConfig values take precedence over host env vars", () => {
    fc.assert(
      fc.property(
        arbOptionalCred, // payload apiKey
        arbOptionalCred, // payload baseUrl
        arbOptionalCred, // payload model
        arbOptionalCred, // host LLM_API_KEY
        arbOptionalCred, // host LLM_BASE_URL
        arbOptionalCred, // host LLM_MODEL
        (pApiKey, pBaseUrl, pModel, hApiKey, hBaseUrl, hModel) => {
          const payload: Record<string, unknown> = {
            llmConfig: {
              ...(pApiKey !== undefined && { apiKey: pApiKey }),
              ...(pBaseUrl !== undefined && { baseUrl: pBaseUrl }),
              ...(pModel !== undefined && { model: pModel }),
            },
          };

          const hostEnv: Record<string, string | undefined> = {
            LLM_API_KEY: hApiKey,
            LLM_BASE_URL: hBaseUrl,
            LLM_MODEL: hModel,
          };

          const creds = resolveAICredentials(payload, hostEnv);

          // payload.llmConfig takes priority over host env
          expect(creds.apiKey).toBe(pApiKey ?? hApiKey ?? "");
          expect(creds.baseUrl).toBe(pBaseUrl ?? hBaseUrl ?? "");
          expect(creds.model).toBe(pModel ?? hModel ?? "");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("buildAIEnvVars outputs AI_ prefixed env vars matching resolved credentials", () => {
    fc.assert(
      fc.property(
        arbOptionalCred,
        arbOptionalCred,
        arbOptionalCred,
        arbOptionalCred,
        arbOptionalCred,
        arbOptionalCred,
        (pApiKey, pBaseUrl, pModel, hApiKey, hBaseUrl, hModel) => {
          const payload: Record<string, unknown> = {
            llmConfig: {
              ...(pApiKey !== undefined && { apiKey: pApiKey }),
              ...(pBaseUrl !== undefined && { baseUrl: pBaseUrl }),
              ...(pModel !== undefined && { model: pModel }),
            },
          };

          const hostEnv: Record<string, string | undefined> = {
            LLM_API_KEY: hApiKey,
            LLM_BASE_URL: hBaseUrl,
            LLM_MODEL: hModel,
          };

          const creds = resolveAICredentials(payload, hostEnv);
          const envVars = buildAIEnvVars(creds);

          // Must contain exactly 3 entries with AI_ prefix
          expect(envVars).toHaveLength(3);
          expect(envVars[0]).toBe(`AI_API_KEY=${creds.apiKey}`);
          expect(envVars[1]).toBe(`AI_BASE_URL=${creds.baseUrl}`);
          expect(envVars[2]).toBe(`AI_MODEL=${creds.model}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when no payload.llmConfig is provided, host env vars are used", () => {
    fc.assert(
      fc.property(
        arbOptionalCred,
        arbOptionalCred,
        arbOptionalCred,
        (hApiKey, hBaseUrl, hModel) => {
          const payload: Record<string, unknown> = {};
          const hostEnv: Record<string, string | undefined> = {
            LLM_API_KEY: hApiKey,
            LLM_BASE_URL: hBaseUrl,
            LLM_MODEL: hModel,
          };

          const creds = resolveAICredentials(payload, hostEnv);

          expect(creds.apiKey).toBe(hApiKey ?? "");
          expect(creds.baseUrl).toBe(hBaseUrl ?? "");
          expect(creds.model).toBe(hModel ?? "");
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 3: 凭证验证拒绝无效输入 ─── */

describe("Property 3: 凭证验证拒绝无效输入", () => {
  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * For any API Key string, if empty or length ≤ 8, validateCredentials
   * should throw; if length > 8 and non-empty, should pass validation.
   */

  it("rejects empty or short API keys (length ≤ 8)", () => {
    fc.assert(
      fc.property(arbInvalidApiKey, (apiKey) => {
        const creds = { apiKey, baseUrl: "https://api.example.com", model: "gpt-4" };
        expect(() => validateCredentials(creds)).toThrow(CredentialValidationError);
      }),
      { numRuns: 100 },
    );
  });

  it("accepts valid API keys (non-empty, length > 8)", () => {
    fc.assert(
      fc.property(arbValidApiKey, (apiKey) => {
        const creds = { apiKey, baseUrl: "https://api.example.com", model: "gpt-4" };
        expect(() => validateCredentials(creds)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("the boundary: exactly 8 characters should be rejected, 9 should pass", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        (len) => {
          // Generate a string of exactly `len` alphanumeric characters
          const apiKey = "a".repeat(len);
          const creds = { apiKey, baseUrl: "", model: "" };

          if (len === 0 || len <= 8) {
            expect(() => validateCredentials(creds)).toThrow(CredentialValidationError);
          } else {
            expect(() => validateCredentials(creds)).not.toThrow();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
