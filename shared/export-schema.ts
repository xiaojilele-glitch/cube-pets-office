/**
 * 跨框架导出中间表示（IR）类型定义
 *
 * IR 是框架无关的统一数据结构，由 Cube 内部模型转换而来，
 * 供各目标框架适配器（CrewAI / LangGraph / AutoGen）消费。
 *
 * ExportFile 类型复用 shared/export/contracts.ts 中的定义（C05 冻结）。
 */

import type { ExportFile } from "./export/contracts.js";
import type {
  WorkflowOrganizationSnapshot,
  WorkflowOrganizationNode,
} from "./organization-schema.js";
import type { WorkflowRecord, TaskRecord } from "./workflow-runtime.js";
import { WORKFLOW_STAGES, WORKFLOW_STAGE_LABELS } from "./workflow-runtime.js";

// Re-export ExportFile so consumers can import from this module
export type { ExportFile };

// ---------------------------------------------------------------------------
// 导出框架类型（扩展 contracts 中的 ExportFramework，增加 "all"）
// ---------------------------------------------------------------------------

export type ExportFramework = "crewai" | "langgraph" | "autogen" | "all";

export const SUPPORTED_FRAMEWORKS = [
  "crewai",
  "langgraph",
  "autogen",
  "all",
] as const;

// ---------------------------------------------------------------------------
// Agent 定义
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  id: string;
  name: string;
  role: "ceo" | "manager" | "worker";
  title: string;
  responsibility: string;
  goals: string[];
  skillIds: string[];
  toolIds: string[];
  model: {
    name: string;
    temperature: number;
    maxTokens: number;
  };
}

// ---------------------------------------------------------------------------
// 团队定义
// ---------------------------------------------------------------------------

export interface TeamDefinition {
  id: string;
  label: string;
  managerAgentId: string;
  memberAgentIds: string[];
  strategy: "parallel" | "sequential" | "batched";
  direction: string;
}

// ---------------------------------------------------------------------------
// 管道与阶段定义
// ---------------------------------------------------------------------------

export interface StageDefinition {
  name: string;
  label: string;
  participantRoles: ("ceo" | "manager" | "worker")[];
  executionStrategy: "parallel" | "sequential";
}

export interface PipelineDefinition {
  stages: StageDefinition[];
}

// ---------------------------------------------------------------------------
// Skill 定义
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  id: string;
  name: string;
  summary: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  id: string;
  name: string;
  server: string;
  description: string;
  tools: string[];
  connection: {
    transport: string;
    endpoint: string;
  };
}

// ---------------------------------------------------------------------------
// 导出中间表示根对象
// ---------------------------------------------------------------------------

export interface ExportIR {
  version: 1;
  exportedAt: string;
  source: {
    workflowId: string;
    directive: string;
    status: string;
  };
  agents: AgentDefinition[];
  teams: TeamDefinition[];
  pipeline: PipelineDefinition;
  skills: SkillDefinition[];
  tools: ToolDefinition[];
}

// ---------------------------------------------------------------------------
// 每个工作流阶段的参与角色和执行策略映射
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<
  string,
  {
    participantRoles: ("ceo" | "manager" | "worker")[];
    executionStrategy: "parallel" | "sequential";
  }
> = {
  direction: { participantRoles: ["ceo"], executionStrategy: "sequential" },
  planning: {
    participantRoles: ["ceo", "manager"],
    executionStrategy: "sequential",
  },
  execution: { participantRoles: ["worker"], executionStrategy: "parallel" },
  review: { participantRoles: ["manager"], executionStrategy: "sequential" },
  meta_audit: { participantRoles: ["ceo"], executionStrategy: "sequential" },
  revision: { participantRoles: ["worker"], executionStrategy: "parallel" },
  verify: { participantRoles: ["manager"], executionStrategy: "sequential" },
  summary: {
    participantRoles: ["manager", "worker"],
    executionStrategy: "sequential",
  },
  feedback: { participantRoles: ["ceo"], executionStrategy: "sequential" },
  evolution: {
    participantRoles: ["ceo", "manager", "worker"],
    executionStrategy: "parallel",
  },
};

// ---------------------------------------------------------------------------
// IR 构建入口函数
// ---------------------------------------------------------------------------

/**
 * 将 Cube 内部数据模型转换为框架无关的中间表示（IR）。
 *
 * 映射规则：
 * - 每个 WorkflowOrganizationNode → AgentDefinition
 * - 每个 WorkflowOrganizationDepartment → TeamDefinition
 * - WORKFLOW_STAGES → 10 个 StageDefinition（固定管道）
 * - 所有节点的 skills/mcp 绑定去重后 → SkillDefinition[] / ToolDefinition[]
 */
export function buildExportIR(
  organization: WorkflowOrganizationSnapshot,
  workflow: WorkflowRecord,
  tasks: TaskRecord[]
): ExportIR {
  // --- nodeId → agentId 查找表 ---
  const nodeIdToAgentId = new Map<string, string>();
  for (const node of organization.nodes) {
    nodeIdToAgentId.set(node.id, node.agentId);
  }

  // --- 1. Agents ---
  const agents: AgentDefinition[] = organization.nodes.map(node =>
    mapNodeToAgent(node)
  );

  // --- 2. Teams ---
  const teams: TeamDefinition[] = organization.departments.map(dept => {
    const memberAgentIds = organization.nodes
      .filter(n => n.departmentId === dept.id)
      .map(n => n.agentId);

    return {
      id: dept.id,
      label: dept.label,
      managerAgentId:
        nodeIdToAgentId.get(dept.managerNodeId) ?? dept.managerNodeId,
      memberAgentIds,
      strategy: dept.strategy,
      direction: dept.direction,
    };
  });

  // --- 3. Pipeline (fixed 10 stages) ---
  const stages: StageDefinition[] = WORKFLOW_STAGES.map(stageName => {
    const config = STAGE_CONFIG[stageName] ?? {
      participantRoles: ["ceo", "manager", "worker"] as const,
      executionStrategy: "sequential" as const,
    };
    return {
      name: stageName,
      label: WORKFLOW_STAGE_LABELS[stageName],
      participantRoles: config.participantRoles,
      executionStrategy: config.executionStrategy,
    };
  });

  // --- 4. Skills (deduplicated) ---
  const skillMap = new Map<string, SkillDefinition>();
  for (const node of organization.nodes) {
    const skills = node.skills ?? [];
    for (const skill of skills) {
      if (!skillMap.has(skill.id)) {
        skillMap.set(skill.id, {
          id: skill.id,
          name: skill.name,
          summary: skill.summary,
          prompt: skill.prompt,
        });
      }
    }
  }

  // --- 5. Tools (deduplicated) ---
  const toolMap = new Map<string, ToolDefinition>();
  for (const node of organization.nodes) {
    const mcpBindings = node.mcp ?? [];
    for (const mcp of mcpBindings) {
      if (!toolMap.has(mcp.id)) {
        toolMap.set(mcp.id, {
          id: mcp.id,
          name: mcp.name,
          server: mcp.server,
          description: mcp.description,
          tools: mcp.tools,
          connection: {
            transport: mcp.connection.transport,
            endpoint: mcp.connection.endpoint,
          },
        });
      }
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      workflowId: workflow.id,
      directive: workflow.directive,
      status: workflow.status,
    },
    agents,
    teams,
    pipeline: { stages },
    skills: Array.from(skillMap.values()),
    tools: Array.from(toolMap.values()),
  };
}

// ---------------------------------------------------------------------------
// 内部辅助：Node → AgentDefinition
// ---------------------------------------------------------------------------

function mapNodeToAgent(node: WorkflowOrganizationNode): AgentDefinition {
  const skillIds = (node.skills ?? []).map(s => s.id);
  const toolIds = (node.mcp ?? []).map(m => m.id);

  return {
    id: node.agentId,
    name: node.name,
    role: node.role,
    title: node.title,
    responsibility: node.responsibility,
    goals: node.goals,
    skillIds,
    toolIds,
    model: {
      name: node.model.model,
      temperature: node.model.temperature,
      maxTokens: node.model.maxTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// IR 序列化与反序列化
// ---------------------------------------------------------------------------

/**
 * 将 ExportIR 序列化为 JSON 字符串。
 *
 * @param ir - 要序列化的 ExportIR 对象
 * @returns JSON 字符串
 */
export function serializeIR(ir: ExportIR): string {
  return JSON.stringify(ir);
}

/**
 * 从 JSON 字符串反序列化还原 ExportIR，含基本类型校验。
 *
 * 校验规则：
 * - JSON 必须可解析
 * - version 字段必须为 1
 * - 必须包含所有顶层必需字段
 *
 * @param json - JSON 字符串
 * @returns 还原的 ExportIR 对象
 * @throws Error 如果 JSON 无效或缺少必需字段
 */
export function deserializeIR(json: string): ExportIR {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON string");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid IR: expected a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  // Check required top-level fields
  const requiredFields = [
    "version",
    "exportedAt",
    "source",
    "agents",
    "teams",
    "pipeline",
    "skills",
    "tools",
  ] as const;

  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new Error(`Invalid IR: missing required field "${field}"`);
    }
  }

  // Validate version
  if (obj.version !== 1) {
    throw new Error(
      `Invalid IR: unsupported version ${String(obj.version)}, expected 1`
    );
  }

  // Validate field types
  if (typeof obj.exportedAt !== "string") {
    throw new Error('Invalid IR: "exportedAt" must be a string');
  }

  if (typeof obj.source !== "object" || obj.source === null) {
    throw new Error('Invalid IR: "source" must be an object');
  }

  if (!Array.isArray(obj.agents)) {
    throw new Error('Invalid IR: "agents" must be an array');
  }

  if (!Array.isArray(obj.teams)) {
    throw new Error('Invalid IR: "teams" must be an array');
  }

  if (typeof obj.pipeline !== "object" || obj.pipeline === null) {
    throw new Error('Invalid IR: "pipeline" must be an object');
  }

  if (!Array.isArray(obj.skills)) {
    throw new Error('Invalid IR: "skills" must be an array');
  }

  if (!Array.isArray(obj.tools)) {
    throw new Error('Invalid IR: "tools" must be an array');
  }

  return parsed as ExportIR;
}
