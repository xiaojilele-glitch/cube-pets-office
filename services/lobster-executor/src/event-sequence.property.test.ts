/**
 * Property 9: 事件序列顺序
 *
 * For any successfully completed Job, events should start with
 * job.started (status: running), followed by zero or more job.progress
 * (status: running), ending with job.completed (status: completed).
 *
 * Note: job.accepted is emitted by the service layer (LobsterExecutorService.submit),
 * not by the runner. This test validates the runner-level event sequence.
 *
 * **Validates: Requirements 3.1, 3.2, 3.4**
 *
 * Feature: lobster-executor-real, Property 9: 事件序列顺序
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
  const dir = mkdtempSync(join(tmpdir(), "evt-seq-"));
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

function makeRecord(
  dataDir: string,
  steps: number,
  delayMs: number,
  logs?: string[],
): StoredJobRecord {
  const logFile = join(dataDir, "executor.log");
  const planJob: ExecutionPlanJob = {
    id: "job-1",
    key: "test-job",
    label: "Test Job",
    description: "test",
    kind: "execute",
    payload: {
      runner: {
        kind: "mock" as const,
        outcome: "success" as const,
        steps,
        delayMs,
        ...(logs && logs.length > 0 ? { logs } : {}),
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
      jobId: "job-1",
      receivedAt: new Date().toISOString(),
    },
    request: {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-1",
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

/** optional log lines: 1–10 non-empty strings */
const arbLogs = fc.option(
  fc.array(fc.string({ minLength: 1, maxLength: 40 }), {
    minLength: 1,
    maxLength: 10,
  }),
  { nil: undefined },
);

/* ─── Tests ─── */

describe("Property 9: 事件序列顺序", () => {
  it("successful job events: job.started → job.progress* → job.completed", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, arbLogs, async (steps, logs) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeRecord(dataDir, steps, 0, logs ?? undefined);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        // Must have at least 2 events: started + completed
        expect(events.length).toBeGreaterThanOrEqual(2);

        // First event must be job.started with status running
        expect(events[0].type).toBe("job.started");
        expect(events[0].status).toBe("running");

        // Last event must be job.completed with status completed
        const last = events[events.length - 1];
        expect(last.type).toBe("job.completed");
        expect(last.status).toBe("completed");

        // Middle events (if any) must all be job.progress with status running
        const middle = events.slice(1, -1);
        for (const evt of middle) {
          expect(evt.type).toBe("job.progress");
          expect(evt.status).toBe("running");
        }

        // Status transitions: running → running → ... → completed
        const statuses = events.map((e) => e.status);
        const runningCount = statuses.filter((s) => s === "running").length;
        const completedCount = statuses.filter((s) => s === "completed").length;
        expect(completedCount).toBe(1);
        expect(runningCount).toBe(events.length - 1);

        // Event types sequence: started, progress*, completed
        const types = events.map((e) => e.type);
        expect(types[0]).toBe("job.started");
        expect(types[types.length - 1]).toBe("job.completed");
        for (let i = 1; i < types.length - 1; i++) {
          expect(types[i]).toBe("job.progress");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("progress values are monotonically non-decreasing", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, arbLogs, async (steps, logs) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeRecord(dataDir, steps, 0, logs ?? undefined);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        for (let i = 1; i < events.length; i++) {
          const prev = events[i - 1].progress ?? 0;
          const curr = events[i].progress ?? 0;
          expect(curr).toBeGreaterThanOrEqual(prev);
        }

        // Final event should have progress 100
        expect(events[events.length - 1].progress).toBe(100);
      }),
      { numRuns: 100 },
    );
  });

  it("completed event contains artifacts and metrics with durationMs", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, arbLogs, async (steps, logs) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeRecord(dataDir, steps, 0, logs ?? undefined);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        const completed = events.find((e) => e.type === "job.completed");
        expect(completed).toBeDefined();
        expect(completed!.artifacts).toBeDefined();
        expect(completed!.artifacts!.length).toBeGreaterThan(0);
        expect(completed!.metrics).toBeDefined();
        expect(completed!.metrics!.durationMs).toBeDefined();
        expect(completed!.metrics!.durationMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});
