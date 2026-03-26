import type {
  AgentInfo,
  HeartbeatStatusInfo,
  StageInfo,
} from "./types";

type AgentSeed = Pick<
  AgentInfo,
  "id" | "name" | "department" | "role" | "managerId"
>;

const AGENT_SEEDS: AgentSeed[] = [
  { id: "ceo", name: "CEO Gateway", department: "meta", role: "ceo", managerId: null },
  { id: "pixel", name: "Pixel", department: "game", role: "manager", managerId: "ceo" },
  { id: "nova", name: "Nova", department: "game", role: "worker", managerId: "pixel" },
  { id: "blaze", name: "Blaze", department: "game", role: "worker", managerId: "pixel" },
  { id: "lyra", name: "Lyra", department: "game", role: "worker", managerId: "pixel" },
  { id: "volt", name: "Volt", department: "game", role: "worker", managerId: "pixel" },
  { id: "nexus", name: "Nexus", department: "ai", role: "manager", managerId: "ceo" },
  { id: "flux", name: "Flux", department: "ai", role: "worker", managerId: "nexus" },
  { id: "tensor", name: "Tensor", department: "ai", role: "worker", managerId: "nexus" },
  { id: "quark", name: "Quark", department: "ai", role: "worker", managerId: "nexus" },
  { id: "iris", name: "Iris", department: "ai", role: "worker", managerId: "nexus" },
  { id: "echo", name: "Echo", department: "life", role: "manager", managerId: "ceo" },
  { id: "zen", name: "Zen", department: "life", role: "worker", managerId: "echo" },
  { id: "coco", name: "Coco", department: "life", role: "worker", managerId: "echo" },
  { id: "warden", name: "Warden", department: "meta", role: "manager", managerId: "ceo" },
  { id: "forge", name: "Forge", department: "meta", role: "worker", managerId: "warden" },
  { id: "prism", name: "Prism", department: "meta", role: "worker", managerId: "warden" },
  { id: "scout", name: "Scout", department: "meta", role: "worker", managerId: "warden" },
];

export const STAGES: StageInfo[] = [
  { id: "direction", order: 1, label: "Direction" },
  { id: "planning", order: 2, label: "Planning" },
  { id: "execution", order: 3, label: "Execution" },
  { id: "review", order: 4, label: "Review" },
  { id: "meta_audit", order: 5, label: "Meta Audit" },
  { id: "revision", order: 6, label: "Revision" },
  { id: "verify", order: 7, label: "Verify" },
  { id: "summary", order: 8, label: "Summary" },
  { id: "feedback", order: 9, label: "Feedback" },
  { id: "evolution", order: 10, label: "Evolution" },
];

const HEARTBEAT_KEYWORDS: Record<string, string[]> = {
  game: ["retention", "event design", "feature polish"],
  ai: ["model quality", "latency", "evaluation"],
  life: ["community", "tone", "engagement"],
  meta: ["workflow health", "quality", "coordination"],
};

export function createSeedAgents(): AgentInfo[] {
  return AGENT_SEEDS.map(agent => ({
    ...agent,
    model: "browser-runtime",
    isActive: true,
    status: "idle",
  }));
}

export function createSeedHeartbeatStatuses(
  agents: AgentInfo[] = createSeedAgents()
): HeartbeatStatusInfo[] {
  return agents
    .filter(agent => agent.id !== "ceo")
    .map(agent => ({
      agentId: agent.id,
      agentName: agent.name,
      department: agent.department,
      enabled: true,
      state: "scheduled" as const,
      intervalMinutes: agent.role === "manager" ? 180 : 240,
      keywords: HEARTBEAT_KEYWORDS[agent.department] || ["focus"],
      focus: `${agent.name} watches ${agent.department} signals.`,
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastReportId: null,
      lastReportTitle: null,
      lastReportAt: null,
      reportCount: 0,
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function getManagerForDepartment(
  department: string,
  agents: AgentInfo[]
): AgentInfo | undefined {
  return agents.find(
    agent => agent.role === "manager" && agent.department === department
  );
}

export function getWorkersForManager(
  managerId: string,
  agents: AgentInfo[]
): AgentInfo[] {
  return agents.filter(
    agent => agent.role === "worker" && agent.managerId === managerId
  );
}
