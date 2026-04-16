import { randomUUID } from "node:crypto";

export type FeishuTaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "done"
  | "failed";
export type FeishuTaskStageStatus = "pending" | "running" | "done" | "failed";
export type FeishuTaskEventType =
  | "created"
  | "progress"
  | "log"
  | "waiting"
  | "decision"
  | "done"
  | "failed";

export interface FeishuTaskStage {
  key: string;
  label: string;
  status: FeishuTaskStageStatus;
  detail?: string;
}

export interface FeishuTaskDecisionOption {
  id: string;
  label: string;
  description?: string;
  severity?: "info" | "warn" | "danger";
}

export interface FeishuTaskDecisionPrompt {
  prompt: string;
  options: FeishuTaskDecisionOption[];
  allowFreeText?: boolean;
  type?: string;
}

export interface FeishuResolvedDecision {
  optionId?: string;
  optionLabel?: string;
  freeText?: string;
}

export interface FeishuTaskEvent {
  type: FeishuTaskEventType;
  message: string;
  progress?: number;
  stageKey?: string;
  time: number;
  level?: "info" | "warning" | "error";
}

export interface FeishuTaskRecord {
  id: string;
  kind: string;
  title: string;
  status: FeishuTaskStatus;
  progress: number;
  currentStageKey?: string;
  stages: FeishuTaskStage[];
  events: FeishuTaskEvent[];
  createdAt: number;
  updatedAt: number;
  waitingFor?: string;
  decision?: FeishuTaskDecisionPrompt;
  summary?: string;
  sourceText?: string;
  workflowId?: string;
  lastResolvedDecision?: FeishuResolvedDecision;
}

export interface CreateFeishuTaskInput {
  id?: string;
  kind: string;
  title: string;
  sourceText?: string;
  stages?: Array<{ key: string; label: string }>;
}

export interface FeishuTaskUpdateOptions {
  notify?: boolean;
}

export interface MarkTaskRunningInput {
  stageKey: string;
  stageLabel?: string;
  detail: string;
  progress: number;
  eventType?: "progress" | "log";
}

export interface WaitOnTaskInput {
  waitingFor: string;
  detail: string;
  progress: number;
  decision: FeishuTaskDecisionPrompt;
  stageKey?: string;
  stageLabel?: string;
}

export interface CompleteTaskInput {
  summary: string;
  detail?: string;
  progress?: number;
  stageKey?: string;
  stageLabel?: string;
}

export interface FailTaskInput {
  detail: string;
  progress?: number;
  stageKey?: string;
  stageLabel?: string;
}

export interface ResolveTaskDecisionInput {
  optionId?: string;
  optionLabel?: string;
  freeText?: string;
  detail?: string;
  progress?: number;
}

export interface ResolveTaskDecisionOptions extends FeishuTaskUpdateOptions {
  idempotentIfNotWaiting?: boolean;
}

export type ResolveTaskDecisionResult =
  | {
      ok: true;
      task: FeishuTaskRecord;
      decision: FeishuResolvedDecision;
      alreadyResolved?: boolean;
    }
  | {
      ok: false;
      error: string;
      statusCode: number;
      task?: FeishuTaskRecord;
    };

export interface FeishuTaskStore {
  createTask(input: CreateFeishuTaskInput): FeishuTaskRecord;
  getTask(taskId: string): FeishuTaskRecord | undefined;
  listTasks(limit?: number): FeishuTaskRecord[];
  bindWorkflow(
    taskId: string,
    workflowId: string
  ): FeishuTaskRecord | undefined;
  markTaskRunning(
    taskId: string,
    input: MarkTaskRunningInput,
    options?: FeishuTaskUpdateOptions
  ): Promise<FeishuTaskRecord>;
  waitOnTask(
    taskId: string,
    input: WaitOnTaskInput,
    options?: FeishuTaskUpdateOptions
  ): Promise<FeishuTaskRecord>;
  completeTask(
    taskId: string,
    input: CompleteTaskInput,
    options?: FeishuTaskUpdateOptions
  ): Promise<FeishuTaskRecord>;
  failTask(
    taskId: string,
    input: FailTaskInput,
    options?: FeishuTaskUpdateOptions
  ): Promise<FeishuTaskRecord>;
  resolveTaskDecision(
    taskId: string,
    input: ResolveTaskDecisionInput,
    options?: ResolveTaskDecisionOptions
  ): Promise<ResolveTaskDecisionResult>;
  subscribe(
    listener: (task: FeishuTaskRecord) => void | Promise<void>
  ): () => void;
}

export const DEFAULT_FEISHU_TASK_STAGES: Array<{ key: string; label: string }> =
  [
    { key: "receive", label: "接收请求" },
    { key: "understand", label: "理解问题" },
    { key: "planning", label: "规划执行" },
    { key: "execution", label: "执行处理" },
    { key: "finalize", label: "整理答复" },
  ];

function cloneTask(task: FeishuTaskRecord): FeishuTaskRecord {
  if (typeof structuredClone === "function") {
    return structuredClone(task);
  }
  return JSON.parse(JSON.stringify(task)) as FeishuTaskRecord;
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function createTaskId(): string {
  return `ft_${randomUUID()}`;
}

function buildStageRecords(
  stages: Array<{ key: string; label: string }> | undefined
): FeishuTaskStage[] {
  const source =
    stages && stages.length > 0 ? stages : DEFAULT_FEISHU_TASK_STAGES;
  return source.map(stage => ({
    key: stage.key,
    label: stage.label,
    status: "pending",
  }));
}

function ensureStage(
  task: FeishuTaskRecord,
  stageKey: string,
  stageLabel?: string
): number {
  const existingIndex = task.stages.findIndex(stage => stage.key === stageKey);
  if (existingIndex >= 0) {
    if (stageLabel) {
      task.stages[existingIndex] = {
        ...task.stages[existingIndex],
        label: stageLabel,
      };
    }
    return existingIndex;
  }

  task.stages.push({
    key: stageKey,
    label: stageLabel || stageKey,
    status: "pending",
  });
  return task.stages.length - 1;
}

function syncStageStatuses(
  task: FeishuTaskRecord,
  currentStageIndex: number,
  currentStatus: FeishuTaskStageStatus,
  detail?: string
): void {
  task.stages = task.stages.map((stage, index) => {
    if (index < currentStageIndex) {
      return {
        ...stage,
        status: stage.status === "failed" ? "failed" : "done",
      };
    }
    if (index > currentStageIndex) {
      return {
        ...stage,
        status: stage.status === "failed" ? "failed" : "pending",
      };
    }
    return {
      ...stage,
      status: currentStatus,
      detail,
    };
  });
}

export function describeTaskDecisionAlreadyProcessed(
  task: FeishuTaskRecord,
  decision: FeishuResolvedDecision
): string {
  const choice =
    decision.optionLabel || decision.freeText || decision.optionId || "该决策";
  return `该决策已处理：${choice}。任务 ${task.title} 当前状态为 ${task.status}。`;
}

export class InMemoryFeishuTaskStore implements FeishuTaskStore {
  private readonly tasks = new Map<string, FeishuTaskRecord>();
  private readonly listeners = new Set<
    (task: FeishuTaskRecord) => void | Promise<void>
  >();

  createTask(input: CreateFeishuTaskInput): FeishuTaskRecord {
    const now = Date.now();
    const task: FeishuTaskRecord = {
      id: input.id?.trim() || createTaskId(),
      kind: input.kind.trim() || "chat",
      title: input.title.trim() || "Feishu task",
      status: "queued",
      progress: 0,
      stages: buildStageRecords(input.stages),
      events: [
        {
          type: "created",
          message: "Task created",
          time: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      sourceText: input.sourceText?.trim(),
    };
    this.tasks.set(task.id, task);
    return cloneTask(task);
  }

  getTask(taskId: string): FeishuTaskRecord | undefined {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : undefined;
  }

  listTasks(limit = 20): FeishuTaskRecord[] {
    return Array.from(this.tasks.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(1, limit))
      .map(task => cloneTask(task));
  }

  bindWorkflow(
    taskId: string,
    workflowId: string
  ): FeishuTaskRecord | undefined {
    const task = this.mustGetTask(taskId);
    task.workflowId = workflowId.trim();
    task.updatedAt = Date.now();
    return cloneTask(task);
  }

  async markTaskRunning(
    taskId: string,
    input: MarkTaskRunningInput,
    options: FeishuTaskUpdateOptions = {}
  ): Promise<FeishuTaskRecord> {
    const task = this.mustGetTask(taskId);
    const stageIndex = ensureStage(task, input.stageKey, input.stageLabel);
    syncStageStatuses(task, stageIndex, "running", input.detail);

    task.status = "running";
    task.progress = clampProgress(input.progress);
    task.currentStageKey = task.stages[stageIndex]?.key;
    task.updatedAt = Date.now();
    task.events.push({
      type: input.eventType || "progress",
      message: input.detail,
      progress: task.progress,
      stageKey: task.currentStageKey,
      time: task.updatedAt,
    });

    await this.notify(task, options.notify);
    return cloneTask(task);
  }

  async waitOnTask(
    taskId: string,
    input: WaitOnTaskInput,
    options: FeishuTaskUpdateOptions = {}
  ): Promise<FeishuTaskRecord> {
    const task = this.mustGetTask(taskId);
    const stageKey = input.stageKey || task.currentStageKey || "execution";
    const stageIndex = ensureStage(task, stageKey, input.stageLabel);
    syncStageStatuses(task, stageIndex, "running", input.detail);

    task.status = "waiting";
    task.progress = clampProgress(input.progress);
    task.currentStageKey = task.stages[stageIndex]?.key;
    task.waitingFor = input.waitingFor.trim();
    task.decision = cloneTask({
      ...task,
      decision: input.decision,
    }).decision;
    task.updatedAt = Date.now();
    task.events.push({
      type: "waiting",
      message: input.detail,
      progress: task.progress,
      stageKey: task.currentStageKey,
      time: task.updatedAt,
    });

    await this.notify(task, options.notify);
    return cloneTask(task);
  }

  async completeTask(
    taskId: string,
    input: CompleteTaskInput,
    options: FeishuTaskUpdateOptions = {}
  ): Promise<FeishuTaskRecord> {
    const task = this.mustGetTask(taskId);
    const stageKey = input.stageKey || "finalize";
    const stageIndex = ensureStage(
      task,
      stageKey,
      input.stageLabel || "整理答复"
    );
    const detail = input.detail || input.summary;
    syncStageStatuses(task, stageIndex, "done", detail);

    task.status = "done";
    task.progress = clampProgress(input.progress ?? 100);
    task.currentStageKey = task.stages[stageIndex]?.key;
    task.summary = input.summary.trim();
    task.waitingFor = undefined;
    task.decision = undefined;
    task.updatedAt = Date.now();
    task.events.push({
      type: "done",
      message: detail,
      progress: task.progress,
      stageKey: task.currentStageKey,
      time: task.updatedAt,
    });

    await this.notify(task, options.notify);
    return cloneTask(task);
  }

  async failTask(
    taskId: string,
    input: FailTaskInput,
    options: FeishuTaskUpdateOptions = {}
  ): Promise<FeishuTaskRecord> {
    const task = this.mustGetTask(taskId);
    const stageKey = input.stageKey || task.currentStageKey || "finalize";
    const stageIndex = ensureStage(
      task,
      stageKey,
      input.stageLabel || "整理答复"
    );
    syncStageStatuses(task, stageIndex, "failed", input.detail);

    task.status = "failed";
    task.progress = clampProgress(input.progress ?? task.progress);
    task.currentStageKey = task.stages[stageIndex]?.key;
    task.waitingFor = undefined;
    task.decision = undefined;
    task.updatedAt = Date.now();
    task.events.push({
      type: "failed",
      message: input.detail,
      progress: task.progress,
      stageKey: task.currentStageKey,
      time: task.updatedAt,
      level: "error",
    });

    await this.notify(task, options.notify);
    return cloneTask(task);
  }

  async resolveTaskDecision(
    taskId: string,
    input: ResolveTaskDecisionInput,
    options: ResolveTaskDecisionOptions = {}
  ): Promise<ResolveTaskDecisionResult> {
    const task = this.mustGetTask(taskId);

    if (task.status !== "waiting") {
      if (!options.idempotentIfNotWaiting || !task.lastResolvedDecision) {
        return {
          ok: false,
          error: "Task is not waiting for a decision",
          statusCode: 409,
          task: cloneTask(task),
        };
      }

      return {
        ok: true,
        task: cloneTask(task),
        decision: { ...task.lastResolvedDecision },
        alreadyResolved: true,
      };
    }

    const selectedOption = task.decision?.options.find(
      option => option.id === input.optionId
    );
    const decision: FeishuResolvedDecision = {
      optionId: input.optionId?.trim() || undefined,
      optionLabel:
        input.optionLabel?.trim() || selectedOption?.label || undefined,
      freeText: input.freeText?.trim() || undefined,
    };

    const choice =
      decision.optionLabel ||
      decision.freeText ||
      decision.optionId ||
      "已确认";

    const stageIndex = ensureStage(
      task,
      task.currentStageKey || "execution",
      task.stages.find(stage => stage.key === task.currentStageKey)?.label
    );
    syncStageStatuses(
      task,
      stageIndex,
      "running",
      input.detail || `Decision received: ${choice}`
    );

    task.status = "running";
    task.progress = clampProgress(input.progress ?? task.progress);
    task.waitingFor = undefined;
    task.lastResolvedDecision = decision;
    task.decision = undefined;
    task.updatedAt = Date.now();
    task.events.push({
      type: "decision",
      message: input.detail || `Decision received: ${choice}`,
      progress: task.progress,
      stageKey: task.currentStageKey,
      time: task.updatedAt,
    });

    await this.notify(task, options.notify);
    return {
      ok: true,
      task: cloneTask(task),
      decision,
    };
  }

  subscribe(
    listener: (task: FeishuTaskRecord) => void | Promise<void>
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notify(task: FeishuTaskRecord, notify = true): Promise<void> {
    if (!notify) return;
    const snapshot = cloneTask(task);
    for (const listener of Array.from(this.listeners)) {
      await listener(snapshot);
    }
  }

  private mustGetTask(taskId: string): FeishuTaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Feishu task not found: ${taskId}`);
    }
    return task;
  }
}
