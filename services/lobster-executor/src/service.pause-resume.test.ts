import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ExecutorJobRequest } from "../../../shared/executor/contracts.js";
import type { StoredJobRecord } from "./types.js";
import { createLobsterExecutorService } from "./service.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

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
      summary: `Mock execution for ${jobId}`,
      objective: "Verify pause and resume behavior",
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
          description: "Run mock executor flow",
          kind: "execute",
          payload: {
            runner: {
              kind: "mock",
              outcome: "success",
              steps: 2,
              delayMs: 10,
            },
          },
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

function createSeededService(status: StoredJobRecord["status"] = "queued") {
  const dataRoot = join(tmpdir(), `lobster-executor-pause-${randomUUID()}`);
  cleanupPaths.push(dataRoot);

  const service = createLobsterExecutorService({ dataRoot });
  const request = createTestRequest(`job-${randomUUID()}`);
  const receivedAt = new Date().toISOString();
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
      receivedAt,
    },
    request,
    planJob: request.plan.jobs[0],
    status,
    progress: status === "running" ? 42 : 0,
    message: `Job is ${status}`,
    receivedAt,
    artifacts: [],
    events: [],
    dataDirectory,
    logFile,
    executionMode: "mock",
  };

  ((service as unknown as { jobs: Map<string, StoredJobRecord> }).jobs).set(
    request.jobId,
    record
  );

  return { service, record };
}

describe("LobsterExecutorService.pause/resume", () => {
  it("pauses queued jobs and resumes them back to active execution", async () => {
    const { service, record } = createSeededService("queued");

    const pauseResponse = await service.pause(record.request.jobId, {
      reason: "Wait before dispatch",
      requestedBy: "operator",
      source: "user",
    });

    expect(pauseResponse).toMatchObject({
      ok: true,
      accepted: true,
      pauseRequested: true,
      status: "queued",
      message: "Wait before dispatch",
    });
    expect(record.pausedAt).toBeDefined();
    expect(record.pauseRequested).toMatchObject({
      reason: "Wait before dispatch",
      requestedBy: "operator",
      source: "user",
    });
    expect(readFileSync(record.logFile, "utf-8")).toContain(
      "[pause] Wait before dispatch"
    );

    const resumeResponse = await service.resume(record.request.jobId, {
      reason: "Continue dispatch",
      requestedBy: "operator",
      source: "user",
    });

    expect(resumeResponse).toMatchObject({
      ok: true,
      accepted: true,
      resumeRequested: true,
      status: "queued",
      message: "Continue dispatch",
    });
    expect(record.pausedAt).toBeUndefined();
    expect(record.pauseRequested).toBeUndefined();
    expect(readFileSync(record.logFile, "utf-8")).toContain(
      "[resume] Continue dispatch"
    );
  });

  it("delegates running pause/resume operations to the runner", async () => {
    const { service, record } = createSeededService("running");
    const runnerPause = vi.fn().mockResolvedValue(undefined);
    const runnerResume = vi.fn().mockResolvedValue(undefined);
    (
      service as unknown as {
        runner: {
          pause: typeof runnerPause;
          resume: typeof runnerResume;
        };
      }
    ).runner = {
      pause: runnerPause,
      resume: runnerResume,
    };

    await service.pause(record.request.jobId, {
      reason: "Inspect live container",
    });
    await service.resume(record.request.jobId, {
      reason: "Resume live container",
    });

    expect(runnerPause).toHaveBeenCalledWith(record);
    expect(runnerResume).toHaveBeenCalledWith(record);
  });

  it("treats repeated pause and resume requests as idempotent", async () => {
    const { service, record } = createSeededService("queued");

    const firstPause = await service.pause(record.request.jobId, {
      reason: "Pause once",
    });
    const secondPause = await service.pause(record.request.jobId, {
      reason: "Pause twice",
    });

    expect(firstPause.pauseRequested).toBe(true);
    expect(secondPause.alreadyPaused).toBe(true);

    const firstResume = await service.resume(record.request.jobId, {
      reason: "Resume once",
    });
    const secondResume = await service.resume(record.request.jobId, {
      reason: "Resume twice",
    });

    expect(firstResume.resumeRequested).toBe(true);
    expect(secondResume.alreadyActive).toBe(true);
  });
});
