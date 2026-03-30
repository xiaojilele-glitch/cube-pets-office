import { create } from "zustand";

import type {
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "@shared/organization-schema";
import {
  MISSION_CORE_STAGE_BLUEPRINT,
  type MissionArtifact,
  type MissionDecision,
  type MissionEvent,
  type MissionRecord,
  type MissionStage,
} from "@shared/mission/contracts";
import { MISSION_SOCKET_EVENT, type MissionSocketPayload } from "@shared/mission/socket";
import {
  normalizeWorkflowAttachments,
  type WorkflowInputAttachment,
} from "@shared/workflow-input";
import { io, type Socket } from "socket.io-client";

import {
  createMission as createMissionRequest,
  getMission,
  listMissionEvents,
  listMissions,
  submitMissionDecision as submitMissionDecisionRequest,
} from "./mission-client";
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
  kind: "report" | "department_report" | "attachment" | "file" | "url" | "log";
  managerId?: string;
  format?: string;
  filename?: string;
  workflowId?: string;
  downloadKind?: "workflow" | "department" | "attachment" | "external";
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
  action: "workflow" | "mission";
  optionId?: string;
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
  decisionPrompt: string | null;
  decisionPlaceholder: string | null;
  decisionAllowsFreeText: boolean;
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
  createMission: (input: {
    title?: string;
    sourceText?: string;
    kind?: string;
    topicId?: string;
  }) => Promise<string | null>;
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
let missionSocket: Socket | null = null;

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
      action: "workflow",
    },
    {
      id: "audit-lens",
      label: "Stress test",
      description:
        "Launch a review-heavy mission focused on risks and blind spots.",
      prompt: `Audit the current mission for "${subject}". Focus on assumptions, weak evidence, missing owners, and unresolved risks.`,
      tone: "secondary",
      action: "workflow",
    },
    {
      id: "stakeholder-brief",
      label: "Package brief",
      description: "Turn the current state into a stakeholder-ready update.",
      prompt: `Create a stakeholder brief for "${subject}". Summarize status, decisions, blockers, next steps, and the most useful artifacts.`,
      tone: "secondary",
      action: "workflow",
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
      action: "workflow",
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
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    instanceInfo: buildInstanceInfo(summary, workflow, organization),
    logSummary: buildLogSummary(workflow, detail, workflowEvents),
  };
}

type MissionWorkflowSupplement = {
  workflow: WorkflowInfo | null;
  detail: WorkflowDetailRecord | null;
};

function normalizeSearchText(value: string | null | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function clampPercentage(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function workflowStatusFromMission(
  status: MissionTaskStatus
): WorkflowInfo["status"] {
  if (status === "queued") return "pending";
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function missionStageCatalog(mission: MissionRecord): StageInfo[] {
  const stages =
    mission.stages.length > 0
      ? mission.stages
      : MISSION_CORE_STAGE_BLUEPRINT.map((stage, index) => ({
          key: stage.key,
          label: stage.label,
          status:
            mission.currentStageKey === stage.key && mission.status !== "queued"
              ? ("running" as const)
              : ("pending" as const),
        }));

  return stages.map((stage, index) => ({
    id: stage.key,
    order: index + 1,
    label: stage.label,
  }));
}

function stageKeyFromMission(mission: MissionRecord): string | null {
  return (
    mission.currentStageKey ||
    mission.stages.find(stage => stage.status === "running")?.key ||
    mission.stages.find(stage => stage.status === "failed")?.key ||
    mission.stages.find(stage => stage.status === "done")?.key ||
    MISSION_CORE_STAGE_BLUEPRINT[0]?.key ||
    null
  );
}

function stageLabelFromMission(
  mission: MissionRecord,
  stageKey?: string | null
): string | null {
  if (!stageKey) return null;
  return (
    mission.stages.find(stage => stage.key === stageKey)?.label ||
    MISSION_CORE_STAGE_BLUEPRINT.find(stage => stage.key === stageKey)?.label ||
    stageKey
  );
}

function missionStartedAt(mission: MissionRecord): number | null {
  const stageStartedAt = mission.stages
    .flatMap(stage => [stage.startedAt, stage.completedAt])
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0];

  if (typeof stageStartedAt === "number") {
    return stageStartedAt;
  }

  return mission.status === "queued" ? null : mission.createdAt;
}

function syntheticWorkflowFromMission(mission: MissionRecord): WorkflowInfo {
  return {
    id: mission.id,
    directive: mission.sourceText || mission.title,
    status: workflowStatusFromMission(mission.status),
    current_stage: stageKeyFromMission(mission),
    departments_involved: mission.kind ? [mission.kind] : [],
    started_at: missionStartedAt(mission)
      ? new Date(missionStartedAt(mission) || mission.createdAt).toISOString()
      : null,
    completed_at: mission.completedAt
      ? new Date(mission.completedAt).toISOString()
      : null,
    results: {
      missionId: mission.id,
      summary: mission.summary,
      waitingFor: mission.waitingFor,
      executor: mission.executor,
      instance: mission.instance,
      artifacts: mission.artifacts,
    },
    created_at: new Date(mission.createdAt).toISOString(),
  };
}

function findSupplementalWorkflow(
  mission: MissionRecord,
  workflows: WorkflowInfo[]
): WorkflowInfo | null {
  const missionText = normalizeSearchText(mission.sourceText || mission.title);

  return (
    workflows.find(workflow => workflow.id === mission.id) ||
    workflows.find(
      workflow => safeString(workflow.results?.missionId) === mission.id
    ) ||
    workflows.find(
      workflow => safeString(workflow.results?.taskId) === mission.id
    ) ||
    workflows.find(
      workflow => normalizeSearchText(workflow.directive) === missionText
    ) ||
    null
  );
}

function missionFailureReasons(
  mission: MissionRecord,
  events: MissionEvent[]
): string[] {
  const reasons = new Set<string>();

  if (mission.status === "failed" && mission.summary) {
    reasons.add(mission.summary);
  }

  for (const stage of mission.stages) {
    if (stage.status === "failed" && stage.detail) {
      reasons.add(stage.detail);
    }
  }

  for (const event of events) {
    if (event.level === "error" || event.type === "failed") {
      reasons.add(event.message);
    }
  }

  return Array.from(reasons).filter(Boolean);
}

function missionSummaryText(
  mission: MissionRecord,
  events: MissionEvent[],
  waitingFor: string | null
): string {
  if (trimText(mission.summary, 180)) {
    return trimText(mission.summary, 180);
  }

  const latestEventMessage = trimText(events[events.length - 1]?.message, 180);
  if (latestEventMessage) {
    return latestEventMessage;
  }

  if (waitingFor) {
    return waitingFor;
  }

  if (mission.status === "queued") {
    return "Mission created and waiting for execution signals.";
  }

  if (mission.status === "done") {
    return "Mission completed and is ready for review.";
  }

  if (mission.status === "failed") {
    return "Mission stopped before the execution chain could complete.";
  }

  return "Mission is progressing through the execution pipeline.";
}

function timelineLevelForMissionEvent(event: MissionEvent): TimelineLevel {
  if (event.type === "done") return "success";
  if (event.type === "failed" || event.level === "error") return "error";
  if (event.type === "waiting" || event.level === "warn") return "warn";
  return "info";
}

function titleForMissionEvent(
  mission: MissionRecord,
  event: MissionEvent
): string {
  const stageLabel = stageLabelFromMission(mission, event.stageKey);

  switch (event.type) {
    case "created":
      return "Mission created";
    case "progress":
      return stageLabel ? `Stage active: ${stageLabel}` : "Mission progressed";
    case "waiting":
      return stageLabel ? `Waiting in ${stageLabel}` : "Awaiting decision";
    case "done":
      return "Mission completed";
    case "failed":
      return "Mission failed";
    case "log":
    default:
      return stageLabel ? `${stageLabel} signal` : "Mission log";
  }
}

function buildMissionTimeline(
  mission: MissionRecord,
  events: MissionEvent[]
): TaskTimelineEvent[] {
  const items: TaskTimelineEvent[] = events.map((event, index) => ({
    id: `${mission.id}:${event.time}:${event.type}:${index}`,
    type: event.type,
    time: event.time,
    level: timelineLevelForMissionEvent(event),
    title: titleForMissionEvent(mission, event),
    description: event.message,
    actor: event.source ? capitalize(event.source.replace(/-/g, " ")) : undefined,
  }));

  if (!items.some(item => item.type === "created")) {
    items.unshift({
      id: `${mission.id}:created`,
      type: "created",
      time: mission.createdAt,
      level: "info",
      title: "Mission created",
      description: trimText(mission.sourceText || mission.title, 180) || "Mission created.",
    });
  }

  return items.sort((left, right) => left.time - right.time).slice(-40);
}

function buildMissionInteriorStages(mission: MissionRecord): TaskStageRing[] {
  const orderedStages: MissionStage[] =
    mission.stages.length > 0
      ? mission.stages
      : MISSION_CORE_STAGE_BLUEPRINT.map(stage => ({
          key: stage.key,
          label: stage.label,
          status:
            mission.currentStageKey === stage.key && mission.status !== "queued"
              ? ("running" as const)
              : ("pending" as const),
          detail: undefined,
        }));

  return orderedStages.map((stage, index) => {
    const arcStart = (index / orderedStages.length) * 360;
    const arcEnd = ((index + 1) / orderedStages.length) * 360;
    const midAngle = (arcStart + arcEnd) / 2;
    const segmentStart = (index / orderedStages.length) * 100;
    const segmentEnd = ((index + 1) / orderedStages.length) * 100;
    const segmentProgress =
      segmentEnd <= segmentStart
        ? 0
        : ((clampPercentage(mission.progress) - segmentStart) /
            (segmentEnd - segmentStart)) *
          100;

    let progress = 0;
    if (stage.status === "done") {
      progress = 100;
    } else if (stage.status === "running") {
      progress = Math.max(18, Math.min(96, Math.round(segmentProgress)));
    } else if (stage.status === "failed") {
      progress = Math.max(24, Math.min(92, Math.round(segmentProgress || 42)));
    }

    return {
      key: stage.key,
      label: stage.label,
      status: stage.status,
      progress,
      detail:
        stage.detail ||
        (stage.status === "done"
          ? "Completed"
          : stage.status === "running"
            ? "Live stage"
            : stage.status === "failed"
              ? "Blocked"
              : "Queued"),
      arcStart,
      arcEnd,
      midAngle,
    };
  });
}

function inferMissionCoreAgentStatus(
  status: MissionTaskStatus
): InteriorAgentStatus {
  if (status === "running") return "working";
  if (status === "waiting") return "thinking";
  if (status === "done") return "done";
  if (status === "failed") return "error";
  return "idle";
}

function inferExecutorAgentStatus(
  mission: MissionRecord
): InteriorAgentStatus {
  const executorStatus = normalizeSearchText(mission.executor?.status);

  if (mission.status === "failed" || /fail|error/.test(executorStatus)) {
    return "error";
  }
  if (mission.status === "done" || /done|complete|success|finished/.test(executorStatus)) {
    return "done";
  }
  if (/run|exec|dispatch/.test(executorStatus)) {
    return "working";
  }
  if (/queue|wait|pending|provision/.test(executorStatus)) {
    return "thinking";
  }
  return mission.status === "queued" ? "idle" : "working";
}

function withAgentAngles(
  agents: Omit<TaskInteriorAgent, "angle">[]
): TaskInteriorAgent[] {
  return agents.map((agent, index) => ({
    ...agent,
    angle: agents.length <= 1 ? 0 : Math.round((360 / agents.length) * index),
  }));
}

function buildMissionInteriorAgents(
  summary: MissionTaskSummary,
  mission: MissionRecord
): TaskInteriorAgent[] {
  const currentStageKey = summary.currentStageKey || MISSION_CORE_STAGE_BLUEPRINT[0]?.key || "receive";
  const currentStageLabel =
    summary.currentStageLabel || stageLabelFromMission(mission, currentStageKey) || currentStageKey;
  const agents: Array<Omit<TaskInteriorAgent, "angle">> = [
    {
      id: `${mission.id}:mission-core`,
      name: "Mission Core",
      role: "ceo",
      department: "Mission",
      title: "Mission controller",
      status: inferMissionCoreAgentStatus(summary.status),
      stageKey: currentStageKey,
      stageLabel: currentStageLabel,
      progress: summary.progress,
      currentAction: trimText(
        mission.waitingFor || mission.summary || mission.events[mission.events.length - 1]?.message,
        120
      ) || undefined,
    },
  ];

  if (mission.executor || mission.instance) {
    agents.push({
      id: `${mission.id}:executor`,
      name: mission.executor?.name || "Executor",
      role: "worker",
      department: "Execution",
      title:
        mission.instance?.id ||
        mission.executor?.jobId ||
        "Execution runtime",
      status: inferExecutorAgentStatus(mission),
      stageKey:
        currentStageKey === "receive" || currentStageKey === "understand"
          ? "provision"
          : currentStageKey,
      stageLabel:
        stageLabelFromMission(
          mission,
          currentStageKey === "receive" || currentStageKey === "understand"
            ? "provision"
            : currentStageKey
        ) || "Execution runtime",
      progress:
        mission.status === "queued" ? 0 : clampPercentage(mission.progress, 12),
      currentAction: trimText(
        mission.executor?.status ||
          mission.instance?.workspaceRoot ||
          mission.executor?.jobId,
        120
      ) || undefined,
    });
  }

  if (mission.status === "waiting") {
    agents.push({
      id: `${mission.id}:decision-gate`,
      name: "Decision Gate",
      role: "manager",
      department: "Control",
      title: "Waiting for confirmation",
      status: "thinking",
      stageKey: currentStageKey,
      stageLabel: currentStageLabel,
      progress: null,
      currentAction: trimText(
        mission.decision?.prompt || mission.waitingFor,
        120
      ) || undefined,
    });
  }

  return withAgentAngles(agents);
}

function missionActiveAgentCount(mission: MissionRecord): number {
  return buildMissionInteriorAgents(
    {
      id: mission.id,
      title: mission.title,
      kind: mission.kind,
      sourceText: mission.sourceText || mission.title,
      status: mission.status,
      workflowStatus: workflowStatusFromMission(mission.status),
      progress: clampPercentage(mission.progress),
      currentStageKey: stageKeyFromMission(mission),
      currentStageLabel: stageLabelFromMission(mission, stageKeyFromMission(mission)),
      summary: "",
      waitingFor: mission.waitingFor || null,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      startedAt: missionStartedAt(mission),
      completedAt: mission.completedAt || null,
      departmentLabels: [],
      taskCount: 0,
      completedTaskCount: 0,
      messageCount: 0,
      activeAgentCount: 0,
      attachmentCount: mission.artifacts?.length || 0,
      issueCount: 0,
      hasWarnings: false,
      lastSignal: null,
    },
    mission
  ).filter(agent => agent.status === "working" || agent.status === "thinking")
    .length;
}

function extensionFromValue(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.split(/[?#]/)[0];
  const index = normalized.lastIndexOf(".");
  if (index === -1 || index === normalized.length - 1) {
    return null;
  }
  return normalized.slice(index + 1).toLowerCase();
}

function buildMissionArtifacts(mission: MissionRecord): TaskArtifact[] {
  return (mission.artifacts || []).map((artifact: MissionArtifact, index) => {
    const href = artifact.url || undefined;
    const format =
      extensionFromValue(artifact.name) ||
      extensionFromValue(artifact.path) ||
      extensionFromValue(artifact.url) ||
      undefined;

    return {
      id: `${mission.id}:mission-artifact:${index}`,
      title: artifact.name,
      description:
        artifact.description ||
        artifact.path ||
        artifact.url ||
        `${capitalize(artifact.kind)} artifact`,
      kind: artifact.kind,
      format,
      filename: artifact.name,
      downloadKind: href ? "external" : undefined,
      href,
    };
  });
}

function dedupeArtifacts(artifacts: TaskArtifact[]): TaskArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter(artifact => {
    const key = [
      artifact.kind,
      artifact.title,
      artifact.format || "",
      artifact.href || "",
      artifact.filename || "",
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildMissionDecisionPresets(
  decision: MissionDecision | undefined
): TaskDecisionPreset[] {
  if (!decision) {
    return [];
  }

  const options = Array.isArray(decision.options) ? decision.options : [];
  if (options.length === 0 && decision.allowFreeText) {
    return [
      {
        id: "mission-free-text",
        label: "Submit note",
        description: "Resume the mission with a decision note.",
        prompt: decision.prompt,
        tone: "primary",
        action: "mission",
      },
    ];
  }

  return options.map((option, index) => ({
    id: `mission:${option.id}`,
    label: option.label,
    description:
      option.description ||
      (decision.allowFreeText
        ? "Submit this option with an optional note."
        : "Submit this option and resume the mission."),
    prompt: decision.prompt,
    tone:
      index === 0
        ? "primary"
        : /abort|stop|reject|fail|report/i.test(option.label)
          ? "warning"
          : "secondary",
    action: "mission",
    optionId: option.id,
  }));
}

function buildMissionInstanceInfo(
  summary: MissionTaskSummary,
  mission: MissionRecord
): Array<{ label: string; value: string }> {
  return [
    { label: "Mission ID", value: mission.id },
    { label: "Runtime", value: "Advanced server runtime" },
    { label: "Current stage", value: summary.currentStageLabel || "Not started" },
    { label: "Executor", value: mission.executor?.name || "n/a" },
    { label: "Executor job", value: mission.executor?.jobId || "n/a" },
    { label: "Executor request", value: mission.executor?.requestId || "n/a" },
    { label: "Instance", value: mission.instance?.id || "n/a" },
    { label: "Workspace", value: mission.instance?.workspaceRoot || "n/a" },
    { label: "Created", value: formatShortDate(summary.createdAt) },
    { label: "Completed", value: formatShortDate(summary.completedAt) },
  ];
}

function buildMissionLogSummary(
  mission: MissionRecord,
  events: MissionEvent[]
): Array<{ label: string; value: string }> {
  const lastEvent = events[events.length - 1];

  return [
    { label: "Event entries", value: formatCount(events.length) },
    {
      label: "Progress signals",
      value: formatCount(events.filter(event => event.type === "progress").length),
    },
    {
      label: "Waiting signals",
      value: formatCount(events.filter(event => event.type === "waiting").length),
    },
    {
      label: "Log entries",
      value: formatCount(events.filter(event => event.type === "log").length),
    },
    {
      label: "Executor status",
      value: mission.executor?.status || "n/a",
    },
    {
      label: "Last signal",
      value: lastEvent
        ? `${lastEvent.type} @ ${formatShortDate(lastEvent.time)}`
        : "No live mission event yet",
    },
  ];
}

function buildMissionSummaryRecord(
  mission: MissionRecord,
  supplement: MissionWorkflowSupplement,
  agents: AgentInfo[],
  workflowStageCatalog: StageInfo[],
  events: MissionEvent[]
): MissionTaskSummary {
  const workflow = supplement.workflow || syntheticWorkflowFromMission(mission);
  const detail = supplement.detail;
  const organization = supplement.workflow
    ? getOrganizationSnapshot(supplement.workflow)
    : null;
  const report =
    supplement.workflow && supplement.detail
      ? normalizeDetailReport(supplement.workflow, supplement.detail)
      : null;
  const tasks = detail?.tasks || [];
  const messages = detail?.messages || [];
  const currentStageKey = stageKeyFromMission(mission);
  const currentStageLabel = stageLabelFromMission(mission, currentStageKey);
  const waitingFor =
    mission.waitingFor ||
    (mission.status === "waiting"
      ? mission.decision?.prompt || "Awaiting decision"
      : null);
  const failureReasons = [
    ...missionFailureReasons(mission, events),
    ...buildFailureReasons(workflow, tasks, report),
  ].filter(Boolean);
  const attachmentCount = Math.max(
    mission.artifacts?.length || 0,
    supplement.workflow ? getAttachmentCount(workflow, report) : 0
  );
  const taskCount = tasks.length;
  const completedTaskCount = tasks.filter(
    task => task.status === "passed" || task.status === "verified"
  ).length;
  const updatedAt = Math.max(
    mission.updatedAt,
    ...events.map(event => event.time),
    detail ? getWorkflowUpdatedAt(workflow, detail, []) : 0
  );
  const runtimeAgents = missionActiveAgentCount(mission);

  return {
    id: mission.id,
    title: trimText(mission.title, 76) || "Untitled mission",
    kind: mission.kind || inferTaskKind(workflow, organization),
    sourceText: mission.sourceText || workflow.directive || mission.title,
    status: mission.status,
    workflowStatus: workflow.status,
    progress: clampPercentage(mission.progress),
    currentStageKey,
    currentStageLabel,
    summary: missionSummaryText(mission, events, waitingFor),
    waitingFor,
    createdAt: mission.createdAt,
    updatedAt,
    startedAt: missionStartedAt(mission),
    completedAt: mission.completedAt || null,
    departmentLabels:
      organization?.departments.map(item => item.label) ||
      (mission.kind ? [capitalize(mission.kind.replace(/[_-]/g, " "))] : []),
    taskCount,
    completedTaskCount,
    messageCount: messages.length,
    activeAgentCount:
      taskCount > 0 ? getActiveAgentCount(organization, agents) : runtimeAgents,
    attachmentCount,
    issueCount: failureReasons.length,
    hasWarnings:
      failureReasons.length > 0 ||
      events.some(event => event.level === "warn") ||
      workflow.status === "completed_with_errors",
    lastSignal:
      trimText(events[events.length - 1]?.message, 96) ||
      trimText(messages[messages.length - 1]?.content, 96) ||
      stageLabelFor(workflowStageCatalog, workflow.current_stage) ||
      null,
  };
}

function buildMissionDetailRecord(
  summary: MissionTaskSummary,
  mission: MissionRecord,
  supplement: MissionWorkflowSupplement,
  agents: AgentInfo[],
  workflowStageCatalog: StageInfo[],
  events: MissionEvent[]
): MissionTaskDetail {
  const workflow = supplement.workflow || syntheticWorkflowFromMission(mission);
  const detail = supplement.detail;
  const report =
    supplement.workflow && detail
      ? normalizeDetailReport(supplement.workflow, detail)
      : null;
  const organization = supplement.workflow
    ? getOrganizationSnapshot(supplement.workflow)
    : null;
  const failureReasons = Array.from(
    new Set([
      ...missionFailureReasons(mission, events),
      ...buildFailureReasons(workflow, detail?.tasks || [], report),
    ])
  );
  const missionArtifacts = buildMissionArtifacts(mission);
  const supplementalArtifacts =
    supplement.workflow && report ? buildArtifacts(workflow, report) : [];

  return {
    ...summary,
    workflow,
    tasks: detail?.tasks || [],
    messages: detail?.messages || [],
    report,
    organization,
    stages: buildMissionInteriorStages(mission),
    agents:
      detail?.tasks?.length || detail?.messages?.length
        ? buildInteriorAgents(
            summary,
            workflow,
            detail,
            agents,
            organization,
            workflowStageCatalog
          )
        : buildMissionInteriorAgents(summary, mission),
    timeline: buildMissionTimeline(mission, events),
    artifacts: dedupeArtifacts([...missionArtifacts, ...supplementalArtifacts]),
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildMissionLogSummary(mission, events),
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

function stopMissionSocket() {
  if (!missionSocket) return;
  missionSocket.off(MISSION_SOCKET_EVENT);
  missionSocket.disconnect();
  missionSocket = null;
}

async function loadMissionSupplementMap(
  missions: MissionRecord[],
  workflows: WorkflowInfo[],
  runtimeMode: RuntimeMode
): Promise<Record<string, MissionWorkflowSupplement>> {
  const workflowByMissionId = new Map<string, WorkflowInfo | null>();
  const detailPromises = new Map<string, Promise<WorkflowDetailRecord | null>>();

  for (const mission of missions) {
    const workflow = findSupplementalWorkflow(mission, workflows);
    workflowByMissionId.set(mission.id, workflow);
    if (workflow && !detailPromises.has(workflow.id)) {
      detailPromises.set(
        workflow.id,
        loadWorkflowDetailRecord(workflow.id, runtimeMode)
      );
    }
  }

  const detailsByWorkflowId = Object.fromEntries(
    await Promise.all(
      Array.from(detailPromises.entries()).map(async ([workflowId, promise]) => {
        return [workflowId, await promise] as const;
      })
    )
  ) as Record<string, WorkflowDetailRecord | null>;

  return Object.fromEntries(
    missions.map(mission => {
      const workflow = workflowByMissionId.get(mission.id) || null;
      return [
        mission.id,
        {
          workflow,
          detail: workflow ? detailsByWorkflowId[workflow.id] || null : null,
        },
      ] as const;
    })
  );
}

function resolveSelectedTaskId(
  summaries: MissionTaskSummary[],
  currentSelectedTaskId: string | null,
  preferredTaskId?: string | null
): string | null {
  const nextSelectedTaskId = preferredTaskId ?? currentSelectedTaskId ?? null;
  if (
    nextSelectedTaskId &&
    summaries.some(summary => summary.id === nextSelectedTaskId)
  ) {
    return nextSelectedTaskId;
  }
  return pickFallbackTaskId(summaries);
}

async function patchMissionRecordInStore(
  missionId: string,
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState
): Promise<void> {
  if (useAppStore.getState().runtimeMode !== "advanced") {
    return;
  }

  const workflowState = useWorkflowStore.getState();
  if (!workflowState.connected) {
    await workflowState.initSocket();
  }

  await Promise.all([
    workflowState.fetchStages(),
    workflowState.fetchAgents(),
    workflowState.fetchWorkflows(),
  ]);

  const latestWorkflowState = useWorkflowStore.getState();
  const missionResponse = await getMission(missionId);
  const eventsResponse = await listMissionEvents(missionId, 60);
  const supplement = (
    await loadMissionSupplementMap(
      [missionResponse.task],
      latestWorkflowState.workflows,
      "advanced"
    )
  )[missionId];
  const stageCatalog = toStageCatalog(latestWorkflowState.stages);
  const summary = buildMissionSummaryRecord(
    missionResponse.task,
    supplement,
    latestWorkflowState.agents,
    stageCatalog,
    eventsResponse.events
  );
  const detail = buildMissionDetailRecord(
    summary,
    missionResponse.task,
    supplement,
    latestWorkflowState.agents,
    stageCatalog,
    eventsResponse.events
  );

  set(state => {
    const nextTasks = [...state.tasks.filter(task => task.id !== missionId), summary]
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      ready: true,
      loading: false,
      error: null,
      tasks: nextTasks,
      detailsById: {
        ...state.detailsById,
        [missionId]: detail,
      },
      selectedTaskId: resolveSelectedTaskId(
        nextTasks,
        state.selectedTaskId,
        state.selectedTaskId === missionId ? missionId : undefined
      ),
    };
  });
}

function ensureMissionSocket(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState
) {
  if (typeof window === "undefined") {
    return;
  }

  if (useAppStore.getState().runtimeMode !== "advanced") {
    stopMissionSocket();
    return;
  }

  if (missionSocket) {
    return;
  }

  missionSocket = io(window.location.origin, {
    transports: ["websocket", "polling"],
  });

  missionSocket.on(MISSION_SOCKET_EVENT, (payload: MissionSocketPayload) => {
    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      return;
    }

    if (payload.type === "mission.snapshot") {
      queueTasksRefresh({
        preferredTaskId: get().selectedTaskId,
      });
      return;
    }

    if (!("missionId" in payload) || !payload.missionId) {
      return;
    }

    void patchMissionRecordInStore(payload.missionId, set, get).catch(error => {
      console.warn(
        `[Tasks] Failed to patch mission ${payload.missionId} from socket event:`,
        error
      );
      queueTasksRefresh({
        preferredTaskId: payload.missionId,
      });
    });
  });

  missionSocket.on("disconnect", () => {
    if (useAppStore.getState().runtimeMode !== "advanced") {
      stopMissionSocket();
    }
  });
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
      if (state.runtimeMode !== "advanced") {
        stopMissionSocket();
      }
      queueTasksRefresh();
    }
  });
}

async function hydrateWorkflowTaskData(
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

async function hydrateMissionTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
): Promise<void> {
  const workflowStore = useWorkflowStore.getState();
  if (!workflowStore.connected) {
    await workflowStore.initSocket();
  }

  ensureMissionSocket(set, get);

  await Promise.all([
    workflowStore.fetchStages(),
    workflowStore.fetchAgents(),
    workflowStore.fetchWorkflows(),
  ]);

  const latestWorkflowState = useWorkflowStore.getState();
  const missionsResponse = await listMissions(200);
  const missions = [...missionsResponse.tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
  const supplements = await loadMissionSupplementMap(
    missions,
    latestWorkflowState.workflows,
    "advanced"
  );

  const eventsEntries = await Promise.all(
    missions.map(async mission => {
      try {
        const response = await listMissionEvents(mission.id, 60);
        return [mission.id, response.events] as const;
      } catch (error) {
        console.warn(
          `[Tasks] Failed to load mission events for ${mission.id}:`,
          error
        );
        return [mission.id, mission.events || []] as const;
      }
    })
  );
  const missionEvents = Object.fromEntries(eventsEntries) as Record<
    string,
    MissionEvent[]
  >;

  const stageCatalog = toStageCatalog(latestWorkflowState.stages);
  const summaries = missions
    .map(mission =>
      buildMissionSummaryRecord(
        mission,
        supplements[mission.id] || { workflow: null, detail: null },
        latestWorkflowState.agents,
        stageCatalog,
        missionEvents[mission.id] || mission.events || []
      )
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  const detailsById = Object.fromEntries(
    missions.map(mission => {
      const summary = summaries.find(item => item.id === mission.id);
      if (!summary) {
        return [mission.id, undefined];
      }
      return [
        mission.id,
        buildMissionDetailRecord(
          summary,
          mission,
          supplements[mission.id] || { workflow: null, detail: null },
          latestWorkflowState.agents,
          stageCatalog,
          missionEvents[mission.id] || mission.events || []
        ),
      ];
    })
  ) as Record<string, MissionTaskDetail>;

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId: resolveSelectedTaskId(
      summaries,
      get().selectedTaskId,
      options?.preferredTaskId
    ),
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

  if (useAppStore.getState().runtimeMode === "advanced") {
    await hydrateMissionTaskData(set, get, options);
    return;
  }

  stopMissionSocket();
  await hydrateWorkflowTaskData(set, get, options);
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

  createMission: async input => {
    if (useAppStore.getState().runtimeMode !== "advanced") {
      set({
        error: "Mission creation is only available in advanced runtime mode.",
      });
      return null;
    }

    const response = await createMissionRequest(input);
    await get().refresh({
      preferredTaskId: response.task.id,
    });
    return response.task.id;
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

    if (preset.action === "mission") {
      if (!preset.optionId && detail.decisionAllowsFreeText !== true) {
        set({
          error: "This mission decision requires a configured option.",
        });
        return null;
      }

      if (!preset.optionId && detail.decisionAllowsFreeText && !note) {
        set({
          error: "Add a note before submitting this mission decision.",
        });
        return null;
      }

      const response = await submitMissionDecisionRequest(taskId, {
        optionId: preset.optionId,
        freeText: detail.decisionAllowsFreeText ? note || undefined : undefined,
        detail:
          detail.decisionAllowsFreeText !== true && note ? note : undefined,
      });

      set(state => ({
        error: null,
        decisionNotes: {
          ...state.decisionNotes,
          [taskId]: "",
        },
        lastDecisionLaunch: {
          sourceTaskId: taskId,
          sourceTaskTitle: detail.title,
          spawnedWorkflowId: null,
          at: Date.now(),
        },
      }));

      try {
        await patchMissionRecordInStore(taskId, set, get);
      } catch (error) {
        console.warn(
          `[Tasks] Failed to patch mission ${taskId} after decision submit:`,
          error
        );
        await get().refresh({
          preferredTaskId: response.task.id || taskId,
        });
      }

      return response.task.id;
    }

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
      decisionNotes: {
        ...get().decisionNotes,
        [taskId]: "",
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
