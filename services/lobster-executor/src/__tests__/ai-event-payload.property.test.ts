/**
 * Property tests for AI event payload in DockerRunner.
 *
 * Feature: ai-enabled-sandbox
 * - Property 9: AI 完成事件 contentPreview 截断
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { DockerRunner } from "../docker-runner.js";
import type { AIResultArtifact } from "../types.js";

/* ─── Arbitraries ─── */

/** Arbitrary AI result content — any string including very long ones */
const arbContent = fc.string({ minLength: 0, maxLength: 1000 });

/** Arbitrary token usage numbers */
const arbUsage = fc.record({
  promptTokens: fc.nat({ max: 100000 }),
  completionTokens: fc.nat({ max: 100000 }),
  totalTokens: fc.nat({ max: 200000 }),
});

/** Arbitrary model name */
const arbModel = fc
  .array(
    fc.constantFrom(
      ...("abcdefghijklmnopqrstuvwxyz0123456789-.".split("")),
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((a) => a.join(""));

/** Arbitrary task type */
const arbTaskType = fc.constantFrom(
  "text-generation",
  "code-generation",
  "data-analysis",
  "image-understanding",
);

/** Full AIResultArtifact arbitrary */
const arbAIResult = fc
  .tuple(arbContent, arbUsage, arbModel, arbTaskType)
  .map(
    ([content, usage, model, taskType]): AIResultArtifact => ({
      content,
      usage,
      model,
      taskType,
      completedAt: new Date().toISOString(),
    }),
  );

/* ─── Property 9: AI 完成事件 contentPreview 截断 ─── */

describe("Property 9: AI 完成事件 contentPreview 截断", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any AI generation result, contentPreview field length should be ≤ 200 chars.
   * If original content > 200, contentPreview should be first 200 chars.
   */

  it("contentPreview length is always ≤ 200 characters", () => {
    fc.assert(
      fc.property(arbAIResult, (aiResult) => {
        const summary = DockerRunner.buildAIResultSummary(aiResult);

        expect(summary.contentPreview.length).toBeLessThanOrEqual(200);
      }),
      { numRuns: 100 },
    );
  });

  it("when content ≤ 200 chars, contentPreview equals content exactly", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        arbUsage,
        arbModel,
        arbTaskType,
        (content, usage, model, taskType) => {
          const aiResult: AIResultArtifact = {
            content,
            usage,
            model,
            taskType,
            completedAt: new Date().toISOString(),
          };

          const summary = DockerRunner.buildAIResultSummary(aiResult);

          expect(summary.contentPreview).toBe(content);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when content > 200 chars, contentPreview is first 200 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 201, maxLength: 1000 }),
        arbUsage,
        arbModel,
        arbTaskType,
        (content, usage, model, taskType) => {
          const aiResult: AIResultArtifact = {
            content,
            usage,
            model,
            taskType,
            completedAt: new Date().toISOString(),
          };

          const summary = DockerRunner.buildAIResultSummary(aiResult);

          expect(summary.contentPreview).toBe(content.slice(0, 200));
          expect(summary.contentPreview.length).toBe(200);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("summary preserves tokenUsage and model from the original result", () => {
    fc.assert(
      fc.property(arbAIResult, (aiResult) => {
        const summary = DockerRunner.buildAIResultSummary(aiResult);

        expect(summary.tokenUsage).toEqual(aiResult.usage);
        expect(summary.model).toBe(aiResult.model);
      }),
      { numRuns: 100 },
    );
  });
});
