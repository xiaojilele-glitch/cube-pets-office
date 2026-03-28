import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionPlanArtifact,
  type ExecutorEvent,
  type ExecutorJobStatus,
} from "../../../shared/executor/contracts.js";
import type { CreateExecutorJobResponse } from "../../../shared/executor/api.js";
import { ConflictError, NotFoundError } from "./errors.js";
import {
  getMockRunnerConfig,
  getPlanJobById,
  parseExecutorJobRequest,
} from "./request-schema.js";
import type {
  JobQueueStats,
  LobsterExecutorJobDetail,
  LobsterExecutorJobSummary,
  LobsterExecutorServiceOptions,
  StoredJobRecord,
} from "./types.js";

const FINAL_STATUSES = new Set<ExecutorJobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toRelativePath(pathname: string): string {
  return relative(process.cwd(), pathname).replace(/\\/g, "/");
}

function createQueueStats(records: Iterable<StoredJobRecord>): JobQueueStats {
  const stats: JobQueueStats = {
    total: 0,
    queued: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const record of records) {
    stats.total += 1;
    stats[record.status] += 1;
  }

  return stats;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export class LobsterExecutorService {
  private readonly jobs = new Map<string, StoredJobRecord>();

  private readonly sleep: (ms: number) => Promise<void>;

  private readonly now: () => Date;

  constructor(private readonly options: LobsterExecutorServiceOptions) {
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    mkdirSync(options.dataRoot, { recursive: true });
  }

  getDataRoot(): string {
    return this.options.dataRoot;
  }

  getQueueStats(): JobQueueStats {
    return createQueueStats(this.jobs.values());
  }

  listJobs(): LobsterExecutorJobSummary[] {
    return Array.from(this.jobs.values())
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .map(record => this.toSummary(record));
  }

  getJob(jobId: string): LobsterExecutorJobDetail {
    const record = this.jobs.get(jobId);
    if (!record) {
      throw new NotFoundError(`Executor job ${jobId} was not found`);
    }

    return this.toDetail(record);
  }

  submit(rawRequest: unknown): CreateExecutorJobResponse {
    const request = parseExecutorJobRequest(rawRequest);
    const planJob = getPlanJobById(request);
    const existing = this.jobs.get(request.jobId);

    if (existing) {
      const sameRequest =
        existing.request.requestId === request.requestId ||
        (request.idempotencyKey &&
          existing.request.idempotencyKey === request.idempotencyKey);

      if (sameRequest) {
        return existing.acceptedResponse;
      }

      throw new ConflictError(
        `Executor job ${request.jobId} already exists for mission ${request.missionId}`
      );
    }

    const receivedAt = this.now().toISOString();
    const dataDirectory = join(
      this.options.dataRoot,
      "jobs",
      sanitizePathSegment(request.missionId),
      sanitizePathSegment(request.jobId)
    );
    mkdirSync(dataDirectory, { recursive: true });

    const logFile = join(dataDirectory, "executor.log");
    const acceptedResponse: CreateExecutorJobResponse = {
      ok: true,
      accepted: true,
      requestId: request.requestId,
      missionId: request.missionId,
      jobId: request.jobId,
      receivedAt,
    };

    const record: StoredJobRecord = {
      acceptedResponse,
      request,
      planJob,
      status: "queued",
      progress: 0,
      message: "Job accepted",
      receivedAt,
      artifacts: [],
      events: [],
      dataDirectory,
      logFile,
    };

    this.jobs.set(request.jobId, record);
    writeFileSync(
      join(dataDirectory, "request.json"),
      `${JSON.stringify(request, null, 2)}\n`,
      "utf-8"
    );
    this.appendEvent(record, {
      type: "job.accepted",
      status: "queued",
      progress: 0,
      message: "Job accepted by lobster executor",
    });

    void this.runAcceptedJob(record);
    return acceptedResponse;
  }

  isJobFinal(jobId: string): boolean {
    const record = this.jobs.get(jobId);
    return record ? FINAL_STATUSES.has(record.status) : false;
  }

  private async runAcceptedJob(record: StoredJobRecord): Promise<void> {
    const runner = getMockRunnerConfig(record.planJob);
    const startedAt = this.now().toISOString();

    record.status = "running";
    record.startedAt = startedAt;
    record.message = "Job is running";
    record.progress = 5;

    this.appendEvent(record, {
      type: "job.started",
      status: "running",
      progress: 5,
      message: `Started mock runner for ${record.planJob.label}`,
    });

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
      await this.sleep(runner.delayMs);
      const progress = Math.min(95, Math.round(((index + 1) / steps) * 90));
      const logMessage =
        outputLines[index] ||
        `Completed mock step ${index + 1}/${steps} for ${record.planJob.key}`;

      record.progress = progress;
      record.message = logMessage;
      this.appendLog(record, logMessage);
      this.appendEvent(record, {
        type: "job.progress",
        status: "running",
        progress,
        message: logMessage,
      });
    }

    const finishedAt = this.now().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(record.startedAt);
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
    record.artifacts = artifacts;
    record.summary = resultPayload.summary;
    record.finishedAt = finishedAt;

    if (runner.outcome === "failed") {
      record.status = "failed";
      record.progress = 100;
      record.errorCode = "MOCK_FAILURE";
      record.errorMessage = "Mock runner was configured to fail";
      record.message = record.errorMessage;

      this.appendEvent(record, {
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
      });
      return;
    }

    record.status = "completed";
    record.progress = 100;
    record.message = record.summary;

    this.appendEvent(record, {
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
    });
  }

  private appendEvent(
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
    }
  ): void {
    const event: ExecutorEvent = {
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
    };

    record.events.push(event);
    appendFileSync(
      join(record.dataDirectory, "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf-8"
    );
  }

  private appendLog(record: StoredJobRecord, message: string): void {
    appendFileSync(
      record.logFile,
      `[${this.now().toISOString()}] ${message}\n`,
      "utf-8"
    );
  }

  private toSummary(record: StoredJobRecord): LobsterExecutorJobSummary {
    return {
      requestId: record.request.requestId,
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      jobKey: record.planJob.key,
      jobLabel: record.planJob.label,
      kind: record.planJob.kind,
      status: record.status,
      progress: record.progress,
      message: record.message,
      receivedAt: record.receivedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      summary: record.summary,
      callbackMode: "pending",
      artifactCount: record.artifacts.length,
    };
  }

  private toDetail(record: StoredJobRecord): LobsterExecutorJobDetail {
    return {
      ...this.toSummary(record),
      artifacts: [...record.artifacts],
      events: [...record.events],
      dataDirectory: toRelativePath(record.dataDirectory),
      logFile: toRelativePath(record.logFile),
    };
  }
}

export function createLobsterExecutorService(
  options: LobsterExecutorServiceOptions
): LobsterExecutorService {
  return new LobsterExecutorService(options);
}
