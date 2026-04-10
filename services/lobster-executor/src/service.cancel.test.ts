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
      objective: "Verify cancel behavior",
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
  const dataRoot = join(tmpdir(), `lobster-executor-cancel-${randomUUID()}`);
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
    record,
  );

  return { service, record };
}

describe("LobsterExecutorService.cancel", () => {
  it("rejects unknown jobs", async () => {
    const dataRoot = join(tmpdir(), `lobster-executor-cancel-${randomUUID()}`);
    cleanupPaths.push(dataRoot);
    const service = createLobsterExecutorService({ dataRoot });

    await expect(service.cancel("missing-job")).rejects.toThrow(
      "Executor job missing-job was not found",
    );
  });

  it("cancels queued jobs immediately and persists a cancelled event", async () => {
    const { service, record } = createSeededService("queued");

    const response = await service.cancel(record.request.jobId, {
      reason: "Stop before execution",
      requestedBy: "operator",
      source: "user",
    });

    expect(response).toMatchObject({
      ok: true,
      accepted: true,
      status: "cancelled",
      message: "Stop before execution",
    });
    expect(record.status).toBe("cancelled");
    expect(record.events.at(-1)).toMatchObject({
      type: "job.cancelled",
      status: "cancelled",
      message: "Stop before execution",
    });
    expect(readFileSync(record.logFile, "utf-8")).toContain(
      "[cancel] Stop before execution",
    );
  });

  it("cancels waiting jobs immediately", async () => {
    const { service, record } = createSeededService("waiting");

    const response = await service.cancel(record.request.jobId, {
      reason: "Decision no longer needed",
      requestedBy: "operator",
      source: "user",
    });

    expect(response.status).toBe("cancelled");
    expect(record.status).toBe("cancelled");
    expect(record.cancelRequested).toMatchObject({
      reason: "Decision no longer needed",
      requestedBy: "operator",
      source: "user",
    });
  });

  it("returns alreadyFinal for terminal jobs without appending a second cancel event", async () => {
    const { service, record } = createSeededService("failed");
    record.events.push({
      version: "2026-03-28",
      eventId: "evt-final",
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      executor: record.request.executor,
      type: "job.failed",
      status: "failed",
      occurredAt: new Date().toISOString(),
      message: "Already failed",
    });

    const response = await service.cancel(record.request.jobId, {
      reason: "Late cancellation",
    });

    expect(response).toMatchObject({
      ok: true,
      accepted: true,
      alreadyFinal: true,
      status: "failed",
    });
    expect(record.events).toHaveLength(1);
  });

  it("marks running jobs as cancel requested and delegates to the runner", async () => {
    const { service, record } = createSeededService("running");
    const runnerCancel = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { runner: { cancel: typeof runnerCancel } }).runner = {
      cancel: runnerCancel,
    };

    const response = await service.cancel(record.request.jobId, {
      reason: "Interrupt active container",
      requestedBy: "operator",
      source: "user",
    });

    expect(response).toMatchObject({
      ok: true,
      accepted: true,
      cancelRequested: true,
      status: "running",
      message: "Interrupt active container",
    });
    expect(record.cancelRequested).toMatchObject({
      reason: "Interrupt active container",
      requestedBy: "operator",
      source: "user",
    });
    expect(runnerCancel).toHaveBeenCalledWith(record);
  });
});
