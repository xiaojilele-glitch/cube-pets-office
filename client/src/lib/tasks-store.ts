import { create } from "zustand";

import type {
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "@shared/organization-schema";
import {
  normalizeWorkflowAttachments,
  type WorkflowInputAttachment,
} from "@shared/workflow-input";

import { useAppStore, type RuntimeMode } from "./store";
import { localRuntime } from "./runtime/local-runtime-client";
import type {
  AgentInfo,
  MessageInfo,
  RuntimeWorkflowDetail,
  StageInfo,
  TaskInfo,
  WorkflowInfo,
} from "./runtime/types";
import { useWorkflowStore } from "./workflow-store";

type WorkflowTaskRecord = TaskInfo & {
  created_at?: string | null;
  updated_at?: string | null;
  verify_result?: unknown;
};

type WorkflowMessageRecord = MessageInfo & {
  metadata?: Record<string, unknown> | null;
};

type WorkflowEventLogItem = {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
};

type WorkflowReportRecord = {
  kind?: string;
  generatedAt?: string;
  generated_at?: string;
  ceoFeedback?: string;
  keyIssues?: string[];
  stats?: {
    messageCount?: number;
    taskCount?: number;
    passedTaskCount?: number;
    revisedTaskCount?: number;
    averageScore?: number | null;
  };
  workflow?: {
    directive?: string;
    status?: string;
    currentStage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    departmentsInvolved?: string[];
    attachments?: Array<{
      id?: string;
      name?: string;
      mimeType?: string;
      size?: number;
      excerptStatus?: string;
      excerpt?: string;
      error?: string;
    }>;
  };
  departmentReports?: Array<{
    managerId?: string;
    managerName?: string;
    department?: string;
    summary?: string;
    taskCount?: number;
    averageScore?: number | null;
    reportJsonPath?: string;
    reportMarkdownPath?: string;
  }>;
};

type WorkflowDetailRecord = Omit<
  RuntimeWorkflowDetail,
  "tasks" | "messages" | "report"
> & {
  workflow: WorkflowInfo | null;
  tasks: WorkflowTaskRecord[];
  messages: WorkflowMessageRecord[];
  report: WorkflowReportRecord | null;
};

type WorkflowDetailWithWorkflow = WorkflowDetailRecord & {
  workflow: WorkflowInfo;
};

export type MissionTaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "done"
  | "failed";

export type TimelineLevel = "info" | "success" | "warn" | "error";
export type InteriorStageStatus = "pending" | "running" | "done" | "failed";
export type InteriorAgentStatus =
  | "idle"
  | "working"
  | "thinking"
  | "done"
  | "error";

export interface MissionTaskSummary {
  id: string;
  title: string;
  kind: string;
  sourceText: string;
  status: MissionTaskStatus;
  workflowStatus: WorkflowInfo["status"];
  progress: number;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  summary: string;
  waitingFor: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  departmentLabels: string[];
  taskCount: number;
  completedTaskCount: number;
  messageCount: number;
  activeAgentCount: number;
  attachmentCount: number;
  issueCount: number;
  hasWarnings: boolean;
  lastSignal: string | null;
}

export interface TaskTimelineEvent {
  id: string;
  type: string;
  time: number;
  level: TimelineLevel;
  title: string;
  description: string;
  actor?: string;
}

export interface TaskStageRing {
  key: string;
  label: string;
  status: InteriorStageStatus;
  progress: number;
  detail?: string;
  arcStart: number;
  arcEnd: number;
  midAngle: number;
}

export interface TaskInteriorAgent {
  id: string;
  name: string;
  role: string;
  department: string;
  title: string;
  status: InteriorAgentStatus;
  stageKey: string;
  stageLabel: string;
  progress: number | null;
  currentAction?: string;
  angle: number;
}

export interface TaskArtifact {
  id: string;
  title: string;
  description: string;
  kind: "report" | "department_report" | "attachment";
  managerId?: string;
  format?: string;
  filename?: string;
  workflowId?: string;
  downloadKind?: "workflow" | "department" | "attachment";
  href?: string;
  content?: string;
  mimeType?: string;
}

export interface TaskDecisionPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  tone: "primary" | "secondary" | "warning";
}

export interface MissionTaskDetail extends MissionTaskSummary {
  workflow: WorkflowInfo;
  tasks: WorkflowTaskRecord[];
  messages: WorkflowMessageRecord[];
  report: WorkflowReportRecord | null;
  organization: WorkflowOrganizationSnapshot | null;
  stages: TaskStageRing[];
  agents: TaskInteriorAgent[];
  timeline: TaskTimelineEvent[];
  artifacts: TaskArtifact[];
  failureReasons: string[];
  decisionPresets: TaskDecisionPreset[];
  instanceInfo: Array<{ label: string; value: string }>;
  logSummary: Array<{ label: string; value: string }>;
}

interface TasksStoreState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  selectedTaskId: string | null;
  tasks: MissionTaskSummary[];
  detailsById: Record<string, MissionTaskDetail>;
  decisionNotes: Record<string, string>;
  lastDecisionLaunch: {
    sourceTaskId: string;
    sourceTaskTitle: string;
    spawnedWorkflowId: string | null;
    at: number;
  } | null;
  ensureReady: () => Promise<void>;
  refresh: (options?: { preferredTaskId?: string | null }) => Promise<void>;
  selectTask: (taskId: string | null) => void;
  setDecisionNote: (taskId: string, note: string) => void;
  launchDecision: (taskId: string, presetId: string) => Promise<string | null>;
  clearDecisionLaunch: () => void;
}

const FALLBACK_STAGES: StageInfo[] = [
  { id: "direction", order: 1, label: "Task framing" },
  { id: "planning", order: 2, label: "Organization planning" },
  { id: "execution", order: 3, label: "Execution" },
  { id: "review", order: 4, label: "Manager review" },
  { id: "meta_audit", order: 5, label: "Quality audit" },
  { id: "revision", order: 6, label: "Revision" },
  { id: "verify", order: 7, label: "Verification" },
  { id: "summary", order: 8, label: "Summary" },
  { id: "feedback", order: 9, label: "Lead feedback" },
  { id: "evolution", order: 10, label: "Knowledge update" },
];

const WAITING_STAGES = new Set(["review", "meta_audit", "verify", "feedback"]);
const REVIEW_TASK_STATUSES = new Set([
  "submitted",
  "reviewed",
  "audited",
  "revising",
]);
const ACTIVE_AGENT_STATUSES = new Set([
  "thinking",
  "heartbeat",
  "executing",
  "reviewing",
  "planning",
  "analyzing",
  "auditing",
  "revising",
  "verifying",
  "summarizing",
  "evaluating",
]);
const TASK_PROGRESS_WEIGHT: Record<string, number> = {
  assigned: 0.08,
  executing: 0.32,
  submitted: 0.58,
  reviewed: 0.7,
  audited: 0.78,
  revising: 0.66,
  verified: 1,
  passed: 1,
  failed: 0.35,
};
const INTERIOR_ROLE_CANDIDATES: Record<string, string[]> = {
  ceo: ["direction", "feedback", "summary", "evolution"],
  manager: ["planning", "review", "verify", "summary"],
  worker: ["execution", "revision"],
  plan: ["planning", "direction"],
  review: ["review", "verify"],
  audit: ["meta_audit", "verify"],
  summary: ["summary", "feedback"],
  execute: ["execution", "revision"],
};

function dateValue(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimText(value: string | null | undefined, maxLength = 160): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function toStageCatalog(stages: StageInfo[]): StageInfo[] {
  return stages.length > 0
    ? [...stages].sort((left, right) => left.order - right.order)
    : FALLBACK_STAGES;
}

function stageLabelFor(
  stageCatalog: StageInfo[],
  stageKey?: string | null
): string | null {
  if (!stageKey) return null;
  return stageCatalog.find(stage => stage.id === stageKey)?.label ?? stageKey;
}

function pickFallbackTaskId(tasks: MissionTaskSummary[]): string | null {
  return (
    tasks.find(task => task.status === "running")?.id ||
    tasks.find(task => task.status === "waiting")?.id ||
    tasks[0]?.id ||
    null
  );
}

function getOrganizationSnapshot(
  workflow: WorkflowInfo
): WorkflowOrganizationSnapshot | null {
  const organization = workflow.results?.organization;
  if (!organization || typeof organization !== "object") {
    return null;
  }

  const snapshot = organization as WorkflowOrganizationSnapshot;
  return Array.isArray(snapshot.nodes) ? snapshot : null;
}

function normalizeDetailReport(
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null
): WorkflowReportRecord | null {
  if (detail?.report) return detail.report;

  const resultReport = workflow.results?.final_report;
  if (!resultReport || typeof resultReport !== "object") {
    return null;
  }

  return resultReport as WorkflowReportRecord;
}

function getAttachmentCount(
  workflow: WorkflowInfo,
  report: WorkflowReportRecord | null
): number {
  const fromWorkflow = Array.isArray(workflow.results?.input?.attachments)
    ? workflow.results.input.attachments.length
    : 0;
  const fromReport = Array.isArray(report?.workflow?.attachments)
    ? report.workflow.attachments.length
    : 0;
  return Math.max(fromWorkflow, fromReport);
}

function inferTaskKind(
  workflow: WorkflowInfo,
  organization: WorkflowOrganizationSnapshot | null
): string {
  if (organization?.taskProfile?.trim()) {
    return organization.taskProfile;
  }
  if (workflow.departments_involved.length > 1) {
    return "cross-team";
  }
  return workflow.departments_involved[0] || "general";
}

function inferMissionStatus(
  workflow: WorkflowInfo,
  tasks: WorkflowTaskRecord[]
): MissionTaskStatus {
  if (workflow.status === "pending") return "queued";
  if (workflow.status === "failed") return "failed";
  if (
    workflow.status === "completed" ||
    workflow.status === "completed_with_errors"
  ) {
    return "done";
  }
  if (
    WAITING_STAGES.has(workflow.current_stage || "") ||
    tasks.some(task => REVIEW_TASK_STATUSES.has(task.status))
  ) {
    return "waiting";
  }
  return "running";
}

function computeWorkflowProgress(
  workflow: WorkflowInfo,
  tasks: WorkflowTaskRecord[],
  stageCatalog: StageInfo[]
): number {
  if (
    workflow.status === "completed" ||
    workflow.status === "completed_with_errors"
  ) {
    return 100;
  }
  if (workflow.status === "pending") {
    return 6;
  }

  const orderedStages = toStageCatalog(stageCatalog);
  const stageIndex = Math.max(
    0,
    orderedStages.findIndex(stage => stage.id === workflow.current_stage)
  );
  const stageProgress =
    orderedStages.length <= 1
      ? 0
      : (stageIndex / (orderedStages.length - 1)) * 100;
  const taskProgress =
    tasks.length === 0
      ? 0
      : (tasks.reduce(
          (sum, task) => sum + (TASK_PROGRESS_WEIGHT[task.status] ?? 0.18),
          0
        ) /
          tasks.length) *
        100;
  const blended = stageProgress * 0.56 + taskProgress * 0.44 + 5;
  return Math.min(96, Math.max(10, Math.round(blended)));
}

function buildWaitingFor(
  workflow: WorkflowInfo,
  tasks: WorkflowTaskRecord[],
  stageCatalog: StageInfo[]
): string | null {
  if (workflow.status === "failed") {
    const failedStage = stageLabelFor(
      stageCatalog,
      workflow.results?.failed_stage
    );
    return failedStage ? `Blocked at ${failedStage}` : "Execution halted";
  }
  if (workflow.status === "pending") {
    return "Queued for runtime";
  }
  if (tasks.some(task => task.status === "revising")) {
    return "Worker revisions in progress";
  }

  const currentStageLabel = stageLabelFor(stageCatalog, workflow.current_stage);
  if (WAITING_STAGES.has(workflow.current_stage || "")) {
    return currentStageLabel
      ? `Waiting in ${currentStageLabel}`
      : "Awaiting confirmation";
  }
  if (tasks.some(task => REVIEW_TASK_STATUSES.has(task.status))) {
    return "Manager confirmation";
  }
  return null;
}

function extractIssueMessages(workflow: WorkflowInfo): string[] {
  const issues = Array.isArray(workflow.results?.workflow_issues)
    ? workflow.results.workflow_issues
    : [];

  return issues
    .map((issue: unknown) => {
      if (typeof issue === "string") return issue;
      if (issue && typeof issue === "object" && "message" in issue) {
        return String((issue as { message?: unknown }).message || "");
      }
      return "";
    })
    .filter(Boolean);
}

function buildFailureReasons(
  workflow: WorkflowInfo,
  tasks: WorkflowTaskRecord[],
  report: WorkflowReportRecord | null
): string[] {
  const reasons = new Set<string>();
  const lastError =
    typeof workflow.results?.last_error === "string"
      ? workflow.results.last_error
      : "";
  const failedStage =
    typeof workflow.results?.failed_stage === "string"
      ? workflow.results.failed_stage
      : "";

  if (lastError) reasons.add(lastError);
  if (failedStage) reasons.add(`Failed stage: ${failedStage}`);
  for (const message of extractIssueMessages(workflow)) {
    reasons.add(message);
  }
  for (const issue of report?.keyIssues || []) {
    if (issue) reasons.add(issue);
  }
  for (const task of tasks) {
    if (task.status === "failed") {
      reasons.add(`Task #${task.id} failed: ${trimText(task.description, 96)}`);
    }
    if (task.status === "revising" && task.manager_feedback) {
      reasons.add(
        `Task #${task.id} needs revision: ${trimText(task.manager_feedback, 108)}`
      );
    }
    if (task.meta_audit_feedback) {
      reasons.add(
        `Audit note for task #${task.id}: ${trimText(task.meta_audit_feedback, 108)}`
      );
    }
  }

  return Array.from(reasons);
}

function getTaskPreview(task: WorkflowTaskRecord): string {
  return (
    task.deliverable_v3 ||
    task.deliverable_v2 ||
    task.deliverable ||
    task.manager_feedback ||
    task.meta_audit_feedback ||
    ""
  );
}

function buildSummary(
  workflow: WorkflowInfo,
  tasks: WorkflowTaskRecord[],
  report: WorkflowReportRecord | null,
  waitingFor: string | null
): string {
  const reportFeedback = trimText(report?.ceoFeedback, 180);
  if (reportFeedback) return reportFeedback;

  if (workflow.status === "failed") {
    return (
      trimText(workflow.results?.last_error, 180) ||
      "The mission stopped before the runtime could finish the loop."
    );
  }

  const passedCount = tasks.filter(
    task => task.status === "passed" || task.status === "verified"
  ).length;
  const activeCount = tasks.filter(
    task => task.status === "executing" || task.status === "revising"
  ).length;
  const latestPreview = trimText(
    tasks.map(task => getTaskPreview(task)).find(Boolean),
    180
  );

  if (
    workflow.status === "completed" ||
    workflow.status === "completed_with_errors"
  ) {
    return (
      latestPreview ||
      `Delivered ${passedCount}/${tasks.length || 0} work packages across the temporary organization.`
    );
  }

  if (waitingFor) {
    return (
      latestPreview ||
      `${waitingFor}. ${activeCount > 0 ? `${activeCount} work packages are still moving.` : "The orchestration is between steps."}`
    );
  }

  return (
    latestPreview ||
    "The temporary organization is still assembling evidence, output, and review signals."
  );
}

function getWorkflowUpdatedAt(
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null,
  events: WorkflowEventLogItem[]
): number {
  const candidates = [
    dateValue(workflow.completed_at),
    dateValue(workflow.started_at),
    dateValue(workflow.created_at),
  ];

  for (const task of detail?.tasks || []) {
    candidates.push(dateValue(task.updated_at));
    candidates.push(dateValue(task.created_at));
  }
  for (const message of detail?.messages || []) {
    candidates.push(dateValue(message.created_at));
  }
  for (const event of events) {
    candidates.push(dateValue(event.timestamp));
  }

  return Math.max(
    ...candidates.filter((value): value is number => value !== null),
    Date.now()
  );
}

function getActiveAgentCount(
  organization: WorkflowOrganizationSnapshot | null,
  agents: AgentInfo[]
): number {
  const relevantAgentIds = new Set(
    organization?.nodes.map(node => node.agentId) || []
  );
  return agents.filter(agent => {
    if (relevantAgentIds.size > 0 && !relevantAgentIds.has(agent.id)) {
      return false;
    }
    return ACTIVE_AGENT_STATUSES.has(agent.status);
  }).length;
}

function buildSummaryRecord(
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null,
  agents: AgentInfo[],
  stageCatalog: StageInfo[],
  eventLog: WorkflowEventLogItem[]
): MissionTaskSummary {
  const organization = getOrganizationSnapshot(workflow);
  const report = normalizeDetailReport(workflow, detail);
  const tasks = detail?.tasks || [];
  const messages = detail?.messages || [];
  const workflowEvents = eventLog.filter(
    event => event.data?.workflowId === workflow.id
  );
  const status = inferMissionStatus(workflow, tasks);
  const waitingFor = buildWaitingFor(workflow, tasks, stageCatalog);
  const failureReasons = buildFailureReasons(workflow, tasks, report);
  const updatedAt = getWorkflowUpdatedAt(workflow, detail, workflowEvents);
  const completedTaskCount = tasks.filter(
    task => task.status === "passed" || task.status === "verified"
  ).length;

  return {
    id: workflow.id,
    title: trimText(workflow.directive, 76) || "Untitled mission",
    kind: inferTaskKind(workflow, organization),
    sourceText: workflow.directive,
    status,
    workflowStatus: workflow.status,
    progress: computeWorkflowProgress(workflow, tasks, stageCatalog),
    currentStageKey: workflow.current_stage,
    currentStageLabel: stageLabelFor(stageCatalog, workflow.current_stage),
    summary: buildSummary(workflow, tasks, report, waitingFor),
    waitingFor,
    createdAt: dateValue(workflow.created_at) || Date.now(),
    updatedAt,
    startedAt: dateValue(workflow.started_at),
    completedAt: dateValue(workflow.completed_at),
    departmentLabels:
      organization?.departments.map(item => item.label) ||
      workflow.departments_involved,
    taskCount: tasks.length,
    completedTaskCount,
    messageCount: messages.length,
    activeAgentCount: getActiveAgentCount(organization, agents),
    attachmentCount: getAttachmentCount(workflow, report),
    issueCount: failureReasons.length,
    hasWarnings:
      workflow.status === "completed_with_errors" || failureReasons.length > 0,
    lastSignal:
      trimText(messages[messages.length - 1]?.content, 96) ||
      trimText(
        (workflowEvents[workflowEvents.length - 1]?.type || "").replace(
          /_/g,
          " "
        ),
        96
      ) ||
      null,
  };
}

const AGENT_STATUS_STAGE_MAP: Partial<Record<AgentInfo["status"], string>> = {
  analyzing: "direction",
  planning: "planning",
  executing: "execution",
  reviewing: "review",
  auditing: "meta_audit",
  revising: "revision",
  verifying: "verify",
  summarizing: "summary",
  evaluating: "feedback",
};

const AGENT_STATUS_INTERIOR_MAP: Record<
  AgentInfo["status"],
  InteriorAgentStatus
> = {
  idle: "idle",
  thinking: "thinking",
  heartbeat: "thinking",
  executing: "working",
  reviewing: "working",
  planning: "thinking",
  analyzing: "thinking",
  auditing: "working",
  revising: "working",
  verifying: "working",
  summarizing: "done",
  evaluating: "working",
};

const TASK_STAGE_MAP: Record<string, string> = {
  assigned: "planning",
  executing: "execution",
  submitted: "review",
  reviewed: "review",
  audited: "meta_audit",
  revising: "revision",
  verified: "verify",
  passed: "verify",
  failed: "revision",
};

let taskStoreWatchersStarted = false;
let scheduledRefreshTimer: number | null = null;
let queuedRefreshOptions: { preferredTaskId?: string | null } | null = null;
let inFlightRefresh: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatShortDate(value: number | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDurationMs(value: number | null): string {
  if (value === null || value < 0) return "n/a";
  const totalMinutes = Math.max(1, Math.round(value / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stageOrderIndex(
  stageCatalog: StageInfo[],
  stageKey?: string | null
): number {
  if (!stageKey) return -1;
  return toStageCatalog(stageCatalog).findIndex(stage => stage.id === stageKey);
}

function workflowEventsFor(
  workflowId: string,
  eventLog: WorkflowEventLogItem[]
): WorkflowEventLogItem[] {
  return eventLog
    .filter(event => safeString(event.data?.workflowId) === workflowId)
    .sort((left, right) => {
      return (
        (dateValue(left.timestamp) || 0) - (dateValue(right.timestamp) || 0)
      );
    });
}

function taskStageKey(task: WorkflowTaskRecord): string | null {
  return TASK_STAGE_MAP[task.status] || null;
}

function taskProgressValue(task: WorkflowTaskRecord): number {
  return Math.round((TASK_PROGRESS_WEIGHT[task.status] ?? 0.12) * 100);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function workflowResultRecord(workflow: WorkflowInfo): Record<string, unknown> {
  return isRecord(workflow.results) ? workflow.results : {};
}

function reportPath(
  report: WorkflowReportRecord | null,
  key: "json" | "markdown"
): string | null {
  const candidate = report as Record<string, unknown> | null;
  if (!candidate) return null;
  return safeString(
    key === "json"
      ? (candidate.json_path ?? candidate.jsonPath)
      : (candidate.markdown_path ?? candidate.markdownPath)
  );
}

type DepartmentReportRecord = {
  manager_id?: string;
  managerId?: string;
  manager_name?: string;
  managerName?: string;
  department?: string;
  summary?: string;
  task_count?: number;
  taskCount?: number;
  average_score?: number | null;
  averageScore?: number | null;
  report_json_path?: string;
  reportJsonPath?: string;
  report_markdown_path?: string;
  reportMarkdownPath?: string;
};

function getDepartmentReports(
  workflow: WorkflowInfo,
  report: WorkflowReportRecord | null
): DepartmentReportRecord[] {
  const resultRecord = workflowResultRecord(workflow);
  const fromWorkflow = Array.isArray(resultRecord.department_reports)
    ? resultRecord.department_reports
    : [];
  const reportRecord = report as Record<string, unknown> | null;
  const fromReport = Array.isArray(reportRecord?.departmentReports)
    ? reportRecord.departmentReports
    : Array.isArray(reportRecord?.department_reports)
      ? reportRecord.department_reports
      : [];

  return [...fromReport, ...fromWorkflow].filter(
    isRecord
  ) as DepartmentReportRecord[];
}

function getWorkflowAttachments(
  workflow: WorkflowInfo,
  report: WorkflowReportRecord | null
): WorkflowInputAttachment[] {
  const resultRecord = workflowResultRecord(workflow);
  const inputRecord = isRecord(resultRecord.input) ? resultRecord.input : null;
  const fromInput = normalizeWorkflowAttachments(inputRecord?.attachments);
  const fromReport = normalizeWorkflowAttachments(
    isRecord(report?.workflow) ? report.workflow.attachments : null
  );

  if (fromInput.length > 0) {
    return fromInput;
  }
  return fromReport;
}

function nodeForAgent(
  organization: WorkflowOrganizationSnapshot | null,
  agentId: string
): WorkflowOrganizationNode | null {
  return organization?.nodes.find(node => node.agentId === agentId) || null;
}

function syntheticAgentFor(
  agentId: string,
  organization: WorkflowOrganizationSnapshot | null
): AgentInfo {
  const node = nodeForAgent(organization, agentId);
  const department = node?.departmentId || "meta";
  const role = node?.role || (agentId === "ceo" ? "ceo" : "worker");
  return {
    id: agentId,
    name: node?.name || capitalize(agentId.replace(/[_-]/g, " ")),
    department,
    role,
    managerId: null,
    model: "unknown",
    isActive: true,
    status: "idle",
  };
}

function resolveAgentTitle(
  agent: AgentInfo,
  organization: WorkflowOrganizationSnapshot | null
): string {
  const node = nodeForAgent(organization, agent.id);
  if (node?.title) return node.title;
  if (agent.role === "ceo") return "Mission director";
  if (agent.role === "manager")
    return `${capitalize(agent.department)} manager`;
  return `${capitalize(agent.department)} specialist`;
}

function resolveAgentDepartmentLabel(
  agent: AgentInfo,
  organization: WorkflowOrganizationSnapshot | null
): string {
  const node = nodeForAgent(organization, agent.id);
  if (node?.departmentLabel) return node.departmentLabel;
  return capitalize(agent.department);
}

function inferAgentStageKey(
  agent: AgentInfo,
  workflow: WorkflowInfo,
  organization: WorkflowOrganizationSnapshot | null,
  tasks: WorkflowTaskRecord[]
): string {
  const directStage = AGENT_STATUS_STAGE_MAP[agent.status];
  if (directStage) return directStage;

  const agentTasks = tasks.filter(task => {
    return task.worker_id === agent.id || task.manager_id === agent.id;
  });
  const mappedTaskStage = agentTasks
    .map(task => taskStageKey(task))
    .find(Boolean);
  if (mappedTaskStage) return mappedTaskStage;

  const node = nodeForAgent(organization, agent.id);
  const executionMode = node?.execution?.mode;
  if (executionMode === "orchestrate" || executionMode === "plan") {
    return "planning";
  }
  if (executionMode === "execute") return "execution";
  if (executionMode === "review") return "review";
  if (executionMode === "audit") return "meta_audit";
  if (executionMode === "summary") return "summary";

  const candidates = INTERIOR_ROLE_CANDIDATES[agent.role] || [];
  if (workflow.current_stage && candidates.includes(workflow.current_stage)) {
    return workflow.current_stage;
  }

  return candidates[0] || workflow.current_stage || FALLBACK_STAGES[0].id;
}

function inferAgentProgress(
  agent: AgentInfo,
  tasks: WorkflowTaskRecord[],
  summary: MissionTaskSummary
): number | null {
  const agentTasks = tasks.filter(task => {
    return task.worker_id === agent.id || task.manager_id === agent.id;
  });
  if (agentTasks.length === 0) {
    return agent.role === "ceo" ? summary.progress : null;
  }
  return Math.round(
    average(agentTasks.map(task => taskProgressValue(task))) || 0
  );
}

function latestMessageForAgent(
  agentId: string,
  messages: WorkflowMessageRecord[]
): WorkflowMessageRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.from_agent === agentId || message.to_agent === agentId) {
      return message;
    }
  }
  return null;
}

function buildInteriorStages(
  workflow: WorkflowInfo,
  tasks: WorkflowTaskRecord[],
  stageCatalog: StageInfo[]
): TaskStageRing[] {
  const orderedStages = toStageCatalog(stageCatalog);
  const taskProgressByStage = new Map<string, number[]>();
  for (const task of tasks) {
    const stageKey = taskStageKey(task);
    if (!stageKey) continue;
    const bucket = taskProgressByStage.get(stageKey) || [];
    bucket.push(taskProgressValue(task));
    taskProgressByStage.set(stageKey, bucket);
  }

  const currentIndex = stageOrderIndex(orderedStages, workflow.current_stage);
  const failedStage = safeString(workflow.results?.failed_stage);

  return orderedStages.map((stage, index) => {
    const stageProgress = average(taskProgressByStage.get(stage.id) || []);
    const arcStart = (index / orderedStages.length) * 360;
    const arcEnd = ((index + 1) / orderedStages.length) * 360;
    const midAngle = (arcStart + arcEnd) / 2;
    let status: InteriorStageStatus = "pending";
    let progress = 0;

    if (
      workflow.status === "completed" ||
      workflow.status === "completed_with_errors"
    ) {
      status = "done";
      progress = 100;
    } else if (
      workflow.status === "failed" &&
      (failedStage === stage.id || workflow.current_stage === stage.id)
    ) {
      status = "failed";
      progress = Math.max(20, Math.round(stageProgress || 72));
    } else if (currentIndex > index) {
      status = "done";
      progress = 100;
    } else if (workflow.current_stage === stage.id) {
      status = "running";
      progress = Math.max(18, Math.min(92, Math.round(stageProgress || 52)));
    } else if ((stageProgress || 0) > 0) {
      status = "running";
      progress = Math.max(12, Math.min(88, Math.round(stageProgress || 28)));
    }

    return {
      key: stage.id,
      label: stage.label,
      status,
      progress,
      detail:
        workflow.current_stage === stage.id
          ? "Live stage"
          : status === "done"
            ? "Completed"
            : status === "failed"
              ? "Blocked"
              : "Queued",
      arcStart,
      arcEnd,
      midAngle,
    };
  });
}

function buildInteriorAgents(
  summary: MissionTaskSummary,
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null,
  agents: AgentInfo[],
  organization: WorkflowOrganizationSnapshot | null,
  stageCatalog: StageInfo[]
): TaskInteriorAgent[] {
  const tasks = detail?.tasks || [];
  const messages = detail?.messages || [];
  const involvedAgentIds = new Set<string>();

  for (const task of tasks) {
    involvedAgentIds.add(task.worker_id);
    involvedAgentIds.add(task.manager_id);
  }
  for (const message of messages) {
    involvedAgentIds.add(message.from_agent);
    involvedAgentIds.add(message.to_agent);
  }
  for (const node of organization?.nodes || []) {
    involvedAgentIds.add(node.agentId);
  }
  involvedAgentIds.add("ceo");

  const resolvedAgents = Array.from(involvedAgentIds)
    .filter(Boolean)
    .map(agentId => {
      return (
        agents.find(agent => agent.id === agentId) ||
        syntheticAgentFor(agentId, organization)
      );
    })
    .sort((left, right) => {
      const roleOrder = { ceo: 0, manager: 1, worker: 2 };
      const leftScore = roleOrder[left.role] ?? 3;
      const rightScore = roleOrder[right.role] ?? 3;
      if (leftScore !== rightScore) return leftScore - rightScore;
      if (left.department !== right.department) {
        return left.department.localeCompare(right.department);
      }
      return left.name.localeCompare(right.name);
    });

  return resolvedAgents.map((agent, index) => {
    const stageKey = inferAgentStageKey(agent, workflow, organization, tasks);
    const stageLabel = stageLabelFor(stageCatalog, stageKey) || stageKey;
    const lastMessage = latestMessageForAgent(agent.id, messages);
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      department: resolveAgentDepartmentLabel(agent, organization),
      title: resolveAgentTitle(agent, organization),
      status:
        workflow.status === "failed" && agent.status !== "idle"
          ? "error"
          : AGENT_STATUS_INTERIOR_MAP[agent.status] || "idle",
      stageKey,
      stageLabel,
      progress: inferAgentProgress(agent, tasks, summary),
      currentAction:
        trimText(lastMessage?.content, 120) ||
        (agent.status === "idle"
          ? undefined
          : `Working in ${stageLabelFor(stageCatalog, stageKey) || stageKey}`),
      angle:
        resolvedAgents.length <= 1
          ? 0
          : Math.round((360 / resolvedAgents.length) * index),
    };
  });
}

function timelineLevelForEvent(type: string): TimelineLevel {
  if (type === "workflow_error") return "error";
  if (type === "workflow_complete") return "success";
  if (type === "score_assigned" || type === "task_update") return "info";
  if (type === "stage_change") return "warn";
  return "info";
}

function buildTimeline(
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null,
  stageCatalog: StageInfo[],
  eventLog: WorkflowEventLogItem[],
  agents: AgentInfo[]
): TaskTimelineEvent[] {
  const items: TaskTimelineEvent[] = [];
  const workflowEvents = workflowEventsFor(workflow.id, eventLog);
  const tasks = detail?.tasks || [];
  const messages = detail?.messages || [];

  items.push({
    id: `created:${workflow.id}`,
    type: "workflow_created",
    time: dateValue(workflow.created_at) || Date.now(),
    level: "info",
    title: "Mission created",
    description:
      trimText(workflow.directive, 180) || "Mission directive queued.",
  });

  const startedAt = dateValue(workflow.started_at);
  if (startedAt) {
    items.push({
      id: `started:${workflow.id}`,
      type: "workflow_started",
      time: startedAt,
      level: "info",
      title: "Runtime started",
      description:
        "The runtime began allocating departments, workers, and review loops.",
    });
  }

  for (const event of workflowEvents) {
    const time = dateValue(event.timestamp) || Date.now();
    if (event.type === "stage_change") {
      const stageKey = safeString(event.data.stage) || workflow.current_stage;
      items.push({
        id: `stage:${event.timestamp}:${stageKey}`,
        type: event.type,
        time,
        level: timelineLevelForEvent(event.type),
        title: `Stage entered: ${stageLabelFor(stageCatalog, stageKey) || stageKey || "Unknown"}`,
        description: "The orchestration moved its active focus to a new stage.",
      });
      continue;
    }

    if (event.type === "task_update") {
      const taskId = Number(event.data.taskId);
      const task = tasks.find(item => item.id === taskId);
      const workerId = safeString(event.data.workerId);
      const workerName =
        agents.find(agent => agent.id === workerId)?.name ||
        workerId ||
        "Worker";
      items.push({
        id: `task:${event.timestamp}:${taskId}:${safeString(event.data.status) || "update"}`,
        type: event.type,
        time,
        level: timelineLevelForEvent(event.type),
        title: `Task #${taskId} is ${safeString(event.data.status) || "updated"}`,
        description:
          trimText(task?.description, 160) ||
          `${workerName} pushed a new task state update.`,
        actor: workerName,
      });
      continue;
    }

    if (event.type === "score_assigned") {
      const taskId = Number(event.data.taskId);
      const workerId = safeString(event.data.workerId);
      const workerName =
        agents.find(agent => agent.id === workerId)?.name ||
        workerId ||
        "Worker";
      items.push({
        id: `score:${event.timestamp}:${taskId}`,
        type: event.type,
        time,
        level: timelineLevelForEvent(event.type),
        title: `Review score recorded for task #${taskId}`,
        description: `${workerName} received a score of ${String(event.data.score ?? "n/a")}.`,
        actor: workerName,
      });
      continue;
    }

    if (event.type === "workflow_complete") {
      items.push({
        id: `complete:${event.timestamp}`,
        type: event.type,
        time,
        level: "success",
        title: "Mission completed",
        description:
          safeString(event.data.summary) ||
          "The workflow closed with a final status.",
      });
      continue;
    }

    if (event.type === "workflow_error") {
      items.push({
        id: `error:${event.timestamp}`,
        type: event.type,
        time,
        level: "error",
        title: "Mission failed",
        description:
          safeString(event.data.error) ||
          "The workflow stopped after a runtime error.",
      });
    }
  }

  for (const message of messages.slice(-16)) {
    items.push({
      id: `message:${message.id}`,
      type: "message",
      time: dateValue(message.created_at) || Date.now(),
      level: "info",
      title: `${message.from_agent} -> ${message.to_agent}`,
      description:
        trimText(message.content, 180) ||
        "A coordination message was exchanged.",
      actor: message.from_agent,
    });
  }

  const completedAt = dateValue(workflow.completed_at);
  if (completedAt) {
    items.push({
      id: `completed:${workflow.id}`,
      type: "workflow_closed",
      time: completedAt,
      level:
        workflow.status === "failed"
          ? "error"
          : workflow.status === "completed_with_errors"
            ? "warn"
            : "success",
      title:
        workflow.status === "failed"
          ? "Workflow closed with failure"
          : "Workflow closed",
      description:
        workflow.status === "completed_with_errors"
          ? "The mission completed with warnings that still need follow-up."
          : "The runtime marked the workflow as closed.",
    });
  }

  return items.sort((left, right) => left.time - right.time).slice(-40);
}

function buildArtifacts(
  workflow: WorkflowInfo,
  report: WorkflowReportRecord | null
): TaskArtifact[] {
  const artifacts: TaskArtifact[] = [];
  const generatedAt =
    safeString(report?.generatedAt) || safeString(report?.generated_at);
  const jsonPath = reportPath(report, "json");
  const markdownPath = reportPath(report, "markdown");

  if (
    report ||
    workflow.status === "completed" ||
    workflow.status === "completed_with_errors"
  ) {
    artifacts.push({
      id: `${workflow.id}:workflow-report:json`,
      title: "Workflow report JSON",
      description: generatedAt
        ? `Generated ${generatedAt}`
        : "Structured runtime report for this workflow.",
      kind: "report",
      format: "json",
      workflowId: workflow.id,
      downloadKind: "workflow",
      href: jsonPath || undefined,
      filename: `${workflow.id}-workflow-report.json`,
    });
    artifacts.push({
      id: `${workflow.id}:workflow-report:md`,
      title: "Workflow report Markdown",
      description: "Readable report export with highlights and task summaries.",
      kind: "report",
      format: "md",
      workflowId: workflow.id,
      downloadKind: "workflow",
      href: markdownPath || undefined,
      filename: `${workflow.id}-workflow-report.md`,
    });
  }

  for (const departmentReport of getDepartmentReports(workflow, report)) {
    const managerId =
      safeString(departmentReport.manager_id) ||
      safeString(departmentReport.managerId) ||
      undefined;
    const managerName =
      safeString(departmentReport.manager_name) ||
      safeString(departmentReport.managerName) ||
      managerId ||
      "manager";
    const department = safeString(departmentReport.department) || "department";
    const summary =
      trimText(departmentReport.summary || "", 132) ||
      `${capitalize(department)} submitted a department roll-up.`;
    const jsonReportPath =
      safeString(departmentReport.report_json_path) ||
      safeString(departmentReport.reportJsonPath);
    const markdownReportPath =
      safeString(departmentReport.report_markdown_path) ||
      safeString(departmentReport.reportMarkdownPath);

    artifacts.push({
      id: `${workflow.id}:${managerId || department}:department:json`,
      title: `${capitalize(department)} report JSON`,
      description: summary,
      kind: "department_report",
      managerId,
      format: "json",
      workflowId: workflow.id,
      downloadKind: "department",
      href: jsonReportPath || undefined,
      filename: `${workflow.id}-${department}-department-report.json`,
    });
    artifacts.push({
      id: `${workflow.id}:${managerId || department}:department:md`,
      title: `${capitalize(department)} report Markdown`,
      description: `${summary} Prepared by ${managerName}.`,
      kind: "department_report",
      managerId,
      format: "md",
      workflowId: workflow.id,
      downloadKind: "department",
      href: markdownReportPath || undefined,
      filename: `${workflow.id}-${department}-department-report.md`,
    });
  }

  for (const attachment of getWorkflowAttachments(workflow, report)) {
    artifacts.push({
      id: `${workflow.id}:attachment:${attachment.id}`,
      title: attachment.name,
      description: [
        attachment.mimeType,
        attachment.size > 0 ? `${formatCount(attachment.size)} bytes` : null,
        attachment.excerptStatus === "truncated" ? "excerpt truncated" : null,
      ]
        .filter(Boolean)
        .join(" • "),
      kind: "attachment",
      workflowId: workflow.id,
      downloadKind: "attachment",
      filename: attachment.name,
      content: attachment.content,
      mimeType: attachment.mimeType,
      format: attachment.mimeType.split("/").pop() || "txt",
    });
  }

  return artifacts;
}

function buildDecisionPresets(
  summary: MissionTaskSummary,
  failureReasons: string[]
): TaskDecisionPreset[] {
  const subject = summary.sourceText || summary.title;
  return [
    {
      id: "next-pass",
      label: "Run next pass",
      description: "Continue the mission with a sharper follow-up directive.",
      prompt: `Continue the work started by "${subject}". Keep the strongest progress, close remaining gaps, and produce the next actionable pass.`,
      tone: "primary",
    },
    {
      id: "audit-lens",
      label: "Stress test",
      description:
        "Launch a review-heavy mission focused on risks and blind spots.",
      prompt: `Audit the current mission for "${subject}". Focus on assumptions, weak evidence, missing owners, and unresolved risks.`,
      tone: "secondary",
    },
    {
      id: "stakeholder-brief",
      label: "Package brief",
      description: "Turn the current state into a stakeholder-ready update.",
      prompt: `Create a stakeholder brief for "${subject}". Summarize status, decisions, blockers, next steps, and the most useful artifacts.`,
      tone: "secondary",
    },
    {
      id: "recovery",
      label:
        failureReasons.length > 0 ? "Recover failure" : "Explore alternative",
      description:
        failureReasons.length > 0
          ? "Spin up a recovery path that targets the visible failure reasons."
          : "Generate an alternative direction for the same mission.",
      prompt:
        failureReasons.length > 0
          ? `Recover the blocked mission "${subject}". Address these failure signals first: ${failureReasons.join("; ")}.`
          : `Propose an alternative execution path for "${subject}" with different sequencing, roles, and trade-offs.`,
      tone: "warning",
    },
  ];
}

function buildInstanceInfo(
  summary: MissionTaskSummary,
  workflow: WorkflowInfo,
  organization: WorkflowOrganizationSnapshot | null
): Array<{ label: string; value: string }> {
  const resultRecord = workflowResultRecord(workflow);
  const inputRecord = isRecord(resultRecord.input) ? resultRecord.input : null;
  return [
    { label: "Workflow ID", value: workflow.id },
    {
      label: "Runtime",
      value:
        useAppStore.getState().runtimeMode === "advanced"
          ? "Advanced server runtime"
          : "Browser runtime",
    },
    {
      label: "Departments",
      value:
        summary.departmentLabels.length > 0
          ? summary.departmentLabels.join(", ")
          : "Unassigned",
    },
    {
      label: "Current stage",
      value: summary.currentStageLabel || "Not started",
    },
    {
      label: "Org nodes",
      value: organization ? String(organization.nodes.length) : "n/a",
    },
    {
      label: "Created",
      value: formatShortDate(summary.createdAt),
    },
    {
      label: "Started",
      value: formatShortDate(summary.startedAt),
    },
    {
      label: "Completed",
      value: formatShortDate(summary.completedAt),
    },
    {
      label: "Elapsed",
      value: formatDurationMs(
        summary.startedAt
          ? (summary.completedAt || Date.now()) - summary.startedAt
          : null
      ),
    },
    {
      label: "Input signature",
      value: safeString(inputRecord?.signature) || "n/a",
    },
  ];
}

function buildLogSummary(
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null,
  workflowEvents: WorkflowEventLogItem[]
): Array<{ label: string; value: string }> {
  const tasks = detail?.tasks || [];
  const messages = detail?.messages || [];
  const stageChanges = workflowEvents.filter(
    event => event.type === "stage_change"
  );
  const taskUpdates = workflowEvents.filter(
    event => event.type === "task_update"
  );
  const scoreUpdates = workflowEvents.filter(
    event => event.type === "score_assigned"
  );
  const lastEvent = workflowEvents[workflowEvents.length - 1];
  const revisedTasks = tasks.filter(task => task.version > 1).length;

  return [
    { label: "Event entries", value: formatCount(workflowEvents.length) },
    { label: "Stage hops", value: formatCount(stageChanges.length) },
    { label: "Task updates", value: formatCount(taskUpdates.length) },
    { label: "Review scores", value: formatCount(scoreUpdates.length) },
    { label: "Messages", value: formatCount(messages.length) },
    { label: "Revisions", value: formatCount(revisedTasks) },
    {
      label: "Last signal",
      value: lastEvent
        ? `${lastEvent.type} @ ${formatShortDate(dateValue(lastEvent.timestamp))}`
        : workflow.status === "pending"
          ? "Waiting for first signal"
          : "No live event log yet",
    },
  ];
}

function buildDetailRecord(
  summary: MissionTaskSummary,
  workflow: WorkflowInfo,
  detail: WorkflowDetailRecord | null,
  agents: AgentInfo[],
  stageCatalog: StageInfo[],
  eventLog: WorkflowEventLogItem[]
): MissionTaskDetail {
  const report = normalizeDetailReport(workflow, detail);
  const organization = getOrganizationSnapshot(workflow);
  const workflowEvents = workflowEventsFor(workflow.id, eventLog);
  const failureReasons = buildFailureReasons(
    workflow,
    detail?.tasks || [],
    report
  );

  return {
    ...summary,
    workflow,
    tasks: detail?.tasks || [],
    messages: detail?.messages || [],
    report,
    organization,
    stages: buildInteriorStages(workflow, detail?.tasks || [], stageCatalog),
    agents: buildInteriorAgents(
      summary,
      workflow,
      detail,
      agents,
      organization,
      stageCatalog
    ),
    timeline: buildTimeline(workflow, detail, stageCatalog, eventLog, agents),
    artifacts: buildArtifacts(workflow, report),
    failureReasons,
    decisionPresets: buildDecisionPresets(summary, failureReasons),
    instanceInfo: buildInstanceInfo(summary, workflow, organization),
    logSummary: buildLogSummary(workflow, detail, workflowEvents),
  };
}

async function loadWorkflowDetailRecord(
  workflowId: string,
  runtimeMode: RuntimeMode
): Promise<WorkflowDetailRecord | null> {
  try {
    const payload =
      runtimeMode === "advanced"
        ? await fetch(`/api/workflows/${workflowId}`).then(response => {
            if (!response.ok) {
              throw new Error(`API ${response.status}`);
            }
            return response.json() as Promise<RuntimeWorkflowDetail>;
          })
        : await localRuntime.getWorkflowDetail(workflowId);

    return {
      ...(payload as RuntimeWorkflowDetail),
      workflow: (payload.workflow || null) as WorkflowInfo | null,
      tasks: Array.isArray(payload.tasks)
        ? (payload.tasks as WorkflowTaskRecord[])
        : [],
      messages: Array.isArray(payload.messages)
        ? (payload.messages as WorkflowMessageRecord[])
        : [],
      report: (payload.report || null) as WorkflowReportRecord | null,
    };
  } catch (error) {
    console.warn(
      `[Tasks] Failed to load workflow detail for ${workflowId}:`,
      error
    );
    const workflowState = useWorkflowStore.getState();
    if (
      workflowState.currentWorkflowId === workflowId &&
      workflowState.currentWorkflow
    ) {
      return {
        workflow: workflowState.currentWorkflow,
        tasks: workflowState.tasks as WorkflowTaskRecord[],
        messages: workflowState.messages as WorkflowMessageRecord[],
        report:
          (workflowState.currentWorkflow.results
            ?.final_report as WorkflowReportRecord | null) || null,
      };
    }
    return null;
  }
}

function queueTasksRefresh(options?: { preferredTaskId?: string | null }) {
  queuedRefreshOptions = {
    preferredTaskId:
      options?.preferredTaskId ?? queuedRefreshOptions?.preferredTaskId ?? null,
  };
  if (typeof window === "undefined") return;
  if (scheduledRefreshTimer !== null) {
    window.clearTimeout(scheduledRefreshTimer);
  }
  scheduledRefreshTimer = window.setTimeout(() => {
    scheduledRefreshTimer = null;
    const nextOptions = queuedRefreshOptions;
    queuedRefreshOptions = null;
    void useTasksStore.getState().refresh(nextOptions || undefined);
  }, 140);
}

function startTaskStoreWatchers() {
  if (taskStoreWatchersStarted) return;
  taskStoreWatchersStarted = true;

  useWorkflowStore.subscribe((state, previousState) => {
    if (
      state.eventLog !== previousState.eventLog ||
      state.connected !== previousState.connected
    ) {
      queueTasksRefresh();
    }
  });

  useAppStore.subscribe((state, previousState) => {
    if (state.runtimeMode !== previousState.runtimeMode) {
      queueTasksRefresh();
    }
  });
}

async function hydrateTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
): Promise<void> {
  startTaskStoreWatchers();

  const workflowStore = useWorkflowStore.getState();
  if (!workflowStore.connected) {
    await workflowStore.initSocket();
  }

  await Promise.all([
    workflowStore.fetchStages(),
    workflowStore.fetchAgents(),
    workflowStore.fetchWorkflows(),
  ]);

  const latestWorkflowState = useWorkflowStore.getState();
  const runtimeMode = useAppStore.getState().runtimeMode;
  const stageCatalog = toStageCatalog(latestWorkflowState.stages);
  const workflows = [...latestWorkflowState.workflows].sort((left, right) => {
    return (
      (dateValue(right.created_at) || 0) - (dateValue(left.created_at) || 0)
    );
  });

  const detailEntries = await Promise.all(
    workflows.map(async workflow => {
      return [
        workflow.id,
        await loadWorkflowDetailRecord(workflow.id, runtimeMode),
      ] as const;
    })
  );
  const details = Object.fromEntries(detailEntries);

  const summaries = workflows
    .map(workflow =>
      buildSummaryRecord(
        workflow,
        details[workflow.id] || null,
        latestWorkflowState.agents,
        stageCatalog,
        latestWorkflowState.eventLog as WorkflowEventLogItem[]
      )
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  const detailsById = Object.fromEntries(
    summaries.map(summary => {
      const workflow = workflows.find(item => item.id === summary.id);
      if (!workflow) {
        return [summary.id, undefined];
      }
      return [
        summary.id,
        buildDetailRecord(
          summary,
          workflow,
          details[summary.id] || null,
          latestWorkflowState.agents,
          stageCatalog,
          latestWorkflowState.eventLog as WorkflowEventLogItem[]
        ),
      ];
    })
  ) as Record<string, MissionTaskDetail>;

  const selectedTaskId = (() => {
    const preferredTaskId =
      options?.preferredTaskId ?? get().selectedTaskId ?? null;
    if (
      preferredTaskId &&
      summaries.some(summary => summary.id === preferredTaskId)
    ) {
      return preferredTaskId;
    }
    return pickFallbackTaskId(summaries);
  })();

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId,
  });
}

export const useTasksStore = create<TasksStoreState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,
  selectedTaskId: null,
  tasks: [],
  detailsById: {},
  decisionNotes: {},
  lastDecisionLaunch: null,

  ensureReady: async () => {
    if (get().ready || inFlightRefresh) {
      if (inFlightRefresh) {
        await inFlightRefresh;
      }
      return;
    }

    set({ loading: true, error: null });
    inFlightRefresh = hydrateTaskData(set, get);
    try {
      await inFlightRefresh;
    } catch (error) {
      console.error("[Tasks] Failed to initialize tasks store:", error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load tasks.",
      });
    } finally {
      inFlightRefresh = null;
      if (queuedRefreshOptions) {
        const nextOptions = queuedRefreshOptions;
        queuedRefreshOptions = null;
        void get().refresh(nextOptions);
      }
    }
  },

  refresh: async options => {
    if (inFlightRefresh) {
      queuedRefreshOptions = {
        preferredTaskId:
          options?.preferredTaskId ??
          queuedRefreshOptions?.preferredTaskId ??
          null,
      };
      await inFlightRefresh;
      return;
    }

    set(state => ({
      loading: !state.ready && state.tasks.length === 0,
      error: null,
    }));

    inFlightRefresh = hydrateTaskData(set, get, options);
    try {
      await inFlightRefresh;
    } catch (error) {
      console.error("[Tasks] Failed to refresh tasks store:", error);
      set({
        loading: false,
        error:
          error instanceof Error ? error.message : "Failed to refresh tasks.",
      });
    } finally {
      inFlightRefresh = null;
      if (queuedRefreshOptions) {
        const nextOptions = queuedRefreshOptions;
        queuedRefreshOptions = null;
        void get().refresh(nextOptions);
      }
    }
  },

  selectTask: taskId => {
    set({ selectedTaskId: taskId });
  },

  setDecisionNote: (taskId, note) => {
    set(state => ({
      decisionNotes: {
        ...state.decisionNotes,
        [taskId]: note,
      },
    }));
  },

  launchDecision: async (taskId, presetId) => {
    await get().ensureReady();
    const detail = get().detailsById[taskId];
    const preset = detail?.decisionPresets.find(item => item.id === presetId);
    if (!detail || !preset) return null;

    const note = get().decisionNotes[taskId]?.trim();
    const directive = [
      preset.prompt,
      `Reference workflow: ${detail.workflow.id}`,
      `Current summary: ${detail.summary}`,
      note ? `Additional steering: ${note}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const spawnedWorkflowId = await useWorkflowStore
      .getState()
      .submitDirective({
        directive,
        attachments: [],
      });

    set({
      lastDecisionLaunch: {
        sourceTaskId: taskId,
        sourceTaskTitle: detail.title,
        spawnedWorkflowId,
        at: Date.now(),
      },
    });

    await get().refresh({
      preferredTaskId: spawnedWorkflowId || taskId,
    });

    return spawnedWorkflowId;
  },

  clearDecisionLaunch: () => {
    set({ lastDecisionLaunch: null });
  },
}));
