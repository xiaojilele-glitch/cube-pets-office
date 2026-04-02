import type {
  OrganizationGenerationDebugLog,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "@shared/organization-schema";
export type { WorkflowInputAttachment } from "@shared/workflow-input";

export interface AgentInfo {
  id: string;
  name: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  managerId: string | null;
  model: string;
  isActive: boolean;
  status:
    | "idle"
    | "thinking"
    | "heartbeat"
    | "executing"
    | "reviewing"
    | "planning"
    | "analyzing"
    | "auditing"
    | "revising"
    | "verifying"
    | "summarizing"
    | "evaluating";
}

export interface WorkflowInfo {
  id: string;
  directive: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | "completed_with_errors"
    | "failed";
  current_stage: string | null;
  departments_involved: string[];
  started_at: string | null;
  completed_at: string | null;
  results: any;
  created_at: string;
}

export type {
  OrganizationGenerationDebugLog,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
};

export interface TaskInfo {
  id: number;
  workflow_id: string;
  worker_id: string;
  manager_id: string;
  department: string;
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
  version: number;
  status: string;
}

export interface MessageInfo {
  id: number;
  workflow_id: string;
  from_agent: string;
  to_agent: string;
  stage: string;
  content: string;
  metadata: any;
  created_at: string;
}

export interface StageInfo {
  id: string;
  order: number;
  label: string;
}

export interface AgentMemoryEntry {
  timestamp: string;
  workflowId: string | null;
  stage: string | null;
  type: "message" | "llm_prompt" | "llm_response" | "workflow_summary";
  direction?: "inbound" | "outbound";
  agentId?: string;
  otherAgentId?: string;
  preview: string;
  content: string;
  metadata?: any;
}

export interface AgentMemorySummary {
  workflowId: string;
  createdAt: string;
  directive: string;
  status: string;
  role: string;
  stage: string | null;
  summary: string;
  keywords: string[];
}

export interface HeartbeatStatusInfo {
  agentId: string;
  agentName: string;
  department: string;
  enabled: boolean;
  state: "idle" | "scheduled" | "running" | "error";
  intervalMinutes: number;
  keywords: string[];
  focus: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastReportId: string | null;
  lastReportTitle: string | null;
  lastReportAt: string | null;
  reportCount: number;
}

export interface HeartbeatReportInfo {
  reportId: string;
  generatedAt: string;
  trigger: "scheduled" | "manual" | "startup";
  agentId: string;
  agentName: string;
  department: string;
  title: string;
  summaryPreview: string;
  keywords: string[];
  searchResultCount: number;
  jsonPath: string;
  markdownPath: string;
}

export interface RuntimeStateSnapshot {
  agents: AgentInfo[];
  workflows: WorkflowInfo[];
  tasks: TaskInfo[];
  messages: MessageInfo[];
  agentStatuses: Record<string, string>;
  memoryEntriesByAgent: Record<string, AgentMemoryEntry[]>;
  memorySummariesByAgent: Record<string, AgentMemorySummary[]>;
  heartbeatStatuses: HeartbeatStatusInfo[];
  heartbeatReports: HeartbeatReportInfo[];
  stages: StageInfo[];
  nextTaskId: number;
  nextMessageId: number;
}

export interface RuntimeWorkflowDetail {
  workflow: WorkflowInfo | null;
  tasks: TaskInfo[];
  messages: MessageInfo[];
  report: any;
}

export interface RuntimeDownloadPayload {
  filename: string;
  mimeType: string;
  content: string;
}

export type RuntimeEvent =
  | { type: "stage_change"; workflowId: string; stage: string }
  | { type: "stage_complete"; workflowId: string; stage: string }
  | {
      type: "agent_active";
      workflowId?: string;
      agentId: string;
      action: string;
    }
  | { type: "message_sent"; workflowId: string; messageId: number }
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
      status: WorkflowInfo["status"];
      summary: string;
    }
  | { type: "workflow_error"; workflowId: string; error: string }
  | { type: "heartbeat_status"; status: HeartbeatStatusInfo }
  | { type: "heartbeat_report_saved"; report: HeartbeatReportInfo };
