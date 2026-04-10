import type {
  MissionArtifact,
  MissionExecutorContext,
  MissionDecision,
  MissionEvent,
  MissionEventLevel,
  MissionInstanceContext,
  MissionRecord,
  MissionStage,
  DecisionHistoryEntry,
  DecisionType,
} from '../../shared/mission/contracts.js';
import { MISSION_CORE_STAGE_BLUEPRINT } from '../../shared/mission/contracts.js';
import { generateDecisionId } from './mission-decision.js';

export interface MissionSnapshotStore {
  load(): MissionRecord[];
  save(tasks: MissionRecord[]): void;
}

export interface CreateMissionInput {
  kind: string;
  title: string;
  sourceText?: string;
  topicId?: string;
  stageLabels?: Array<{ key: string; label: string }>;
}

export interface RecoverMissionsOptions {
  message?: string;
  source?: MissionEvent['source'];
}

export interface PatchMissionExecutionInput {
  summary?: string;
  executor?: MissionExecutorContext;
  instance?: MissionInstanceContext;
  artifacts?: MissionArtifact[];
  securitySummary?: MissionRecord["securitySummary"];
}

export interface CancelMissionInput {
  reason?: string;
  requestedBy?: string;
  source?: MissionEvent["source"];
}

function now(): number {
  return Date.now();
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function createMissionId(createdAt: number): string {
  return `mission_${createdAt.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function isMissionFinalStatus(status: MissionRecord["status"]): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/**
 * Enforce legal stage status transitions per the design spec:
 *   pending → running
 *   running → done | failed
 *   done → (terminal)
 *   failed → (terminal)
 */
function isLegalStageTransition(
  from: MissionStage['status'],
  to: MissionStage['status'],
): boolean {
  if (from === to) return true;
  switch (from) {
    case 'pending':
      return to === 'running';
    case 'running':
      return to === 'done' || to === 'failed';
    case 'done':
    case 'failed':
      return false;
    default:
      return false;
  }
}

export class MissionStore {
  private readonly missions: Map<string, MissionRecord>;

  constructor(private readonly snapshotStore: MissionSnapshotStore | null = null) {
    const tasks = this.snapshotStore?.load() ?? [];
    this.missions = new Map(
      tasks.map(task => [task.id, structuredClone(task)])
    );
  }

  create(input: CreateMissionInput): MissionRecord {
    const createdAt = now();
    const stageLabels =
      input.stageLabels && input.stageLabels.length > 0
        ? input.stageLabels
        : [...MISSION_CORE_STAGE_BLUEPRINT];
    const mission: MissionRecord = {
      id: createMissionId(createdAt),
      kind: input.kind,
      title: input.title,
      sourceText: input.sourceText,
      topicId: input.topicId,
      status: 'queued',
      progress: 0,
      stages: stageLabels.map(stage => ({
        ...stage,
        status: 'pending',
      })),
      createdAt,
      updatedAt: createdAt,
      events: [
        {
          type: 'created',
          message: `Mission created: ${input.title}`,
          time: createdAt,
          source: 'mission-core',
        },
      ],
    };

    this.missions.set(mission.id, mission);
    this.persist();
    return structuredClone(mission);
  }

  list(limit = 20): MissionRecord[] {
    return Array.from(this.missions.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .map(task => structuredClone(task));
  }

  get(id: string): MissionRecord | undefined {
    const task = this.missions.get(id);
    return task ? structuredClone(task) : undefined;
  }

  listEvents(id: string, limit = 20): MissionEvent[] {
    const task = this.missions.get(id);
    if (!task) return [];

    return task.events
      .slice()
      .sort((left, right) => right.time - left.time)
      .slice(0, limit)
      .map(event => structuredClone(event));
  }

  update(id: string, updater: (task: MissionRecord) => void): MissionRecord | undefined {
    const task = this.missions.get(id);
    if (!task) return undefined;

    updater(task);
    task.updatedAt = now();
    this.missions.set(id, task);
    this.persist();
    return structuredClone(task);
  }

  patchExecution(
    id: string,
    patch: PatchMissionExecutionInput
  ): MissionRecord | undefined {
    return this.update(id, task => {
      if (patch.summary !== undefined) {
        task.summary = patch.summary;
      }
      if (patch.executor !== undefined) {
        task.executor = structuredClone(patch.executor);
      }
      if (patch.instance !== undefined) {
        task.instance = structuredClone(patch.instance);
      }
      if (patch.artifacts !== undefined) {
        task.artifacts = structuredClone(patch.artifacts);
      }
      if (patch.securitySummary !== undefined) {
        task.securitySummary = structuredClone(patch.securitySummary);
      }
    });
  }

  markRunning(
    id: string,
    stageKey?: string,
    detail?: string,
    progress?: number,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      task.status = 'running';
      task.waitingFor = undefined;
      task.decision = undefined;

      if (typeof progress === 'number') {
        task.progress = clampProgress(progress);
      }

      if (!stageKey) return;

      const previousStageKey = task.currentStageKey;
      task.currentStageKey = stageKey;

      for (const stage of task.stages) {
        if (stage.key === stageKey) {
          stage.status = 'running';
          stage.startedAt ??= now();
          if (detail) stage.detail = detail;
          continue;
        }

        if (stage.status !== 'running') continue;

        if (stage.key === previousStageKey) {
          stage.status = 'done';
          stage.completedAt ??= now();
        } else {
          stage.status = 'pending';
        }
      }

      task.events.push({
        type: 'progress',
        message: detail || `Running ${stageKey}`,
        progress: task.progress,
        stageKey,
        time: now(),
        source,
      });
    });
  }

  updateStage(
    id: string,
    stageKey: string,
    patch: Partial<MissionStage>,
    progress?: number,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      const stage = task.stages.find(item => item.key === stageKey);
      if (!stage) return;

      // Enforce legal stage status transitions:
      //   pending → running
      //   running → done | failed
      //   done → (terminal, no transitions)
      //   failed → (terminal, no transitions)
      if (patch.status !== undefined && patch.status !== stage.status) {
        if (!isLegalStageTransition(stage.status, patch.status)) return;
      }

      Object.assign(stage, patch);

      if (typeof progress === 'number') {
        task.progress = clampProgress(progress);
      }

      if (patch.status === 'running') {
        task.status = 'running';
        task.waitingFor = undefined;
        task.decision = undefined;
        task.currentStageKey = stageKey;
        stage.startedAt ??= now();
      }

      if (patch.status === 'done') {
        stage.completedAt ??= now();
      }

      if (patch.status === 'failed') {
        task.status = 'failed';
        task.completedAt = now();
      }

      task.events.push({
        type: 'progress',
        message: patch.detail || `${stage.label}: ${patch.status || stage.status}`,
        progress: task.progress,
        stageKey,
        time: now(),
        source,
      });
    });
  }

  log(
    id: string,
    message: string,
    level: MissionEventLevel = 'info',
    progress?: number,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      if (typeof progress === 'number') {
        task.progress = clampProgress(progress);
      }

      task.events.push({
        type: 'log',
        message,
        level,
        progress: task.progress,
        stageKey: task.currentStageKey,
        time: now(),
        source,
      });
    });
  }

  markWaiting(
    id: string,
    waitingFor: string,
    detail?: string,
    progress?: number,
    decision?: MissionDecision,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      task.status = 'waiting';
      task.waitingFor = waitingFor;
      task.decision = decision;

      if (typeof progress === 'number') {
        task.progress = clampProgress(progress);
      }

      task.events.push({
        type: 'waiting',
        message: detail || `Waiting for ${waitingFor}`,
        progress: task.progress,
        stageKey: task.currentStageKey,
        time: now(),
        source,
      });
    });
  }

  markDone(
    id: string,
    summary?: string,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      task.status = 'done';
      task.progress = 100;
      task.summary = summary;
      task.waitingFor = undefined;
      task.decision = undefined;
      task.completedAt = now();

      const current =
        task.stages.find(stage => stage.key === task.currentStageKey) ??
        task.stages.find(stage => stage.status === 'running');
      if (current && current.status !== 'done') {
        current.status = 'done';
        current.completedAt ??= now();
      }

      task.events.push({
        type: 'done',
        message: summary || 'Mission completed',
        progress: 100,
        stageKey: task.currentStageKey,
        time: now(),
        source,
      });
    });
  }

  markFailed(
    id: string,
    message: string,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      task.status = 'failed';
      task.waitingFor = undefined;
      task.decision = undefined;
      task.completedAt = now();

      const current =
        task.stages.find(stage => stage.key === task.currentStageKey) ??
        task.stages.find(stage => stage.status === 'running');
      if (current) {
        current.status = 'failed';
        current.detail = message;
      }

      task.events.push({
        type: 'failed',
        message,
        level: 'error',
        progress: task.progress,
        stageKey: current?.key,
        time: now(),
        source,
      });
    });
  }

  markCancelled(
    id: string,
    input: CancelMissionInput = {}
  ): MissionRecord | undefined {
    const task = this.missions.get(id);
    if (!task) return undefined;
    if (task.status === "cancelled" || isMissionFinalStatus(task.status)) {
      return structuredClone(task);
    }

    const cancelledAt = now();
    const reason =
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim()
        : undefined;
    const requestedBy =
      typeof input.requestedBy === "string" && input.requestedBy.trim()
        ? input.requestedBy.trim()
        : undefined;
    const source = input.source ?? "user";
    const current =
      task.stages.find(stage => stage.key === task.currentStageKey) ??
      task.stages.find(stage => stage.status === "running");

    task.status = "cancelled";
    task.waitingFor = undefined;
    task.decision = undefined;
    task.completedAt = cancelledAt;
    task.cancelledAt = cancelledAt;
    task.cancelledBy = requestedBy;
    task.cancelReason = reason;

    if (task.executor) {
      task.executor = {
        ...task.executor,
        status: "cancelled",
        lastEventType: "job.cancelled",
        lastEventAt: cancelledAt,
      };
    }

    if (task.instance) {
      task.instance = {
        ...task.instance,
        completedAt: task.instance.completedAt ?? cancelledAt,
      };
    }

    if (current) {
      current.detail = reason || "Mission cancelled";
      current.completedAt ??= cancelledAt;
    }

    task.events.push({
      type: "cancelled",
      message: reason || "Mission cancelled",
      level: "warn",
      progress: task.progress,
      stageKey: current?.key ?? task.currentStageKey,
      time: cancelledAt,
      source,
    });

    task.updatedAt = cancelledAt;
    this.missions.set(id, task);
    this.persist();
    return structuredClone(task);
  }

  resolveWaiting(
    id: string,
    submission: { detail: string; progress?: number },
    source: MissionEvent['source'] = 'user'
  ): MissionRecord | undefined {
    return this.update(id, task => {
      // Archive current decision to decisionHistory before clearing
      if (task.decision) {
        const entry: DecisionHistoryEntry = {
          decisionId: task.decision.decisionId || generateDecisionId(),
          type: (task.decision.type ?? 'custom-action') as DecisionType,
          prompt: task.decision.prompt,
          options: task.decision.options,
          templateId: task.decision.templateId,
          payload: task.decision.payload,
          resolved: {}, // resolved info not available here
          submittedAt: Date.now(),
          stageKey: task.currentStageKey,
        };
        if (!task.decisionHistory) {
          task.decisionHistory = [];
        }
        task.decisionHistory.push(entry);
      }

      task.status = 'running';
      task.waitingFor = undefined;
      task.decision = undefined;

      if (typeof submission.progress === 'number') {
        task.progress = clampProgress(submission.progress);
      }

      const current =
        task.stages.find(stage => stage.key === task.currentStageKey) ??
        task.stages.find(stage => stage.status === 'pending');

      if (current && current.status === 'pending') {
        current.status = 'running';
        current.startedAt ??= now();
        task.currentStageKey = current.key;
      }

      task.events.push({
        type: 'progress',
        message: submission.detail,
        progress: task.progress,
        stageKey: task.currentStageKey,
        time: now(),
        source,
      });
    });
  }

  recoverInterrupted(options: RecoverMissionsOptions = {}): MissionRecord[] {
    const message =
      options.message || 'Server restarted before the mission completed.';
    const source = options.source || 'mission-core';
    const recovered: MissionRecord[] = [];

    for (const task of Array.from(this.missions.values())) {
      if (task.status !== 'queued' && task.status !== 'running') continue;
      const updated = this.markFailed(task.id, message, source);
      if (updated) recovered.push(updated);
    }

    return recovered;
  }

  private persist(): void {
    this.snapshotStore?.save(
      Array.from(this.missions.values()).map(task => structuredClone(task))
    );
  }
}
