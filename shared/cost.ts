/**
 * 成本可观测性 — 共享类型定义与定价表
 *
 * 前后端共享的成本数据结构、模型定价表和费用预估纯函数。
 * 所有接口均支持 JSON 序列化/反序列化，可直接用于 REST API 和 Socket.IO 传输。
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.4, 13.1
 */

// ---------------------------------------------------------------------------
// 模型定价
// ---------------------------------------------------------------------------

/** 模型单价（每千 Token 美元） */
export interface ModelPricing {
  /** 每千 input token 美元 */
  input: number;
  /** 每千 output token 美元 */
  output: number;
}

/** 定价表：各模型的 input/output 单价 */
export const PRICING_TABLE: Record<string, ModelPricing> = {
  'glm-5-turbo': { input: 0.001, output: 0.002 },
  'glm-4.6':     { input: 0.002, output: 0.004 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o':      { input: 0.005, output: 0.015 },
};

/** 未知模型的兜底定价 */
export const DEFAULT_PRICING: ModelPricing = { input: 0.001, output: 0.002 };

/**
 * 费用预估纯函数
 *
 * 根据模型定价表计算预估费用。未知模型使用 DEFAULT_PRICING 兜底。
 *
 * @param model    - 模型名称
 * @param tokensIn - input token 数量
 * @param tokensOut - output token 数量
 * @returns 预估费用（美元）
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING_TABLE[model] ?? DEFAULT_PRICING;
  return (tokensIn / 1000) * pricing.input + (tokensOut / 1000) * pricing.output;
}

// ---------------------------------------------------------------------------
// 成本记录
// ---------------------------------------------------------------------------

/** 单次 LLM 调用成本记录 */
export interface CostRecord {
  id: string;
  timestamp: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** input 单价（每千 Token 美元） */
  unitPriceIn: number;
  /** output 单价（每千 Token 美元） */
  unitPriceOut: number;
  /** 实际费用（美元） */
  actualCost: number;
  /** 调用耗时（毫秒） */
  durationMs: number;
  agentId?: string;
  missionId?: string;
  sessionId?: string;
  /** 调用失败时的错误信息 */
  error?: string;
}

// ---------------------------------------------------------------------------
// 预算与降级
// ---------------------------------------------------------------------------

/** 预算配置 */
export interface Budget {
  /** 最大费用（美元） */
  maxCost: number;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 预警阈值百分比（0-1），默认 0.8 */
  warningThreshold: number;
}

/** 降级策略 */
export interface DowngradePolicy {
  enabled: boolean;
  /** 低成本替代模型 */
  lowCostModel: string;
  /** 关键 Agent 白名单（不会被暂停） */
  criticalAgentIds: string[];
}

/** 降级状态 */
export type DowngradeLevel = 'none' | 'soft' | 'hard';

// ---------------------------------------------------------------------------
// 预警
// ---------------------------------------------------------------------------

/** 成本预警 */
export interface CostAlert {
  id: string;
  type: 'cost_warning' | 'cost_exceeded' | 'token_warning' | 'token_exceeded';
  message: string;
  timestamp: number;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// 聚合摘要
// ---------------------------------------------------------------------------

/** Agent 成本摘要 */
export interface AgentCostSummary {
  agentId: string;
  agentName: string;
  tokensIn: number;
  tokensOut: number;
  totalCost: number;
  callCount: number;
}

/** 实时成本快照 */
export interface CostSnapshot {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalCalls: number;
  /** 费用维度已用百分比 */
  budgetUsedPercent: number;
  /** Token 维度已用百分比 */
  tokenUsedPercent: number;
  /** 按费用降序排列的 Agent 成本摘要 */
  agentCosts: AgentCostSummary[];
  alerts: CostAlert[];
  downgradeLevel: DowngradeLevel;
  budget: Budget;
  updatedAt: number;
}

/** 历史 Mission 成本摘要 */
export interface MissionCostSummary {
  missionId: string;
  title: string;
  completedAt: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalCalls: number;
  topAgents: AgentCostSummary[];
}

// ---------------------------------------------------------------------------
// 默认值
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGET: Budget = {
  maxCost: 1.0,
  maxTokens: 100000,
  warningThreshold: 0.8,
};

export const DEFAULT_DOWNGRADE_POLICY: DowngradePolicy = {
  enabled: true,
  lowCostModel: 'glm-4.6',
  criticalAgentIds: [],
};
