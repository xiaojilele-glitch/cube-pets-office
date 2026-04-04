export const WORKFLOW_STAGES = [
  "direction",
  "planning",
  "execution",
  "review",
  "meta_audit",
  "revision",
  "verify",
  "summary",
  "feedback",
  "evolution",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  direction: "方向下发",
  planning: "任务规划",
  execution: "执行",
  review: "评审",
  meta_audit: "元审计",
  revision: "修订",
  verify: "验证",
  summary: "汇总",
  feedback: "反馈",
  evolution: "进化",
};

export type AgentRole = "ceo" | "manager" | "worker";
export type AgentDepartment = string;

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface AgentRecord {
  id: string;
  name: string;
  department: AgentDepartment;
  role: AgentRole;
  manager_id: string | null;
  model: string;
  soul_md: string | null;
  heartbeat_config: unknown;
  is_active: number;
  created_at: string;
  updated_at: string;
  capabilities?: string[];
}

export interface WorkflowRecord {
  id: string;
  directive: string;
  status: WorkflowStatus;
  current_stage: string | null;
  departments_involved: string[];
  started_at: string | null;
  completed_at: string | null;
  results: any;
  created_at: string;
}

export interface MessageRecord {
  id: number;
  workflow_id: string;
  from_agent: string;
  to_agent: string;
  stage: string;
  content: string;
  metadata: any;
  created_at: string;
}

export interface TaskRecord {
  id: number;
  workflow_id: string;
  worker_id: string;
  manager_id: string;
  department: AgentDepartment;
  description: string;
  deliverable: string | null;
  deliverable_v2: string | null;
  deliverable_v3: string | null;
  score_accuracy: number | null;
  score_completeness: number | null;
  score_actionability: number | null;
  score_format: number | null;
  total_score: number | null;
  manager_feedback: string | null;
  meta_audit_feedback: string | null;
  verify_result: any;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EvolutionLogInput {
  agent_id: string;
  workflow_id: string | null;
  dimension: string | null;
  old_score: number | null;
  new_score: number | null;
  patch_content: string | null;
  applied: number;
}

export type LLMMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMMessageContentPart[];
}

export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMProvider {
  call(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMResponse>;
  callJson<T = unknown>(
    messages: LLMMessage[],
    options?: LLMCallOptions
  ): Promise<T>;
  isTemporarilyUnavailable?(error: unknown): boolean;
}

export interface MemoryRepository {
  buildPromptContext(
    agentId: string,
    query: string,
    workflowId?: string
  ): string[];
  appendLLMExchange(
    agentId: string,
    options: {
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: any;
    }
  ): void;
  appendMessageLog(
    agentId: string,
    options: {
      workflowId: string;
      stage: string;
      direction: "inbound" | "outbound";
      otherAgentId: string;
      content: string;
      metadata?: any;
    }
  ): void;
  materializeWorkflowMemories(workflowId: string): void;
  getSoulText(agentId: string, fallbackSoulMd?: string): string;
  appendLearnedBehaviors(agentId: string, behaviors: string[]): string;
}

export interface DepartmentReportRecord {
  stats: {
    averageScore: number | null;
  };
}

export interface FinalWorkflowReportRecord {
  kind: "final_workflow_report";
  version: 1;
  workflowId: string;
  generatedAt: string;
  workflow: {
    rootAgentId: string;
    rootAgentName: string;
    directive: string;
    status: string;
    currentStage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    departmentsInvolved: string[];
  };
  stats: {
    messageCount: number;
    taskCount: number;
    passedTaskCount: number;
    revisedTaskCount: number;
    averageScore: number | null;
  };
  departmentReports: Array<{
    managerId: string;
    managerName: string;
    department: string;
    summary: string;
    taskCount: number;
    averageScore: number | null;
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>;
  ceoFeedback: string;
  keyIssues: string[];
  tasks: Array<{
    id: number;
    department: string;
    workerId: string;
    managerId: string;
    status: string;
    totalScore: number | null;
    description: string;
    deliverablePreview: string;
  }>;
}

export interface ReportRepository {
  buildDepartmentReport(
    workflow: WorkflowRecord,
    manager: { id: string; name: string; department?: string },
    summary: string,
    tasks: TaskRecord[]
  ): DepartmentReportRecord;
  saveDepartmentReport(report: unknown): {
    jsonPath: string;
    markdownPath: string;
  };
  saveFinalWorkflowReport(report: FinalWorkflowReportRecord): {
    jsonPath: string;
    markdownPath: string;
  };
}

export interface RuntimeEventEmitter {
  emit(event: AgentEvent): void;
}

export interface AgentHandle {
  config: {
    id: string;
    name: string;
    department: string;
    role: AgentRole;
    managerId: string | null;
    model: string;
    soulMd: string;
  };
  invoke(
    prompt: string,
    context?: string[],
    options?: { workflowId?: string; stage?: string }
  ): Promise<string>;
  invokeJson<T = unknown>(
    prompt: string,
    context?: string[],
    options?: { workflowId?: string; stage?: string }
  ): Promise<T>;
}

export interface AgentDirectory {
  get(id: string): AgentHandle | undefined;
  getCEO(): AgentHandle | undefined;
  getManagerByDepartment(dept: string): AgentHandle | undefined;
  getWorkersByManager(managerId: string): AgentHandle[];
  refresh(agentId: string): void;
  refreshAll?(): void;
}

export interface WorkflowRepository {
  createWorkflow(
    id: string,
    directive: string,
    departments: string[]
  ): WorkflowRecord;
  getWorkflow(id: string): WorkflowRecord | undefined;
  getWorkflows(): WorkflowRecord[];
  findWorkflowByDirective(
    directive: string,
    options?: { statuses?: WorkflowStatus[]; maxAgeMs?: number }
  ): WorkflowRecord | undefined;
  updateWorkflow(id: string, updates: Partial<WorkflowRecord>): void;
  getAgents(): AgentRecord[];
  getAgent(id: string): AgentRecord | undefined;
  getAgentsByRole(role: AgentRole): AgentRecord[];
  getAgentsByDepartment(dept: string): AgentRecord[];
  getTasksByWorkflow(workflowId: string): TaskRecord[];
  createTask(
    task: Omit<TaskRecord, "id" | "created_at" | "updated_at">
  ): TaskRecord;
  updateTask(id: number, updates: Partial<TaskRecord>): void;
  getMessagesByWorkflow(workflowId: string): MessageRecord[];
  createEvolutionLog(log: EvolutionLogInput): unknown;
  getScoresForWorkflow(workflowId: string): TaskRecord[];
}

export interface RuntimeMessageBus {
  send(
    fromId: string,
    toId: string,
    content: string,
    workflowId: string,
    stage: string,
    metadata?: any
  ): Promise<MessageRecord>;
  getInbox(agentId: string, workflowId?: string): Promise<MessageRecord[]>;
  getWorkflowMessages?(workflowId: string): Promise<MessageRecord[]>;
}

export interface EvolutionService {
  evolveWorkflow(workflowId: string): unknown;
}

export interface WorkflowRuntime {
  workflowRepo: WorkflowRepository;
  memoryRepo: MemoryRepository;
  reportRepo: ReportRepository;
  eventEmitter: RuntimeEventEmitter;
  llmProvider: LLMProvider;
  agentDirectory: AgentDirectory;
  messageBus: RuntimeMessageBus;
  evolutionService: EvolutionService;
  /** Called after a workflow stage completes. Used by MissionOrchestrator to enrich MissionRecord. */
  onStageCompleted?(workflowId: string, completedStage: string): void | Promise<void>;
  /** Resolve the missionId linked to a given workflowId. Used by ExecutionBridge integration. */
  resolveMissionId?(workflowId: string): string | undefined;
}

export type AgentEvent =
  | { type: "stage_change"; workflowId: string; stage: string }
  | { type: "stage_complete"; workflowId: string; stage: string }
  | {
      type: "agent_active";
      agentId: string;
      action: string;
      workflowId?: string;
    }
  | {
      type: "message_sent";
      workflowId: string;
      from: string;
      to: string;
      stage: string;
      preview: string;
      timestamp: string;
    }
  | {
      type: "score_assigned";
      workflowId: string;
      taskId: number;
      workerId: string;
      score: number;
    }
  | {
      type: "task_update";
      workflowId: string;
      taskId: number;
      workerId: string;
      status: string;
    }
  | {
      type: "workflow_complete";
      workflowId: string;
      status: string;
      summary: string;
    }
  | { type: "workflow_error"; workflowId: string; error: string }
  | {
      type: "heartbeat_status";
      status: unknown;
    }
  | {
      type: "heartbeat_report_saved";
      agentId: string;
      reportId: string;
      title: string;
      generatedAt: string;
      summary: string;
      jsonPath: string;
      markdownPath: string;
    }
  | {
      type: "agent.roleChanged";
      agentId: string;
      fromRoleId: string | null;
      toRoleId: string | null;
      timestamp: string;
    };
