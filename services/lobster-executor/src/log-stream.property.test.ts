/**
 * Property 5: 日志流完整性
 *
 * For any sequence of stdout/stderr output from a container, the Job's log
 * file should contain all output lines in order.
 *
 * Since we can't run real Docker containers, we test via MockRunner which
 * writes log lines using `appendLog(record, logMessage)` for each step,
 * producing `[ISO_TIMESTAMP] message\n` entries in the log file.
 *
 * **Validates: Requirements 1.5**
 *
 * Feature: lobster-executor-real, Property 5: 日志流完整性
 */
import { describe, expect, it, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "log-stream-"));
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

function makeRecord(dataDir: string, logs: string[]): StoredJobRecord {
  const logFile = join(dataDir, "executor.log");
  const planJob: ExecutionPlanJob = {
    id: "job-log-1",
    key: "test-log-job",
    label: "Test Log Job",
    description: "test log streaming",
    kind: "execute",
    payload: {
      runner: {
        kind: "mock" as const,
        outcome: "success" as const,
        steps: logs.length,
        delayMs: 0,
        logs,
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
      jobId: "job-log-1",
      receivedAt: new Date().toISOString(),
    },
    request: {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-log-1",
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

/**
 * Extract the message portion from a log line formatted as
 * `[ISO_TIMESTAMP] message`.
 */
function extractMessage(logLine: string): string {
  const match = logLine.match(/^\[.*?\]\s(.*)$/);
  return match ? match[1] : logLine;
}

/* ─── Arbitraries ─── */

/**
 * Generate 1–20 non-empty log message strings.
 * Avoid newlines inside messages since each log line is delimited by \n.
 */
const arbLogs = fc.array(
  fc.string({ minLength: 1, maxLength: 80 }).filter(s => !s.includes("\n")),
  { minLength: 1, maxLength: 20 }
);

/* ─── Tests ─── */

describe("Property 5: 日志流完整性", () => {
  it("all log messages appear in the log file in order with none missing", async () => {
    await fc.assert(
      fc.asyncProperty(arbLogs, async logs => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({
          sleep: async () => {},
          now: () => new Date(),
        });
        const record = makeRecord(dataDir, logs);

        const events: ExecutorEvent[] = [];
        await runner.run(record, evt => events.push(evt));

        // Read the log file
        const logContent = readFileSync(record.logFile, "utf-8");
        const logLines = logContent.split("\n").filter(l => l.length > 0);

        // Extract messages from log lines
        const loggedMessages = logLines.map(extractMessage);

        // All input log messages must appear in the log file
        expect(loggedMessages.length).toBeGreaterThanOrEqual(logs.length);

        // Find each expected log message in order
        let searchFrom = 0;
        for (const expectedMsg of logs) {
          const idx = loggedMessages.indexOf(expectedMsg, searchFrom);
          expect(idx).toBeGreaterThanOrEqual(searchFrom);
          searchFrom = idx + 1;
        }
      }),
      { numRuns: 100 }
    );
  });

  it("log file line count matches the number of steps executed", async () => {
    await fc.assert(
      fc.asyncProperty(arbLogs, async logs => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({
          sleep: async () => {},
          now: () => new Date(),
        });
        const record = makeRecord(dataDir, logs);

        const events: ExecutorEvent[] = [];
        await runner.run(record, evt => events.push(evt));

        const logContent = readFileSync(record.logFile, "utf-8");
        const logLines = logContent.split("\n").filter(l => l.length > 0);

        // MockRunner writes one log line per step; steps = max(runner.steps, logs.length)
        // Since we set steps = logs.length, there should be exactly logs.length lines
        expect(logLines.length).toBe(logs.length);
      }),
      { numRuns: 100 }
    );
  });

  it("each log line follows the [timestamp] message format", async () => {
    await fc.assert(
      fc.asyncProperty(arbLogs, async logs => {
        const dataDir = makeTempDir();
        const runner = new MockRunner({
          sleep: async () => {},
          now: () => new Date(),
        });
        const record = makeRecord(dataDir, logs);

        const events: ExecutorEvent[] = [];
        await runner.run(record, evt => events.push(evt));

        const logContent = readFileSync(record.logFile, "utf-8");
        const logLines = logContent.split("\n").filter(l => l.length > 0);

        // Every line must match the [ISO_TIMESTAMP] message format
        const timestampPattern = /^\[.+?\] .+$/;
        for (const line of logLines) {
          expect(line).toMatch(timestampPattern);
        }
      }),
      { numRuns: 100 }
    );
  });
});
