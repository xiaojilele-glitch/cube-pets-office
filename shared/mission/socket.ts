import type { ExecutorEvent } from "../executor/contracts.js";
import type {
  MissionDecisionResolved,
  MissionPlanetEdge,
  MissionPlanetOverviewItem,
  MissionRecord,
} from "./contracts.js";

export const MISSION_SOCKET_EVENT = "mission_event" as const;

export const MISSION_SOCKET_TYPES = {
  snapshot: "mission.snapshot",
  recordUpdated: "mission.record.updated",
  recordWaiting: "mission.record.waiting",
  recordCompleted: "mission.record.completed",
  recordFailed: "mission.record.failed",
  recordCancelled: "mission.record.cancelled",
  planetUpdated: "mission.planet.updated",
  planetEdgeUpdated: "mission.planet.edge.updated",
  executorEvent: "mission.executor.event",
  decisionSubmitted: "mission.decision.submitted",
} as const;

export interface MissionSocketSnapshotEvent {
  type: typeof MISSION_SOCKET_TYPES.snapshot;
  issuedAt: number;
  tasks: MissionRecord[];
  planets?: MissionPlanetOverviewItem[];
  edges?: MissionPlanetEdge[];
}

export interface MissionSocketRecordEvent {
  type:
    | typeof MISSION_SOCKET_TYPES.recordUpdated
    | typeof MISSION_SOCKET_TYPES.recordWaiting
    | typeof MISSION_SOCKET_TYPES.recordCompleted
    | typeof MISSION_SOCKET_TYPES.recordFailed
    | typeof MISSION_SOCKET_TYPES.recordCancelled;
  issuedAt: number;
  missionId: string;
  task: MissionRecord;
}

export interface MissionSocketPlanetUpdatedEvent {
  type: typeof MISSION_SOCKET_TYPES.planetUpdated;
  issuedAt: number;
  missionId: string;
  planet: MissionPlanetOverviewItem;
}

export interface MissionSocketPlanetEdgeUpdatedEvent {
  type: typeof MISSION_SOCKET_TYPES.planetEdgeUpdated;
  issuedAt: number;
  missionId?: string;
  edge: MissionPlanetEdge;
}

export interface MissionSocketExecutorEvent {
  type: typeof MISSION_SOCKET_TYPES.executorEvent;
  issuedAt: number;
  missionId: string;
  event: ExecutorEvent;
}

export interface MissionSocketDecisionSubmittedEvent {
  type: typeof MISSION_SOCKET_TYPES.decisionSubmitted;
  issuedAt: number;
  missionId: string;
  decisionId: string;
  resolved: MissionDecisionResolved;
  task: MissionRecord;
}

export type MissionSocketPayload =
  | MissionSocketSnapshotEvent
  | MissionSocketRecordEvent
  | MissionSocketPlanetUpdatedEvent
  | MissionSocketPlanetEdgeUpdatedEvent
  | MissionSocketExecutorEvent
  | MissionSocketDecisionSubmittedEvent;

// ─── Sandbox Live Preview Socket Events ─────────────────────────────

export const SANDBOX_SOCKET_EVENTS = {
  missionLog: "mission_log",
  missionScreen: "mission_screen",
  missionLogHistory: "mission_log_history",
} as const;

export interface SandboxLogPayload {
  missionId: string;
  jobId: string;
  stepIndex: number;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

export interface SandboxScreenPayload {
  missionId: string;
  jobId: string;
  stepIndex: number;
  imageData: string;
  width: number;
  height: number;
  timestamp: string;
}

export interface SandboxLogHistoryPayload {
  missionId: string;
  lines: SandboxLogPayload[];
}
