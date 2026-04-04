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
  getPlanJobById,
  parseExecutorJobRequest,
} from "./request-schema.js";
import type {
  JobQueueStats,
  LobsterExecutorConfig,
  LobsterExecutorJobDetail,
  LobsterExecutorJobSummary,
  LobsterExecutorServiceOptions,
  StoredJobRecord,
} from "./types.js";
import type { JobRunner } from "./runner.js";
import { createJobRunner } from "./runner.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { CallbackSender } from "./callback-sender.js";

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

export class LobsterExecutorService {
  private readonly jobs = new Map<string, StoredJobRecord>();

  private readonly now: () => Date;

  private readonly runner: JobRunner;
  private readonly limiter: ConcurrencyLimiter;
  private readonly executionMode: "real" | "mock";

  constructor(private readonly options: LobsterExecutorServiceOptions) {
    this.now = options.now ?? (() => new Date());
    mkdirSync(options.dataRoot, { recursive: true });

    // Resolve config: use provided config or build a mock-mode default
    const config: LobsterExecutorConfig = options.config ?? {
      host: "0.0.0.0",
      port: 3031,
      dataRoot: options.dataRoot,
      serviceName: "lobster-executor",
      executionMode: "mock",
      defaultImage: "node:20-slim",
      maxConcurrentJobs: 2,
      callbackSecret: "",
      aiImage: "cube-ai-sandbox:latest",
    };

    this.executionMode = config.executionMode;

    // Create CallbackSender for "real" mode
    let callbackSender: CallbackSender | undefined;
    if (config.executionMode === "real") {
      callbackSender = new CallbackSender({
        secret: config.callbackSecret,
        executorId: config.serviceName,
      });
    }

    // Select runner based on executionMode
    this.runner = createJobRunner(config, callbackSender, {
      sleep: options.sleep,
      now: options.now,
    });

    // Create concurrency limiter
    this.limiter = new ConcurrencyLimiter(config.maxConcurrentJobs);
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
      executionMode: this.executionMode,
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
    await this.limiter.acquire();
    try {
      await this.runner.run(record, (event: ExecutorEvent) => {
        // Persist every event emitted by the runner
        record.events.push(event);
        appendFileSync(
          join(record.dataDirectory, "events.jsonl"),
          `${JSON.stringify(event)}\n`,
          "utf-8"
        );
      });
    } finally {
      this.limiter.release();
    }
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
