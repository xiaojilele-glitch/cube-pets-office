import { randomUUID } from "node:crypto";

import {
  EXECUTOR_API_ROUTES,
  type CancelExecutorJobRequest,
  type PauseExecutorJobRequest,
  type ResumeExecutorJobRequest,
} from "../../shared/executor/api.js";
import type {
  MissionEvent,
  MissionOperatorActionRecord,
  MissionOperatorActionType,
  MissionOperatorState,
  MissionRecord,
} from "../../shared/mission/contracts.js";
import type { SubmitMissionOperatorActionRequest } from "../../shared/mission/api.js";
import type { MissionRuntime } from "./mission-runtime.js";

const DEFAULT_EXECUTOR_BASE_URL = "http://127.0.0.1:3031";
const FINAL_MISSION_STATUSES = new Set(["done", "failed", "cancelled"]);

function buildExecutorUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
}

function getOperatorState(task: MissionRecord): MissionOperatorState {
  return task.operatorState ?? "active";
}

function trimOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toExecutorSource(): CancelExecutorJobRequest["source"] {
  return "user";
}

function appendOperatorAction(
  task: MissionRecord,
  input: {
    action: MissionOperatorActionType;
    requestedBy?: string;
    reason?: string;
    detail?: string;
    result?: MissionOperatorActionRecord["result"];
  }
): MissionOperatorActionRecord {
  const record: MissionOperatorActionRecord = {
    id: randomUUID(),
    action: input.action,
    requestedBy: input.requestedBy,
    reason: input.reason,
    createdAt: Date.now(),
    result: input.result ?? "completed",
    detail: input.detail,
  };

  task.operatorActions = [...(task.operatorActions ?? []), record];
  return record;
}

function appendMissionLog(
  task: MissionRecord,
  input: {
    message: string;
    level?: MissionEvent["level"];
    source?: MissionEvent["source"];
  }
): void {
  task.events.push({
    type: "log",
    message: input.message,
    level: input.level,
    progress: task.progress,
    stageKey: task.currentStageKey,
    time: Date.now(),
    source: input.source ?? "user",
  });
}

function getAvailableOperatorActions(
  task: MissionRecord
): MissionOperatorActionType[] {
  const operatorState = getOperatorState(task);

  if (task.status === "failed" || task.status === "cancelled") {
    return ["retry"];
  }

  if (operatorState === "terminating") {
    return [];
  }

  if (operatorState === "paused") {
    return ["resume", "terminate"];
  }

  if (operatorState === "blocked") {
    return ["resume", "retry", "terminate"];
  }

  if (task.status === "queued" || task.status === "running") {
    return ["pause", "mark-blocked", "terminate"];
  }

  if (task.status === "waiting") {
    return ["mark-blocked", "terminate"];
  }

  return [];
}

function createUnavailableActionMessage(
  action: MissionOperatorActionType,
  task: MissionRecord
): string {
  return `Action "${action}" is not allowed while mission status is "${task.status}" and operator state is "${getOperatorState(task)}".`;
}

function resetMissionForRetry(task: MissionRecord, requestedBy?: string): void {
  const nextAttempt = Math.max(1, task.attempt ?? 1) + 1;

  task.status = "queued";
  task.progress = 0;
  task.summary = undefined;
  task.waitingFor = undefined;
  task.decision = undefined;
  task.completedAt = undefined;
  task.cancelledAt = undefined;
  task.cancelledBy = undefined;
  task.cancelReason = undefined;
  task.operatorState = "active";
  task.blocker = undefined;
  task.attempt = nextAttempt;
  task.currentStageKey = undefined;

  for (const stage of task.stages) {
    stage.status = "pending";
    stage.detail = undefined;
    stage.startedAt = undefined;
    stage.completedAt = undefined;
  }

  if (task.executor) {
    task.executor = {
      ...task.executor,
      requestId: undefined,
      jobId: undefined,
      status: "queued",
      lastEventType: undefined,
      lastEventAt: undefined,
    };
  }

  if (task.instance) {
    task.instance = {
      ...task.instance,
      id: undefined,
      startedAt: undefined,
      completedAt: undefined,
      exitCode: undefined,
    };
  }

  const detail = `Retry requested. Attempt ${nextAttempt} queued for execution.`;
  appendMissionLog(task, {
    message: detail,
    level: "info",
    source: "user",
  });
  appendOperatorAction(task, {
    action: "retry",
    requestedBy,
    detail,
  });
}

class MissionOperatorActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly allowedActions?: MissionOperatorActionType[]
  ) {
    super(message);
    this.name = "MissionOperatorActionError";
  }
}

export interface MissionOperatorServiceOptions {
  fetchImpl?: typeof fetch;
  executorBaseUrl?: string;
}

export interface MissionOperatorActionResult {
  task: MissionRecord;
  action: MissionOperatorActionRecord;
}

export class MissionOperatorService {
  private readonly fetchImpl: typeof fetch;
  private readonly defaultExecutorBaseUrl: string;

  constructor(
    private readonly runtime: MissionRuntime,
    options: MissionOperatorServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultExecutorBaseUrl =
      options.executorBaseUrl?.trim() || DEFAULT_EXECUTOR_BASE_URL;
  }

  async submit(
    missionId: string,
    input: SubmitMissionOperatorActionRequest
  ): Promise<MissionOperatorActionResult> {
    const task = this.runtime.getTask(missionId);
    if (!task) {
      throw new MissionOperatorActionError("Task not found", 404);
    }

    const requestedBy = trimOptional(input.requestedBy);
    const reason = trimOptional(input.reason);
    const allowedActions = getAvailableOperatorActions(task);

    if (!allowedActions.includes(input.action)) {
      throw new MissionOperatorActionError(
        createUnavailableActionMessage(input.action, task),
        409,
        allowedActions
      );
    }

    if (input.action === "mark-blocked" && !reason) {
      throw new MissionOperatorActionError(
        "A blocker reason is required for mark-blocked.",
        400,
        allowedActions
      );
    }

    if (input.action === "pause") {
      return this.pauseMission(task, requestedBy, reason);
    }

    if (input.action === "resume") {
      return this.resumeMission(task, requestedBy, reason);
    }

    if (input.action === "mark-blocked") {
      return this.markMissionBlocked(task, requestedBy, reason!);
    }

    if (input.action === "retry") {
      return this.retryMission(task, requestedBy);
    }

    return this.terminateMission(task, requestedBy, reason);
  }

  private async pauseMission(
    task: MissionRecord,
    requestedBy?: string,
    reason?: string
  ): Promise<MissionOperatorActionResult> {
    await this.forwardPauseToExecutor(task, requestedBy, reason);

    let actionRecord: MissionOperatorActionRecord | null = null;
    const updated = this.runtime.updateMission(task.id, current => {
      current.operatorState = "paused";
      if (current.executor) {
        current.executor = {
          ...current.executor,
          status: "paused",
          lastEventType: "operator.pause",
          lastEventAt: Date.now(),
        };
      }
      const detail =
        current.status === "queued"
          ? "Mission paused before executor dispatch."
          : "Mission paused while execution is in progress.";
      appendMissionLog(current, {
        message: reason || detail,
        level: "warn",
        source: "user",
      });
      actionRecord = appendOperatorAction(current, {
        action: "pause",
        requestedBy,
        reason,
        detail,
      });
    });

    return {
      task: updated!,
      action: actionRecord!,
    };
  }

  private async resumeMission(
    task: MissionRecord,
    requestedBy?: string,
    reason?: string
  ): Promise<MissionOperatorActionResult> {
    await this.forwardResumeToExecutor(task, requestedBy, reason);

    let actionRecord: MissionOperatorActionRecord | null = null;
    const updated = this.runtime.updateMission(task.id, current => {
      current.operatorState = "active";
      current.blocker = undefined;
      if (current.executor) {
        current.executor = {
          ...current.executor,
          status: current.status === "queued" ? "queued" : "running",
          lastEventType: "operator.resume",
          lastEventAt: Date.now(),
        };
      }
      const detail = "Mission resumed and returned to active operator state.";
      appendMissionLog(current, {
        message: reason || detail,
        level: "info",
        source: "user",
      });
      actionRecord = appendOperatorAction(current, {
        action: "resume",
        requestedBy,
        reason,
        detail,
      });
    });

    return {
      task: updated!,
      action: actionRecord!,
    };
  }

  private async markMissionBlocked(
    task: MissionRecord,
    requestedBy: string | undefined,
    reason: string
  ): Promise<MissionOperatorActionResult> {
    let actionRecord: MissionOperatorActionRecord | null = null;
    const updated = this.runtime.updateMission(task.id, current => {
      current.operatorState = "blocked";
      current.blocker = {
        reason,
        createdAt: Date.now(),
        createdBy: requestedBy,
      };
      appendMissionLog(current, {
        message: `Mission marked blocked: ${reason}`,
        level: "warn",
        source: "user",
      });
      actionRecord = appendOperatorAction(current, {
        action: "mark-blocked",
        requestedBy,
        reason,
        detail: "Mission is blocked pending manual follow-up.",
      });
    });

    return {
      task: updated!,
      action: actionRecord!,
    };
  }

  private async retryMission(
    task: MissionRecord,
    requestedBy?: string
  ): Promise<MissionOperatorActionResult> {
    let actionRecord: MissionOperatorActionRecord | null = null;
    const updated = this.runtime.updateMission(task.id, current => {
      resetMissionForRetry(current, requestedBy);
      actionRecord = current.operatorActions?.at(-1) ?? null;
    });

    return {
      task: updated!,
      action: actionRecord!,
    };
  }

  private async terminateMission(
    task: MissionRecord,
    requestedBy?: string,
    reason?: string
  ): Promise<MissionOperatorActionResult> {
    await this.forwardTerminateToExecutor(task, requestedBy, reason);
    this.runtime.cancelMission(task.id, {
      reason: reason || "Mission terminated by operator.",
      requestedBy,
      source: "user",
    });

    let actionRecord: MissionOperatorActionRecord | null = null;
    const updated = this.runtime.updateMission(task.id, current => {
      current.operatorState = "terminating";
      actionRecord = appendOperatorAction(current, {
        action: "terminate",
        requestedBy,
        reason,
        detail: "Mission termination reused the cancel execution path.",
      });
    });

    return {
      task: updated!,
      action: actionRecord!,
    };
  }

  private async forwardPauseToExecutor(
    task: MissionRecord,
    requestedBy?: string,
    reason?: string
  ): Promise<void> {
    const executorJobId = task.executor?.jobId?.trim();
    if (!executorJobId) {
      return;
    }

    const requestBody: PauseExecutorJobRequest = {
      requestedBy,
      reason,
      source: toExecutorSource(),
    };

    await this.postExecutorControl(
      task,
      EXECUTOR_API_ROUTES.pauseJob.replace(
        ":id",
        encodeURIComponent(executorJobId)
      ),
      requestBody,
      "Executor pause request failed"
    );
  }

  private async forwardResumeToExecutor(
    task: MissionRecord,
    requestedBy?: string,
    reason?: string
  ): Promise<void> {
    const executorJobId = task.executor?.jobId?.trim();
    if (!executorJobId) {
      return;
    }

    const requestBody: ResumeExecutorJobRequest = {
      requestedBy,
      reason,
      source: toExecutorSource(),
    };

    await this.postExecutorControl(
      task,
      EXECUTOR_API_ROUTES.resumeJob.replace(
        ":id",
        encodeURIComponent(executorJobId)
      ),
      requestBody,
      "Executor resume request failed"
    );
  }

  private async forwardTerminateToExecutor(
    task: MissionRecord,
    requestedBy?: string,
    reason?: string
  ): Promise<void> {
    const executorJobId = task.executor?.jobId?.trim();
    if (!executorJobId || FINAL_MISSION_STATUSES.has(task.status)) {
      return;
    }

    const requestBody: CancelExecutorJobRequest = {
      requestedBy,
      reason,
      source: toExecutorSource(),
    };

    await this.postExecutorControl(
      task,
      EXECUTOR_API_ROUTES.cancelJob.replace(
        ":id",
        encodeURIComponent(executorJobId)
      ),
      requestBody,
      "Executor terminate request failed"
    );
  }

  private async postExecutorControl(
    task: MissionRecord,
    route: string,
    body: object,
    fallbackMessage: string
  ): Promise<void> {
    const executorBaseUrl =
      task.executor?.baseUrl?.trim() || this.defaultExecutorBaseUrl;

    let downstreamResponse: Response;
    try {
      downstreamResponse = await this.fetchImpl(
        buildExecutorUrl(executorBaseUrl, route),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
    } catch (error) {
      throw new MissionOperatorActionError(
        error instanceof Error
          ? `${fallbackMessage}: ${error.message}`
          : fallbackMessage,
        503
      );
    }

    if (downstreamResponse.ok) {
      return;
    }

    const rawBody = await downstreamResponse.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = null;
    }

    const message =
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      "error" in parsedBody &&
      typeof parsedBody.error === "string"
        ? parsedBody.error
        : `${fallbackMessage} with HTTP ${downstreamResponse.status}`;

    throw new MissionOperatorActionError(
      message,
      downstreamResponse.status === 404 ? 502 : 503
    );
  }
}

export function createMissionOperatorService(
  runtime: MissionRuntime,
  options: MissionOperatorServiceOptions = {}
): MissionOperatorService {
  return new MissionOperatorService(runtime, options);
}

export {
  MissionOperatorActionError,
  getAvailableOperatorActions as getAvailableMissionOperatorActions,
  getOperatorState as getMissionOperatorState,
};
