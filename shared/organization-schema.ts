import type { AgentRole } from "./workflow-runtime.js";
import type { A2AFrameworkType } from "./a2a-protocol.js";

export type OrganizationGenerationSource = "generated" | "fallback";

export interface WorkflowSkillBinding {
  id: string;
  name: string;
  summary: string;
  prompt: string;
}

export interface WorkflowMcpBinding {
  id: string;
  name: string;
  server: string;
  description: string;
  connection: {
    transport: string;
    endpoint: string;
    notes?: string;
  };
  tools: string[];
}

export interface WorkflowNodeModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface WorkflowNodeExecutionConfig {
  mode: "orchestrate" | "plan" | "execute" | "review" | "audit" | "summary";
  strategy: "parallel" | "sequential" | "batched";
  maxConcurrency: number;
}

export interface WorkflowOrganizationNode {
  id: string;
  agentId: string;
  parentId: string | null;
  departmentId: string;
  departmentLabel: string;
  name: string;
  title: string;
  role: AgentRole;
  responsibility: string;
  responsibilities: string[];
  goals: string[];
  summaryFocus: string[];
  skills: WorkflowSkillBinding[];
  mcp: WorkflowMcpBinding[];
  model: WorkflowNodeModelConfig;
  execution: WorkflowNodeExecutionConfig;
}

export interface WorkflowOrganizationDepartment {
  id: string;
  label: string;
  managerNodeId: string;
  direction: string;
  strategy: WorkflowNodeExecutionConfig["strategy"];
  maxConcurrency: number;
}

export interface WorkflowOrganizationSnapshot {
  kind: "workflow_organization";
  version: 1;
  workflowId: string;
  directive: string;
  generatedAt: string;
  source: OrganizationGenerationSource;
  taskProfile: string;
  reasoning: string;
  rootNodeId: string;
  rootAgentId: string;
  departments: WorkflowOrganizationDepartment[];
  nodes: WorkflowOrganizationNode[];
}

export interface OrganizationGenerationDebugLog {
  workflowId: string;
  directive: string;
  generatedAt: string;
  source: OrganizationGenerationSource;
  prompt: string;
  rawResponse: string | null;
  parsedPlan: unknown;
  fallbackReason: string | null;
  logPath?: string;
}

// ─── Guest Agent Types (from agent-marketplace spec) ─────────────────

/** 访客代理技能描述 */
export interface GuestSkillDescriptor {
  name: string;
  description: string;
}

/** 访客代理配置 */
export interface GuestAgentConfig {
  model: string;
  baseUrl: string;
  apiKey?: string;
  skills: GuestSkillDescriptor[];
  mcp: WorkflowMcpBinding[];
  avatarHint: string;
}

/** 访客代理节点（继承 WorkflowOrganizationNode） */
export interface GuestAgentNode extends WorkflowOrganizationNode {
  invitedBy: string;
  source: string;
  expiresAt: number;
  guestConfig?: GuestAgentConfig;
}

// ─── External Agent Types (A2A Protocol) ─────────────────────────────

/** 外部框架 Agent 节点（继承 GuestAgentNode） */
export interface ExternalAgentNode extends GuestAgentNode {
  frameworkType: A2AFrameworkType;
  a2aEndpoint: string;
  a2aAuth?: string;
}
