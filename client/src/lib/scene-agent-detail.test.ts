import { describe, expect, it } from "vitest";

import type { ReputationProfile } from "@shared/reputation";

import {
  buildAgentDetailSnapshot,
  buildOfficeNoticeBoardSnapshot,
  selectWorkflowForAgent,
} from "./scene-agent-detail";
import type {
  AgentInfo,
  AgentMemoryEntry,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  TaskInfo,
  WorkflowInfo,
} from "./runtime/types";
import type { MissionTaskDetail, MissionTaskSummary } from "./tasks-store";

function makeWorkflow(
  id: string,
  overrides: Partial<WorkflowInfo> = {}
): WorkflowInfo {
  return {
    id,
    directive: `Workflow ${id}`,
    status: "running",
    current_stage: "execution",
    departments_involved: ["game"],
    started_at: "2026-04-11T10:00:00.000Z",
    completed_at: null,
    results: {
      organization: {
        rootNodeId: "node-ceo",
        nodes: [
          {
            id: "node-ceo",
            agentId: "ceo",
            name: "CEO Gateway",
            title: "Executive orchestrator",
            departmentId: "meta",
            role: "ceo",
          },
          {
            id: "node-nova",
            agentId: "nova",
            name: "Nova",
            title: "Gameplay designer",
            departmentId: "game",
            role: "worker",
          },
        ],
        departments: [],
      },
    },
    created_at: "2026-04-11T09:50:00.000Z",
    ...overrides,
  };
}

function makeAgent(
  id: string,
  overrides: Partial<AgentInfo> = {}
): AgentInfo {
  return {
    id,
    name: id.toUpperCase(),
    department: "game",
    role: "worker",
    managerId: "pixel",
    model: "gpt-5.2",
    isActive: true,
    status: "executing",
    ...overrides,
  };
}

function makeWorkflowTask(
  id: number,
  overrides: Partial<TaskInfo> = {}
): TaskInfo {
  return {
    id,
    workflow_id: "wf-main",
    worker_id: "nova",
    manager_id: "pixel",
    department: "game",
    description: "Draft the core gameplay loop",
    deliverable: "Gameplay outline",
    deliverable_v2: null,
    deliverable_v3: null,
    score_accuracy: null,
    score_completeness: null,
    score_actionability: null,
    score_format: null,
    total_score: null,
    manager_feedback: null,
    meta_audit_feedback: null,
    version: 1,
    status: "running",
    ...overrides,
  };
}

function makeMissionSummary(
  id: string,
  overrides: Partial<MissionTaskSummary> = {}
): MissionTaskSummary {
  return {
    id,
    title: `Mission ${id}`,
    kind: "general",
    sourceText: "Source",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 64,
    currentStageKey: "execution",
    currentStageLabel: "Run execution",
    summary: "The mission is actively moving through execution.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: 10,
    updatedAt: 20,
    startedAt: 12,
    completedAt: null,
    departmentLabels: ["Game"],
    taskCount: 1,
    completedTaskCount: 0,
    messageCount: 4,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: "Latest signal",
    ...overrides,
  };
}

function makeMissionDetail(
  summary: MissionTaskSummary,
  overrides: Partial<MissionTaskDetail> = {}
): MissionTaskDetail {
  return {
    ...summary,
    workflow: {
      id: summary.id,
      directive: summary.title,
      status: "running",
      current_stage: summary.currentStageKey,
      departments_involved: ["game"],
      started_at: "2026-04-11T10:00:00.000Z",
      completed_at: null,
      results: null,
      created_at: "2026-04-11T09:50:00.000Z",
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [
      {
        id: "nova",
        name: "Nova",
        role: "worker",
        department: "game",
        title: "Gameplay designer",
        status: "working",
        stageKey: "execution",
        stageLabel: "Run execution",
        progress: 72,
        currentAction: "Refining the next gameplay proposal",
        angle: 0,
      },
    ],
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    decisionHistory: [],
    operatorActions: [],
    ...overrides,
  };
}

describe("scene-agent-detail helpers", () => {
  it("prefers a workflow that explicitly contains the selected agent", () => {
    const unrelatedCurrent = makeWorkflow("wf-unrelated", {
      results: {
        organization: {
          rootNodeId: "node-ceo",
          nodes: [
            {
              id: "node-ceo",
              agentId: "ceo",
              name: "CEO Gateway",
              title: "Executive orchestrator",
              departmentId: "meta",
              role: "ceo",
            },
          ],
          departments: [],
        },
      },
    });
    const related = makeWorkflow("wf-related");

    const selected = selectWorkflowForAgent({
      agentId: "nova",
      currentWorkflow: unrelatedCurrent,
      workflows: [unrelatedCurrent, related],
    });

    expect(selected?.id).toBe("wf-related");
  });

  it("uses mission detail context before generic workflow task fallback", () => {
    const missionSummary = makeMissionSummary("mission-1");
    const missionDetail = makeMissionDetail(missionSummary);
    const snapshot = buildAgentDetailSnapshot({
      agentId: "nova",
      locale: "zh-CN",
      runtimeMode: "advanced",
      agents: [makeAgent("nova")],
      agentStatuses: { nova: "executing" },
      currentWorkflow: makeWorkflow("wf-main"),
      workflows: [makeWorkflow("wf-main")],
      workflowTasks: [makeWorkflowTask(1)],
      missionTasks: [missionSummary],
      missionDetailsById: { "mission-1": missionDetail },
      heartbeatStatuses: [],
      heartbeatReports: [],
      recentMemory: [],
      roleInfo: null,
      reputationProfile: null,
    });

    expect(snapshot.workFocus.missionId).toBe("mission-1");
    expect(snapshot.workFocus.summary).toContain("Refining the next gameplay proposal");
    expect(snapshot.memoryEmpty?.title).toBe("近期记忆为空");
    expect(snapshot.reportEmpty?.title).toBe("还没有报告摘要");
  });

  it("builds summary cards for heartbeat, reputation, and recent report", () => {
    const report: HeartbeatReportInfo = {
      reportId: "r-1",
      generatedAt: "2026-04-11T10:20:00.000Z",
      trigger: "manual",
      agentId: "nova",
      agentName: "Nova",
      department: "game",
      title: "Nova heartbeat",
      summaryPreview: "Nova is progressing steadily.",
      keywords: ["gameplay", "proposal"],
      searchResultCount: 3,
      jsonPath: "/heartbeat/nova.json",
      markdownPath: "/heartbeat/nova.md",
    };
    const heartbeat: HeartbeatStatusInfo = {
      agentId: "nova",
      agentName: "Nova",
      department: "game",
      enabled: true,
      state: "running",
      intervalMinutes: 15,
      keywords: ["gameplay"],
      focus: "Polish the next iteration",
      nextRunAt: "2026-04-11T10:30:00.000Z",
      lastRunAt: "2026-04-11T10:15:00.000Z",
      lastSuccessAt: "2026-04-11T10:15:00.000Z",
      lastError: null,
      lastReportId: "r-1",
      lastReportTitle: "Nova heartbeat",
      lastReportAt: "2026-04-11T10:20:00.000Z",
      reportCount: 2,
    };
    const reputation: ReputationProfile = {
      agentId: "nova",
      overallScore: 812,
      dimensions: {
        qualityScore: 820,
        speedScore: 780,
        efficiencyScore: 790,
        collaborationScore: 840,
        reliabilityScore: 830,
      },
      grade: "A",
      trustTier: "trusted",
      isExternal: false,
      totalTasks: 14,
      consecutiveHighQuality: 3,
      roleReputation: {},
      lastActiveAt: "2026-04-11T10:18:00.000Z",
      createdAt: "2026-04-10T10:00:00.000Z",
      updatedAt: "2026-04-11T10:20:00.000Z",
    };
    const memory: AgentMemoryEntry[] = [
      {
        timestamp: "2026-04-11T10:12:00.000Z",
        workflowId: "wf-main",
        stage: "execution",
        type: "message",
        preview: "Gameplay draft v2 now includes a clearer reward loop.",
        content: "Gameplay draft v2 now includes a clearer reward loop.",
      },
    ];

    const snapshot = buildAgentDetailSnapshot({
      agentId: "nova",
      locale: "en-US",
      runtimeMode: "advanced",
      agents: [makeAgent("nova")],
      agentStatuses: { nova: "executing" },
      currentWorkflow: makeWorkflow("wf-main"),
      workflows: [makeWorkflow("wf-main")],
      workflowTasks: [makeWorkflowTask(1)],
      missionTasks: [],
      missionDetailsById: {},
      heartbeatStatuses: [heartbeat],
      heartbeatReports: [report],
      recentMemory: memory,
      roleInfo: null,
      reputationProfile: reputation,
    });

    expect(snapshot.heartbeat.stateLabel).toBe("Running");
    expect(snapshot.reputation.grade).toBe("A");
    expect(snapshot.latestReport?.reportId).toBe("r-1");
    expect(snapshot.memoryEntries).toHaveLength(1);
  });

  it("aggregates office notice board counts from mission and heartbeat data", () => {
    const running = makeMissionSummary("mission-running");
    const waiting = makeMissionSummary("mission-waiting", {
      status: "waiting",
      title: "Waiting mission",
      blocker: {
        kind: "human_decision",
        label: "Need approval",
        detail: "Waiting for decision",
      } as any,
      updatedAt: 30,
    });
    const waitingDetail = makeMissionDetail(waiting, {
      agents: [
        {
          id: "nova",
          name: "Nova",
          role: "worker",
          department: "game",
          title: "Gameplay designer",
          status: "error",
          stageKey: "execution",
          stageLabel: "Run execution",
          progress: 50,
          currentAction: "Blocked on approval",
          angle: 0,
        },
      ],
    });

    const board = buildOfficeNoticeBoardSnapshot({
      locale: "zh-CN",
      runtimeMode: "advanced",
      missionTasks: [running, waiting],
      missionDetailsById: { [waiting.id]: waitingDetail },
      workflows: [makeWorkflow("wf-main")],
      heartbeatStatuses: [
        {
          agentId: "iris",
          agentName: "Iris",
          department: "ai",
          enabled: true,
          state: "error",
          intervalMinutes: 20,
          keywords: [],
          focus: "Recover the integration step",
          nextRunAt: null,
          lastRunAt: null,
          lastSuccessAt: null,
          lastError: "timeout",
          lastReportId: null,
          lastReportTitle: null,
          lastReportAt: null,
          reportCount: 0,
        },
      ],
      totalTokens: 123456,
      totalCost: 4.321,
    });

    expect(board.activeMissionCount).toBe(2);
    expect(board.blockedAgentCount).toBe(2);
    expect(board.focusLine).toContain("当前优先处理");
  });
});
