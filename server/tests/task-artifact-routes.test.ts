import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MissionArtifact } from "../../shared/mission/contracts.js";
import { createTaskRouter } from "../routes/tasks.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";

async function startServer(runtime: MissionRuntime) {
  const app = express();
  app.use(express.json());
  app.use("/api/tasks", createTaskRouter(runtime));

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

function artifactPath(missionId: string, jobId: string, relativePath: string) {
  return path.join(
    process.cwd(),
    "tmp/lobster-executor/jobs",
    missionId,
    jobId,
    relativePath
  );
}

describe("task artifact routes", () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";
  let cleanupTargets: string[] = [];

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;
    cleanupTargets = [];
  });

  afterEach(async () => {
    await Promise.all(
      cleanupTargets.map(target =>
        fs.rm(target, { recursive: true, force: true })
      )
    );

    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    server = null;
  });

  async function createMissionWithArtifacts(
    artifacts: MissionArtifact[],
    options?: {
      jobId?: string;
      files?: Array<{ path: string; content: string | Uint8Array }>;
    }
  ) {
    const mission = runtime.createChatTask("Artifact mission");
    const jobId = options?.jobId || "job-artifacts";

    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: "executor",
        jobId,
        status: "running",
      },
      artifacts,
    });

    cleanupTargets.push(
      path.join(process.cwd(), "tmp/lobster-executor/jobs", mission.id)
    );

    await Promise.all(
      (options?.files || []).map(async file => {
        const absolutePath = artifactPath(mission.id, jobId, file.path);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, file.content);
      })
    );

    return {
      missionId: mission.id,
      jobId,
    };
  }

  it("lists mission artifacts with download urls", async () => {
    const { missionId } = await createMissionWithArtifacts([
      { kind: "file", name: "result.json", path: "artifacts/result.json" },
      { kind: "url", name: "Dashboard", url: "https://example.com" },
    ]);

    const response = await fetch(`${baseUrl}/api/tasks/${missionId}/artifacts`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      missionId,
      artifacts: [
        {
          index: 0,
          name: "result.json",
          downloadUrl: `/api/tasks/${missionId}/artifacts/0/download`,
        },
        {
          index: 1,
          name: "Dashboard",
          downloadUrl: `/api/tasks/${missionId}/artifacts/1/download`,
        },
      ],
    });
  });

  it("returns 404 for a missing mission on the artifact list route", async () => {
    const response = await fetch(
      `${baseUrl}/api/tasks/mission_missing/artifacts`
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain("Mission not found");
  });

  it("returns an empty array when the mission has no artifacts", async () => {
    const mission = runtime.createChatTask("No artifacts yet");

    const response = await fetch(
      `${baseUrl}/api/tasks/${mission.id}/artifacts`
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.artifacts).toEqual([]);
  });

  it("downloads a file artifact with attachment headers", async () => {
    const { missionId } = await createMissionWithArtifacts(
      [{ kind: "file", name: "result.json", path: "artifacts/result.json" }],
      {
        files: [
          {
            path: "artifacts/result.json",
            content: '{"ok":true}',
          },
        ],
      }
    );

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/download`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="result.json"'
    );
    expect(await response.text()).toBe('{"ok":true}');
  });

  it("downloads artifacts whose stored path is already repo-relative", async () => {
    const mission = runtime.createChatTask("Repo-relative artifact");
    const jobId = `${mission.id}:analyze:1`;
    const sanitizedJobId = `${mission.id}_analyze_1`;
    const relativePath = `tmp/lobster-executor/jobs/${mission.id}/${sanitizedJobId}/executor.log`;
    const absolutePath = path.join(process.cwd(), relativePath);

    cleanupTargets.push(
      path.join(process.cwd(), "tmp/lobster-executor/jobs", mission.id)
    );

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "executor output\n");

    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: "executor",
        jobId,
        status: "completed",
      },
      artifacts: [
        {
          kind: "log",
          name: "executor.log",
          path: relativePath,
        },
      ],
    });

    const response = await fetch(
      `${baseUrl}/api/tasks/${mission.id}/artifacts/0/download`
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("executor output\n");
  });

  it("downloads fallback content when executor.log exists but is empty", async () => {
    const mission = runtime.createChatTask("Executor log empty fallback");
    const jobId = `${mission.id}:analyze:1`;
    const sanitizedJobId = `${mission.id}_analyze_1`;
    const jobDirectory = path.join(
      process.cwd(),
      "tmp/lobster-executor/jobs",
      mission.id,
      sanitizedJobId
    );

    cleanupTargets.push(
      path.join(process.cwd(), "tmp/lobster-executor/jobs", mission.id)
    );

    await fs.mkdir(jobDirectory, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(jobDirectory, "executor.log"), "", "utf-8"),
      fs.writeFile(
        path.join(jobDirectory, "events.jsonl"),
        `${JSON.stringify({
          occurredAt: "2026-04-09T07:24:09.153Z",
          message: "Started Docker container 2c3e17c5b91e for Analyze request",
        })}\n`,
        "utf-8"
      ),
    ]);

    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: "executor",
        jobId,
        status: "completed",
      },
      artifacts: [
        {
          kind: "log",
          name: "executor.log",
          path: `tmp/lobster-executor/jobs/${mission.id}/${sanitizedJobId}/executor.log`,
          description: "Line-oriented executor runtime log",
        },
      ],
    });

    const response = await fetch(
      `${baseUrl}/api/tasks/${mission.id}/artifacts/0/download`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain(
      "Started Docker container 2c3e17c5b91e for Analyze request"
    );
  });

  it("redirects url artifacts on download", async () => {
    const { missionId } = await createMissionWithArtifacts([
      { kind: "url", name: "Dashboard", url: "https://example.com/dashboard" },
    ]);

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/download`,
      {
        redirect: "manual",
      }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://example.com/dashboard"
    );
  });

  it("rejects path traversal on download", async () => {
    const { missionId } = await createMissionWithArtifacts([
      { kind: "file", name: "secret.txt", path: "../secret.txt" },
    ]);

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/download`
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Path traversal not allowed" });
  });

  it("returns 404 when the downloaded artifact file is missing", async () => {
    const { missionId } = await createMissionWithArtifacts([
      { kind: "file", name: "missing.json", path: "artifacts/missing.json" },
    ]);

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/download`
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Artifact file not found" });
  });

  it("previews text artifacts", async () => {
    const { missionId } = await createMissionWithArtifacts(
      [{ kind: "log", name: "run.log", path: "logs/run.log" }],
      {
        files: [
          {
            path: "logs/run.log",
            content: "line 1\nline 2\n",
          },
        ],
      }
    );

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/preview`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("line 1\nline 2\n");
  });

  it("falls back to events.jsonl when executor.log has not been created yet", async () => {
    const mission = runtime.createChatTask("Executor log fallback");
    const jobId = `${mission.id}:analyze:1`;
    const sanitizedJobId = `${mission.id}_analyze_1`;
    const jobDirectory = path.join(
      process.cwd(),
      "tmp/lobster-executor/jobs",
      mission.id,
      sanitizedJobId
    );

    cleanupTargets.push(
      path.join(process.cwd(), "tmp/lobster-executor/jobs", mission.id)
    );

    await fs.mkdir(jobDirectory, { recursive: true });
    await fs.writeFile(
      path.join(jobDirectory, "events.jsonl"),
      `${JSON.stringify({
        occurredAt: "2026-04-09T07:03:44.144Z",
        message: "Started Docker container 4333be9f2fc5 for Analyze request",
      })}\n`,
      "utf-8"
    );

    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: "executor",
        jobId,
        status: "completed",
      },
      artifacts: [
        {
          kind: "log",
          name: "executor.log",
          path: `tmp/lobster-executor/jobs/${mission.id}/${sanitizedJobId}/executor.log`,
          description: "Line-oriented executor runtime log",
        },
      ],
    });

    const response = await fetch(
      `${baseUrl}/api/tasks/${mission.id}/artifacts/0/preview`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain(
      "Started Docker container 4333be9f2fc5 for Analyze request"
    );
  });

  it("previews fallback content when executor.log only contains whitespace", async () => {
    const mission = runtime.createChatTask("Executor log whitespace fallback");
    const jobId = `${mission.id}:analyze:1`;
    const sanitizedJobId = `${mission.id}_analyze_1`;
    const jobDirectory = path.join(
      process.cwd(),
      "tmp/lobster-executor/jobs",
      mission.id,
      sanitizedJobId
    );

    cleanupTargets.push(
      path.join(process.cwd(), "tmp/lobster-executor/jobs", mission.id)
    );

    await fs.mkdir(jobDirectory, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(jobDirectory, "executor.log"), "   \n\t", "utf-8"),
      fs.writeFile(
        path.join(jobDirectory, "events.jsonl"),
        `${JSON.stringify({
          occurredAt: "2026-04-09T07:24:09.226Z",
          message: "Docker execution completed successfully",
        })}\n`,
        "utf-8"
      ),
    ]);

    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: "executor",
        jobId,
        status: "completed",
      },
      artifacts: [
        {
          kind: "log",
          name: "executor.log",
          path: `tmp/lobster-executor/jobs/${mission.id}/${sanitizedJobId}/executor.log`,
          description: "Line-oriented executor runtime log",
        },
      ],
    });

    const response = await fetch(
      `${baseUrl}/api/tasks/${mission.id}/artifacts/0/preview`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain(
      "Docker execution completed successfully"
    );
  });

  it("marks previews as truncated when the artifact exceeds 1 MB", async () => {
    const largeLog = "a".repeat(1_048_580);
    const { missionId } = await createMissionWithArtifacts(
      [{ kind: "log", name: "large.log", path: "logs/large.log" }],
      {
        files: [
          {
            path: "logs/large.log",
            content: largeLog,
          },
        ],
      }
    );

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/preview`
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-truncated")).toBe("true");
    expect(body.length).toBe(1_048_576);
  });

  it("rejects binary previews", async () => {
    const { missionId } = await createMissionWithArtifacts(
      [{ kind: "file", name: "image.png", path: "artifacts/image.png" }],
      {
        files: [
          {
            path: "artifacts/image.png",
            content: new Uint8Array([137, 80, 78, 71]),
          },
        ],
      }
    );

    const response = await fetch(
      `${baseUrl}/api/tasks/${missionId}/artifacts/0/preview`
    );
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body).toEqual({ error: "Binary files cannot be previewed" });
  });
});
