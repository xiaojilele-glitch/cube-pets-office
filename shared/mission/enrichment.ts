/**
 * MissionRecord 丰富化字段契约
 *
 * workflow-decoupling 的目标：让 MissionRecord 自身携带足够的数据，
 * 使 tasks-store 不再需要从 workflow-store 投影 agent crew、work packages 等信息。
 *
 * mission-native-projection 的 /api/planets 路由设计依赖此结构。
 */

// ---------------------------------------------------------------------------
// Mission 域自有角色类型（解耦自 workflow-runtime 的 AgentRole）
// ---------------------------------------------------------------------------

export type MissionAgentRole = "ceo" | "manager" | "worker";

// ---------------------------------------------------------------------------
// 组织快照（精简版，不含完整 skills/mcp/model 配置）
// ---------------------------------------------------------------------------

export interface MissionOrganizationDepartment {
  id: string;
  label: string;
  managerName: string;
  workerCount: number;
  direction: string;
}

export interface MissionOrganizationSnapshot {
  source: "generated" | "fallback";
  taskProfile: string;
  reasoning: string;
  departments: MissionOrganizationDepartment[];
  totalAgentCount: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Agent Crew（参与的智能体列表）
// ---------------------------------------------------------------------------

export interface MissionAgentCrewMember {
  agentId: string;
  name: string;
  role: MissionAgentRole;
  department: string;
  departmentLabel: string;
  title: string;
  responsibility: string;
  /** 当前状态（由 mission 阶段推导） */
  status: "idle" | "working" | "reviewing" | "done" | "error";
  /** 最近一条消息预览 */
  lastMessage?: string;
  /** 评分（如果是 worker 且已评审） */
  totalScore?: number;
}

// ---------------------------------------------------------------------------
// Work Packages（任务包列表）
// ---------------------------------------------------------------------------

export interface MissionWorkPackage {
  taskId: number;
  workerId: string;
  workerName: string;
  managerId: string;
  department: string;
  departmentLabel: string;
  description: string;
  status: string;
  version: number;
  /** 交付物预览（截取前 200 字符） */
  deliverablePreview?: string;
  /** 评分 */
  totalScore?: number;
  scoreBreakdown?: {
    accuracy: number;
    completeness: number;
    actionability: number;
    format: number;
  };
  /** 经理反馈预览 */
  feedbackPreview?: string;
  /** 是否被退回修订 */
  wasRevised: boolean;
}

// ---------------------------------------------------------------------------
// 消息日志（最近 N 条）
// ---------------------------------------------------------------------------

export interface MissionMessageLogEntry {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  stage: string;
  preview: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// MissionRecord 丰富化扩展字段
// ---------------------------------------------------------------------------

/**
 * 这些字段将作为 optional 添加到 MissionRecord 接口中。
 * 在 MissionOrchestrator 的工作流阶段完成回调中填充。
 *
 * 填充时机：
 * - organization: direction/planning 阶段完成后
 * - agentCrew: direction/planning 阶段完成后
 * - workPackages: execution/review/revision/verify 阶段完成后
 * - messageLog: 每个阶段完成后更新（保留最近 50 条）
 */
export interface MissionEnrichmentFields {
  organization?: MissionOrganizationSnapshot;
  agentCrew?: MissionAgentCrewMember[];
  workPackages?: MissionWorkPackage[];
  messageLog?: MissionMessageLogEntry[];
}

// ---------------------------------------------------------------------------
// /api/planets 路由响应类型
// ---------------------------------------------------------------------------

/**
 * GET /api/planets 返回的星球列表项。
 * 复用 MissionPlanetOverviewItem（已在 contracts.ts 中定义），
 * 此处补充丰富化字段的投影。
 */
export interface PlanetOverviewWithEnrichment {
  id: string;
  title: string;
  status: string;
  progress: number;
  currentStageKey?: string;
  currentStageLabel?: string;
  /** 从 organization 投影 */
  departmentCount: number;
  agentCount: number;
  taskProfile?: string;
  /** 从 workPackages 投影 */
  taskCount: number;
  averageScore?: number;
  /** 从 agentCrew 投影 */
  activeAgentCount: number;
}

/**
 * GET /api/planets/:id/interior 返回的星球内部数据。
 * 复用 MissionPlanetInteriorData（已在 contracts.ts 中定义），
 * 此处补充丰富化字段。
 */
export interface PlanetInteriorWithEnrichment {
  organization?: MissionOrganizationSnapshot;
  agentCrew?: MissionAgentCrewMember[];
  workPackages?: MissionWorkPackage[];
  messageLog?: MissionMessageLogEntry[];
}
