export const MISSION_CONTRACT_VERSION = "2026-03-28" as const;
export const MISSION_TOPIC_STRATEGY = "strict-by-thread" as const;

export const MISSION_STAGE_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
] as const;

export type MissionStageStatus = (typeof MISSION_STAGE_STATUSES)[number];

export const MISSION_STATUSES = [
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_EVENT_TYPES = [
  "created",
  "progress",
  "log",
  "waiting",
  "done",
  "failed",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export const MISSION_EVENT_LEVELS = ["info", "warn", "error"] as const;
export type MissionEventLevel = (typeof MISSION_EVENT_LEVELS)[number];

export interface MissionStage {
  key: string;
  label: string;
  status: MissionStageStatus;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface MissionEvent {
  type: MissionEventType;
  message: string;
  progress?: number;
  stageKey?: string;
  level?: MissionEventLevel;
  time: number;
  source?: "mission-core" | "executor" | "feishu" | "brain" | "user";
}

export interface MissionDecisionOption {
  id: string;
  label: string;
  description?: string;
}

export interface MissionDecision {
  prompt: string;
  options: MissionDecisionOption[];
  allowFreeText?: boolean;
  placeholder?: string;
}

export interface MissionDecisionSubmission {
  optionId?: string;
  freeText?: string;
  detail?: string;
  progress?: number;
}

export interface MissionDecisionResolved {
  optionId?: string;
  optionLabel?: string;
  freeText?: string;
}

export const MISSION_CORE_STAGE_BLUEPRINT = [
  { key: "receive", label: "Receive task" },
  { key: "understand", label: "Understand request" },
  { key: "plan", label: "Build execution plan" },
  { key: "provision", label: "Provision execution runtime" },
  { key: "execute", label: "Run execution" },
  { key: "finalize", label: "Finalize mission" },
] as const;

export interface MissionArtifact {
  kind: "file" | "report" | "url" | "log";
  name: string;
  path?: string;
  url?: string;
  description?: string;
}

export interface MissionExecutorContext {
  name: string;
  requestId?: string;
  jobId?: string;
  status?: string;
  baseUrl?: string;
  lastEventType?: string;
  lastEventAt?: number;
}

export interface MissionInstanceContext {
  id?: string;
  image?: string;
  command?: string[];
  workspaceRoot?: string;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  host?: string;
}

export interface MissionRecord {
  id: string;
  kind: string;
  title: string;
  sourceText?: string;
  topicId?: string;
  status: MissionStatus;
  progress: number;
  currentStageKey?: string;
  stages: MissionStage[];
  summary?: string;
  executor?: MissionExecutorContext;
  instance?: MissionInstanceContext;
  artifacts?: MissionArtifact[];
  waitingFor?: string;
  decision?: MissionDecision;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  events: MissionEvent[];
}

export interface MissionPosition {
  x: number;
  y: number;
}

export type MissionPlanetStatus = MissionStatus | "archived";

export interface MissionPlanetOverviewItem {
  id: string;
  title: string;
  sourceText?: string;
  summary?: string;
  kind: string;
  status: MissionPlanetStatus;
  progress: number;
  complexity: number;
  radius: number;
  position: MissionPosition;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  currentStageKey?: string;
  currentStageLabel?: string;
  waitingFor?: string;
  taskUrl: string;
  tags: string[];
}

export const MISSION_PLANET_EDGE_TYPES = [
  "depends-on",
  "related-to",
  "supersedes",
] as const;

export type MissionPlanetEdgeType =
  (typeof MISSION_PLANET_EDGE_TYPES)[number];

export interface MissionPlanetEdge {
  fromPlanetId: string;
  toPlanetId: string;
  type: MissionPlanetEdgeType;
  confidence: number;
  source: "auto" | "manual";
  reason?: string;
}

export interface MissionPlanetInteriorStage {
  key: string;
  label: string;
  status: MissionStageStatus;
  progress: number;
  detail?: string;
  startedAt?: number;
  completedAt?: number;
  arcStart: number;
  arcEnd: number;
  midAngle: number;
}

export type MissionAgentStatus =
  | "idle"
  | "working"
  | "thinking"
  | "done"
  | "error";

export interface MissionPlanetInteriorAgent {
  id: string;
  name: string;
  role: string;
  sprite: string;
  status: MissionAgentStatus;
  stageKey: string;
  stageLabel: string;
  progress?: number;
  currentAction?: string;
  angle: number;
}

export interface MissionPlanetInteriorData {
  stages: MissionPlanetInteriorStage[];
  agents: MissionPlanetInteriorAgent[];
  events: MissionEvent[];
  summary?: string;
  waitingFor?: string;
}
