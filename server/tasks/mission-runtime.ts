import {
  MISSION_SOCKET_EVENT,
  MISSION_SOCKET_TYPES,
  type MissionSocketPayload,
  type MissionSocketRecordEvent,
  type MissionSocketDecisionSubmittedEvent,
} from '../../shared/mission/socket.js';
import type {
  MissionArtifact,
  MissionDecision,
  MissionDecisionResolved,
  DecisionHistoryEntry,
  MissionExecutorContext,
  MissionEvent,
  MissionEventLevel,
  MissionInstanceContext,
  MissionRecord,
  MissionStage,
} from '../../shared/mission/contracts.js';
import { getSocketIO } from '../core/socket.js';
import { DatabaseMissionSnapshotStore } from '../db/mission-storage.js';
import { MISSION_CORE_STAGE_BLUEPRINT } from '../../shared/mission/contracts.js';
import {
  MissionStore,
  type CancelMissionInput,
  type CreateMissionInput,
  type PatchMissionExecutionInput,
} from './mission-store.js';

// ─── Lineage Collector Integration (module-level, opt-in) ──────────────────

import type { LineageCollectorLike } from '../../shared/runtime-agent.js';

let _missionLineageCollector: LineageCollectorLike | null = null;

export function setMissionLineageCollector(collector: LineageCollectorLike | null): void {
  _missionLineageCollector = collector;
}

export function getMissionLineageCollector(): LineageCollectorLike | null {
  return _missionLineageCollector;
}

export interface MissionRuntimeOptions {
  store?: MissionStore;
  autoRecover?: boolean;
  recoveryMessage?: string;
}

function resolveSocketEventType(
  task: MissionRecord
): MissionSocketRecordEvent['type'] {
  if (task.status === 'waiting') return MISSION_SOCKET_TYPES.recordWaiting;
  if (task.status === 'done') return MISSION_SOCKET_TYPES.recordCompleted;
  if (task.status === 'failed') return MISSION_SOCKET_TYPES.recordFailed;
  if (task.status === 'cancelled') return MISSION_SOCKET_TYPES.recordCancelled;
  return MISSION_SOCKET_TYPES.recordUpdated;
}

export class MissionRuntime {
  private readonly store: MissionStore;

  constructor(options: MissionRuntimeOptions = {}) {
    this.store =
      options.store ??
      new MissionStore(new DatabaseMissionSnapshotStore());

    if (options.autoRecover) {
      this.recoverInterruptedMissions(options.recoveryMessage);
    }
  }

  createTask(input: CreateMissionInput): MissionRecord {
    const task = this.store.create(input);
    this.emitMissionUpdate(task);

    // Lineage hook: record source when a mission is created
    try {
      const collector = _missionLineageCollector;
      if (collector?.recordSource) {
        collector.recordSource({
          sourceId: task.id,
          sourceName: task.title,
          context: { missionId: task.id },
          metadata: { kind: task.kind, topicId: task.topicId },
        });
      }
    } catch {
      // Graceful degradation: lineage failure must not affect mission creation
    }

    return task;
  }

  createChatTask(
    title: string,
    sourceText?: string,
    topicId?: string
  ): MissionRecord {
    return this.createTask({
      kind: 'chat',
      title,
      sourceText,
      topicId,
      stageLabels: [...MISSION_CORE_STAGE_BLUEPRINT],
    });
  }

  listTasks(limit = 20): MissionRecord[] {
    return this.store.list(limit);
  }

  getTask(id: string): MissionRecord | undefined {
    return this.store.get(id);
  }

  listTaskEvents(id: string, limit = 20): MissionEvent[] {
    return this.store.listEvents(id, limit);
  }

  patchMissionExecution(
    id: string,
    patch: PatchMissionExecutionInput
  ): MissionRecord | undefined {
    const task = this.store.patchExecution(id, patch);
    this.emitMissionUpdate(task);
    return task;
  }

  /**
   * Apply enrichment fields (organization, workPackages, messageLog, agentCrew)
   * to a mission and emit the Socket broadcast so the frontend receives the update.
   */
  patchEnrichment(
    id: string,
    enrichment: Partial<Pick<MissionRecord, 'organization' | 'workPackages' | 'messageLog' | 'agentCrew'>>,
  ): MissionRecord | undefined {
    const task = this.store.update(id, (record) => {
      if (enrichment.organization !== undefined) record.organization = enrichment.organization;
      if (enrichment.workPackages !== undefined) record.workPackages = enrichment.workPackages;
      if (enrichment.messageLog !== undefined) record.messageLog = enrichment.messageLog;
      if (enrichment.agentCrew !== undefined) record.agentCrew = enrichment.agentCrew;
    });
    this.emitMissionUpdate(task);
    return task;
  }

  markMissionRunning(
    id: string,
    stageKey?: string,
    detail?: string,
    progress?: number,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    const task = this.store.markRunning(id, stageKey, detail, progress, source);
    this.emitMissionUpdate(task);
    return task;
  }

  updateMissionStage(
    id: string,
    stageKey: string,
    patch: Partial<MissionStage>,
    progress?: number,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    const task = this.store.updateStage(id, stageKey, patch, progress, source);
    this.emitMissionUpdate(task);
    return task;
  }

  logMission(
    id: string,
    message: string,
    level: MissionEventLevel = 'info',
    progress?: number,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    const task = this.store.log(id, message, level, progress, source);
    this.emitMissionUpdate(task);
    return task;
  }

  waitOnMission(
    id: string,
    waitingFor: string,
    detail?: string,
    progress?: number,
    decision?: MissionDecision,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    const task = this.store.markWaiting(
      id,
      waitingFor,
      detail,
      progress,
      decision,
      source
    );
    this.emitMissionUpdate(task);
    return task;
  }

  finishMission(
    id: string,
    summary?: string,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    const task = this.store.markDone(id, summary, source);
    this.emitMissionUpdate(task);

    // Lineage hook: record decision when a mission finishes
    try {
      const collector = _missionLineageCollector;
      if (task && collector?.recordDecision) {
        collector.recordDecision({
          decisionId: id,
          agentId: undefined,
          inputLineageIds: [],
          result: 'done',
          context: { missionId: id },
          metadata: { summary, source },
        });
      }
    } catch {
      // Graceful degradation
    }

    return task;
  }

  failMission(
    id: string,
    message: string,
    source: MissionEvent['source'] = 'mission-core'
  ): MissionRecord | undefined {
    const task = this.store.markFailed(id, message, source);
    this.emitMissionUpdate(task);
    return task;
  }

  cancelMission(
    id: string,
    input: CancelMissionInput = {}
  ): MissionRecord | undefined {
    const task = this.store.markCancelled(id, input);
    this.emitMissionUpdate(task);
    return task;
  }

  resumeMissionFromDecision(
    id: string,
    submission: { detail: string; progress?: number },
    source: MissionEvent['source'] = 'user'
  ): MissionRecord | undefined {
    const task = this.store.resolveWaiting(id, submission, source);
    this.emitMissionUpdate(task);
    return task;
  }

  recoverInterruptedMissions(
    message = 'Server restarted before the mission completed.'
  ): MissionRecord[] {
    const recovered = this.store.recoverInterrupted({ message });
    for (const task of recovered) {
      this.emitMissionUpdate(task);
    }
    return recovered;
  }

  emitDecisionSubmitted(
    task: MissionRecord,
    historyEntry: DecisionHistoryEntry,
    resolved: MissionDecisionResolved,
  ): void {
    const io = getSocketIO();
    if (!io) return;

    const payload: MissionSocketDecisionSubmittedEvent = {
      type: MISSION_SOCKET_TYPES.decisionSubmitted,
      issuedAt: Date.now(),
      missionId: task.id,
      decisionId: historyEntry.decisionId,
      resolved,
      task,
    };

    io.emit(MISSION_SOCKET_EVENT, payload);
  }

  private emitMissionUpdate(task: MissionRecord | undefined): void {
    if (!task) return;

    const io = getSocketIO();
    if (!io) return;

    const payload: MissionSocketPayload = {
      type: resolveSocketEventType(task),
      issuedAt: Date.now(),
      missionId: task.id,
      task,
    };

    io.emit(MISSION_SOCKET_EVENT, payload);
  }
}

export function createMissionRuntime(
  options: MissionRuntimeOptions = {}
): MissionRuntime {
  return new MissionRuntime(options);
}

export const missionRuntime = createMissionRuntime({
  autoRecover: true,
});
