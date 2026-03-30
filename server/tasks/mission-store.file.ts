import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  MISSION_EVENT_LEVELS,
  MISSION_EVENT_TYPES,
  MISSION_STAGE_STATUSES,
  MISSION_STATUSES,
  type MissionArtifact,
  type MissionDecision,
  type MissionDecisionOption,
  type MissionExecutorContext,
  type MissionEvent,
  type MissionInstanceContext,
  type MissionRecord,
  type MissionStage,
} from '../../shared/mission/contracts.js';
import type { MissionSnapshotStore } from './mission-store.js';

interface SerializedMissionSnapshotFile {
  version: 1;
  tasks: MissionRecord[];
}

function isMissionStageStatus(value: unknown): value is MissionStage['status'] {
  return (
    typeof value === 'string' &&
    MISSION_STAGE_STATUSES.includes(value as MissionStage['status'])
  );
}

function isMissionStatus(value: unknown): value is MissionRecord['status'] {
  return (
    typeof value === 'string' &&
    MISSION_STATUSES.includes(value as MissionRecord['status'])
  );
}

function normalizeDecisionOptions(value: unknown): MissionDecisionOption[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<MissionDecisionOption>;
    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') {
      return [];
    }

    return [
      {
        id: candidate.id,
        label: candidate.label,
        description:
          typeof candidate.description === 'string'
            ? candidate.description
            : undefined,
      },
    ];
  });
}

function normalizeDecision(value: unknown): MissionDecision | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Partial<MissionDecision>;
  if (typeof candidate.prompt !== 'string') return undefined;

  const options = normalizeDecisionOptions(candidate.options);
  if (options.length === 0) return undefined;

  return {
    prompt: candidate.prompt,
    options,
    allowFreeText: candidate.allowFreeText === true,
    placeholder:
      typeof candidate.placeholder === 'string'
        ? candidate.placeholder
        : undefined,
  };
}

function normalizeStage(value: unknown): MissionStage | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MissionStage>;
  if (typeof candidate.key !== 'string' || typeof candidate.label !== 'string') {
    return null;
  }

  return {
    key: candidate.key,
    label: candidate.label,
    status: isMissionStageStatus(candidate.status)
      ? candidate.status
      : 'pending',
    detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
    startedAt:
      typeof candidate.startedAt === 'number' ? candidate.startedAt : undefined,
    completedAt:
      typeof candidate.completedAt === 'number'
        ? candidate.completedAt
        : undefined,
  };
}

function normalizeEvent(value: unknown): MissionEvent | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MissionEvent>;
  if (typeof candidate.message !== 'string' || typeof candidate.time !== 'number') {
    return null;
  }

  if (
    typeof candidate.type !== 'string' ||
    !MISSION_EVENT_TYPES.includes(candidate.type as MissionEvent['type'])
  ) {
    return null;
  }

  const source =
    candidate.source === 'mission-core' ||
    candidate.source === 'executor' ||
    candidate.source === 'feishu' ||
    candidate.source === 'brain' ||
    candidate.source === 'user'
      ? candidate.source
      : undefined;

  const level =
    typeof candidate.level === 'string' &&
    MISSION_EVENT_LEVELS.includes(
      candidate.level as (typeof MISSION_EVENT_LEVELS)[number]
    )
      ? (candidate.level as MissionEvent['level'])
      : undefined;

  return {
    type: candidate.type,
    message: candidate.message,
    progress:
      typeof candidate.progress === 'number' ? candidate.progress : undefined,
    stageKey:
      typeof candidate.stageKey === 'string' ? candidate.stageKey : undefined,
    level,
    time: candidate.time,
    source,
  };
}

function normalizeArtifact(value: unknown): MissionArtifact | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MissionArtifact>;
  if (
    (candidate.kind !== 'file' &&
      candidate.kind !== 'report' &&
      candidate.kind !== 'url' &&
      candidate.kind !== 'log') ||
    typeof candidate.name !== 'string'
  ) {
    return null;
  }

  return {
    kind: candidate.kind,
    name: candidate.name,
    path: typeof candidate.path === 'string' ? candidate.path : undefined,
    url: typeof candidate.url === 'string' ? candidate.url : undefined,
    description:
      typeof candidate.description === 'string'
        ? candidate.description
        : undefined,
  };
}

function normalizeExecutorContext(value: unknown): MissionExecutorContext | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Partial<MissionExecutorContext>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
    return undefined;
  }

  return {
    name: candidate.name,
    requestId:
      typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
    jobId: typeof candidate.jobId === 'string' ? candidate.jobId : undefined,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    baseUrl:
      typeof candidate.baseUrl === 'string' ? candidate.baseUrl : undefined,
    lastEventType:
      typeof candidate.lastEventType === 'string'
        ? candidate.lastEventType
        : undefined,
    lastEventAt:
      typeof candidate.lastEventAt === 'number'
        ? candidate.lastEventAt
        : undefined,
  };
}

function normalizeInstanceContext(value: unknown): MissionInstanceContext | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Partial<MissionInstanceContext>;
  return {
    id: typeof candidate.id === 'string' ? candidate.id : undefined,
    image: typeof candidate.image === 'string' ? candidate.image : undefined,
    command: Array.isArray(candidate.command)
      ? candidate.command.filter(
          (entry): entry is string => typeof entry === 'string'
        )
      : undefined,
    workspaceRoot:
      typeof candidate.workspaceRoot === 'string'
        ? candidate.workspaceRoot
        : undefined,
    startedAt:
      typeof candidate.startedAt === 'number' ? candidate.startedAt : undefined,
    completedAt:
      typeof candidate.completedAt === 'number'
        ? candidate.completedAt
        : undefined,
    exitCode:
      typeof candidate.exitCode === 'number' ? candidate.exitCode : undefined,
    host: typeof candidate.host === 'string' ? candidate.host : undefined,
  };
}

function normalizeTask(value: unknown): MissionRecord | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MissionRecord>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.kind !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.progress !== 'number' ||
    typeof candidate.createdAt !== 'number' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return null;
  }

  const stages = Array.isArray(candidate.stages)
    ? candidate.stages
        .map(stage => normalizeStage(stage))
        .filter((stage): stage is MissionStage => Boolean(stage))
    : [];
  const events = Array.isArray(candidate.events)
    ? candidate.events
        .map(event => normalizeEvent(event))
        .filter((event): event is MissionEvent => Boolean(event))
    : [];

  return {
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    sourceText:
      typeof candidate.sourceText === 'string' ? candidate.sourceText : undefined,
    topicId: typeof candidate.topicId === 'string' ? candidate.topicId : undefined,
    status: isMissionStatus(candidate.status) ? candidate.status : 'queued',
    progress: Math.max(0, Math.min(100, Math.round(candidate.progress))),
    currentStageKey:
      typeof candidate.currentStageKey === 'string'
        ? candidate.currentStageKey
        : undefined,
    stages,
    summary: typeof candidate.summary === 'string' ? candidate.summary : undefined,
    executor: normalizeExecutorContext(candidate.executor),
    instance: normalizeInstanceContext(candidate.instance),
    artifacts: Array.isArray(candidate.artifacts)
      ? candidate.artifacts
          .map(artifact => normalizeArtifact(artifact))
          .filter((artifact): artifact is MissionArtifact => Boolean(artifact))
      : undefined,
    waitingFor:
      typeof candidate.waitingFor === 'string' ? candidate.waitingFor : undefined,
    decision: normalizeDecision(candidate.decision),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    completedAt:
      typeof candidate.completedAt === 'number'
        ? candidate.completedAt
        : undefined,
    events,
  };
}

export class MissionFileSnapshotStore implements MissionSnapshotStore {
  constructor(
    private readonly filePath: string,
    private readonly maxTasks = 240
  ) {}

  load(): MissionRecord[] {
    const data = this.readFile();
    return data?.tasks ?? [];
  }

  save(tasks: MissionRecord[]): void {
    const data: SerializedMissionSnapshotFile = {
      version: 1,
      tasks: tasks
        .map(task => normalizeTask(task))
        .filter((task): task is MissionRecord => Boolean(task))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, this.maxTasks),
    };

    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private readFile(): SerializedMissionSnapshotFile | null {
    if (!existsSync(this.filePath)) return null;

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as
        | SerializedMissionSnapshotFile
        | MissionRecord[];
      const tasks = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.tasks)
          ? parsed.tasks
          : [];

      return {
        version: 1,
        tasks: tasks
          .map(task => normalizeTask(task))
          .filter((task): task is MissionRecord => Boolean(task))
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, this.maxTasks),
      };
    } catch {
      return null;
    }
  }
}
