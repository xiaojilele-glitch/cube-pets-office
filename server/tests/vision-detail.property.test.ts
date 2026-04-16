/**
 * Property 11: 多图分析时 detail 参数约束
 *
 * For any multi-image analysis request, when VISION_LLM_DETAIL is not
 * explicitly set to "high" or "auto", all image_url detail parameters
 * should be "low".
 *
 * **Validates: Requirements 7.2**
 *
 * Feature: multi-modal-vision, Property 11: 多图分析时 detail 参数约束
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { getVisionConfig } from "../core/vision-provider.js";

/* ─── Env helpers ─── */

const ALL_RELEVANT_KEYS = [
  "VISION_LLM_API_KEY",
  "VISION_LLM_BASE_URL",
  "VISION_LLM_MODEL",
  "VISION_LLM_WIRE_API",
  "VISION_LLM_MAX_TOKENS",
  "VISION_LLM_DETAIL",
  "VISION_LLM_TIMEOUT_MS",
  "FALLBACK_LLM_API_KEY",
  "FALLBACK_LLM_BASE_URL",
  "FALLBACK_LLM_MODEL",
  "FALLBACK_LLM_WIRE_API",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_WIRE_API",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_WIRE_API",
  "OPENAI_TIMEOUT_MS",
  "OPENAI_REASONING_EFFORT",
  "OPENAI_STREAM",
  "OPENAI_CHAT_THINKING_TYPE",
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

function setBaselineEnv(): void {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://main.test/v1";
  process.env.LLM_MODEL = "main-model";
}

/* ─── Arbitraries ─── */

/** Arbitrary string that is NOT "high" or "auto" (case-insensitive) */
const arbNonHighAutoDetail = fc
  .string({ minLength: 0, maxLength: 30 })
  .filter(s => {
    const lower = s.toLowerCase();
    return lower !== "high" && lower !== "auto";
  });

/** Arbitrary "high" or "auto" in various casings */
const arbHighOrAuto = fc.constantFrom(
  "high",
  "auto",
  "HIGH",
  "AUTO",
  "High",
  "Auto"
);

/* ─── Tests ─── */

describe("Property 11: 多图分析时 detail 参数约束", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = snapshotEnv();
    clearRelevantEnv();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  it("detail is 'low' when VISION_LLM_DETAIL is not 'high' or 'auto'", () => {
    fc.assert(
      fc.property(arbNonHighAutoDetail, detailValue => {
        clearRelevantEnv();
        setBaselineEnv();
        process.env.VISION_LLM_DETAIL = detailValue;

        const config = getVisionConfig();

        // When VISION_LLM_DETAIL is not explicitly "high" or "auto",
        // detail must be "low" to reduce token consumption for multi-image analysis
        expect(config.detail).toBe("low");
      }),
      { numRuns: 100 }
    );
  });

  it("detail is 'high' when VISION_LLM_DETAIL is explicitly 'high' (case-insensitive)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("high", "HIGH", "High", "hIgH"),
        detailValue => {
          clearRelevantEnv();
          setBaselineEnv();
          process.env.VISION_LLM_DETAIL = detailValue;

          const config = getVisionConfig();
          expect(config.detail).toBe("high");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detail is 'auto' when VISION_LLM_DETAIL is explicitly 'auto' (case-insensitive)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("auto", "AUTO", "Auto", "aUtO"),
        detailValue => {
          clearRelevantEnv();
          setBaselineEnv();
          process.env.VISION_LLM_DETAIL = detailValue;

          const config = getVisionConfig();
          expect(config.detail).toBe("auto");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detail defaults to 'low' when VISION_LLM_DETAIL is unset", () => {
    clearRelevantEnv();
    setBaselineEnv();
    // Do NOT set VISION_LLM_DETAIL at all

    const config = getVisionConfig();
    expect(config.detail).toBe("low");
  });

  it("detail constraint holds for arbitrary env var combinations", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbNonHighAutoDetail, arbHighOrAuto),
        detailValue => {
          clearRelevantEnv();
          setBaselineEnv();
          process.env.VISION_LLM_DETAIL = detailValue;

          const config = getVisionConfig();
          const lower = detailValue.toLowerCase();

          if (lower === "high") {
            expect(config.detail).toBe("high");
          } else if (lower === "auto") {
            expect(config.detail).toBe("auto");
          } else {
            // For multi-image analysis, detail MUST be "low" to reduce token consumption
            expect(config.detail).toBe("low");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
