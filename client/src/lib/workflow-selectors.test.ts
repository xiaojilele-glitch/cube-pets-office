import { describe, expect, it } from "vitest";

import type {
  AgentInfo,
  HeartbeatReportInfo,
  WorkflowInfo,
  WorkflowOrganizationSnapshot,
} from "./workflow-store";
import type { MissionTaskDetail } from "./tasks-store";
import {
  selectHeartbeatReportsForAgent,
  selectOfficeAgentOptions,
  selectWorkflowLegacyDestination,
  selectWorkflowMissionDetail,
  selectWorkflowOrganization,
} from "./workflow-selectors";

const ORGANIZATION: WorkflowOrganizationSnapshot = {
  kind: "workflow_organization",
  version: 1,
  workflowId: "wf-1",
  directive: "Ship the release train",
  generatedAt: "2026-04-11T08:00:00.000Z",
  source: "generated",
  taskProfile: "release",
  reasoning: "Need a small release squad.",
  rootNodeId: "node-ceo",
  rootAgentId: "agent-ceo",
  departments: [
    {
      id: "dept-release",
      label: "Release",
      managerNodeId: "node-mgr",
      direction: "Own rollout quality",
      strategy: "parallel",
      maxConcurrency: 2,
    },
  ],
  nodes: [
    {
      id: "node-ceo",
      agentId: "agent-ceo",
      parentId: null,
      departmentId: "dept-release",
      departmentLabel: "Release",
      name: "CEO",
      title: "Lead",
      role: "lead",
      responsibility: "Coordinate the squad",
      responsibilities: ["Coordinate"],
      goals: ["Ship"],
      summaryFocus: ["status"],
      skills: [],
      mcp: [],
      model: { model: "gpt-5.4", temperature: 0.2, maxTokens: 4000 },
      execution: {
        mode: "orchestrate",
        strategy: "parallel",
        maxConcurrency: 2,
      },
    },
    {
      id: "node-mgr",
      agentId: "agent-mgr",
      parentId: "node-ceo",
      departmentId: "dept-release",
      departmentLabel: "Release",
      name: "Manager",
      title: "Release Manager",
      role: "manager",
      responsibility: "Run the pod",
      responsibilities: ["Run the pod"],
      goals: ["Review"],
      summaryFocus: ["quality"],
      skills: [],
      mcp: [],
      model: { model: "gpt-5.4", temperature: 0.2, maxTokens: 4000 },
      execution: {
        mode: "review",
        strategy: "parallel",
        maxConcurrency: 2,
      },
    },
    {
      id: "node-worker",
      agentId: "agent-worker",
      parentId: "node-mgr",
      departmentId: "dept-release",
      departmentLabel: "Release",
      name: "Worker",
      title: "Release Worker",
      role: "worker",
      responsibility: "Execute",
      responsibilities: ["Execute"],
      goals: ["Deliver"],
      summaryFocus: ["delivery"],
      skills: [],
      mcp: [],
      model: { model: "gpt-5.4", temperature: 0.2, maxTokens: 4000 },
      execution: {
        mode: "execute",
        strategy: "parallel",
        maxConcurrency: 2,
      },
    },
  ],
};

const WORKFLOW: WorkflowInfo = {
  id: "wf-1",
  missionId: "mission-1",
  directive: "Ship the release train",
  status: "running",
  current_stage: "execution",
  departments_involved: ["dept-release"],
  started_at: "2026-04-11T08:00:00.000Z",
  completed_at: null,
  results: {
    organization: ORGANIZATION,
  },
  created_at: "2026-04-11T08:00:00.000Z",
};

const AGENTS: AgentInfo[] = [
  {
    id: "agent-worker",
    name: "Worker",
    department: "Release",
    role: "worker",
    managerId: "agent-mgr",
    model: "gpt-5.4",
    isActive: true,
    status: "executing",
  },
  {
    id: "agent-mgr",
    name: "Manager",
    department: "Release",
    role: "manager",
    managerId: "agent-ceo",
    model: "gpt-5.4",
    isActive: true,
    status: "reviewing",
  },
  {
    id: "agent-ceo",
    name: "CEO",
    department: "Release",
    role: "ceo",
    managerId: null,
    model: "gpt-5.4",
    isActive: true,
    status: "planning",
  },
  {
    id: "agent-outside",
    name: "Outside",
    department: "Other",
    role: "worker",
    managerId: null,
    model: "gpt-5.4",
    isActive: true,
    status: "idle",
  },
];

const DETAIL = {
  id: "mission-1",
  title: "Release rollout",
  sourceText: "Ship the release train",
  summary: "Finish rollout and verify results",
} as MissionTaskDetail;

describe("workflow-selectors", () => {
  it("extracts workflow organization snapshots when present", () => {
    expect(selectWorkflowOrganization(WORKFLOW)).toEqual(ORGANIZATION);
    expect(selectWorkflowOrganization(null)).toBeNull();
  });

  it("resolves current workflow mission details from the task map", () => {
    expect(
      selectWorkflowMissionDetail(WORKFLOW, {
        "mission-1": DETAIL,
      })
    ).toBe(DETAIL);
  });

  it("sorts office agent options by org membership and role order", () => {
    const result = selectOfficeAgentOptions({
      workflow: WORKFLOW,
      agents: AGENTS,
      locale: "en-US",
    });

    expect(result.map(item => item.agent.id)).toEqual([
      "agent-ceo",
      "agent-mgr",
      "agent-worker",
    ]);
    expect(result.every(item => item.node?.departmentLabel === "Release")).toBe(
      true
    );
  });

  it("maps legacy tabs into task and office destinations", () => {
    expect(
      selectWorkflowLegacyDestination("workflow", {
        workflow: WORKFLOW,
        detailsById: { "mission-1": DETAIL },
        agents: AGENTS,
        selectedTaskId: null,
        selectedAgentId: null,
      })
    ).toEqual({
      kind: "task-detail",
      href: "/tasks/mission-1",
      taskId: "mission-1",
      agentId: "agent-ceo",
    });

    expect(
      selectWorkflowLegacyDestination("memory", {
        workflow: WORKFLOW,
        detailsById: { "mission-1": DETAIL },
        agents: AGENTS,
        selectedTaskId: null,
        selectedAgentId: "agent-worker",
      })
    ).toEqual({
      kind: "office",
      href: "/",
      taskId: "mission-1",
      agentId: "agent-worker",
    });
  });

  it("filters heartbeat reports per agent and keeps newest items", () => {
    const reports: HeartbeatReportInfo[] = [
      {
        reportId: "r-1",
        generatedAt: "2026-04-11T10:00:00.000Z",
        trigger: "scheduled",
        agentId: "agent-worker",
        agentName: "Worker",
        department: "Release",
        title: "Worker report",
        summaryPreview: "Latest worker report",
        keywords: [],
        searchResultCount: 2,
        jsonPath: "/tmp/a.json",
        markdownPath: "/tmp/a.md",
      },
      {
        reportId: "r-2",
        generatedAt: "2026-04-11T09:00:00.000Z",
        trigger: "manual",
        agentId: "agent-ceo",
        agentName: "CEO",
        department: "Release",
        title: "CEO report",
        summaryPreview: "Latest ceo report",
        keywords: [],
        searchResultCount: 1,
        jsonPath: "/tmp/b.json",
        markdownPath: "/tmp/b.md",
      },
    ];

    expect(
      selectHeartbeatReportsForAgent(reports, "agent-worker", 4).map(
        item => item.reportId
      )
    ).toEqual(["r-1"]);
  });
});
