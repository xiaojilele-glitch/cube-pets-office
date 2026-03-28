import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { CreateExecutorJobResponse } from "../../../shared/executor/api.js";
import type { ExecutorJobRequest } from "../../../shared/executor/contracts.js";
import { createLobsterExecutorApp } from "./app.js";
import { createLobsterExecutorService } from "./service.js";
import type {
  LobsterExecutorHealthResponse,
  LobsterExecutorJobDetailResponse,
} from "./types.js";

interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
}

const cleanupTasks: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

function createTestRequest(
  jobId: string,
  outcome: "success" | "failed"
): ExecutorJobRequest {
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
      objective: "Verify lobster executor first-phase endpoints",
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
              outcome,
              steps: 2,
              delayMs: 10,
              logs: ["Booting mock runner", "Finishing mock runner"],
              summary:
                outcome === "success"
                  ? "Mock success path finished"
                  : "Mock failure path finished",
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

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createHarness(): Promise<TestHarness> {
  const dataRoot = join(tmpdir(), `lobster-executor-${randomUUID()}`);
  const service = createLobsterExecutorService({ dataRoot });
  const app = createLobsterExecutorApp(service);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }

  const close = async () => {
    await closeServer(server);
    rmSync(dataRoot, { recursive: true, force: true });
  };
  cleanupTasks.push(close);

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
  };
}

async function waitForJob(
  baseUrl: string,
  jobId: string
): Promise<LobsterExecutorJobDetailResponse["job"]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/executor/jobs/${jobId}`);
    const body = (await response.json()) as LobsterExecutorJobDetailResponse;
    if (["completed", "failed", "cancelled"].includes(body.job.status)) {
      return body.job;
    }

    await new Promise(resolve => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out while waiting for executor job ${jobId}`);
}

describe("lobster executor app", () => {
  it("returns a health snapshot with queue stats", async () => {
    const harness = await createHarness();

    const response = await fetch(`${harness.baseUrl}/health`);
    const body = (await response.json()) as LobsterExecutorHealthResponse;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.queue.total).toBe(0);
    expect(body.features.createJob).toBe(true);
  });

  it("accepts and completes a mock success job", async () => {
    const harness = await createHarness();
    const request = createTestRequest("success-job", "success");

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const accepted = (await response.json()) as CreateExecutorJobResponse;

    expect(response.status).toBe(202);
    expect(accepted.accepted).toBe(true);

    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("completed");
    expect(job.summary).toContain("success");
    expect(job.artifacts.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts and finishes a mock failed job", async () => {
    const harness = await createHarness();
    const request = createTestRequest("failed-job", "failed");

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(202);

    const job = await waitForJob(harness.baseUrl, request.jobId);
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("MOCK_FAILURE");
    expect(job.events.some(event => event.type === "job.failed")).toBe(true);
  });

  it("rejects requests whose jobId is not present in the plan", async () => {
    const harness = await createHarness();
    const request = createTestRequest("missing-job", "success");
    request.jobId = "different-job";

    const response = await fetch(`${harness.baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("request.jobId must exist in plan.jobs");
  });
});
