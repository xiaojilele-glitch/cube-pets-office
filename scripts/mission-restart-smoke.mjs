import { existsSync, readdirSync, rmSync } from "node:fs";

import {
  fetchJson,
  sleep,
  startManagedProcess,
  stopManagedProcess,
  waitForUrl,
} from "./mission-smoke-shared.mjs";

const TSX_COMMAND = [process.execPath, "./node_modules/tsx/dist/cli.mjs"];

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

async function waitForMissionFailure(baseUrl, missionId) {
  const timeoutMs = 20_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { response, body } = await fetchJson(
      `${baseUrl}/api/tasks/${missionId}`
    );
    if (response.ok && body?.task?.status === "failed") {
      return body.task;
    }
    await sleep(200);
  }

  throw new Error(
    `Timed out waiting for recovered mission ${missionId} to fail`
  );
}

async function main() {
  const port = parseInteger(process.env.MISSION_RESTART_SMOKE_PORT, 3102);
  const baseUrl =
    process.env.MISSION_RESTART_SMOKE_BASE_URL || `http://127.0.0.1:${port}`;
  const missionDataExisted = existsSync("data/missions");
  const env = {
    PORT: String(port),
    MISSION_SMOKE_ENABLED: "true",
    FEISHU_ENABLED: process.env.FEISHU_ENABLED || "false",
  };

  let server = null;

  try {
    server = startManagedProcess(
      "cube-server-restart-smoke",
      [...TSX_COMMAND, "server/index.ts"],
      env
    );
    await waitForUrl(`${baseUrl}/api/health`, {
      timeoutMs: 20_000,
      intervalMs: 250,
    });

    const { response, body } = await fetchJson(
      `${baseUrl}/api/tasks/smoke/seed-running`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Mission restart smoke",
          detail: "Mission seeded before restart recovery check",
          progress: 58,
        }),
      }
    );

    assert(
      response.ok && body?.missionId,
      `Failed to seed running mission: ${JSON.stringify(body)}`
    );

    const missionId = body.missionId;
    await stopManagedProcess(server);
    server = null;

    server = startManagedProcess(
      "cube-server-restart-smoke",
      [...TSX_COMMAND, "server/index.ts"],
      env
    );
    await waitForUrl(`${baseUrl}/api/health`, {
      timeoutMs: 20_000,
      intervalMs: 250,
    });

    const recovered = await waitForMissionFailure(baseUrl, missionId);
    assert(
      String(
        recovered.summary ||
          recovered.events?.[recovered.events.length - 1]?.message ||
          ""
      )
        .toLowerCase()
        .includes("restarted"),
      `Recovered mission did not explain restart failure: ${JSON.stringify(recovered)}`
    );

    console.log(
      `[mission-restart-smoke] mission ${missionId} recovered as ${recovered.status}`
    );
    console.log("[mission-restart-smoke] restart recovery smoke passed");
  } finally {
    if (server) {
      await stopManagedProcess(server);
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
    `[mission-restart-smoke] failed: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  process.exitCode = 1;
});
