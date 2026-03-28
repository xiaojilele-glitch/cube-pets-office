import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = process.cwd();
const port = process.env.LOBSTER_EXECUTOR_PORT || "3031";
const baseUrl =
  process.env.LOBSTER_EXECUTOR_BASE_URL || `http://127.0.0.1:${port}`;
const startManagedService = process.env.LOBSTER_SMOKE_NO_SPAWN !== "1";

function buildJobRequest(jobId, outcome) {
  const missionId = `mission-${jobId}`;
  return {
    version: "2026-03-28",
    requestId: `req-${jobId}`,
    missionId,
    jobId,
    executor: "lobster",
    createdAt: new Date().toISOString(),
    traceId: `${jobId}-trace`,
    idempotencyKey: `${jobId}-idem`,
    plan: {
      version: "2026-03-28",
      missionId,
      summary: `Smoke ${outcome} job`,
      objective: "Verify lobster executor success and failed jobs",
      requestedBy: "brain",
      mode: "auto",
      steps: [
        {
          key: "dispatch",
          label: "Dispatch",
          description: "Submit mock smoke job",
        },
      ],
      jobs: [
        {
          id: jobId,
          key: `job-${jobId}`,
          label: `Smoke ${jobId}`,
          description: "Run the Worktree B smoke job",
          kind: "execute",
          payload: {
            runner: {
              kind: "mock",
              outcome,
              steps: 3,
              delayMs: 25,
              logs: [
                `Starting ${outcome} smoke job`,
                `Halfway through ${outcome} smoke job`,
                `Finishing ${outcome} smoke job`,
              ],
              summary:
                outcome === "success"
                  ? "Smoke success job completed"
                  : "Smoke failed job completed with expected mock failure",
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

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Service may still be starting.
    }

    await delay(250);
  }

  throw new Error(
    `Timed out waiting for lobster executor health at ${url}/health`
  );
}

async function submitJob(url, request) {
  const response = await fetch(`${url}/api/executor/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to submit job ${request.jobId}: ${response.status} ${body}`
    );
  }

  return response.json();
}

async function waitForFinalJob(url, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${url}/api/executor/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch job ${jobId}: ${response.status}`);
    }

    const body = await response.json();
    if (["completed", "failed", "cancelled"].includes(body.job.status)) {
      return body.job;
    }

    await delay(200);
  }

  throw new Error(`Timed out waiting for executor job ${jobId}`);
}

let child = null;

try {
  if (startManagedService) {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd.exe" : "npx";
    const args = isWindows
      ? ["/d", "/s", "/c", "npx tsx services/lobster-executor/src/index.ts"]
      : ["tsx", "services/lobster-executor/src/index.ts"];

    child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        LOBSTER_EXECUTOR_PORT: port,
      },
    });
  }

  await waitForHealth(baseUrl);

  const successRequest = buildJobRequest("smoke-success", "success");
  const failedRequest = buildJobRequest("smoke-failed", "failed");

  await submitJob(baseUrl, successRequest);
  await submitJob(baseUrl, failedRequest);

  const successJob = await waitForFinalJob(baseUrl, successRequest.jobId);
  const failedJob = await waitForFinalJob(baseUrl, failedRequest.jobId);

  if (successJob.status !== "completed") {
    throw new Error(
      `Expected success job to complete, got ${successJob.status}`
    );
  }

  if (failedJob.status !== "failed") {
    throw new Error(`Expected failed job to fail, got ${failedJob.status}`);
  }

  console.log(
    "[lobster-executor-smoke] success job:",
    successJob.status,
    successJob.summary
  );
  console.log(
    "[lobster-executor-smoke] failed job:",
    failedJob.status,
    failedJob.errorCode
  );
  console.log("[lobster-executor-smoke] smoke checks passed");
} finally {
  if (child && child.exitCode === null) {
    child.kill();
  }
}
