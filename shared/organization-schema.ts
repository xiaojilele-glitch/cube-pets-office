import type { AgentRole } from "./workflow-runtime.js";

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
