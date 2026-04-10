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
  executionMode: "real" | "mock";
  defaultImage: string;
  maxConcurrentJobs: number;
  dockerHost?: string;
  dockerTlsVerify?: boolean;
  dockerCertPath?: string;
  callbackSecret: string;
  aiImage: string;

  // ── Security sandbox (Task 2.2) ──
  securityLevel: string;
  containerUser: string;
  maxMemory: string;
  maxCpus: string;
  maxPids: number;
  tmpfsSize: string;
  networkWhitelist: string[];
  seccompProfilePath?: string;
}

export interface LobsterExecutorServiceOptions {
  dataRoot: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Full executor config — used to select runner and create limiter */
  config?: LobsterExecutorConfig;
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
  docker: {
    status: "connected" | "disconnected";
    host?: string;
  };
  features: {
    health: true;
    createJob: true;
    jobQuery: true;
    cancelJob: true;
    dockerLifecycle: boolean;
    callbackSigning: boolean;
  };
  aiCapability: {
    enabled: boolean;
    image: string;
    llmProvider: string;
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
  containerId?: string;
  cancelRequested?: {
    requestedAt: string;
    requestedBy?: string;
    reason?: string;
    source?: string;
  };
  executionMode: "real" | "mock";
}

export interface AIJobPayload {
  aiEnabled?: boolean;
  aiTaskType?:
    | "text-generation"
    | "code-generation"
    | "data-analysis"
    | "image-understanding";
  llmConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

export interface AIResultArtifact {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  taskType: string;
  completedAt: string;
}
