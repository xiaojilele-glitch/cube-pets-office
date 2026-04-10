import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ExecutorJobRequest } from "../../../shared/executor/contracts.js";
import type { LobsterExecutorConfig, StoredJobRecord } from "./types.js";
import { DockerRunner } from "./docker-runner.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

function createExecutorConfig(dataRoot: string): LobsterExecutorConfig {
  return {
    host: "127.0.0.1",
    port: 3031,
    dataRoot,
    serviceName: "lobster-executor",
    executionMode: "real",
    defaultImage: "node:20-slim",
    maxConcurrentJobs: 1,
    callbackSecret: "secret",
    aiImage: "cube-ai-sandbox:latest",
    securityLevel: "strict",
    containerUser: "65534",
    maxMemory: "512m",
    maxCpus: "1.0",
    maxPids: 256,
    tmpfsSize: "64m",
    networkWhitelist: [],
  };
}

function createTestRequest(jobId: string): ExecutorJobRequest {
  const missionId = `mission-${jobId}`;
  return {
    version: "2026-03-28",
    requestId: `req-${jobId}`,
    missionId,
    jobId,
    executor: "lobster",
    createdAt: new Date().toISOString(),
    traceId: randomUUID(),
    idempotencyKey: `idem-${jobId}`,
    plan: {
      version: "2026-03-28",
      missionId,
      summary: `Docker execution for ${jobId}`,
      objective: "Verify docker cancel behavior",
      requestedBy: "brain",
      mode: "auto",
      steps: [
        {
          key: "dispatch",
          label: "Dispatch",
          description: "Accept the execution request",
        },
      ],
      jobs: [
        {
          id: jobId,
          key: `job-${jobId}`,
          label: `Job ${jobId}`,
          description: "Run docker executor flow",
          kind: "execute",
          payload: {},
        },
      ],
    },
    callback: {
      eventsUrl: "http://localhost:3999/api/executor/events",
      auth: {
        scheme: "hmac-sha256",
        executorHeader: "x-cube-executor-id",
        timestampHeader: "x-cube-executor-timestamp",
        signatureHeader: "x-cube-executor-signature",
        signedPayload: "timestamp.rawBody",
      },
    },
  };
}

function createStoredRecord(dataRoot: string, overrides: Partial<StoredJobRecord> = {}) {
  const request = createTestRequest(`job-${randomUUID()}`);
  const dataDirectory = join(dataRoot, "jobs", request.missionId, request.jobId);
  mkdirSync(dataDirectory, { recursive: true });
  const logFile = join(dataDirectory, "executor.log");
  writeFileSync(logFile, "", "utf-8");

  const record: StoredJobRecord = {
    acceptedResponse: {
      ok: true,
      accepted: true,
      requestId: request.requestId,
      missionId: request.missionId,
      jobId: request.jobId,
      receivedAt: new Date().toISOString(),
    },
    request,
    planJob: request.plan.jobs[0],
    status: "running",
    progress: 48,
    message: "Job is running",
    receivedAt: new Date().toISOString(),
    artifacts: [],
    events: [],
    dataDirectory,
    logFile,
    executionMode: "real",
    ...overrides,
  };

  return record;
}

describe("DockerRunner cancellation helpers", () => {
  it("stops the running container and appends the cancel reason to the log", async () => {
    const dataRoot = join(tmpdir(), `docker-runner-cancel-${randomUUID()}`);
    cleanupPaths.push(dataRoot);

    const stop = vi.fn().mockResolvedValue(undefined);
    const kill = vi.fn().mockResolvedValue(undefined);
    const docker = {
      getContainer: vi.fn(() => ({
        stop,
        kill,
      })),
    };

    const runner = new DockerRunner(
      createExecutorConfig(dataRoot),
      { send: vi.fn().mockResolvedValue(undefined) } as never,
      docker as never,
    );
    const record = createStoredRecord(dataRoot, {
      containerId: "container-123",
      cancelRequested: {
        requestedAt: new Date().toISOString(),
        reason: "Stop this container",
      },
    });

    await runner.cancel(record);

    expect(docker.getContainer).toHaveBeenCalledWith("container-123");
    expect(stop).toHaveBeenCalledWith({ t: 10 });
    expect(kill).not.toHaveBeenCalled();
    expect(record.message).toBe("Stop this container");
    expect(readFileSync(record.logFile, "utf-8")).toContain(
      "[cancel] Stop this container",
    );
  });

  it("kills the container when stop does not finish within the timeout", async () => {
    vi.useFakeTimers();

    const dataRoot = join(tmpdir(), `docker-runner-cancel-${randomUUID()}`);
    cleanupPaths.push(dataRoot);

    const stop = vi.fn(() => new Promise(() => undefined));
    const kill = vi.fn().mockResolvedValue(undefined);
    const docker = {
      getContainer: vi.fn(() => ({
        stop,
        kill,
      })),
    };

    const runner = new DockerRunner(
      createExecutorConfig(dataRoot),
      { send: vi.fn().mockResolvedValue(undefined) } as never,
      docker as never,
    );
    const record = createStoredRecord(dataRoot, {
      containerId: "container-timeout",
      cancelRequested: {
        requestedAt: new Date().toISOString(),
        reason: "Timeout while stopping",
      },
    });

    const cancellation = runner.cancel(record);
    await vi.advanceTimersByTimeAsync(1600);
    await cancellation;

    expect(stop).toHaveBeenCalledWith({ t: 10 });
    expect(kill).toHaveBeenCalledWith({ signal: "SIGKILL" });
  });

  it("writes a cancelled result payload for cancelled docker jobs", () => {
    const dataRoot = join(tmpdir(), `docker-runner-cancel-${randomUUID()}`);
    cleanupPaths.push(dataRoot);

    const runner = new DockerRunner(
      createExecutorConfig(dataRoot),
      { send: vi.fn().mockResolvedValue(undefined) } as never,
      { getContainer: vi.fn() } as never,
    );
    const record = createStoredRecord(dataRoot);

    const resultFile = (
      runner as unknown as {
        writeResult: (
          record: StoredJobRecord,
          exitCode: number,
          durationMs: number,
          timedOut: boolean,
          options: { outcome: "cancelled"; summary: string },
        ) => string;
      }
    ).writeResult(record, 137, 1234, false, {
      outcome: "cancelled",
      summary: "Stopped by operator",
    });

    expect(JSON.parse(readFileSync(resultFile, "utf-8"))).toMatchObject({
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      outcome: "cancelled",
      summary: "Stopped by operator",
      exitCode: 137,
      durationMs: 1234,
    });
  });

  it("pauses and resumes the running container", async () => {
    const dataRoot = join(tmpdir(), `docker-runner-control-${randomUUID()}`);
    cleanupPaths.push(dataRoot);

    const pause = vi.fn().mockResolvedValue(undefined);
    const unpause = vi.fn().mockResolvedValue(undefined);
    const docker = {
      getContainer: vi.fn(() => ({
        pause,
        unpause,
      })),
    };

    const runner = new DockerRunner(
      createExecutorConfig(dataRoot),
      { send: vi.fn().mockResolvedValue(undefined) } as never,
      docker as never,
    );
    const record = createStoredRecord(dataRoot, {
      containerId: "container-pause",
      pauseRequested: {
        requestedAt: new Date().toISOString(),
        reason: "Inspect container state",
      },
    });

    await runner.pause(record);
    await runner.resume(record);

    expect(docker.getContainer).toHaveBeenCalledWith("container-pause");
    expect(pause).toHaveBeenCalledTimes(1);
    expect(unpause).toHaveBeenCalledTimes(1);
    expect(readFileSync(record.logFile, "utf-8")).toContain(
      "[pause] Inspect container state",
    );
    expect(readFileSync(record.logFile, "utf-8")).toContain(
      "[resume] Resume requested",
    );
  });
});
