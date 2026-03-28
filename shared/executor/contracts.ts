import type { MissionDecision } from "../mission/contracts.js";

export const EXECUTOR_CONTRACT_VERSION = "2026-03-28" as const;

export const EXECUTION_RUN_MODES = [
  "auto",
  "reuse",
  "managed",
] as const;

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
  "job.log",
  "job.heartbeat",
] as const;

export type ExecutorEventType = (typeof EXECUTOR_EVENT_TYPES)[number];

export interface ExecutionPlanStep {
  key: string;
  label: string;
  description: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
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
}
