import { describe, expect, it } from "vitest";

import { DockerRunner } from "./docker-runner.js";
import { SANDBOX_NETWORK_NAME } from "./security-policy.js";
import type { CallbackSender } from "./callback-sender.js";
import type { LobsterExecutorConfig, StoredJobRecord } from "./types.js";
import type {
  ExecutionPlanJob,
  ExecutorJobRequest,
} from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";

function makeRunner(
  securityLevel: LobsterExecutorConfig["securityLevel"] = "strict"
) {
  const config: LobsterExecutorConfig = {
    host: "localhost",
    port: 7200,
    dataRoot: "/tmp/test",
    serviceName: "lobster-executor",
    executionMode: "real",
    defaultImage: "node:20-slim",
    maxConcurrentJobs: 2,
    callbackSecret: "",
    aiImage: "cube-ai-sandbox:latest",
    securityLevel,
    containerUser: "65534",
    maxMemory: "512m",
    maxCpus: "1.0",
    maxPids: 256,
    tmpfsSize: "64m",
    networkWhitelist: [],
  };
  const mockCallbackSender = {
    send: async () => {},
  } as unknown as CallbackSender;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockDocker = {} as any;

  return new DockerRunner(config, mockCallbackSender, mockDocker);
}

function makeRecord(payload: Record<string, unknown>): StoredJobRecord {
  const planJob: ExecutionPlanJob = {
    id: "job-1",
    key: "test-job",
    label: "Test Job",
    description: "test",
    kind: "analyze",
    payload,
  };

  return {
    planJob,
    status: "queued",
    progress: 0,
    message: "",
    receivedAt: new Date().toISOString(),
    artifacts: [],
    events: [],
    dataDirectory: "/tmp/test/jobs/m1/j1",
    logFile: "/tmp/test/jobs/m1/j1/executor.log",
    executionMode: "real",
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
        summary: "",
        objective: "",
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

describe("DockerRunner AI security policy", () => {
  it("lifts strict AI jobs to the balanced network preset", () => {
    const runner = makeRunner("strict");
    const opts = runner.buildContainerOptions(
      makeRecord({
        aiEnabled: true,
        llmConfig: {
          apiKey: "test-api-key-123456",
          baseUrl: "https://api.example.com",
          model: "gpt-test",
        },
      }),
      "/tmp/ws"
    );

    expect(opts.HostConfig?.NetworkMode).toBe(SANDBOX_NETWORK_NAME);
    expect(opts.HostConfig?.ReadonlyRootfs).toBe(true);
  });

  it("keeps non-AI strict jobs on network none", () => {
    const runner = makeRunner("strict");
    const opts = runner.buildContainerOptions(makeRecord({}), "/tmp/ws");

    expect(opts.HostConfig?.NetworkMode).toBe("none");
  });
});
