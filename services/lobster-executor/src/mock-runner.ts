import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionPlanArtifact,
  type ExecutorEvent,
  type ExecutorJobStatus,
} from "../../../shared/executor/contracts.js";
import type { AIResultArtifact, StoredJobRecord } from "./types.js";
import { getMockRunnerConfig } from "./request-schema.js";
import type { JobRunner } from "./runner.js";

const MOCK_AI_RESULT = {
  content: "This is a mock AI response for testing purposes.",
  usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
  model: "mock-model",
  taskType: "text-generation",
};

function toRelativePath(pathname: string): string {
  return relative(process.cwd(), pathname).replace(/\\/g, "/");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export interface MockRunnerOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export class MockRunner implements JobRunner {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(options?: MockRunnerOptions) {
    this.sleep = options?.sleep ?? defaultSleep;
    this.now = options?.now ?? (() => new Date());
  }

  async run(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
  ): Promise<void> {
    const runner = getMockRunnerConfig(record.planJob);
    const startedAt = this.now().toISOString();

    record.status = "running";
    record.startedAt = startedAt;
    record.message = "Job is running";
    record.progress = 5;

    emitEvent(this.createEvent(record, {
      type: "job.started",
      status: "running",
      progress: 5,
      message: `Started mock runner for ${record.planJob.label}`,
    }));

    const outputLines =
      runner.logs && runner.logs.length > 0
        ? runner.logs
        : [
            `Preparing ${record.planJob.kind} workspace`,
            `Executing ${record.planJob.key}`,
            "Collecting executor artifacts",
          ];

    const steps = Math.max(runner.steps, outputLines.length);

    for (let index = 0; index < steps; index += 1) {
      await this.waitWhilePaused(record);
      await this.sleep(runner.delayMs);
      await this.waitWhilePaused(record);
      if (record.cancelRequested) {
        const finishedAt = this.now().toISOString();
        const durationMs = Date.parse(finishedAt) - Date.parse(record.startedAt!);
        const cancelReason =
          record.cancelRequested.reason?.trim() || "Mock execution cancelled";

        record.status = "cancelled";
        record.progress = Math.min(record.progress, 99);
        record.summary = cancelReason;
        record.message = cancelReason;
        record.finishedAt = finishedAt;

        emitEvent(this.createEvent(record, {
          type: "job.cancelled",
          status: "cancelled",
          progress: record.progress,
          message: cancelReason,
          summary: cancelReason,
          artifacts: [
            {
              kind: "log",
              name: "executor.log",
              path: toRelativePath(record.logFile),
              description: "Line-oriented executor runtime log",
            },
          ],
          metrics: {
            durationMs,
          },
          payload: {
            cancelRequested: record.cancelRequested,
          },
        }));
        return;
      }
      const progress = Math.min(95, Math.round(((index + 1) / steps) * 90));
      const logMessage =
        outputLines[index] ||
        `Completed mock step ${index + 1}/${steps} for ${record.planJob.key}`;

      record.progress = progress;
      record.message = logMessage;
      this.appendLog(record, logMessage);
      emitEvent(this.createEvent(record, {
        type: "job.progress",
        status: "running",
        progress,
        message: logMessage,
      }));
    }

    const finishedAt = this.now().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(record.startedAt!);
    const resultPayload = {
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      requestId: record.request.requestId,
      summary:
        runner.summary ||
        (runner.outcome === "success"
          ? "Mock execution completed successfully"
          : "Mock execution failed as requested"),
      outcome: runner.outcome,
      durationMs,
      callback: {
        eventsUrl: record.request.callback.eventsUrl,
        delivery: "pending-phase-3",
      },
    };

    const resultFile = join(record.dataDirectory, "result.json");
    writeFileSync(
      resultFile,
      `${JSON.stringify(resultPayload, null, 2)}\n`,
      "utf-8"
    );

    const jobPayload = (record.planJob.payload ?? {}) as Record<string, unknown>;
    const aiEnabled = jobPayload.aiEnabled === true;

    // Write AI result artifact if AI is enabled
    let aiResultArtifact: AIResultArtifact | undefined;
    let aiResultFile: string | undefined;
    if (aiEnabled) {
      const aiTaskType = (jobPayload.aiTaskType as string) || MOCK_AI_RESULT.taskType;
      aiResultArtifact = {
        ...MOCK_AI_RESULT,
        taskType: aiTaskType,
        completedAt: finishedAt,
      };
      const artifactsDir = join(record.dataDirectory, "artifacts");
      if (!existsSync(artifactsDir)) {
        mkdirSync(artifactsDir, { recursive: true });
      }
      aiResultFile = join(artifactsDir, "ai-result.json");
      writeFileSync(aiResultFile, `${JSON.stringify(aiResultArtifact, null, 2)}\n`, "utf-8");
    }

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
        description: "Mock execution summary and callback delivery placeholder",
      },
    ];

    if (aiEnabled && aiResultFile) {
      artifacts.push({
        kind: "report",
        name: "ai-result.json",
        path: toRelativePath(aiResultFile),
        description: "Mock AI execution result",
      });
    }

    record.artifacts = artifacts;
    record.summary = resultPayload.summary;
    record.finishedAt = finishedAt;

    // Build AI event payload if enabled
    let eventPayload: Record<string, unknown> | undefined;
    if (aiEnabled && aiResultArtifact) {
      eventPayload = {
        aiTaskType: aiResultArtifact.taskType,
        aiModel: aiResultArtifact.model,
        aiResult: {
          tokenUsage: aiResultArtifact.usage,
          model: aiResultArtifact.model,
          contentPreview: aiResultArtifact.content.length > 200
            ? aiResultArtifact.content.slice(0, 200)
            : aiResultArtifact.content,
        },
      };
    }

    if (runner.outcome === "failed") {
      record.status = "failed";
      record.progress = 100;
      record.errorCode = "MOCK_FAILURE";
      record.errorMessage = "Mock runner was configured to fail";
      record.message = record.errorMessage;

      emitEvent(this.createEvent(record, {
        type: "job.failed",
        status: "failed",
        progress: 100,
        message: record.errorMessage,
        errorCode: record.errorCode,
        summary: record.summary,
        artifacts,
        metrics: {
          durationMs,
          failed: 1,
        },
        payload: eventPayload,
      }));
      return;
    }

    record.status = "completed";
    record.progress = 100;
    record.message = record.summary;

    emitEvent(this.createEvent(record, {
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: record.summary,
      summary: record.summary,
      artifacts,
      metrics: {
        durationMs,
        passed: 1,
      },
      payload: eventPayload,
    }));
  }

  async pause(record: StoredJobRecord): Promise<void> {
    const reason =
      record.pauseRequested?.reason?.trim() || "Mock execution paused";
    record.message = reason;
    this.appendLog(record, `[pause] ${reason}`);
  }

  async resume(record: StoredJobRecord): Promise<void> {
    const reason = "Mock execution resumed";
    record.message = reason;
    this.appendLog(record, `[resume] ${reason}`);
  }

  private async waitWhilePaused(record: StoredJobRecord): Promise<void> {
    while (record.pausedAt) {
      if (!record.resumeWaiter) {
        let resolve!: () => void;
        const promise = new Promise<void>(nextResolve => {
          resolve = nextResolve;
        });
        record.resumeWaiter = { promise, resolve };
      }

      await record.resumeWaiter.promise;
      record.resumeWaiter = undefined;
    }
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
      occurredAt: this.now().toISOString(),
      progress: input.progress,
      message: input.message,
      summary: input.summary,
      errorCode: input.errorCode,
      artifacts: input.artifacts,
      metrics: input.metrics,
      payload: input.payload,
    };
  }

  private appendLog(record: StoredJobRecord, message: string): void {
    appendFileSync(
      record.logFile,
      `[${this.now().toISOString()}] ${message}\n`,
      "utf-8",
    );
  }
}
