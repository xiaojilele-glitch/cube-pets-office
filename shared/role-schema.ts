import type { WorkflowNodeModelConfig } from "./organization-schema.js";

export type AuthorityLevel = "high" | "medium" | "low";
export type RoleSource = "predefined" | "generated";
export type RoleLoadPolicy = "override" | "prefer_agent" | "merge";

export interface RoleTemplate {
  roleId: string;
  roleName: string;
  responsibilityPrompt: string;
  requiredSkillIds: string[];
  mcpIds: string[];
  defaultModelConfig: WorkflowNodeModelConfig;
  authorityLevel: AuthorityLevel;
  source: RoleSource;
  extends?: string;
  compatibleRoles?: string[];
  incompatibleRoles?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleChangeLogEntry {
  roleId: string;
  changedBy: string;
  changedAt: string;
  action: "created" | "modified" | "deprecated";
  diff: Record<string, { old: unknown; new: unknown }>;
}

export interface RoleOperationLog {
  agentId: string;
  roleId: string;
  action: "load" | "unload";
  timestamp: string;
  triggerSource: string;
}

export interface RolePerformanceRecord {
  totalTasks: number;
  avgQualityScore: number;
  avgLatencyMs: number;
  successRate: number;
  lastActiveAt: string;
  lowConfidence: boolean;
  recentTasks: Array<{
    taskId: string;
    qualityScore: number;
    latencyMs: number;
    timestamp: string;
  }>;
}

export interface AgentRoleRecommendation {
  agentId: string;
  recommendedRoleId: string;
  roleMatchScore: number;
  reason: string;
}

export interface RoleSwitchTrace {
  agentId: string;
  fromRoleId: string | null;
  toRoleId: string | null;
  phaseId: string;
  timestamp: string;
}

export interface PhaseAssignment {
  agentId: string;
  roleId: string;
}

export interface RoleConstraintError {
  code:
    | "ROLE_SWITCH_DENIED"
    | "AGENT_BUSY"
    | "COOLDOWN_ACTIVE"
    | "AUTHORITY_APPROVAL_REQUIRED";
  agentId: string;
  requestedRoleId: string;
  denialReason: string;
  timestamp: string;
}

export interface RoleUsageSummary {
  roleId: string;
  roleName: string;
  loadTotal: number;
  activeDurationSeconds: number;
  avgMatchScore: number;
}

export interface AgentRoleDistribution {
  agentId: string;
  agentName: string;
  roles: Array<{ roleId: string; roleName: string; percentage: number }>;
}
