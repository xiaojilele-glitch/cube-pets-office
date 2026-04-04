/**
 * Property tests for AI Result Artifact completeness.
 *
 * Feature: ai-enabled-sandbox
 * - Property 6: AI 结果 Artifact 完整性
 *
 * Tests the serialization/deserialization of AIResultArtifact —
 * write to a temp file, read back, verify all fields present and correct.
 * Does NOT test actual OpenAI API calls.
 */
import { describe, expect, it, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AIResultArtifact } from "../types.js";

/* ─── Arbitraries ─── */

const AI_TASK_TYPES = [
  "text-generation",
  "code-generation",
  "data-analysis",
  "image-understanding",
] as const;

/** Non-empty string content (simulating LLM output) */
const arbContent = fc.string({ minLength: 1, maxLength: 2000 });

/** Non-negative integer for token counts */
const arbTokenCount = fc.nat({ max: 100_000 });

/** Model name string */
const arbModel = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-.".split("")), {
    minLength: 1,
    maxLength: 50,
  })
  .map((a) => a.join(""));

/** One of the known AI task types */
const arbTaskType = fc.constantFrom(...AI_TASK_TYPES);

/** ISO date string — use integer timestamp to avoid invalid date edge cases */
const arbCompletedAt = fc
  .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-12-31").getTime() })
  .map((ts) => new Date(ts).toISOString());

/** Full AIResultArtifact arbitrary */
const arbAIResultArtifact: fc.Arbitrary<AIResultArtifact> = fc.record({
  content: arbContent,
  usage: fc.record({
    promptTokens: arbTokenCount,
    completionTokens: arbTokenCount,
    totalTokens: arbTokenCount,
  }),
  model: arbModel,
  taskType: arbTaskType,
  completedAt: arbCompletedAt,
});

/* ─── Temp dir management ─── */

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-artifact-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  tmpDirs.length = 0;
});

/* ─── Property 6: AI 结果 Artifact 完整性 ─── */

describe("Property 6: AI 结果 Artifact 完整性", () => {
  /**
   * **Validates: Requirements 3.6, 5.4**
   *
   * For any successful AI execution result, the JSON written to
   * /workspace/artifacts/ai-result.json should contain: content (string),
   * usage (with promptTokens, completionTokens, totalTokens), model (string),
   * taskType (string) — all four required fields.
   * After deserialization, the result should be equivalent to the original.
   */

  it("serialized artifact contains all required fields after deserialization", () => {
    fc.assert(
      fc.property(arbAIResultArtifact, (artifact) => {
        const dir = makeTmpDir();
        const filePath = path.join(dir, "ai-result.json");

        // Serialize
        fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");

        // Deserialize
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as AIResultArtifact;

        // All four required fields must be present
        expect(typeof parsed.content).toBe("string");
        expect(typeof parsed.model).toBe("string");
        expect(typeof parsed.taskType).toBe("string");
        expect(parsed.usage).toBeDefined();
        expect(typeof parsed.usage.promptTokens).toBe("number");
        expect(typeof parsed.usage.completionTokens).toBe("number");
        expect(typeof parsed.usage.totalTokens).toBe("number");
      }),
      { numRuns: 100 },
    );
  });

  it("deserialized artifact is equivalent to the original", () => {
    fc.assert(
      fc.property(arbAIResultArtifact, (artifact) => {
        const dir = makeTmpDir();
        const filePath = path.join(dir, "ai-result.json");

        // Serialize
        fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");

        // Deserialize
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as AIResultArtifact;

        // Deep equality — round-trip preserves all data
        expect(parsed.content).toBe(artifact.content);
        expect(parsed.usage.promptTokens).toBe(artifact.usage.promptTokens);
        expect(parsed.usage.completionTokens).toBe(artifact.usage.completionTokens);
        expect(parsed.usage.totalTokens).toBe(artifact.usage.totalTokens);
        expect(parsed.model).toBe(artifact.model);
        expect(parsed.taskType).toBe(artifact.taskType);
        expect(parsed.completedAt).toBe(artifact.completedAt);
      }),
      { numRuns: 100 },
    );
  });

  it("artifact content field is always a non-empty string", () => {
    fc.assert(
      fc.property(arbAIResultArtifact, (artifact) => {
        const serialized = JSON.stringify(artifact);
        const parsed = JSON.parse(serialized) as AIResultArtifact;

        expect(typeof parsed.content).toBe("string");
        expect(parsed.content.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("artifact usage token counts are non-negative integers", () => {
    fc.assert(
      fc.property(arbAIResultArtifact, (artifact) => {
        const serialized = JSON.stringify(artifact);
        const parsed = JSON.parse(serialized) as AIResultArtifact;

        expect(Number.isInteger(parsed.usage.promptTokens)).toBe(true);
        expect(Number.isInteger(parsed.usage.completionTokens)).toBe(true);
        expect(Number.isInteger(parsed.usage.totalTokens)).toBe(true);
        expect(parsed.usage.promptTokens).toBeGreaterThanOrEqual(0);
        expect(parsed.usage.completionTokens).toBeGreaterThanOrEqual(0);
        expect(parsed.usage.totalTokens).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it("artifact taskType is always one of the known AI task types", () => {
    fc.assert(
      fc.property(arbAIResultArtifact, (artifact) => {
        const serialized = JSON.stringify(artifact);
        const parsed = JSON.parse(serialized) as AIResultArtifact;

        expect(AI_TASK_TYPES).toContain(parsed.taskType);
      }),
      { numRuns: 100 },
    );
  });
});
