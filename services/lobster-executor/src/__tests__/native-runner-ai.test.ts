import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    key: "native-ai",
    label: "Native AI",
    description: "native",
    kind: "execute",
    timeoutMs: 30_000,
    payload: {
      workspaceRoot: root,
      aiEnabled: true,
      command: [],
      env: {
        TASK_CONTENT: "reply with one word: ok",
      },
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

describe("NativeRunner AI-only job", () => {
  it("completes when aiEnabled=true and command is empty", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-ai-"));
    const prevFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ content: "ok", usage: { total_tokens: 1 }, model: "gpt" }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as any;

      process.env.SERVER_BASE_URL = "http://127.0.0.1:3001";

      const record = makeRecord(root);
      const callbackSender = { send: async () => {} } as unknown as CallbackSender;
      const runner = new NativeRunner(callbackSender);
      const events: any[] = [];
      await runner.run(record, (event) => events.push(event));

      expect(events.some((e) => e.type === "job.completed")).toBe(true);
      const ai = record.artifacts.find((a) => a.name === "ai-result.json");
      expect(ai).toBeTruthy();
      const aiPath = join(process.cwd(), ai!.path!);
      const content = JSON.parse(readFileSync(aiPath, "utf8"));
      expect(content.content).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

