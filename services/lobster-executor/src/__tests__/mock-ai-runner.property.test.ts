/**
 * Property tests for MockRunner AI simulation.
 *
 * Feature: ai-enabled-sandbox
 * - Property 10: Mock 模式 AI 响应一致性
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

import { MockRunner } from "../mock-runner.js";
import type { StoredJobRecord } from "../types.js";
import type {
  ExecutionPlanJob,
  ExecutorEvent,
  ExecutorJobRequest,
} from "../../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../../shared/executor/contracts.js";

/* ─── Expected constants (must match mock-runner.ts MOCK_AI_RESULT) ─── */

const EXPECTED_MOCK_AI = {
  content: "This is a mock AI response for testing purposes.",
  usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
  model: "mock-model",
};

/* ─── Helpers ─── */

const FIXED_DATE = new Date("2026-04-04T12:00:00.000Z");
const instantSleep = async () => {};
const fixedNow = () => FIXED_DATE;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mock-ai-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeRecord(
  payload: Record<string, unknown>,
  dataDir: string,
): StoredJobRecord {
  const planJob: ExecutionPlanJob = {
    id: "job-1",
    key: "ai-test-job",
    label: "AI Test Job",
    description: "test ai mock",
    kind: "execute",
    payload: {
      ...payload,
      runner: { kind: "mock", outcome: "success", steps: 1, delayMs: 0 },
    },
  };

  const logFile = join(dataDir, "executor.log");
  // Ensure log file exists so appendFileSync works
  require("node:fs").writeFileSync(logFile, "", "utf-8");

  return {
    planJob,
    status: "queued",
    progress: 0,
    message: "",
    receivedAt: FIXED_DATE.toISOString(),
    artifacts: [],
    events: [],
    dataDirectory: dataDir,
    logFile,
    executionMode: "mock",
    acceptedResponse: {
      ok: true as const,
      accepted: true as const,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-1",
      receivedAt: FIXED_DATE.toISOString(),
    },
    request: {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-1",
      executor: "lobster",
      createdAt: FIXED_DATE.toISOString(),
      plan: {
        version: EXECUTOR_CONTRACT_VERSION,
        missionId: "m1",
        summary: "test",
        objective: "test",
        requestedBy: "brain",
        mode: "auto",
        steps: [],
        jobs: [planJob],
      },
      callback: {
        eventsUrl: "http://localhost/events",
        auth: {
          scheme: "hmac-sha256",
          executorHeader: "x-cube-executor-id",
          timestampHeader: "x-cube-executor-timestamp",
          signatureHeader: "x-cube-executor-signature",
          signedPayload: "timestamp.rawBody",
        },
      },
    } as ExecutorJobRequest,
  };
}

/* ─── Arbitraries ─── */

/** AI task type — either a known type or undefined (should default to text-generation) */
const arbAiTaskType = fc.constantFrom(
  "text-generation",
  "code-generation",
  "data-analysis",
  "image-understanding",
  undefined,
);

/* ─── Property 10: Mock 模式 AI 响应一致性 ─── */

describe("Property 10: Mock 模式 AI 响应一致性", () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any aiEnabled=true Job in mock mode, the completed event should contain
   * fixed mock AI response (content, usage, model fields are all predefined values),
   * and artifacts should include ai-result.json.
   */

  it("completed event contains fixed mock AI response for any aiEnabled=true job", async () => {
    await fc.assert(
      fc.asyncProperty(arbAiTaskType, async (aiTaskType) => {
        const runner = new MockRunner({ sleep: instantSleep, now: fixedNow });
        const payload: Record<string, unknown> = { aiEnabled: true };
        if (aiTaskType !== undefined) {
          payload.aiTaskType = aiTaskType;
        }

        const jobDir = join(tempDir, `job-${Math.random().toString(36).slice(2)}`);
        require("node:fs").mkdirSync(jobDir, { recursive: true });

        const record = makeRecord(payload, jobDir);
        const events: ExecutorEvent[] = [];
        await runner.run(record, (e) => events.push(e));

        // Find the completed event
        const completed = events.find((e) => e.type === "job.completed");
        expect(completed).toBeDefined();

        // Verify payload exists with AI result
        const ep = completed!.payload as Record<string, unknown>;
        expect(ep).toBeDefined();

        // aiTaskType should match payload or default to text-generation
        const expectedTaskType = aiTaskType ?? "text-generation";
        expect(ep.aiTaskType).toBe(expectedTaskType);
        expect(ep.aiModel).toBe(EXPECTED_MOCK_AI.model);

        // aiResult summary
        const aiResult = ep.aiResult as Record<string, unknown>;
        expect(aiResult).toBeDefined();
        expect(aiResult.model).toBe(EXPECTED_MOCK_AI.model);
        expect(aiResult.contentPreview).toBe(EXPECTED_MOCK_AI.content);

        const tokenUsage = aiResult.tokenUsage as Record<string, number>;
        expect(tokenUsage.promptTokens).toBe(EXPECTED_MOCK_AI.usage.promptTokens);
        expect(tokenUsage.completionTokens).toBe(EXPECTED_MOCK_AI.usage.completionTokens);
        expect(tokenUsage.totalTokens).toBe(EXPECTED_MOCK_AI.usage.totalTokens);
      }),
      { numRuns: 100 },
    );
  });

  it("artifacts include ai-result.json for any aiEnabled=true job", async () => {
    await fc.assert(
      fc.asyncProperty(arbAiTaskType, async (aiTaskType) => {
        const runner = new MockRunner({ sleep: instantSleep, now: fixedNow });
        const payload: Record<string, unknown> = { aiEnabled: true };
        if (aiTaskType !== undefined) {
          payload.aiTaskType = aiTaskType;
        }

        const jobDir = join(tempDir, `job-${Math.random().toString(36).slice(2)}`);
        require("node:fs").mkdirSync(jobDir, { recursive: true });

        const record = makeRecord(payload, jobDir);
        const events: ExecutorEvent[] = [];
        await runner.run(record, (e) => events.push(e));

        // Check completed event artifacts
        const completed = events.find((e) => e.type === "job.completed");
        expect(completed).toBeDefined();
        const artifactNames = (completed!.artifacts ?? []).map((a) => a.name);
        expect(artifactNames).toContain("ai-result.json");

        // Verify the file was actually written
        const aiResultPath = join(jobDir, "artifacts", "ai-result.json");
        expect(existsSync(aiResultPath)).toBe(true);

        // Verify file content matches expected mock values
        const fileContent = JSON.parse(readFileSync(aiResultPath, "utf-8"));
        expect(fileContent.content).toBe(EXPECTED_MOCK_AI.content);
        expect(fileContent.model).toBe(EXPECTED_MOCK_AI.model);
        expect(fileContent.usage).toEqual(EXPECTED_MOCK_AI.usage);

        const expectedTaskType = aiTaskType ?? "text-generation";
        expect(fileContent.taskType).toBe(expectedTaskType);
      }),
      { numRuns: 100 },
    );
  });

  it("non-AI jobs do not include ai-result.json or AI payload", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(false, undefined),
        async (aiEnabled) => {
          const runner = new MockRunner({ sleep: instantSleep, now: fixedNow });
          const payload: Record<string, unknown> = {};
          if (aiEnabled !== undefined) {
            payload.aiEnabled = aiEnabled;
          }

          const jobDir = join(tempDir, `job-${Math.random().toString(36).slice(2)}`);
          require("node:fs").mkdirSync(jobDir, { recursive: true });

          const record = makeRecord(payload, jobDir);
          const events: ExecutorEvent[] = [];
          await runner.run(record, (e) => events.push(e));

          const completed = events.find((e) => e.type === "job.completed");
          expect(completed).toBeDefined();

          // No AI payload
          expect(completed!.payload).toBeUndefined();

          // No ai-result.json artifact
          const artifactNames = (completed!.artifacts ?? []).map((a) => a.name);
          expect(artifactNames).not.toContain("ai-result.json");

          // No ai-result.json file
          const aiResultPath = join(jobDir, "artifacts", "ai-result.json");
          expect(existsSync(aiResultPath)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
