import type { ReputationProfile } from "@shared/reputation";

import {
  getAgentConfig,
  getAgentIdleText,
  getAgentTitle,
} from "@/lib/agent-config";
import type { AppLocale } from "@/lib/locale";
import type { AgentRoleInfo } from "@/lib/role-store";
import type {
  AgentInfo,
  AgentMemoryEntry,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  TaskInfo,
  WorkflowInfo,
  WorkflowOrganizationSnapshot,
} from "@/lib/runtime/types";
import type { MissionTaskDetail, MissionTaskSummary } from "@/lib/tasks-store";
import type { RuntimeMode } from "@/lib/store";

const ACTIVE_WORKFLOW_STATUSES = new Set<WorkflowInfo["status"]>([
  "pending",
  "running",
]);

const ACTIVE_WORK_PACKAGE_STATUSES = new Set([
  "pending",
  "queued",
  "running",
  "in_progress",
  "reviewing",
  "revising",
  "blocked",
  "waiting",
]);

function t(locale: AppLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function trimText(value: string | null | undefined, maxLength = 120) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function humanizeKey(value: string | null | undefined, locale: AppLocale) {
  if (!value) return t(locale, "未开始", "Not started");
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) return t(locale, "未开始", "Not started");
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function formatTime(locale: AppLocale, value: string | null | undefined) {
  if (!value) return t(locale, "暂无", "Not yet");
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDepartmentLabel(
  department: string | null | undefined,
  locale: AppLocale
) {
  switch ((department || "").toLowerCase()) {
    case "game":
      return t(locale, "游戏部", "Game");
    case "ai":
      return t(locale, "AI 部", "AI");
    case "life":
      return t(locale, "生活部", "Life");
    case "meta":
      return t(locale, "元部门", "Meta");
    default:
      return department || t(locale, "未分配", "Unassigned");
  }
}

function formatAgentRole(
  role: AgentInfo["role"] | string | null | undefined,
  locale: AppLocale
) {
  switch (role) {
    case "ceo":
      return t(locale, "CEO", "CEO");
    case "manager":
      return t(locale, "经理", "Manager");
    case "worker":
      return t(locale, "执行 Agent", "Worker");
    default:
      return role || t(locale, "未定义", "Undefined");
  }
}

export function formatAgentStatusLabel(
  status: string | null | undefined,
  locale: AppLocale
) {
  switch (status) {
    case "idle":
      return t(locale, "待命中", "Idle");
    case "thinking":
      return t(locale, "思考中", "Thinking");
    case "heartbeat":
      return t(locale, "心跳中", "Heartbeat");
    case "executing":
      return t(locale, "执行中", "Executing");
    case "reviewing":
      return t(locale, "评审中", "Reviewing");
    case "planning":
      return t(locale, "规划中", "Planning");
    case "analyzing":
      return t(locale, "分析中", "Analyzing");
    case "auditing":
      return t(locale, "审计中", "Auditing");
    case "revising":
      return t(locale, "修订中", "Revising");
    case "verifying":
      return t(locale, "验证中", "Verifying");
    case "summarizing":
      return t(locale, "汇总中", "Summarizing");
    case "evaluating":
      return t(locale, "评估中", "Evaluating");
    case "error":
      return t(locale, "异常", "Error");
    default:
      return t(locale, "待命中", "Idle");
  }
}

export function formatHeartbeatStateLabel(
  state: HeartbeatStatusInfo["state"] | "missing",
  locale: AppLocale
) {
  switch (state) {
    case "scheduled":
      return t(locale, "已排程", "Scheduled");
    case "running":
      return t(locale, "执行中", "Running");
    case "error":
      return t(locale, "异常", "Error");
    case "idle":
      return t(locale, "空闲", "Idle");
    case "missing":
    default:
      return t(locale, "暂无心跳", "No heartbeat");
  }
}

function formatWorkflowStatusLabel(
  status: WorkflowInfo["status"] | null | undefined,
  locale: AppLocale
) {
  switch (status) {
    case "pending":
      return t(locale, "待启动", "Pending");
    case "running":
      return t(locale, "进行中", "Running");
    case "completed":
      return t(locale, "已完成", "Completed");
    case "completed_with_errors":
      return t(locale, "完成但有异常", "Completed with issues");
    case "failed":
      return t(locale, "失败", "Failed");
    default:
      return t(locale, "未开始", "Not started");
  }
}

function formatWorkPackageStatusLabel(
  status: string | null | undefined,
  locale: AppLocale
) {
  switch ((status || "").toLowerCase()) {
    case "queued":
      return t(locale, "排队中", "Queued");
    case "pending":
      return t(locale, "待处理", "Pending");
    case "running":
    case "in_progress":
      return t(locale, "进行中", "In progress");
    case "working":
      return t(locale, "工作中", "Working");
    case "thinking":
      return t(locale, "思考中", "Thinking");
    case "reviewing":
      return t(locale, "评审中", "Reviewing");
    case "revising":
      return t(locale, "修订中", "Revising");
    case "blocked":
      return t(locale, "阻塞中", "Blocked");
    case "waiting":
      return t(locale, "等待中", "Waiting");
    case "passed":
    case "verified":
    case "done":
    case "completed":
      return t(locale, "已完成", "Done");
    case "failed":
    case "error":
      return t(locale, "失败", "Failed");
    default:
      return status || t(locale, "未知", "Unknown");
  }
}

function isOpenWorkPackage(status: string | null | undefined) {
  return ACTIVE_WORK_PACKAGE_STATUSES.has((status || "").toLowerCase());
}

function getWorkflowOrganization(
  workflow: WorkflowInfo | null | undefined
): WorkflowOrganizationSnapshot | null {
  const organization = workflow?.results?.organization;
  if (!organization || typeof organization !== "object") return null;
  return Array.isArray((organization as WorkflowOrganizationSnapshot).nodes)
    ? (organization as WorkflowOrganizationSnapshot)
    : null;
}

function workflowContainsAgent(
  workflow: WorkflowInfo | null | undefined,
  agentId: string
) {
  const organization = getWorkflowOrganization(workflow);
  if (!organization) return false;
  return organization.nodes.some(node => node.agentId === agentId);
}

export function selectWorkflowForAgent(params: {
  agentId: string;
  currentWorkflow: WorkflowInfo | null;
  workflows: WorkflowInfo[];
}) {
  const { agentId, currentWorkflow, workflows } = params;
  const activeWorkflows = workflows.filter(workflow =>
    ACTIVE_WORKFLOW_STATUSES.has(workflow.status)
  );

  if (currentWorkflow && workflowContainsAgent(currentWorkflow, agentId)) {
    return currentWorkflow;
  }

  const relatedWorkflow = activeWorkflows.find(workflow =>
    workflowContainsAgent(workflow, agentId)
  );
  if (relatedWorkflow) return relatedWorkflow;

  if (currentWorkflow && ACTIVE_WORKFLOW_STATUSES.has(currentWorkflow.status)) {
    return currentWorkflow;
  }

  return activeWorkflows[0] ?? currentWorkflow ?? null;
}

function sortMissionSummaries(tasks: MissionTaskSummary[]) {
  return [...tasks].sort((left, right) => right.updatedAt - left.updatedAt);
}

function findMissionContextForAgent(params: {
  agentId: string;
  missionTasks: MissionTaskSummary[];
  missionDetailsById: Record<string, MissionTaskDetail>;
}) {
  const { agentId, missionDetailsById } = params;
  const orderedTasks = sortMissionSummaries(params.missionTasks);
  const activeFirst = [
    ...orderedTasks.filter(
      task => task.status === "running" || task.status === "waiting"
    ),
    ...orderedTasks.filter(
      task => task.status !== "running" && task.status !== "waiting"
    ),
  ];

  for (const summary of activeFirst) {
    const detail = missionDetailsById[summary.id];
    if (!detail?.agents?.some(agent => agent.id === agentId)) continue;
    return { summary, detail };
  }

  return null;
}

export interface AgentWorkFocus {
  title: string;
  summary: string;
  stageLabel: string | null;
  statusLabel: string | null;
  missionId: string | null;
  workflowId: string | null;
  managerName: string | null;
  taskId: number | null;
}

function buildWorkFocus(params: {
  locale: AppLocale;
  runtimeMode: RuntimeMode;
  agent: AgentInfo;
  candidateWorkflow: WorkflowInfo | null;
  workflowTasks: TaskInfo[];
  missionTasks: MissionTaskSummary[];
  missionDetailsById: Record<string, MissionTaskDetail>;
  agentMap: Map<string, AgentInfo>;
}) {
  const {
    locale,
    runtimeMode,
    agent,
    candidateWorkflow,
    workflowTasks,
    missionTasks,
    missionDetailsById,
    agentMap,
  } = params;

  const missionContext = findMissionContextForAgent({
    agentId: agent.id,
    missionTasks,
    missionDetailsById,
  });

  if (missionContext) {
    const agentProjection =
      missionContext.detail.agents.find(item => item.id === agent.id) || null;

    return {
      title: missionContext.summary.title,
      summary:
        trimText(agentProjection?.currentAction, 120) ||
        trimText(missionContext.summary.summary, 120) ||
        t(
          locale,
          "正在推进当前阶段的任务分工。",
          "Working through the current stage assignment."
        ),
      stageLabel:
        agentProjection?.stageLabel ||
        missionContext.summary.currentStageLabel ||
        null,
      statusLabel: formatWorkPackageStatusLabel(
        agentProjection?.status || missionContext.summary.status,
        locale
      ),
      missionId: missionContext.summary.id,
      workflowId: missionContext.detail.workflow.id,
      managerName:
        agent.managerId && agentMap.has(agent.managerId)
          ? agentMap.get(agent.managerId)?.name || null
          : null,
      taskId: null,
    } satisfies AgentWorkFocus;
  }

  const directTask =
    workflowTasks.find(
      task => task.worker_id === agent.id && isOpenWorkPackage(task.status)
    ) ||
    workflowTasks.find(task => task.worker_id === agent.id) ||
    null;

  if (directTask) {
    return {
      title:
        trimText(directTask.description, 72) ||
        t(locale, "当前工作包", "Current work package"),
      summary:
        trimText(directTask.deliverable, 120) ||
        trimText(directTask.description, 120) ||
        t(
          locale,
          "正在根据当前工作流拆解执行内容。",
          "Working through the current workflow package."
        ),
      stageLabel: candidateWorkflow?.current_stage
        ? humanizeKey(candidateWorkflow.current_stage, locale)
        : null,
      statusLabel: formatWorkPackageStatusLabel(directTask.status, locale),
      missionId: null,
      workflowId: directTask.workflow_id,
      managerName:
        agentMap.get(directTask.manager_id)?.name ||
        directTask.manager_id ||
        null,
      taskId: directTask.id,
    } satisfies AgentWorkFocus;
  }

  const managedTasks = workflowTasks.filter(
    task => task.manager_id === agent.id && isOpenWorkPackage(task.status)
  );

  if (managedTasks.length > 0) {
    return {
      title: t(
        locale,
        `正在协调 ${managedTasks.length} 个工作包`,
        `Coordinating ${managedTasks.length} work packages`
      ),
      summary:
        trimText(managedTasks[0]?.description, 120) ||
        t(
          locale,
          "正在跟进下游执行和交付质量。",
          "Following up on downstream execution and delivery quality."
        ),
      stageLabel: candidateWorkflow?.current_stage
        ? humanizeKey(candidateWorkflow.current_stage, locale)
        : null,
      statusLabel: formatWorkflowStatusLabel(candidateWorkflow?.status, locale),
      missionId: null,
      workflowId: candidateWorkflow?.id || null,
      managerName: null,
      taskId: managedTasks[0]?.id || null,
    } satisfies AgentWorkFocus;
  }

  if (
    candidateWorkflow &&
    ACTIVE_WORKFLOW_STATUSES.has(candidateWorkflow.status)
  ) {
    return {
      title:
        trimText(candidateWorkflow.directive, 72) ||
        t(locale, "全局编排", "Mission orchestration"),
      summary: t(
        locale,
        "当前以工作流主线为准，还没有更细的个人工作包可展示。",
        "The workflow is active, but a more specific personal task is not available yet."
      ),
      stageLabel: candidateWorkflow.current_stage
        ? humanizeKey(candidateWorkflow.current_stage, locale)
        : null,
      statusLabel: formatWorkflowStatusLabel(candidateWorkflow.status, locale),
      missionId: null,
      workflowId: candidateWorkflow.id,
      managerName: null,
      taskId: null,
    } satisfies AgentWorkFocus;
  }

  return {
    title: t(locale, "等待任务上下文", "Waiting for task context"),
    summary:
      runtimeMode === "advanced"
        ? t(
            locale,
            "这个 Agent 目前没有被分配到进行中的任务，等下一次编排后这里会自动更新。",
            "This agent is not assigned to an active task right now. The panel will update after the next orchestration run."
          )
        : t(
            locale,
            "当前是前端预演模式，真实任务上下文会在切到 Advanced Mode 后补齐。",
            "The app is in frontend preview mode. Real task context appears after switching to Advanced Mode."
          ),
    stageLabel: null,
    statusLabel: null,
    missionId: null,
    workflowId: null,
    managerName: null,
    taskId: null,
  } satisfies AgentWorkFocus;
}

export interface AgentDetailSnapshot {
  id: string;
  name: string;
  emoji: string;
  title: string;
  roleLabel: string;
  departmentLabel: string;
  modelLabel: string;
  statusLabel: string;
  statusKey: string;
  currentRoleName: string | null;
  currentRoleLoadedAt: string | null;
  runtimeHint: string | null;
  idleHint: string;
  heartbeat: {
    stateLabel: string;
    focus: string | null;
    nextRunAt: string | null;
    lastSuccessAt: string | null;
    reportCount: number;
    emptyLabel: string | null;
  };
  reputation: {
    score: number | null;
    grade: string | null;
    trustTier: string | null;
    updatedAt: string | null;
    emptyLabel: string | null;
  };
  workFocus: AgentWorkFocus;
  memoryEntries: AgentMemoryEntry[];
  memoryEmpty: {
    title: string;
    description: string;
    hint: string | null;
  } | null;
  latestReport: HeartbeatReportInfo | null;
  reportCount: number;
  reportEmpty: {
    title: string;
    description: string;
    hint: string | null;
  } | null;
}

export function buildAgentDetailSnapshot(params: {
  agentId: string;
  locale: AppLocale;
  runtimeMode: RuntimeMode;
  agents: AgentInfo[];
  agentStatuses: Record<string, string>;
  currentWorkflow: WorkflowInfo | null;
  workflows: WorkflowInfo[];
  workflowTasks: TaskInfo[];
  missionTasks: MissionTaskSummary[];
  missionDetailsById: Record<string, MissionTaskDetail>;
  heartbeatStatuses: HeartbeatStatusInfo[];
  heartbeatReports: HeartbeatReportInfo[];
  recentMemory: AgentMemoryEntry[];
  roleInfo: AgentRoleInfo | null;
  reputationProfile: ReputationProfile | null;
}) {
  const {
    agentId,
    locale,
    runtimeMode,
    agents,
    agentStatuses,
    currentWorkflow,
    workflows,
    workflowTasks,
    missionTasks,
    missionDetailsById,
    heartbeatStatuses,
    heartbeatReports,
    recentMemory,
    roleInfo,
    reputationProfile,
  } = params;

  const fallbackConfig = getAgentConfig(agentId);
  const agentMap = new Map(agents.map(agent => [agent.id, agent]));
  const liveAgent = agentMap.get(agentId);
  const agent: AgentInfo = liveAgent || {
    id: agentId,
    name: fallbackConfig.name,
    department: fallbackConfig.department,
    role: fallbackConfig.role,
    managerId: null,
    model: t(locale, "场景内置配置", "Scene default"),
    isActive: true,
    status: "idle",
  };
  const effectiveStatus =
    agentStatuses[agentId] || liveAgent?.status || agent.status || "idle";
  const heartbeat =
    heartbeatStatuses.find(item => item.agentId === agentId) || null;
  const reports = heartbeatReports
    .filter(item => item.agentId === agentId)
    .sort(
      (left, right) =>
        new Date(right.generatedAt).getTime() -
        new Date(left.generatedAt).getTime()
    );
  const latestReport = reports[0] || null;
  const candidateWorkflow = selectWorkflowForAgent({
    agentId,
    currentWorkflow,
    workflows,
  });

  return {
    id: agentId,
    name: liveAgent?.name || fallbackConfig.name,
    emoji: fallbackConfig.emoji,
    title: getAgentTitle(agentId, locale),
    roleLabel: formatAgentRole(agent.role, locale),
    departmentLabel: formatDepartmentLabel(agent.department, locale),
    modelLabel: agent.model || t(locale, "场景内置配置", "Scene default"),
    statusLabel: formatAgentStatusLabel(effectiveStatus, locale),
    statusKey: effectiveStatus,
    currentRoleName: roleInfo?.currentRole?.roleName || null,
    currentRoleLoadedAt: roleInfo?.currentRole?.loadedAt || null,
    runtimeHint:
      runtimeMode === "frontend"
        ? t(
            locale,
            "前端预演模式会优先展示本地流程与说明性数据；切到 Advanced Mode 可读取更完整的任务、心跳与信誉信息。",
            "Frontend preview mode prioritizes local flow data and explainable fallbacks. Switch to Advanced Mode for fuller task, heartbeat, and reputation context."
          )
        : null,
    idleHint: getAgentIdleText(agentId, locale),
    heartbeat: {
      stateLabel: formatHeartbeatStateLabel(
        heartbeat?.state || "missing",
        locale
      ),
      focus: heartbeat?.focus || null,
      nextRunAt: heartbeat?.nextRunAt
        ? formatTime(locale, heartbeat.nextRunAt)
        : null,
      lastSuccessAt: heartbeat?.lastSuccessAt
        ? formatTime(locale, heartbeat.lastSuccessAt)
        : null,
      reportCount: heartbeat?.reportCount ?? reports.length,
      emptyLabel: heartbeat
        ? null
        : t(
            locale,
            "还没有拿到这个 Agent 的 heartbeat 状态。",
            "Heartbeat status for this agent is not available yet."
          ),
    },
    reputation: {
      score: reputationProfile?.overallScore ?? null,
      grade: reputationProfile?.grade ?? null,
      trustTier: reputationProfile?.trustTier ?? null,
      updatedAt: reputationProfile?.updatedAt
        ? formatTime(locale, reputationProfile.updatedAt)
        : null,
      emptyLabel: reputationProfile
        ? null
        : t(
            locale,
            "当前还没有可展示的信誉档案。",
            "A reputation profile is not available yet."
          ),
    },
    workFocus: buildWorkFocus({
      locale,
      runtimeMode,
      agent,
      candidateWorkflow,
      workflowTasks,
      missionTasks,
      missionDetailsById,
      agentMap,
    }),
    memoryEntries: recentMemory.slice(0, 4),
    memoryEmpty:
      recentMemory.length > 0
        ? null
        : {
            title: t(locale, "近期记忆为空", "Recent memory is empty"),
            description:
              runtimeMode === "advanced"
                ? t(
                    locale,
                    "还没有同步到这个 Agent 的近期记忆片段，可能是当前任务还没产生足够上下文。",
                    "Recent memory for this agent has not been synced yet. The current task may not have produced enough context."
                  )
                : t(
                    locale,
                    "前端预演模式下如果本地流程还没运行到对应阶段，这里会先保持为空。",
                    "In frontend preview mode this section stays empty until the local flow reaches a relevant stage."
                  ),
            hint:
              runtimeMode === "advanced"
                ? t(
                    locale,
                    "可以先去工作流面板的 Memory 视图里触发一次刷新。",
                    "You can refresh memory from the Workflow panel."
                  )
                : null,
          },
    latestReport,
    reportCount: reports.length || heartbeat?.reportCount || 0,
    reportEmpty: latestReport
      ? null
      : {
          title: t(locale, "还没有报告摘要", "No report summary yet"),
          description:
            runtimeMode === "advanced"
              ? t(
                  locale,
                  "这个 Agent 还没有生成可展示的 heartbeat 报告。",
                  "This agent has not generated a heartbeat report yet."
                )
              : t(
                  locale,
                  "演示模式下如果本地流程没有触发 heartbeat，这里会显示为空态说明。",
                  "If heartbeat has not been triggered in preview mode, this section stays in an explanatory empty state."
                ),
          hint:
            heartbeat?.focus || heartbeat?.lastError
              ? trimText(heartbeat.focus || heartbeat.lastError, 120)
              : null,
        },
  } satisfies AgentDetailSnapshot;
}

export interface OfficeNoticeBoardSnapshot {
  activeMissionCount: number;
  blockedAgentCount: number;
  totalTokens: number;
  totalCost: number;
  focusLine: string;
  modeHint: string | null;
}

export function buildOfficeNoticeBoardSnapshot(params: {
  locale: AppLocale;
  runtimeMode: RuntimeMode;
  missionTasks: MissionTaskSummary[];
  missionDetailsById: Record<string, MissionTaskDetail>;
  workflows: WorkflowInfo[];
  heartbeatStatuses: HeartbeatStatusInfo[];
  totalTokens: number;
  totalCost: number;
}) {
  const {
    locale,
    runtimeMode,
    missionTasks,
    missionDetailsById,
    workflows,
    heartbeatStatuses,
    totalTokens,
    totalCost,
  } = params;

  const activeMissionCount =
    missionTasks.length > 0
      ? missionTasks.filter(
          task => task.status === "running" || task.status === "waiting"
        ).length
      : workflows.filter(workflow =>
          ACTIVE_WORKFLOW_STATUSES.has(workflow.status)
        ).length;

  const blockedAgentIds = new Set<string>();
  heartbeatStatuses
    .filter(item => item.state === "error")
    .forEach(item => blockedAgentIds.add(item.agentId));

  Object.values(missionDetailsById).forEach(detail => {
    detail.agents
      .filter(agent => agent.status === "error")
      .forEach(agent => blockedAgentIds.add(agent.id));
  });

  const waitingMission =
    sortMissionSummaries(missionTasks).find(
      task => task.status === "waiting"
    ) ||
    sortMissionSummaries(missionTasks).find(
      task => task.blocker || task.waitingFor
    ) ||
    null;
  const runningMission = sortMissionSummaries(missionTasks).find(
    task => task.status === "running"
  );

  const fallbackBlockedCount =
    blockedAgentIds.size > 0
      ? blockedAgentIds.size
      : missionTasks.filter(task => task.status === "waiting").length;

  return {
    activeMissionCount,
    blockedAgentCount: fallbackBlockedCount,
    totalTokens,
    totalCost,
    focusLine: waitingMission
      ? t(
          locale,
          `当前优先处理：${trimText(waitingMission.title, 42)}`,
          `Priority now: ${trimText(waitingMission.title, 42)}`
        )
      : runningMission
        ? t(
            locale,
            `主线任务：${trimText(runningMission.title, 42)}`,
            `Main mission: ${trimText(runningMission.title, 42)}`
          )
        : t(
            locale,
            "当前没有运行中的任务，创建新 mission 后这里会自动刷新。",
            "There is no active mission right now. This board updates after a new mission starts."
          ),
    modeHint:
      runtimeMode === "frontend"
        ? t(
            locale,
            "现在展示的是办公室预演视图，若要查看真实任务详情与服务端状态，请切到 Advanced Mode。",
            "This board is currently showing the office preview. Switch to Advanced Mode for real mission detail and server-backed state."
          )
        : null,
  } satisfies OfficeNoticeBoardSnapshot;
}
