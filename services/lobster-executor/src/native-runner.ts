import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join, relative, resolve } from "node:path";

import type {
  ExecutionPlanArtifact,
  ExecutorEvent,
  ExecutorJobStatus,
} from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";
import type { CallbackSender } from "./callback-sender.js";
import type { JobRunner } from "./runner.js";
import { LogBatcher } from "./log-batcher.js";
import type { StoredJobRecord } from "./types.js";
import {
  buildAIEnvVars,
  resolveAICredentials,
  validateCredentials,
} from "./credential-injector.js";

function toRelativePath(pathname: string): string {
  return relative(process.cwd(), pathname).replace(/\\/g, "/");
}

export class NativeRunner implements JobRunner {
  private child?: ChildProcess;

  constructor(private readonly callbackSender: CallbackSender) {}

  async cancel(record: StoredJobRecord): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      appendFileSync(
        record.logFile,
        `[${new Date().toISOString()}] [cancel] SIGTERM sent\n`,
        "utf-8",
      );
    }
  }

  async run(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
  ): Promise<void> {
    const payload = (record.planJob.payload ?? {}) as Record<string, unknown>;
    const command = (payload.command ?? []) as string[];
    const aiEnabled = payload.aiEnabled === true;

    mkdirSync(record.dataDirectory, { recursive: true });
    mkdirSync(join(record.dataDirectory, "artifacts"), { recursive: true });

    if (!Array.isArray(command) || command.length === 0) {
      if (aiEnabled) {
        await this.runAIJob(record, payload, emitEvent);
        return;
      }
      const message = "Native runner requires payload.command";
      record.status = "failed";
      record.progress = 100;
      record.errorCode = "NATIVE_MISSING_COMMAND";
      record.errorMessage = message;
      record.message = message;

      const event = this.createEvent(record, {
        type: "job.failed",
        status: "failed",
        progress: 100,
        message,
        errorCode: record.errorCode,
      });
      emitEvent(event);
      await this.sendCallback(record, event);
      return;
    }

    const workspaceRootRaw = payload.workspaceRoot as string | undefined;
    const workspaceRoot = workspaceRootRaw ? resolve(workspaceRootRaw) : process.cwd();

    const envFromPayload = (payload.env ?? {}) as Record<string, string>;
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    for (const [key, value] of Object.entries(envFromPayload)) {
      if (typeof value === "string") env[key] = value;
    }

    if (aiEnabled) {
      const creds = resolveAICredentials(payload, process.env);
      validateCredentials(creds);
      for (const entry of buildAIEnvVars(creds)) {
        const idx = entry.indexOf("=");
        if (idx <= 0) continue;
        env[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
    }

    const logBatcher = new LogBatcher(
      (lines) => {
        if (lines.length === 0) return;
        const logEvent = this.createEvent(record, {
          type: "job.log",
          status: "running",
          message: lines.join("\n"),
        });
        emitEvent(logEvent);
        void this.sendCallback(record, logEvent);
      },
      500,
      4096,
    );

    record.status = "running";
    record.startedAt = new Date().toISOString();
    record.progress = 5;
    record.message = `Started native process for ${record.planJob.label}`;

    const startedEvent = this.createEvent(record, {
      type: "job.started",
      status: "running",
      progress: 5,
      message: record.message,
    });
    emitEvent(startedEvent);
    await this.sendCallback(record, startedEvent);

    const timeoutMs = record.planJob.timeoutMs ?? 300_000;
    const startTime = Date.now();

    const proc = spawn(command[0], command.slice(1), {
      cwd: workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = proc;

    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      appendFileSync(record.logFile, text, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) logBatcher.push(line);
      }
    });

    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      appendFileSync(record.logFile, text, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) logBatcher.push(line);
      }
    });

    let timedOut = false;
    const exitCode = await new Promise<number>((resolveExit) => {
      let resolved = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 1500);
      }, timeoutMs);

      proc.on("exit", (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolveExit(typeof code === "number" ? code : 1);
      });
    });

    logBatcher.destroy();

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    const result = {
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      requestId: record.request.requestId,
      exitCode,
      timedOut,
      durationMs,
      outcome: exitCode === 0 && !timedOut ? "success" : "failed",
      summary:
        exitCode === 0 && !timedOut
          ? "Native execution completed successfully"
          : timedOut
            ? "Native execution timed out"
            : `Native execution failed (exit ${exitCode})`,
    };

    const resultFile = join(record.dataDirectory, "result.json");
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf-8");

    const artifacts: ExecutionPlanArtifact[] = [
      {
        kind: "log",
        name: "executor.log",
        path: toRelativePath(record.logFile),
        description: "Line-oriented executor runtime log",
      },
      {
        kind: "report",
        name: "result.json",
        path: toRelativePath(resultFile),
        description: "Native execution summary",
      },
    ];

    record.finishedAt = finishedAt;
    record.progress = 100;
    record.summary = result.summary;
    record.message = result.summary;
    record.artifacts = artifacts;

    if (exitCode === 0 && !timedOut) {
      record.status = "completed";
      const event = this.createEvent(record, {
        type: "job.completed",
        status: "completed",
        progress: 100,
        message: result.summary,
        summary: result.summary,
        artifacts,
        metrics: { durationMs, passed: 1 },
      });
      emitEvent(event);
      await this.sendCallback(record, event);
      return;
    }

    record.status = "failed";
    record.errorCode = timedOut ? "NATIVE_TIMEOUT" : "NATIVE_EXIT_NONZERO";
    record.errorMessage = timedOut
      ? `Process timed out after ${timeoutMs}ms`
      : `Process exited with code ${exitCode}`;

    const event = this.createEvent(record, {
      type: "job.failed",
      status: "failed",
      progress: 100,
      message: record.errorMessage,
      summary: result.summary,
      errorCode: record.errorCode,
      artifacts,
      metrics: { durationMs, failed: 1, timedOut: timedOut ? 1 : undefined },
    });
    emitEvent(event);
    await this.sendCallback(record, event);
  }

  private async runAIJob(
    record: StoredJobRecord,
    payload: Record<string, unknown>,
    emitEvent: (event: ExecutorEvent) => void,
  ): Promise<void> {
    const artifactsDir = join(record.dataDirectory, "artifacts");
    const envFromPayload = (payload.env ?? {}) as Record<string, unknown>;
    const taskContent =
      typeof envFromPayload.TASK_CONTENT === "string"
        ? envFromPayload.TASK_CONTENT
        : record.planJob.description;

    record.status = "running";
    record.startedAt = new Date().toISOString();
    record.progress = 5;
    record.message = `Started native AI job for ${record.planJob.label}`;

    const startedEvent = this.createEvent(record, {
      type: "job.started",
      status: "running",
      progress: 5,
      message: record.message,
    });
    emitEvent(startedEvent);
    await this.sendCallback(record, startedEvent);

    const serverBaseUrl =
      process.env.SERVER_BASE_URL?.trim() ||
      process.env.LOBSTER_SERVER_BASE_URL?.trim() ||
      "http://127.0.0.1:3001";
    const url = new URL("/api/chat", serverBaseUrl).toString();

    const startedAtMs = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: taskContent }],
        temperature: 0.2,
        maxTokens: 800,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;

    const aiResult = {
      content: String(data?.content ?? ""),
      usage: data?.usage ?? undefined,
      model: String(data?.model ?? ""),
      taskType: "text-generation",
      completedAt: finishedAt,
    };

    const aiResultFile = join(artifactsDir, "ai-result.json");
    writeFileSync(aiResultFile, `${JSON.stringify(aiResult, null, 2)}\n`, "utf-8");

    const result = {
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      requestId: record.request.requestId,
      exitCode: 0,
      timedOut: false,
      durationMs,
      outcome: "success",
      summary: "Native AI execution completed successfully",
    };
    const resultFile = join(record.dataDirectory, "result.json");
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf-8");

    const artifacts: ExecutionPlanArtifact[] = [
      {
        kind: "log",
        name: "executor.log",
        path: toRelativePath(record.logFile),
        description: "Line-oriented executor runtime log",
      },
      {
        kind: "report",
        name: "result.json",
        path: toRelativePath(resultFile),
        description: "Native execution summary",
      },
      {
        kind: "report",
        name: "ai-result.json",
        path: toRelativePath(aiResultFile),
        description: "Native AI execution result",
      },
    ];

    record.status = "completed";
    record.finishedAt = finishedAt;
    record.progress = 100;
    record.summary = result.summary;
    record.message = result.summary;
    record.artifacts = artifacts;

    const event = this.createEvent(record, {
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: result.summary,
      summary: result.summary,
      artifacts,
      metrics: { durationMs, passed: 1 },
      payload: {
        aiTaskType: aiResult.taskType,
        aiModel: aiResult.model,
        aiResult: {
          tokenUsage: aiResult.usage,
          model: aiResult.model,
          contentPreview:
            aiResult.content.length > 200 ? aiResult.content.slice(0, 200) : aiResult.content,
        },
      },
    });
    emitEvent(event);
    await this.sendCallback(record, event);
  }

  private createEvent(
    record: StoredJobRecord,
    input: {
      type: ExecutorEvent["type"];
      status: ExecutorJobStatus;
      progress?: number;
      message: string;
      summary?: string;
      errorCode?: string;
      artifacts?: ExecutionPlanArtifact[];
      metrics?: ExecutorEvent["metrics"];
      payload?: Record<string, unknown>;
    },
  ): ExecutorEvent {
    return {
      version: EXECUTOR_CONTRACT_VERSION,
      eventId: randomUUID(),
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      executor: record.request.executor,
      type: input.type,
      status: input.status,
      occurredAt: new Date().toISOString(),
      progress: input.progress,
      message: input.message,
      summary: input.summary,
      errorCode: input.errorCode,
      artifacts: input.artifacts,
      metrics: input.metrics,
      payload: input.payload,
    };
  }

  private async sendCallback(
    record: StoredJobRecord,
    event: ExecutorEvent,
  ): Promise<void> {
    try {
      await this.callbackSender.send(record.request.callback.eventsUrl, event);
    } catch {
    }
  }
}
