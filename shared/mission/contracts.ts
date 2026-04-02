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
  "role_switch",
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

export interface MissionOrganizationSnapshot {
  departments: Array<{
    key: string;
    label: string;
    managerName?: string;
  }>;
  agentCount: number;
}

export interface MissionWorkPackage {
  id: string;
  workerId?: string;
  title?: string;
  assignee?: string;
  description?: string;
  stageKey?: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'verified';
  score?: number;
  deliverable?: string;
  feedback?: string;
}

export interface MissionMessageLogEntry {
  sender: string;
  content: string;
  time: number;
  stageKey?: string;
}

export interface MissionAgentCrewMember {
  id: string;
  name: string;
  role: "ceo" | "manager" | "worker";
  department?: string;
  status: "idle" | "working" | "thinking" | "done" | "error";
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
  organization?: MissionOrganizationSnapshot;
  workPackages?: MissionWorkPackage[];
  messageLog?: MissionMessageLogEntry[];
  agentCrew?: MissionAgentCrewMember[];
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

/* ─── Snapshot Persistence Types ─── */

export const SNAPSHOT_VERSION = 1 as const;

/**
 * 快照中保存的运行时模式。
 * 与 client/src/lib/store.ts 中的 RuntimeMode 保持一致。
 */
export type SnapshotRuntimeMode = "frontend" | "advanced";

/**
 * 快照中保存的 AI 配置（精简版）。
 * 与 client/src/lib/ai-config.ts 中的 AIConfig 保持一致。
 */
export interface SnapshotAIConfig {
  mode: "server_proxy" | "browser_direct";
  source: "server_env" | "browser_local";
  apiKey: string;
  baseUrl: string;
  model: string;
  modelReasoningEffort: string;
  maxContext: number;
  providerName: string;
  wireApi: "responses" | "chat_completions";
  timeoutMs: number;
  stream: boolean;
  chatThinkingType?: string;
  proxyUrl: string;
}

/**
 * 快照中保存的聊天消息。
 * 与 client/src/lib/store.ts 中的 ChatMessage 保持一致。
 */
export interface SnapshotChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  petName?: string;
  timestamp: number;
}

export interface AgentMemorySummary {
  agentId: string;
  soulMdHash: string;
  recentExchanges: unknown[];
}

export interface SceneLayoutState {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  selectedPet: string | null;
}

export interface MissionDecisionEntry {
  stageKey: string;
  decision: MissionDecision;
  resolved?: MissionDecisionResolved;
  timestamp: number;
}

export interface AttachmentIndexEntry {
  name: string;
  kind: MissionArtifact["kind"];
  path?: string;
  url?: string;
  size?: number;
}

export interface ZustandRecoverySlice {
  runtimeMode: SnapshotRuntimeMode;
  aiConfig: SnapshotAIConfig;
  chatMessages: SnapshotChatMessage[];
}

export interface SnapshotPayload {
  mission: MissionRecord;
  agentMemories: AgentMemorySummary[];
  sceneLayout: SceneLayoutState;
  decisionHistory: MissionDecisionEntry[];
  attachmentIndex: AttachmentIndexEntry[];
  zustandSlice: ZustandRecoverySlice;
}

export interface SnapshotRecord {
  id: string;
  missionId: string;
  version: number;
  checksum: string;
  createdAt: number;
  missionTitle: string;
  missionProgress: number;
  missionStatus: MissionStatus;
  payload: SnapshotPayload;
}
