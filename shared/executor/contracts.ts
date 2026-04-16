import type { MissionDecision } from "../mission/contracts.js";
import type { PhaseAssignment } from "../role-schema.js";

export const EXECUTOR_CONTRACT_VERSION = "2026-03-28" as const;

export const EXECUTION_RUN_MODES = ["auto", "reuse", "managed"] as const;

export type ExecutionRunMode = (typeof EXECUTION_RUN_MODES)[number];

export const EXECUTION_JOB_KINDS = [
  "scan",
  "analyze",
  "plan",
  "codegen",
  "execute",
  "report",
  "custom",
] as const;

export type ExecutionJobKind = (typeof EXECUTION_JOB_KINDS)[number];

export const EXECUTOR_JOB_STATUSES = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "timeout",
] as const;

export type ExecutorJobStatus = (typeof EXECUTOR_JOB_STATUSES)[number];

export const EXECUTOR_EVENT_TYPES = [
  "job.accepted",
  "job.started",
  "job.progress",
  "job.waiting",
  "job.completed",
  "job.failed",
  "job.cancelled",
  "job.timeout",
  "job.log",
  "job.heartbeat",
  "job.log_stream",
  "job.screenshot",
] as const;

export type ExecutorEventType = (typeof EXECUTOR_EVENT_TYPES)[number];

export interface ExecutionPlanStep {
  key: string;
  label: string;
  description: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  /** Agent-role assignments for this phase (dynamic role system) */
  assignments?: PhaseAssignment[];
}

export interface ExecutionPlanJob {
  id: string;
  key: string;
  label: string;
  description: string;
  kind: ExecutionJobKind;
  dependsOn?: string[];
  timeoutMs?: number;
  payload?: Record<string, unknown>;
}

export interface ExecutionPlanArtifact {
  kind: "file" | "report" | "url" | "log";
  name: string;
  path?: string;
  url?: string;
  description?: string;
}

export interface ExecutionPlan {
  version: typeof EXECUTOR_CONTRACT_VERSION;
  missionId: string;
  summary: string;
  objective: string;
  requestedBy: "brain" | "user" | "feishu" | "system";
  mode: ExecutionRunMode;
  sourceText?: string;
  workspaceRoot?: string;
  steps: ExecutionPlanStep[];
  jobs: ExecutionPlanJob[];
  artifacts?: ExecutionPlanArtifact[];
  metadata?: Record<string, unknown>;
}

export interface ExecutorCallbackAuth {
  scheme: "hmac-sha256";
  executorHeader: "x-cube-executor-id";
  timestampHeader: "x-cube-executor-timestamp";
  signatureHeader: "x-cube-executor-signature";
  signedPayload: "timestamp.rawBody";
}

export interface ExecutorCallbackConfig {
  eventsUrl: string;
  timeoutMs?: number;
  auth: ExecutorCallbackAuth;
}

export interface ExecutorJobRequest {
  version: typeof EXECUTOR_CONTRACT_VERSION;
  requestId: string;
  missionId: string;
  jobId: string;
  executor: "lobster";
  createdAt: string;
  traceId?: string;
  idempotencyKey?: string;
  plan: ExecutionPlan;
  callback: ExecutorCallbackConfig;
}

export interface ExecutorEventMetrics {
  durationMs?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  timedOut?: number;
}

export interface ExecutorEventLog {
  level: "info" | "warn" | "error";
  message: string;
}

export interface ExecutorEvent {
  version: typeof EXECUTOR_CONTRACT_VERSION;
  eventId: string;
  missionId: string;
  jobId: string;
  executor: string;
  type: ExecutorEventType;
  status: ExecutorJobStatus;
  occurredAt: string;
  stageKey?: string;
  progress?: number;
  message: string;
  detail?: string;
  waitingFor?: string;
  decision?: MissionDecision;
  summary?: string;
  errorCode?: string;
  log?: ExecutorEventLog;
  metrics?: ExecutorEventMetrics;
  artifacts?: ExecutionPlanArtifact[];
  payload?: Record<string, unknown>;
  /** 日志/截图关联的步骤索引 */
  stepIndex?: number;
  /** 日志流类型 */
  stream?: "stdout" | "stderr";
  /** 日志数据（最大 4KB） */
  data?: string;
  /** base64 编码 PNG 截图（最大 200KB） */
  imageData?: string;
  /** 截图宽度 */
  imageWidth?: number;
  /** 截图高度 */
  imageHeight?: number;
}

// ─── Security Sandbox Types ─────────────────────────────────────────────────

export const SECURITY_LEVELS = ["strict", "balanced", "permissive"] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

export interface SecurityResourceLimits {
  memoryBytes: number; // 默认 512MB = 536870912
  nanoCpus: number; // 默认 1.0 核 = 1_000_000_000
  pidsLimit: number; // 默认 256
  tmpfsSizeBytes: number; // 默认 64MB = 67108864
}

export interface SecurityNetworkPolicy {
  mode: "none" | "whitelist" | "bridge";
  whitelist?: string[]; // 域名/IP 列表
}

export interface SecurityPolicy {
  level: SecurityLevel;
  user: string; // 容器运行用户，默认 "65534" (nobody)
  readonlyRootfs: boolean;
  noNewPrivileges: boolean;
  capDrop: string[]; // 默认 ["ALL"]
  capAdd: string[]; // 按等级添加
  seccompProfile?: string; // seccomp profile 路径
  resources: SecurityResourceLimits;
  network: SecurityNetworkPolicy;
}

export interface SecurityAuditEntry {
  timestamp: string;
  jobId: string;
  missionId: string;
  eventType:
    | "container.created"
    | "container.started"
    | "container.oom"
    | "container.seccomp_violation"
    | "container.security_failure"
    | "container.destroyed"
    | "resource.exceeded";
  securityLevel: SecurityLevel;
  detail: Record<string, unknown>;
}
