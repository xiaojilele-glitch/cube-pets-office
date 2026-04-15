import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionPlanJob, ExecutorJobRequest } from "../../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../../shared/executor/contracts.js";
import type { StoredJobRecord } from "../types.js";
import type { CallbackSender } from "../callback-sender.js";
import { NativeRunner } from "../native-runner.js";

function makeRecord(root: string): StoredJobRecord {
  const now = new Date().toISOString();
  const planJob: ExecutionPlanJob = {
    id: "job-1",
    key: "native-test",
    label: "Native Test",
    description: "native",
    kind: "execute",
    timeoutMs: 30_000,
    payload: {
      workspaceRoot: root,
      command: ["node", "script.js"],
    },
  };

  const request: ExecutorJobRequest = {
    version: EXECUTOR_CONTRACT_VERSION,
    requestId: "r1",
    missionId: "m1",
    jobId: "job-1",
    executor: "lobster",
    createdAt: now,
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
  };

  return {
    acceptedResponse: {
      ok: true,
      accepted: true,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-1",
      receivedAt: now,
    },
    request,
    planJob,
    status: "queued",
    progress: 0,
    message: "",
    receivedAt: now,
    artifacts: [],
    events: [],
    dataDirectory: join(root, ".job"),
    logFile: join(root, ".job", "executor.log"),
    executionMode: "native",
  };
}

describe("NativeRunner", () => {
  it("runs payload.command inside workspaceRoot", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-runner-"));
    try {
      writeFileSync(join(root, "script.js"), "console.log('hello-native')\n", "utf8");

      const record = makeRecord(root);
      const callbackSender = { send: async () => {} } as unknown as CallbackSender;
      const runner = new NativeRunner(callbackSender);
      const events: any[] = [];

      await runner.run(record, (event) => events.push(event));

      expect(events.some((e) => e.type === "job.started")).toBe(true);
      expect(events.some((e) => e.type === "job.completed")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

