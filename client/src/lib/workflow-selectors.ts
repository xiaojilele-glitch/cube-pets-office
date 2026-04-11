import type { MissionTaskDetail } from "./tasks-store";
import type {
  AgentInfo,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  PanelView,
  WorkflowInfo,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "./workflow-store";

type MissionDetailMap = Record<string, MissionTaskDetail>;

type LegacyDestinationKind = "tasks" | "task-detail" | "office" | "legacy";

export interface WorkflowLegacyDestination {
  kind: LegacyDestinationKind;
  href: string | null;
  taskId: string | null;
  agentId: string | null;
}

export interface WorkflowOfficeAgentOption {
  agent: AgentInfo;
  node: WorkflowOrganizationNode | null;
}

const AGENT_ROLE_ORDER: Record<AgentInfo["role"], number> = {
  ceo: 0,
  manager: 1,
  worker: 2,
};

export function selectWorkflowOrganization(
  workflow: WorkflowInfo | null | undefined
): WorkflowOrganizationSnapshot | null {
  const organization = workflow?.results?.organization;
  if (!organization || typeof organization !== "object") {
    return null;
  }

  return Array.isArray((organization as WorkflowOrganizationSnapshot).nodes)
    ? (organization as WorkflowOrganizationSnapshot)
    : null;
}

export function selectWorkflowMissionId(
  workflow: WorkflowInfo | null | undefined
): string | null {
  if (!workflow?.missionId || typeof workflow.missionId !== "string") {
    return null;
  }

  return workflow.missionId;
}

export function selectWorkflowMissionDetail(
  workflow: WorkflowInfo | null | undefined,
  detailsById: MissionDetailMap
): MissionTaskDetail | null {
  const missionId = selectWorkflowMissionId(workflow);
  if (!missionId) {
    return null;
  }

  return detailsById[missionId] ?? null;
}

export function selectWorkflowAgentNode(
  workflow: WorkflowInfo | null | undefined,
  agentId: string | null | undefined
): WorkflowOrganizationNode | null {
  if (!agentId) {
    return null;
  }

  const organization = selectWorkflowOrganization(workflow);
  return (
    organization?.nodes.find(
      node => node.agentId === agentId || node.id === agentId
    ) ?? null
  );
}

export function selectPrimaryOfficeAgentId(input: {
  workflow: WorkflowInfo | null | undefined;
  agents: AgentInfo[];
  selectedAgentId?: string | null;
}): string | null {
  const { workflow, agents, selectedAgentId = null } = input;

  if (selectedAgentId && agents.some(agent => agent.id === selectedAgentId)) {
    return selectedAgentId;
  }

  const organization = selectWorkflowOrganization(workflow);
  if (
    organization?.rootAgentId &&
    agents.some(agent => agent.id === organization.rootAgentId)
  ) {
    return organization.rootAgentId;
  }

  return agents[0]?.id ?? null;
}

export function selectOfficeAgentOptions(input: {
  workflow: WorkflowInfo | null | undefined;
  agents: AgentInfo[];
  locale?: string;
}): WorkflowOfficeAgentOption[] {
  const { workflow, agents, locale = "en-US" } = input;
  const organization = selectWorkflowOrganization(workflow);
  const organizationAgentIds = organization
    ? new Set(organization.nodes.map(node => node.agentId))
    : null;

  const relevantAgents = organizationAgentIds
    ? agents.filter(agent => organizationAgentIds.has(agent.id))
    : agents;

  return [...relevantAgents]
    .sort((left, right) => {
      const roleDelta =
        AGENT_ROLE_ORDER[left.role] - AGENT_ROLE_ORDER[right.role];
      if (roleDelta !== 0) {
        return roleDelta;
      }

      return left.name.localeCompare(right.name, locale);
    })
    .map(agent => ({
      agent,
      node: selectWorkflowAgentNode(workflow, agent.id),
    }));
}

export function selectHeartbeatStatusForAgent(
  statuses: HeartbeatStatusInfo[],
  agentId: string | null | undefined
): HeartbeatStatusInfo | null {
  if (!agentId) {
    return null;
  }

  return statuses.find(status => status.agentId === agentId) ?? null;
}

export function selectHeartbeatReportsForAgent(
  reports: HeartbeatReportInfo[],
  agentId: string | null | undefined,
  limit = 4
): HeartbeatReportInfo[] {
  if (!agentId) {
    return [];
  }

  return reports
    .filter(report => report.agentId === agentId)
    .slice(0, Math.max(0, limit));
}

export function selectWorkflowLegacyDestination(
  view: PanelView,
  input: {
    workflow: WorkflowInfo | null | undefined;
    detailsById: MissionDetailMap;
    agents: AgentInfo[];
    selectedTaskId?: string | null;
    selectedAgentId?: string | null;
  }
): WorkflowLegacyDestination {
  const {
    workflow,
    detailsById,
    agents,
    selectedTaskId = null,
    selectedAgentId = null,
  } = input;
  const missionDetail = selectWorkflowMissionDetail(workflow, detailsById);
  const missionId = selectWorkflowMissionId(workflow);
  const taskId = missionDetail?.id ?? missionId ?? selectedTaskId ?? null;
  const officeAgentId = selectPrimaryOfficeAgentId({
    workflow,
    agents,
    selectedAgentId,
  });

  switch (view) {
    case "directive":
    case "history":
      return {
        kind: "tasks",
        href: "/tasks",
        taskId,
        agentId: officeAgentId,
      };
    case "workflow":
    case "review":
      return {
        kind: taskId ? "task-detail" : "tasks",
        href: taskId ? `/tasks/${taskId}` : "/tasks",
        taskId,
        agentId: officeAgentId,
      };
    case "org":
    case "memory":
    case "reports":
      return {
        kind: "office",
        href: "/",
        taskId,
        agentId: officeAgentId,
      };
    case "sessions":
      return {
        kind: "legacy",
        href: null,
        taskId,
        agentId: officeAgentId,
      };
    default:
      return {
        kind: "tasks",
        href: "/tasks",
        taskId,
        agentId: officeAgentId,
      };
  }
}
