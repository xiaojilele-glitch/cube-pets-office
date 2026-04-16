import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";

import {
  buildExecutorCallbackRequest,
  buildRelayHeaders,
  fetchJson,
  sleep,
  startManagedProcess,
  stopManagedProcess,
  waitForUrl,
} from "./mission-smoke-shared.mjs";

const TSX_COMMAND = [process.execPath, "./node_modules/tsx/dist/cli.mjs"];
const MISSION_SOCKET_EVENT = "mission_event";
const FINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

function parseInteger(value, fallback) {
  if (!value || !String(value).trim()) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function textFromFeishuBody(body) {
  if (!body || typeof body.content !== "string") return "";
  try {
    const parsed = JSON.parse(body.content);
    if (typeof parsed?.text === "string") {
      return parsed.text;
    }
  } catch {
    return body.content;
  }
  return "";
}

function createConfig() {
  const serverPort = parseInteger(process.env.MISSION_SMOKE_SERVER_PORT, 3101);
  const executorPort = parseInteger(
    process.env.MISSION_SMOKE_EXECUTOR_PORT,
    3131
  );
  const feishuPort = parseInteger(process.env.MISSION_SMOKE_FEISHU_PORT, 3141);
  const serverBaseUrl =
    process.env.MISSION_SMOKE_SERVER_BASE_URL ||
    `http://127.0.0.1:${serverPort}`;
  const executorBaseUrl =
    process.env.LOBSTER_EXECUTOR_BASE_URL || `http://127.0.0.1:${executorPort}`;
  const feishuApiBaseUrl =
    process.env.FEISHU_API_BASE_URL ||
    `http://127.0.0.1:${feishuPort}/open-apis`;

  return {
    serverPort,
    executorPort,
    feishuPort,
    serverBaseUrl,
    executorBaseUrl,
    feishuApiBaseUrl,
    relaySecret:
      process.env.FEISHU_RELAY_SECRET || "mission-smoke-relay-secret",
    executorSecret:
      process.env.EXECUTOR_CALLBACK_SECRET || "mission-smoke-executor-secret",
    noSpawnServer: process.env.MISSION_SMOKE_NO_SPAWN_SERVER === "1",
    noSpawnExecutor: process.env.MISSION_SMOKE_NO_SPAWN_EXECUTOR === "1",
    noSpawnFeishu: process.env.MISSION_SMOKE_NO_SPAWN_FEISHU === "1",
  };
}

async function waitFor(description, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

async function startFakeFeishuServer(port) {
  const messages = [];
  let messageCount = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const parsedBody = rawBody ? JSON.parse(rawBody) : {};

    if (
      request.method === "POST" &&
      url.pathname === "/open-apis/im/v1/messages"
    ) {
      messageCount += 1;
      const messageId = `mock-msg-${messageCount}`;
      const rootId = parsedBody.root_id || messageId;
      const threadId = parsedBody.reply_in_thread ? rootId : undefined;
      messages.push({
        method: request.method,
        path: url.pathname,
        query: url.searchParams.toString(),
        body: parsedBody,
        messageId,
        rootId,
        threadId,
        text: textFromFeishuBody(parsedBody),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          code: 0,
          msg: "ok",
          data: {
            message_id: messageId,
            root_id: rootId,
            thread_id: threadId,
          },
        })
      );
      return;
    }

    if (
      request.method === "PATCH" &&
      url.pathname.startsWith("/open-apis/im/v1/messages/")
    ) {
      const messageId = decodeURIComponent(
        url.pathname.slice("/open-apis/im/v1/messages/".length)
      );
      messages.push({
        method: request.method,
        path: url.pathname,
        query: url.searchParams.toString(),
        body: parsedBody,
        messageId,
        rootId: undefined,
        threadId: undefined,
        text: textFromFeishuBody(parsedBody),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          code: 0,
          msg: "ok",
          data: {
            message_id: messageId,
          },
        })
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 404, msg: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    messages,
    async close() {
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

async function waitForFeishuMessage(messages, index) {
  return waitFor(
    `Feishu message #${index + 1}`,
    () => messages[index] || null,
    { timeoutMs: 10_000, intervalMs: 100 }
  );
}

async function waitForJobDetail(executorBaseUrl, jobId) {
  return waitFor(
    `executor job ${jobId} final status`,
    async () => {
      const { response, body } = await fetchJson(
        `${executorBaseUrl}/api/executor/jobs/${jobId}`
      );
      if (!response.ok) return null;
      if (!body?.job || !FINAL_JOB_STATUSES.has(body.job.status)) {
        return null;
      }
      return body.job;
    },
    { timeoutMs: 20_000, intervalMs: 200 }
  );
}

async function waitForMissionTask(serverBaseUrl, missionId, expectedStatus) {
  return waitFor(
    `mission ${missionId} -> ${expectedStatus}`,
    async () => {
      const { response, body } = await fetchJson(
        `${serverBaseUrl}/api/tasks/${missionId}`
      );
      if (!response.ok || !body?.task) return null;
      return body.task.status === expectedStatus ? body.task : null;
    },
    { timeoutMs: 20_000, intervalMs: 200 }
  );
}

async function connectMissionSocket(serverBaseUrl) {
  const { io } = await import("socket.io-client");
  const events = [];
  const socket = io(serverBaseUrl, {
    transports: ["websocket", "polling"],
    timeout: 5_000,
  });

  socket.on(MISSION_SOCKET_EVENT, payload => {
    events.push(payload);
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out connecting mission socket"));
    }, 5_000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once("connect_error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return {
    socket,
    events,
  };
}

async function postRelay(baseUrl, relaySecret, path, body) {
  const headers = {
    "content-type": "application/json",
    ...buildRelayHeaders(relaySecret, path, body),
  };
  const { response, body: payload } = await fetchJson(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert(response.ok, `${path} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function postExecutorCallback(baseUrl, secret, event) {
  const payload = { event };
  const request = buildExecutorCallbackRequest(secret, payload);
  const { response, body } = await fetchJson(`${baseUrl}/api/executor/events`, {
    method: "POST",
    headers: request.headers,
    body: request.rawBody,
  });
  assert(
    response.ok,
    `/api/executor/events rejected ${event.type}: ${JSON.stringify(body)}`
  );
  return body;
}

async function runFeishuRelayFlow({
  serverBaseUrl,
  relaySecret,
  messages,
  outcome,
}) {
  const label =
    outcome === "done"
      ? "Feishu relay smoke success path"
      : "Feishu relay smoke failed path";
  const beforeCount = messages.length;
  const relayBody = {
    chatId: "chat:mission-smoke",
    requestId: `relay-${randomUUID()}`,
    text: `${label} with staged relay updates`,
    finalAnswerSource: "openclaw",
  };

  const relayResult = await postRelay(
    serverBaseUrl,
    relaySecret,
    "/api/feishu/relay",
    relayBody
  );
  assert(relayResult.ok === true, "Feishu relay did not report success");
  assert(relayResult.taskId, "Feishu relay did not return taskId");

  const ackMessage = await waitForFeishuMessage(messages, beforeCount);
  assert(
    ackMessage.text.includes(label),
    `Feishu ACK did not include request label: ${ackMessage.text}`
  );
  assert(
    ackMessage.text.includes(`/tasks/${relayResult.taskId}`),
    `Feishu ACK did not include task link: ${ackMessage.text}`
  );

  const progressDetail = `${label} progress update`;
  const progressResult = await postRelay(
    serverBaseUrl,
    relaySecret,
    "/api/feishu/relay/event",
    {
      taskId: relayResult.taskId,
      type: "progress",
      stageKey: "execution",
      stageLabel: "Smoke execution",
      detail: progressDetail,
      progress: 62,
    }
  );
  assert(
    progressResult.task?.status === "running",
    `Feishu progress event did not keep task running: ${JSON.stringify(progressResult)}`
  );

  const progressMessage = await waitForFeishuMessage(messages, beforeCount + 1);
  assert(
    progressMessage.text.includes(progressDetail),
    `Feishu progress message missing detail: ${progressMessage.text}`
  );

  if (outcome === "done") {
    const summary = `${label} completed`;
    const completeResult = await postRelay(
      serverBaseUrl,
      relaySecret,
      "/api/feishu/relay/event",
      {
        taskId: relayResult.taskId,
        type: "done",
        stageKey: "finalize",
        stageLabel: "Finalize",
        detail: "Relay reported completion",
        summary,
      }
    );
    assert(
      completeResult.task?.status === "done",
      `Feishu done event did not finish task: ${JSON.stringify(completeResult)}`
    );

    const completeMessage = await waitForFeishuMessage(
      messages,
      beforeCount + 2
    );
    assert(
      completeMessage.text.includes(summary),
      `Feishu done message missing summary: ${completeMessage.text}`
    );
    console.log(
      `[mission-integration-smoke] Feishu done flow ok -> ${relayResult.taskId}`
    );
    return;
  }

  const failureDetail = `${label} failed`;
  const failedResult = await postRelay(
    serverBaseUrl,
    relaySecret,
    "/api/feishu/relay/event",
    {
      taskId: relayResult.taskId,
      type: "failed",
      stageKey: "finalize",
      stageLabel: "Finalize",
      detail: failureDetail,
      progress: 74,
    }
  );
  assert(
    failedResult.task?.status === "failed",
    `Feishu failed event did not fail task: ${JSON.stringify(failedResult)}`
  );

  const failedMessage = await waitForFeishuMessage(messages, beforeCount + 2);
  assert(
    failedMessage.text.includes(failureDetail),
    `Feishu failed message missing detail: ${failedMessage.text}`
  );
  console.log(
    `[mission-integration-smoke] Feishu failed flow ok -> ${relayResult.taskId}`
  );
}

async function runExecutorMissionFlow({
  serverBaseUrl,
  executorBaseUrl,
  executorSecret,
  socketEvents,
  outcome,
}) {
  const dispatchBody = {
    title:
      outcome === "success"
        ? "Mission integration smoke success"
        : "Mission integration smoke failure",
    outcome,
    executorBaseUrl,
  };

  const { response, body } = await fetchJson(
    `${serverBaseUrl}/api/tasks/smoke/dispatch`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(dispatchBody),
    }
  );

  assert(
    response.ok && body?.missionId && body?.jobId,
    `Smoke dispatch failed: ${JSON.stringify(body)}`
  );

  const finalJob = await waitForJobDetail(executorBaseUrl, body.jobId);
  assert(
    Array.isArray(finalJob.events) && finalJob.events.length > 0,
    `Executor job ${body.jobId} did not expose replayable events`
  );

  const socketStartIndex = socketEvents.length;
  for (const event of finalJob.events) {
    await postExecutorCallback(serverBaseUrl, executorSecret, event);
  }

  const expectedStatus = outcome === "success" ? "done" : "failed";
  const finalTask = await waitForMissionTask(
    serverBaseUrl,
    body.missionId,
    expectedStatus
  );

  const emitted = socketEvents
    .slice(socketStartIndex)
    .filter(event => event?.missionId === body.missionId);
  assert(
    emitted.length > 0,
    `Mission socket did not emit updates for ${body.missionId}`
  );
  assert(
    emitted.some(event =>
      outcome === "success"
        ? event?.type === "mission.record.completed"
        : event?.type === "mission.record.failed"
    ),
    `Mission socket did not emit final ${expectedStatus} event for ${body.missionId}`
  );

  console.log(
    `[mission-integration-smoke] mission ${body.missionId} -> ${finalTask.status} via ${body.jobId}`
  );
}

async function main() {
  const config = createConfig();
  const managedChildren = [];
  const missionDataExisted = existsSync("data/missions");
  let fakeFeishu = null;
  let socketSession = null;

  try {
    if (!config.noSpawnFeishu) {
      fakeFeishu = await startFakeFeishuServer(config.feishuPort);
      await waitForUrl(`http://127.0.0.1:${config.feishuPort}/health`, {
        timeoutMs: 5_000,
        intervalMs: 100,
      });
    }

    if (!config.noSpawnExecutor) {
      managedChildren.push(
        startManagedProcess(
          "lobster-executor",
          [...TSX_COMMAND, "services/lobster-executor/src/index.ts"],
          {
            LOBSTER_EXECUTOR_HOST: "127.0.0.1",
            LOBSTER_EXECUTOR_PORT: String(config.executorPort),
            LOBSTER_EXECUTOR_BASE_URL: config.executorBaseUrl,
            LOBSTER_EXECUTOR_DATA_ROOT:
              process.env.LOBSTER_EXECUTOR_DATA_ROOT ||
              "tmp/lobster-executor-mission-smoke",
          }
        )
      );
    }

    if (!config.noSpawnServer) {
      managedChildren.push(
        startManagedProcess(
          "cube-server",
          [...TSX_COMMAND, "server/index.ts"],
          {
            PORT: String(config.serverPort),
            MISSION_SMOKE_ENABLED: "true",
            LOBSTER_EXECUTOR_BASE_URL: config.executorBaseUrl,
            EXECUTOR_CALLBACK_SECRET: config.executorSecret,
            EXECUTOR_CALLBACK_MAX_SKEW_SECONDS: "300",
            FEISHU_ENABLED: "true",
            FEISHU_MODE: "live",
            FEISHU_API_BASE_URL: config.feishuApiBaseUrl,
            FEISHU_TENANT_ACCESS_TOKEN: "mission-smoke-token",
            FEISHU_BASE_TASK_URL: config.serverBaseUrl,
            FEISHU_RELAY_SECRET: config.relaySecret,
            FEISHU_RELAY_MAX_SKEW_SECONDS: "300",
            FEISHU_RELAY_NONCE_TTL_SECONDS: "300",
            FEISHU_MESSAGE_FORMAT: "text",
            FEISHU_FINAL_SUMMARY_MODE: "none",
            FEISHU_WEBHOOK_DEDUP_FILE:
              process.env.FEISHU_WEBHOOK_DEDUP_FILE ||
              "tmp/mission-smoke/feishu-webhook-dedup.json",
          }
        )
      );
    }

    await waitForUrl(`${config.executorBaseUrl}/health`, {
      timeoutMs: 20_000,
      intervalMs: 250,
    });
    await waitForUrl(`${config.serverBaseUrl}/api/health`, {
      timeoutMs: 20_000,
      intervalMs: 250,
    });

    socketSession = await connectMissionSocket(config.serverBaseUrl);

    const feishuMessages = fakeFeishu?.messages || [];
    await runFeishuRelayFlow({
      serverBaseUrl: config.serverBaseUrl,
      relaySecret: config.relaySecret,
      messages: feishuMessages,
      outcome: "done",
    });
    await runFeishuRelayFlow({
      serverBaseUrl: config.serverBaseUrl,
      relaySecret: config.relaySecret,
      messages: feishuMessages,
      outcome: "failed",
    });

    await runExecutorMissionFlow({
      serverBaseUrl: config.serverBaseUrl,
      executorBaseUrl: config.executorBaseUrl,
      executorSecret: config.executorSecret,
      socketEvents: socketSession.events,
      outcome: "success",
    });
    await runExecutorMissionFlow({
      serverBaseUrl: config.serverBaseUrl,
      executorBaseUrl: config.executorBaseUrl,
      executorSecret: config.executorSecret,
      socketEvents: socketSession.events,
      outcome: "failed",
    });

    console.log("[mission-integration-smoke] all smoke checks passed");
  } finally {
    if (socketSession?.socket) {
      socketSession.socket.close();
    }

    for (const child of managedChildren.reverse()) {
      await stopManagedProcess(child);
    }

    if (fakeFeishu) {
      await fakeFeishu.close();
    }

    if (!missionDataExisted && existsSync("data/missions")) {
      rmSync("data/missions", { recursive: true, force: true });
      if (existsSync("data") && readdirSync("data").length === 0) {
        rmSync("data", { recursive: true, force: true });
      }
    }
  }
}

main().catch(error => {
  console.error(
    `[mission-integration-smoke] failed: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  process.exitCode = 1;
});
