/**
 * Property tests for AI Task Presets module.
 *
 * Feature: ai-enabled-sandbox
 * - Property 4: AI 任务预设映射
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  AITaskPreset,
  AI_TASK_PRESETS,
  getAITaskPreset,
} from "../ai-task-presets.js";

/* ─── Constants ─── */

const KNOWN_TASK_TYPES = Object.keys(AI_TASK_PRESETS);
const TEXT_GEN_PRESET = AI_TASK_PRESETS["text-generation"];

/* ─── Arbitraries ─── */

/** One of the four known AI task types */
const arbKnownType = fc.constantFrom(...KNOWN_TASK_TYPES);

/** An arbitrary string that is NOT one of the known task types */
const arbUnknownType = fc
  .string({ minLength: 0, maxLength: 100 })
  .filter(s => !KNOWN_TASK_TYPES.includes(s));

/* ─── Property 4: AI 任务预设映射 ─── */

describe("Property 4: AI 任务预设映射", () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6**
   *
   * For any string as aiTaskType, getAITaskPreset should return the correct
   * preset config: known types return their specific temperature/maxTokens/jsonMode
   * combination; unknown types fall back to text-generation defaults.
   */

  it("known task types return their exact preset configuration", () => {
    fc.assert(
      fc.property(arbKnownType, taskType => {
        const preset = getAITaskPreset(taskType);
        const expected = AI_TASK_PRESETS[taskType];

        expect(preset.temperature).toBe(expected.temperature);
        expect(preset.maxTokens).toBe(expected.maxTokens);
        expect(preset.jsonMode).toBe(expected.jsonMode);
        expect(preset.supportsImageInput).toBe(expected.supportsImageInput);
      }),
      { numRuns: 100 }
    );
  });

  it("unknown task types fall back to text-generation defaults", () => {
    fc.assert(
      fc.property(arbUnknownType, taskType => {
        const preset = getAITaskPreset(taskType);

        expect(preset.temperature).toBe(TEXT_GEN_PRESET.temperature);
        expect(preset.maxTokens).toBe(TEXT_GEN_PRESET.maxTokens);
        expect(preset.jsonMode).toBe(TEXT_GEN_PRESET.jsonMode);
        expect(preset.supportsImageInput).toBe(
          TEXT_GEN_PRESET.supportsImageInput
        );
      }),
      { numRuns: 100 }
    );
  });

  it("return value always has all required fields with correct types", () => {
    fc.assert(
      fc.property(fc.string(), taskType => {
        const preset = getAITaskPreset(taskType);

        expect(typeof preset.temperature).toBe("number");
        expect(typeof preset.maxTokens).toBe("number");
        expect(typeof preset.jsonMode).toBe("boolean");
        expect(typeof preset.supportsImageInput).toBe("boolean");

        // temperature should be in [0, 1] range
        expect(preset.temperature).toBeGreaterThanOrEqual(0);
        expect(preset.temperature).toBeLessThanOrEqual(1);

        // maxTokens should be positive
        expect(preset.maxTokens).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("text-generation preset has temperature 0.7, maxTokens 2048, jsonMode false", () => {
    fc.assert(
      fc.property(fc.constant("text-generation"), taskType => {
        const preset = getAITaskPreset(taskType);
        expect(preset.temperature).toBe(0.7);
        expect(preset.maxTokens).toBe(2048);
        expect(preset.jsonMode).toBe(false);
        expect(preset.supportsImageInput).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("code-generation preset has temperature 0.2, maxTokens 4096, jsonMode false", () => {
    fc.assert(
      fc.property(fc.constant("code-generation"), taskType => {
        const preset = getAITaskPreset(taskType);
        expect(preset.temperature).toBe(0.2);
        expect(preset.maxTokens).toBe(4096);
        expect(preset.jsonMode).toBe(false);
        expect(preset.supportsImageInput).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("data-analysis preset has temperature 0.1, maxTokens 4096, jsonMode true", () => {
    fc.assert(
      fc.property(fc.constant("data-analysis"), taskType => {
        const preset = getAITaskPreset(taskType);
        expect(preset.temperature).toBe(0.1);
        expect(preset.maxTokens).toBe(4096);
        expect(preset.jsonMode).toBe(true);
        expect(preset.supportsImageInput).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("image-understanding preset has temperature 0.5, maxTokens 2048, supportsImageInput true", () => {
    fc.assert(
      fc.property(fc.constant("image-understanding"), taskType => {
        const preset = getAITaskPreset(taskType);
        expect(preset.temperature).toBe(0.5);
        expect(preset.maxTokens).toBe(2048);
        expect(preset.jsonMode).toBe(false);
        expect(preset.supportsImageInput).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
