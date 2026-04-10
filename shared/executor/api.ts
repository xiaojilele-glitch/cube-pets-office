import type {
  ExecutorEvent,
  ExecutorJobRequest,
  ExecutorJobStatus,
} from "./contracts.js";

export const EXECUTOR_API_ROUTES = {
  createJob: "/api/executor/jobs",
  cancelJob: "/api/executor/jobs/:id/cancel",
  pauseJob: "/api/executor/jobs/:id/pause",
  resumeJob: "/api/executor/jobs/:id/resume",
  events: "/api/executor/events",
} as const;

export const EXECUTOR_CALLBACK_HEADERS = {
  executorId: "x-cube-executor-id",
  timestamp: "x-cube-executor-timestamp",
  signature: "x-cube-executor-signature",
} as const;

export type CreateExecutorJobRequest = ExecutorJobRequest;

export interface CreateExecutorJobResponse {
  ok: true;
  accepted: true;
  requestId: string;
  missionId: string;
  jobId: string;
  receivedAt: string;
}

export interface CancelExecutorJobRequest {
  reason?: string;
  requestedBy?: string;
  source?: "user" | "brain" | "feishu" | "system";
}

export interface CancelExecutorJobResponse {
  ok: true;
  accepted: true;
  alreadyFinal?: boolean;
  cancelRequested?: boolean;
  missionId: string;
  jobId: string;
  status: ExecutorJobStatus;
  message: string;
}

export interface PauseExecutorJobRequest {
  reason?: string;
  requestedBy?: string;
  source?: "user" | "brain" | "feishu" | "system";
}

export interface PauseExecutorJobResponse {
  ok: true;
  accepted: true;
  alreadyFinal?: boolean;
  alreadyPaused?: boolean;
  pauseRequested?: boolean;
  missionId: string;
  jobId: string;
  status: ExecutorJobStatus;
  message: string;
}

export interface ResumeExecutorJobRequest {
  reason?: string;
  requestedBy?: string;
  source?: "user" | "brain" | "feishu" | "system";
}

export interface ResumeExecutorJobResponse {
  ok: true;
  accepted: true;
  alreadyFinal?: boolean;
  alreadyActive?: boolean;
  resumeRequested?: boolean;
  missionId: string;
  jobId: string;
  status: ExecutorJobStatus;
  message: string;
}

export interface SubmitExecutorEventRequest {
  event: ExecutorEvent;
}

export interface SubmitExecutorEventResponse {
  ok: true;
  accepted: true;
  missionId: string;
  jobId: string;
  eventId: string;
}

export interface ExecutorApiErrorResponse {
  ok?: false;
  error: string;
}
