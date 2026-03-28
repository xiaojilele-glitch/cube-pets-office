import type { CreateExecutorJobResponse } from "../../../shared/executor/api.js";
import type {
  ExecutionPlanArtifact,
  ExecutionPlanJob,
  ExecutorEvent,
  ExecutorJobRequest,
  ExecutorJobStatus,
} from "../../../shared/executor/contracts.js";

export interface LobsterExecutorConfig {
  host: string;
  port: number;
  dataRoot: string;
  serviceName: string;
}

export interface LobsterExecutorServiceOptions {
  dataRoot: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface JobQueueStats {
  total: number;
  queued: number;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface LobsterExecutorJobSummary {
  requestId: string;
  missionId: string;
  jobId: string;
  jobKey: string;
  jobLabel: string;
  kind: ExecutionPlanJob["kind"];
  status: ExecutorJobStatus;
  progress: number;
  message: string;
  receivedAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  summary?: string;
  callbackMode: "pending";
  artifactCount: number;
}

export interface LobsterExecutorJobDetail extends LobsterExecutorJobSummary {
  artifacts: ExecutionPlanArtifact[];
  events: ExecutorEvent[];
  dataDirectory: string;
  logFile: string;
}

export interface LobsterExecutorJobsResponse {
  ok: true;
  jobs: LobsterExecutorJobSummary[];
}

export interface LobsterExecutorJobDetailResponse {
  ok: true;
  job: LobsterExecutorJobDetail;
}

export interface LobsterExecutorHealthResponse {
  ok: true;
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
  dataRoot: string;
  queue: JobQueueStats;
  features: {
    health: true;
    createJob: true;
    jobQuery: true;
    cancelJob: false;
    dockerLifecycle: false;
    callbackSigning: false;
  };
}

export interface StoredJobRecord {
  acceptedResponse: CreateExecutorJobResponse;
  request: ExecutorJobRequest;
  planJob: ExecutionPlanJob;
  status: ExecutorJobStatus;
  progress: number;
  message: string;
  receivedAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  summary?: string;
  artifacts: ExecutionPlanArtifact[];
  events: ExecutorEvent[];
  dataDirectory: string;
  logFile: string;
}
