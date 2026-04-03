/**
 * Property 4: Vision 配置解析与 Fallback 链
 *
 * For any combination of environment variables (VISION_LLM_*, FALLBACK_LLM_*, LLM_*),
 * getVisionConfig() returns config following the priority chain:
 *   VISION_LLM_* > FALLBACK_LLM_* > main LLM_*
 * maxTokens should reflect VISION_LLM_MAX_TOKENS or default to 1000.
 *
 * **Validates: Requirements 2.1, 2.2, 7.1**
 *
 * Feature: multi-modal-vision, Property 4: Vision 配置解析与 Fallback 链
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { getVisionConfig } from "../core/vision-provider.js";

/* ─── Env helpers ─── */

const VISION_KEYS = [
  "VISION_LLM_API_KEY",
  "VISION_LLM_BASE_URL",
  "VISION_LLM_MODEL",
  "VISION_LLM_WIRE_API",
  "VISION_LLM_MAX_TOKENS",
  "VISION_LLM_DETAIL",
  "VISION_LLM_TIMEOUT_MS",
] as const;

const FALLBACK_KEYS = [
  "FALLBACK_LLM_API_KEY",
  "FALLBACK_LLM_BASE_URL",
  "FALLBACK_LLM_MODEL",
  "FALLBACK_LLM_WIRE_API",
] as const;

const MAIN_KEYS = [
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_WIRE_API",
] as const;

const OPENAI_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_WIRE_API",
  "OPENAI_TIMEOUT_MS",
  "OPENAI_REASONING_EFFORT",
  "OPENAI_STREAM",
  "OPENAI_CHAT_THINKING_TYPE",
] as const;

const ALL_RELEVANT_KEYS = [
  ...VISION_KEYS,
  ...FALLBACK_KEYS,
  ...MAIN_KEYS,
  ...OPENAI_KEYS,
  "LLM_TIMEOUT_MS",
  "LLM_STREAM",
  "LLM_REASONING_EFFORT",
  "LLM_MAX_CONTEXT",
  "LLM_CHAT_THINKING_TYPE",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

function clearRelevantEnv(): void {
  for (const k of ALL_RELEVANT_KEYS) {
    delete process.env[k];
  }
}

/* ─── Arbitraries ─── */

/** Non-empty string that won't be falsy when used as env var */
const arbEnvValue = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** Optional env value: either a non-empty string or undefined (meaning "not set") */
const arbOptionalEnv = fc.option(arbEnvValue, { nil: undefined });

const arbWireApi = fc.constantFrom("responses", "chat_completions", "RESPONSES", "Chat_Completions");

const arbOptionalWireApi = fc.option(arbWireApi, { nil: undefined });

/** Positive integer for maxTokens */
const arbPositiveInt = fc.integer({ min: 1, max: 100000 });

const arbDetail = fc.constantFrom("low", "high", "auto", "LOW", "HIGH", "AUTO");

/* ─── Tests ─── */

describe("Property 4: Vision 配置解析与 Fallback 链", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = snapshotEnv();
    clearRelevantEnv();
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  it("apiKey follows VISION > FALLBACK > main LLM priority chain", () => {
    fc.assert(
      fc.property(
        arbEnvValue,       // main LLM key (always set as baseline)
        arbOptionalEnv,    // fallback key
        arbOptionalEnv,    // vision key
        (mainKey, fallbackKey, visionKey) => {
          clearRelevantEnv();
          process.env.LLM_API_KEY = mainKey;
          process.env.LLM_BASE_URL = "https://main.test/v1";
          process.env.LLM_MODEL = "main-model";

          if (fallbackKey !== undefined) {
            process.env.FALLBACK_LLM_API_KEY = fallbackKey;
          }
          if (visionKey !== undefined) {
            process.env.VISION_LLM_API_KEY = visionKey;
          }

          const cfg = getVisionConfig();

          if (visionKey !== undefined) {
            expect(cfg.apiKey).toBe(visionKey);
          } else if (fallbackKey !== undefined) {
            expect(cfg.apiKey).toBe(fallbackKey);
          } else {
            expect(cfg.apiKey).toBe(mainKey);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("baseUrl follows VISION > FALLBACK > main LLM priority chain", () => {
    fc.assert(
      fc.property(
        arbEnvValue,
        arbOptionalEnv,
        arbOptionalEnv,
        (mainUrl, fallbackUrl, visionUrl) => {
          clearRelevantEnv();
          process.env.LLM_API_KEY = "test-key";
          process.env.LLM_BASE_URL = mainUrl;
          process.env.LLM_MODEL = "main-model";

          if (fallbackUrl !== undefined) {
            process.env.FALLBACK_LLM_BASE_URL = fallbackUrl;
          }
          if (visionUrl !== undefined) {
            process.env.VISION_LLM_BASE_URL = visionUrl;
          }

          const cfg = getVisionConfig();

          if (visionUrl !== undefined) {
            expect(cfg.baseUrl).toBe(visionUrl);
          } else if (fallbackUrl !== undefined) {
            expect(cfg.baseUrl).toBe(fallbackUrl);
          } else {
            expect(cfg.baseUrl).toBe(mainUrl);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("model follows VISION > FALLBACK > main LLM priority chain", () => {
    fc.assert(
      fc.property(
        arbEnvValue,
        arbOptionalEnv,
        arbOptionalEnv,
        (mainModel, fallbackModel, visionModel) => {
          clearRelevantEnv();
          process.env.LLM_API_KEY = "test-key";
          process.env.LLM_BASE_URL = "https://main.test/v1";
          process.env.LLM_MODEL = mainModel;

          if (fallbackModel !== undefined) {
            process.env.FALLBACK_LLM_MODEL = fallbackModel;
          }
          if (visionModel !== undefined) {
            process.env.VISION_LLM_MODEL = visionModel;
          }

          const cfg = getVisionConfig();

          if (visionModel !== undefined) {
            expect(cfg.model).toBe(visionModel);
          } else if (fallbackModel !== undefined) {
            expect(cfg.model).toBe(fallbackModel);
          } else {
            expect(cfg.model).toBe(mainModel);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("wireApi follows VISION > FALLBACK > main LLM priority chain", () => {
    fc.assert(
      fc.property(
        arbWireApi,
        arbOptionalWireApi,
        arbOptionalWireApi,
        (mainWire, fallbackWire, visionWire) => {
          clearRelevantEnv();
          process.env.LLM_API_KEY = "test-key";
          process.env.LLM_BASE_URL = "https://main.test/v1";
          process.env.LLM_MODEL = "main-model";
          process.env.LLM_WIRE_API = mainWire;

          if (fallbackWire !== undefined) {
            process.env.FALLBACK_LLM_WIRE_API = fallbackWire;
          }
          if (visionWire !== undefined) {
            process.env.VISION_LLM_WIRE_API = visionWire;
          }

          const cfg = getVisionConfig();

          // The effective raw value follows the priority chain
          const effectiveRaw = visionWire ?? fallbackWire;
          if (effectiveRaw !== undefined) {
            const expected =
              effectiveRaw.toLowerCase() === "responses"
                ? "responses"
                : "chat_completions";
            expect(cfg.wireApi).toBe(expected);
          } else {
            // Falls through to aiConfig.wireApi which normalizes mainWire
            const expected =
              mainWire.toLowerCase() === "responses"
                ? "responses"
                : "chat_completions";
            expect(cfg.wireApi).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("maxTokens uses VISION_LLM_MAX_TOKENS when valid positive number, else defaults to 1000", () => {
    fc.assert(
      fc.property(arbPositiveInt, (maxTokens) => {
        clearRelevantEnv();
        process.env.LLM_API_KEY = "test-key";
        process.env.LLM_BASE_URL = "https://main.test/v1";
        process.env.LLM_MODEL = "main-model";
        process.env.VISION_LLM_MAX_TOKENS = String(maxTokens);

        const cfg = getVisionConfig();
        expect(cfg.maxTokens).toBe(maxTokens);
      }),
      { numRuns: 100 },
    );
  });

  it("maxTokens defaults to 1000 for invalid values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "abc", "-1", "0", "NaN", "Infinity", "  ", "1.2.3"),
        (invalidValue) => {
          clearRelevantEnv();
          process.env.LLM_API_KEY = "test-key";
          process.env.LLM_BASE_URL = "https://main.test/v1";
          process.env.LLM_MODEL = "main-model";
          process.env.VISION_LLM_MAX_TOKENS = invalidValue;

          const cfg = getVisionConfig();
          expect(cfg.maxTokens).toBe(1000);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("maxTokens defaults to 1000 when VISION_LLM_MAX_TOKENS is not set", () => {
    clearRelevantEnv();
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://main.test/v1";
    process.env.LLM_MODEL = "main-model";

    const cfg = getVisionConfig();
    expect(cfg.maxTokens).toBe(1000);
  });

  it("detail respects 'high' and 'auto', defaults to 'low' for anything else", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbDetail, fc.string({ minLength: 0, maxLength: 20 })),
        (detailValue) => {
          clearRelevantEnv();
          process.env.LLM_API_KEY = "test-key";
          process.env.LLM_BASE_URL = "https://main.test/v1";
          process.env.LLM_MODEL = "main-model";
          process.env.VISION_LLM_DETAIL = detailValue;

          const cfg = getVisionConfig();
          const lower = detailValue.toLowerCase();

          if (lower === "high") {
            expect(cfg.detail).toBe("high");
          } else if (lower === "auto") {
            expect(cfg.detail).toBe("auto");
          } else {
            expect(cfg.detail).toBe("low");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all four fallback fields are independently resolved per the priority chain", () => {
    fc.assert(
      fc.property(
        // Main tier (always set)
        fc.record({
          apiKey: arbEnvValue,
          baseUrl: arbEnvValue,
          model: arbEnvValue,
          wireApi: arbWireApi,
        }),
        // Fallback tier (each field optionally set)
        fc.record({
          apiKey: arbOptionalEnv,
          baseUrl: arbOptionalEnv,
          model: arbOptionalEnv,
          wireApi: arbOptionalWireApi,
        }),
        // Vision tier (each field optionally set)
        fc.record({
          apiKey: arbOptionalEnv,
          baseUrl: arbOptionalEnv,
          model: arbOptionalEnv,
          wireApi: arbOptionalWireApi,
        }),
        (main, fallback, vision) => {
          clearRelevantEnv();

          // Set main tier
          process.env.LLM_API_KEY = main.apiKey;
          process.env.LLM_BASE_URL = main.baseUrl;
          process.env.LLM_MODEL = main.model;
          process.env.LLM_WIRE_API = main.wireApi;

          // Set fallback tier
          if (fallback.apiKey !== undefined) process.env.FALLBACK_LLM_API_KEY = fallback.apiKey;
          if (fallback.baseUrl !== undefined) process.env.FALLBACK_LLM_BASE_URL = fallback.baseUrl;
          if (fallback.model !== undefined) process.env.FALLBACK_LLM_MODEL = fallback.model;
          if (fallback.wireApi !== undefined) process.env.FALLBACK_LLM_WIRE_API = fallback.wireApi;

          // Set vision tier
          if (vision.apiKey !== undefined) process.env.VISION_LLM_API_KEY = vision.apiKey;
          if (vision.baseUrl !== undefined) process.env.VISION_LLM_BASE_URL = vision.baseUrl;
          if (vision.model !== undefined) process.env.VISION_LLM_MODEL = vision.model;
          if (vision.wireApi !== undefined) process.env.VISION_LLM_WIRE_API = vision.wireApi;

          const cfg = getVisionConfig();

          // apiKey: VISION > FALLBACK > main
          expect(cfg.apiKey).toBe(vision.apiKey ?? fallback.apiKey ?? main.apiKey);

          // baseUrl: VISION > FALLBACK > main
          expect(cfg.baseUrl).toBe(vision.baseUrl ?? fallback.baseUrl ?? main.baseUrl);

          // model: VISION > FALLBACK > main
          expect(cfg.model).toBe(vision.model ?? fallback.model ?? main.model);

          // wireApi: VISION > FALLBACK > main (with normalization)
          const effectiveRawWire = vision.wireApi ?? fallback.wireApi;
          if (effectiveRawWire !== undefined) {
            const expected =
              effectiveRawWire.toLowerCase() === "responses"
                ? "responses"
                : "chat_completions";
            expect(cfg.wireApi).toBe(expected);
          } else {
            const expected =
              main.wireApi.toLowerCase() === "responses"
                ? "responses"
                : "chat_completions";
            expect(cfg.wireApi).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
