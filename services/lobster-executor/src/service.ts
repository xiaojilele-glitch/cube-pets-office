import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionPlanArtifact,
  type ExecutorEvent,
  type ExecutorJobStatus,
} from "../../../shared/executor/contracts.js";
import type {
  CancelExecutorJobRequest,
  CancelExecutorJobResponse,
  CreateExecutorJobResponse,
  PauseExecutorJobRequest,
  PauseExecutorJobResponse,
  ResumeExecutorJobRequest,
  ResumeExecutorJobResponse,
} from "../../../shared/executor/api.js";
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
  private readonly callbackSender?: CallbackSender;

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
      // Security defaults for mock mode
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    };

    this.executionMode = config.executionMode;

    // Create CallbackSender for all modes so mock execution can still replay
    // lifecycle events back to the server.
    const callbackSender = new CallbackSender({
      secret: config.callbackSecret,
      executorId: config.serviceName,
    });
    this.callbackSender = callbackSender;

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

  async cancel(
    jobId: string,
    request: CancelExecutorJobRequest = {},
  ): Promise<CancelExecutorJobResponse> {
    const record = this.jobs.get(jobId);
    if (!record) {
      throw new NotFoundError(`Executor job ${jobId} was not found`);
    }

    if (FINAL_STATUSES.has(record.status)) {
      return {
        ok: true,
        accepted: true,
        alreadyFinal: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    const requestedAt = this.now().toISOString();
    const reason =
      typeof request.reason === "string" && request.reason.trim()
        ? request.reason.trim()
        : undefined;
    const requestedBy =
      typeof request.requestedBy === "string" && request.requestedBy.trim()
        ? request.requestedBy.trim()
        : undefined;
    const source =
      typeof request.source === "string" && request.source.trim()
        ? request.source.trim()
        : undefined;

    record.cancelRequested = {
      requestedAt,
      requestedBy,
      reason,
      source,
    };

    const cancelMessage = reason || "Cancellation requested";
    record.message = cancelMessage;
    this.appendLog(record, `[cancel] ${cancelMessage}`);

    if (record.status === "queued" || record.status === "waiting") {
      const finishedAt = this.now().toISOString();
      record.status = "cancelled";
      record.finishedAt = finishedAt;
      record.summary = reason || "Executor job cancelled before execution completed";
      record.message = record.summary;
      record.pausedAt = undefined;
      record.pauseRequested = undefined;
      record.resumeWaiter?.resolve();
      record.resumeWaiter = undefined;

      const event = this.createEvent(record, {
        type: "job.cancelled",
        status: "cancelled",
        progress: record.progress,
        message: record.summary,
        summary: record.summary,
        detail: reason,
        artifacts: [
          {
            kind: "log",
            name: "executor.log",
            path: toRelativePath(record.logFile),
            description: "Line-oriented executor runtime log",
          },
        ],
        payload: {
          cancelRequested: record.cancelRequested,
        },
      });
      this.persistEvent(record, event);
      await this.sendCallback(record, event);

      return {
        ok: true,
        accepted: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    if (record.status === "running") {
      record.pausedAt = undefined;
      record.pauseRequested = undefined;
      record.resumeWaiter?.resolve();
      record.resumeWaiter = undefined;

      if (typeof this.runner.cancel === "function") {
        await this.runner.cancel(record);
      }

      return {
        ok: true,
        accepted: true,
        cancelRequested: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    return {
      ok: true,
      accepted: true,
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      status: record.status,
      message: record.message,
    };
  }

  async pause(
    jobId: string,
    request: PauseExecutorJobRequest = {},
  ): Promise<PauseExecutorJobResponse> {
    const record = this.jobs.get(jobId);
    if (!record) {
      throw new NotFoundError(`Executor job ${jobId} was not found`);
    }

    if (FINAL_STATUSES.has(record.status)) {
      return {
        ok: true,
        accepted: true,
        alreadyFinal: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    if (record.pausedAt) {
      return {
        ok: true,
        accepted: true,
        alreadyPaused: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    if (record.status !== "queued" && record.status !== "running") {
      throw new ConflictError(
        `Executor job ${jobId} cannot be paused from status ${record.status}`,
      );
    }

    const requestedAt = this.now().toISOString();
    const reason =
      typeof request.reason === "string" && request.reason.trim()
        ? request.reason.trim()
        : undefined;
    const requestedBy =
      typeof request.requestedBy === "string" && request.requestedBy.trim()
        ? request.requestedBy.trim()
        : undefined;
    const source =
      typeof request.source === "string" && request.source.trim()
        ? request.source.trim()
        : undefined;

    record.pauseRequested = {
      requestedAt,
      requestedBy,
      reason,
      source,
    };
    record.pausedAt = requestedAt;

    const message =
      reason ||
      (record.status === "queued"
        ? "Executor job paused before execution"
        : "Executor job paused while running");
    record.message = message;
    this.appendLog(record, `[pause] ${message}`);

    if (record.status === "running" && typeof this.runner.pause === "function") {
      await this.runner.pause(record);
    }

    return {
      ok: true,
      accepted: true,
      pauseRequested: true,
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      status: record.status,
      message: record.message,
    };
  }

  async resume(
    jobId: string,
    request: ResumeExecutorJobRequest = {},
  ): Promise<ResumeExecutorJobResponse> {
    const record = this.jobs.get(jobId);
    if (!record) {
      throw new NotFoundError(`Executor job ${jobId} was not found`);
    }

    if (FINAL_STATUSES.has(record.status)) {
      return {
        ok: true,
        accepted: true,
        alreadyFinal: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    if (!record.pausedAt && !record.pauseRequested) {
      return {
        ok: true,
        accepted: true,
        alreadyActive: true,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        status: record.status,
        message: record.message,
      };
    }

    if (record.status !== "queued" && record.status !== "running") {
      throw new ConflictError(
        `Executor job ${jobId} cannot be resumed from status ${record.status}`,
      );
    }

    const reason =
      typeof request.reason === "string" && request.reason.trim()
        ? request.reason.trim()
        : undefined;
    record.pausedAt = undefined;
    record.pauseRequested = undefined;

    const message =
      reason ||
      (record.status === "queued"
        ? "Executor job resumed and ready for execution"
        : "Executor job resumed");
    record.message = message;
    this.appendLog(record, `[resume] ${message}`);

    record.resumeWaiter?.resolve();
    record.resumeWaiter = undefined;

    if (record.status === "running" && typeof this.runner.resume === "function") {
      await this.runner.resume(record);
    }

    return {
      ok: true,
      accepted: true,
      resumeRequested: true,
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      status: record.status,
      message: record.message,
    };
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
    writeFileSync(logFile, "", "utf-8");
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
      if (FINAL_STATUSES.has(record.status)) {
        return;
      }
      await this.waitUntilResumed(record);
      if (FINAL_STATUSES.has(record.status)) {
        return;
      }
      await this.runner.run(record, (event: ExecutorEvent) => {
        this.persistEvent(record, event);
        if (record.executionMode === "mock") {
          void this.sendCallback(record, event);
        }
      });
    } finally {
      this.limiter.release();
    }
  }

  private persistEvent(record: StoredJobRecord, event: ExecutorEvent): void {
    record.events.push(event);
    appendFileSync(
      join(record.dataDirectory, "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf-8"
    );
  }

  private async sendCallback(
    record: StoredJobRecord,
    event: ExecutorEvent,
  ): Promise<void> {
    if (!this.callbackSender) {
      return;
    }

    try {
      await this.callbackSender.send(record.request.callback.eventsUrl, event);
    } catch {
      // Callback delivery must not break local executor state transitions.
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
      detail?: string;
      artifacts?: ExecutionPlanArtifact[];
      metrics?: ExecutorEvent["metrics"];
    }
  ): void {
    const event = this.createEvent(record, input);
    this.persistEvent(record, event);
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
      detail?: string;
      artifacts?: ExecutionPlanArtifact[];
      metrics?: ExecutorEvent["metrics"];
      payload?: Record<string, unknown>;
    }
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
      detail: input.detail,
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

  private async waitUntilResumed(record: StoredJobRecord): Promise<void> {
    while (record.pausedAt && !FINAL_STATUSES.has(record.status)) {
      if (!record.resumeWaiter) {
        let resolve!: () => void;
        const promise = new Promise<void>(nextResolve => {
          resolve = nextResolve;
        });
        record.resumeWaiter = {
          promise,
          resolve,
        };
      }

      await record.resumeWaiter.promise;
      record.resumeWaiter = undefined;
    }
  }
}

export function createLobsterExecutorService(
  options: LobsterExecutorServiceOptions
): LobsterExecutorService {
  return new LobsterExecutorService(options);
}
