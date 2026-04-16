/**
 * Collaboration Replay System — Shared Contracts
 *
 * 所有枚举使用 `as const` 数组 + 类型推导模式，
 * 与 shared/mission/contracts.ts 风格一致。
 */

/* ─── Event Type Enums ─── */

export const REPLAY_EVENT_TYPES = [
  "AGENT_STARTED",
  "AGENT_STOPPED",
  "MESSAGE_SENT",
  "MESSAGE_RECEIVED",
  "DECISION_MADE",
  "CODE_EXECUTED",
  "RESOURCE_ACCESSED",
  "ERROR_OCCURRED",
  "MILESTONE_REACHED",
] as const;
export type ReplayEventType = (typeof REPLAY_EVENT_TYPES)[number];

export const MESSAGE_TYPES = [
  "INSTRUCTION",
  "RESPONSE",
  "QUERY",
  "RESULT",
  "ERROR",
  "FEEDBACK",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = [
  "SENT",
  "RECEIVED",
  "PROCESSED",
  "FAILED",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const EXECUTION_STATUSES = [
  "SUCCESS",
  "FAILURE",
  "TIMEOUT",
  "EXCEPTION",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const RESOURCE_TYPES = [
  "FILE",
  "DATABASE",
  "API",
  "NETWORK",
  "MCP_TOOL",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACCESS_TYPES = [
  "READ",
  "WRITE",
  "DELETE",
  "EXECUTE",
  "QUERY",
] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

/* ─── Core Event Interface ─── */

export interface ExecutionEvent {
  eventId: string;
  missionId: string;
  timestamp: number;
  eventType: ReplayEventType;
  sourceAgent: string;
  targetAgent?: string;
  eventData: Record<string, unknown>;
  metadata?: {
    phase?: string;
    stageKey?: string;
    cost?: number;
    tokenUsage?: { prompt: number; completion: number };
    checksum?: string;
  };
}

/* ─── Event Data Interfaces ─── */

export interface CommunicationEventData {
  senderId: string;
  receiverId: string;
  messageId: string;
  messageContent: string | Record<string, unknown>;
  messageType: MessageType;
  status: MessageStatus;
  forwardChain?: Array<{ agentId: string; timestamp: number }>;
}

export interface DecisionEventData {
  decisionId: string;
  agentId: string;
  decisionInput: Record<string, unknown>;
  decisionLogic: string;
  decisionResult: unknown;
  alternatives?: unknown[];
  confidence: number;
  validation?: { correct?: boolean; betterChoice?: string };
}

export interface CodeExecutionEventData {
  agentId: string;
  codeSnippet: string;
  codeLanguage: string;
  codeLocation?: { file: string; startLine: number; endLine: number };
  executionInput: Record<string, unknown>;
  executionOutput: {
    stdout: string;
    stderr: string;
    returnValue?: unknown;
  };
  executionStatus: ExecutionStatus;
  executionTime: number;
  versionId?: string;
  changeReason?: string;
}

export interface ResourceAccessEventData {
  agentId: string;
  resourceType: ResourceType;
  resourceId: string;
  accessType: AccessType;
  accessResult: {
    success: boolean;
    dataSummary?: string;
    duration: number;
  };
  permissionCheck?: {
    requested: string;
    actual: string;
    rule: string;
    passed: boolean;
  };
  sensitiveDataMasked?: boolean;
}

/* ─── Timeline & Query Interfaces ─── */

export interface ExecutionTimeline {
  missionId: string;
  events: ExecutionEvent[];
  startTime: number;
  endTime: number;
  totalDuration: number;
  eventCount: number;
  indices: {
    byTime: Map<number, number[]>;
    byAgent: Map<string, number[]>;
    byType: Map<ReplayEventType, number[]>;
    byResource: Map<string, number[]>;
  };
  version: number;
  checksum: string;
}

export interface EventQuery {
  missionId: string;
  timeRange?: { start: number; end: number };
  agentIds?: string[];
  eventTypes?: ReplayEventType[];
  resourceIds?: string[];
  limit?: number;
  offset?: number;
}

/* ─── Replay Engine Types ─── */

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export type ReplayState = "idle" | "playing" | "paused" | "stopped";

export interface ReplayFilters {
  eventTypes?: ReplayEventType[];
  agentIds?: string[];
  keyword?: string;
}

/* ─── Snapshot Interface ─── */

export interface ReplaySnapshot {
  snapshotId: string;
  missionId: string;
  timestamp: number;
  createdAt: number;
  label: string;
  note?: string;
  version: number;
  state: {
    eventCursorIndex: number;
    filters: ReplayFilters;
    cameraPosition: [number, number, number];
    cameraTarget: [number, number, number];
    speed: PlaybackSpeed;
  };
}

/* ─── Data Lineage Interfaces ─── */

export interface LineageNode {
  id: string;
  eventId: string;
  agentId: string;
  dataKey: string;
  timestamp: number;
}

export interface LineageEdge {
  from: string;
  to: string;
  transformType: "pass-through" | "transform" | "aggregate" | "split";
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/* ─── Cost Interfaces ─── */

export interface CostAnomaly {
  eventId: string;
  cost: number;
  threshold: number;
  reason: string;
}

export interface CostSummary {
  totalCost: number;
  byAgent: Record<string, number>;
  byModel: Record<string, number>;
  byOperationType: Record<string, number>;
  anomalies: CostAnomaly[];
}

export type CostDistribution = Record<string, number>;

/* ─── Performance Interfaces ─── */

export interface PerformanceMetrics {
  totalDuration: number;
  stageMetrics: Array<{
    stageKey: string;
    duration: number;
    isBottleneck: boolean;
  }>;
  llmMetrics: {
    callCount: number;
    avgResponseTime: number;
    totalTokens: number;
  };
  concurrency: {
    maxConcurrentAgents: number;
    avgConcurrentAgents: number;
    timeline: Array<{ time: number; activeAgents: number }>;
  };
}

/* ─── Audit Interface ─── */

export interface AuditEntry {
  id: string;
  userId: string;
  missionId: string;
  action: "play" | "pause" | "seek" | "export" | "snapshot" | "view";
  timestamp: number;
  details?: Record<string, unknown>;
}
