/**
 * Property 4: 容器清理后文件保留
 *
 * For any completed Job (success or failure), the container should be
 * removed but log files and artifacts directory should remain in
 * dataDirectory.
 *
 * Since we cannot run real Docker containers in tests, we validate this
 * property using MockRunner. After MockRunner completes:
 * - record.logFile (executor.log) should exist in dataDirectory
 * - result.json should exist in dataDirectory
 * - dataDirectory itself should still exist
 * - record.artifacts array should be non-empty
 *
 * **Validates: Requirements 1.9, 1.10**
 *
 * Feature: lobster-executor-real, Property 4: 容器清理后文件保留
 */
import { describe, expect, it, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "cleanup-prop-"));
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
  outcome: "success" | "failed",
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
        outcome,
        steps,
        delayMs: 0,
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

/** outcome: success or failed */
const arbOutcome = fc.constantFrom("success" as const, "failed" as const);

/** optional log lines: 1–10 non-empty strings */
const arbLogs = fc.option(
  fc.array(fc.string({ minLength: 1, maxLength: 40 }), {
    minLength: 1,
    maxLength: 10,
  }),
  { nil: undefined },
);

/* ─── Tests ─── */

describe("Property 4: 容器清理后文件保留", () => {
  it("after job completion (success or failure), dataDirectory, log file, and result.json remain", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, arbOutcome, arbLogs, async (steps, outcome, logs) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeRecord(dataDir, steps, outcome, logs ?? undefined);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        // dataDirectory should still exist after completion
        expect(existsSync(record.dataDirectory)).toBe(true);

        // Log file (executor.log) should exist in dataDirectory
        expect(existsSync(record.logFile)).toBe(true);

        // result.json should exist in dataDirectory
        expect(existsSync(join(record.dataDirectory, "result.json"))).toBe(true);

        // Artifacts array should be non-empty
        expect(record.artifacts.length).toBeGreaterThan(0);

        // Job should be in a terminal state (completed or failed)
        expect(["completed", "failed"]).toContain(record.status);
      }),
      { numRuns: 100 },
    );
  });

  it("log file artifact path references the correct file", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, arbOutcome, arbLogs, async (steps, outcome, logs) => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
        const record = makeRecord(dataDir, steps, outcome, logs ?? undefined);

        const events: ExecutorEvent[] = [];
        await runner.run(record, (evt) => events.push(evt));

        // Should have a log artifact named "executor.log"
        const logArtifact = record.artifacts.find((a) => a.name === "executor.log");
        expect(logArtifact).toBeDefined();
        expect(logArtifact!.kind).toBe("log");

        // Should have a result artifact named "result.json"
        const resultArtifact = record.artifacts.find((a) => a.name === "result.json");
        expect(resultArtifact).toBeDefined();
        expect(resultArtifact!.kind).toBe("report");
      }),
      { numRuns: 100 },
    );
  });

  it("files persist regardless of outcome (success vs failure)", async () => {
    await fc.assert(
      fc.asyncProperty(arbSteps, arbLogs, async (steps, logs) => {
        // Run both success and failure with same config, both should retain files
        for (const outcome of ["success", "failed"] as const) {
          const dataDir = makeTempDir();
          const runner = new MockRunner({ sleep: async () => {}, now: () => new Date() });
          const record = makeRecord(dataDir, steps, outcome, logs ?? undefined);

          const events: ExecutorEvent[] = [];
          await runner.run(record, (evt) => events.push(evt));

          // All files must exist regardless of outcome
          expect(existsSync(record.dataDirectory)).toBe(true);
          expect(existsSync(record.logFile)).toBe(true);
          expect(existsSync(join(record.dataDirectory, "result.json"))).toBe(true);
          expect(record.artifacts.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
