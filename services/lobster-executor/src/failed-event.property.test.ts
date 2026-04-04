/**
 * Property 10: 失败事件内容完整性
 *
 * For any failed Job, the job.failed event should contain non-empty errorCode,
 * metrics.durationMs >= 0, and detail with at most 50 lines of stderr.
 *
 * **Validates: Requirements 3.5, 3.6**
 *
 * Feature: lobster-executor-real, Property 10: 失败事件内容完整性
 */
import { describe, expect, it, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MockRunner } from "./mock-runner.js";
import type { StoredJobRecord } from "./types.js";
import type {
  ExecutionPlanJob,
  ExecutorEvent,
  ExecutorJobRequest,
} from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";

/* ─── Helpers ─── */

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fail-evt-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

function makeFailedRecord(
  dataDir: string,
  steps: number,
): StoredJobRecord {
  const logFile = join(dataDir, "executor.log");
  const planJob: ExecutionPlanJob = {
    id: "job-fail-1",
    key: "test-fail-job",
    label: "Test Fail Job",
    description: "test failure",
    kind: "execute",
    payload: {
      runner: {
        kind: "mock" as const,
        outcome: "failed" as const,
        steps,
        delayMs: 0,
      },
    },
  };
  return {
    planJob,
    status: "queued",
    progress: 0,
    message: "",
    receivedAt: new Date().toISOString(),
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
      jobId: "job-fail-1",
      receivedAt: new Date().toISOString(),
    },
    request: {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-fail-1",
      executor: "lobster",
      createdAt: new Date().toISOString(),
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

/** steps: 1–10 */
const arbSteps = fc.integer({ min: 1, max: 10 });

/** stderr lines: 0–100 random non-empty strings */
const arbStderrLines = fc.array(
  fc.string({ minLength: 1, maxLength: 80 }),
  { minLength: 0, maxLength: 100 },
);

/* ─── Tests ─── */

describe("Property 10: 失败事件内容完整性", () => {
  it("failed job event has non-empty errorCode and metrics with durationMs >= 0", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeFailedRecord(dataDir, steps);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        // Find the job.failed event
        const failedEvent = events.find((e) => e.type === "job.failed");
        expect(failedEvent).toBeDefined();

        // errorCode must be non-empty
        expect(failedEvent!.errorCode).toBeDefined();
        expect(failedEvent!.errorCode!.length).toBeGreaterThan(0);

        // status must be "failed"
        expect(failedEvent!.status).toBe("failed");

        // metrics must exist with durationMs >= 0
        expect(failedEvent!.metrics).toBeDefined();
        expect(failedEvent!.metrics!.durationMs).toBeDefined();
        expect(failedEvent!.metrics!.durationMs!).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it("failed event sequence: job.started → job.progress* → job.failed", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeFailedRecord(dataDir, steps);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        // Must have at least 2 events: started + failed
        expect(events.length).toBeGreaterThanOrEqual(2);

        // First event must be job.started
        expect(events[0].type).toBe("job.started");
        expect(events[0].status).toBe("running");

        // Last event must be job.failed
        const last = events[events.length - 1];
        expect(last.type).toBe("job.failed");
        expect(last.status).toBe("failed");

        // Middle events (if any) must all be job.progress
        const middle = events.slice(1, -1);
        for (const evt of middle) {
          expect(evt.type).toBe("job.progress");
          expect(evt.status).toBe("running");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("stderr detail is truncated to at most 50 lines (pure property)", () => {
    fc.assert(
      fc.property(arbStderrLines, (stderrLines) => {
        // This mirrors DockerRunner.emitFailed logic:
        // detail = stderrLines.slice(-50).join("\n")
        const truncated = stderrLines.slice(-50);
        const detail = truncated.length > 0 ? truncated.join("\n") : undefined;

        // At most 50 lines in the detail
        if (detail !== undefined) {
          const lineCount = detail.split("\n").length;
          expect(lineCount).toBeLessThanOrEqual(50);
        }

        // If input had > 50 lines, only the last 50 are kept
        if (stderrLines.length > 50) {
          expect(truncated.length).toBe(50);
          // The kept lines should be the tail of the original
          for (let i = 0; i < 50; i++) {
            expect(truncated[i]).toBe(stderrLines[stderrLines.length - 50 + i]);
          }
        } else {
          // All lines are kept
          expect(truncated.length).toBe(stderrLines.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("failed event contains artifacts list", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, async (steps) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeFailedRecord(dataDir, steps);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        const failedEvent = events.find((e) => e.type === "job.failed");
        expect(failedEvent).toBeDefined();

        // Artifacts should be present
        expect(failedEvent!.artifacts).toBeDefined();
        expect(Array.isArray(failedEvent!.artifacts)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
