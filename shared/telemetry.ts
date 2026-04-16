/**
 * 遥测数据模型 — 前后端共享类型定义
 *
 * 定义 LLM 调用记录、Agent 计时、预警、指标快照、历史摘要等数据结构，
 * 以及费用预估函数和默认预算常量。
 *
 * 注意：事件总线契约在 shared/telemetry/contracts.ts 中定义，本文件仅定义数据模型。
 */

// ---------------------------------------------------------------------------
// 接口定义
// ---------------------------------------------------------------------------

/** 单次 LLM 调用记录 */
export interface LLMCallRecord {
  id: string;
  timestamp: number; // Unix ms
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number; // 预估费用（美元）
  durationMs: number;
  agentId?: string;
  workflowId?: string;
  missionId?: string;
  error?: string; // 失败时记录错误信息
}

/** Agent 响应时间记录 */
export interface AgentTimingRecord {
  agentId: string;
  agentName: string;
  durationMs: number;
  timestamp: number;
  workflowId?: string;
}

/** 预警事件 */
export interface TelemetryAlert {
  id: string;
  type: "agent_slow" | "token_over_budget";
  agentId?: string;
  message: string;
  timestamp: number;
  resolved: boolean;
}

/** Agent 响应时间摘要 */
export interface AgentTimingSummary {
  agentId: string;
  agentName: string;
  avgDurationMs: number;
  callCount: number;
}

/** Mission 阶段耗时 */
export interface MissionStageTiming {
  stageKey: string;
  stageLabel: string;
  durationMs: number;
}

/** 实时指标快照 */
export interface TelemetrySnapshot {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalCalls: number;
  activeAgentCount: number;
  agentTimings: AgentTimingSummary[]; // 按平均耗时降序
  missionStageTimings: MissionStageTiming[];
  alerts: TelemetryAlert[];
  updatedAt: number;
}

/** 历史 Mission 指标摘要 */
export interface MissionTelemetrySummary {
  missionId: string;
  title: string;
  completedAt: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalCalls: number;
  topAgents: AgentTimingSummary[];
  stageTimings: MissionStageTiming[];
}

/** Token 预算配置 */
export interface TelemetryBudget {
  maxTokens: number; // 默认 100000
  warningThreshold: number; // 默认 0.8（80%）
}

// ---------------------------------------------------------------------------
// 费用预估
// ---------------------------------------------------------------------------

/** 每 1K Token 的费用（美元），按模型分类 */
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "glm-5-turbo": { input: 0.001, output: 0.002 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  default: { input: 0.001, output: 0.002 },
};

/**
 * 根据模型和 Token 数量预估费用（美元）。
 * 未知模型使用 default 定价兜底。
 */
export function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const pricing = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS.default;
  return (
    (tokensIn / 1000) * pricing.input + (tokensOut / 1000) * pricing.output
  );
}

// ---------------------------------------------------------------------------
// 默认预算
// ---------------------------------------------------------------------------

/** 默认 Token 预算配置 */
export const DEFAULT_BUDGET: TelemetryBudget = {
  maxTokens: 100_000,
  warningThreshold: 0.8,
};
