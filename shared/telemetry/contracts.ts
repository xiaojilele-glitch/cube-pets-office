/**
 * 事件总线与可观测性契约
 *
 * telemetry-dashboard、cost-observability、state-persistence-recovery
 * 三个模块共享此契约。约定事件名前缀、payload 结构、IndexedDB store key。
 */

// ---------------------------------------------------------------------------
// 事件名前缀约定
// ---------------------------------------------------------------------------

/** 所有遥测事件以 "telemetry:" 为前缀 */
export const TELEMETRY_EVENT_PREFIX = "telemetry:" as const;
/** 所有成本事件以 "cost:" 为前缀 */
export const COST_EVENT_PREFIX = "cost:" as const;
/** 所有持久化恢复事件以 "recovery:" 为前缀 */
export const RECOVERY_EVENT_PREFIX = "recovery:" as const;

// ---------------------------------------------------------------------------
// 遥测事件
// ---------------------------------------------------------------------------

export interface TelemetryLLMCallEvent {
  type: "telemetry:llm_call";
  timestamp: number;
  agentId: string;
  workflowId?: string;
  missionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string;
}

export interface TelemetryStageEvent {
  type: "telemetry:stage_complete";
  timestamp: number;
  workflowId: string;
  stage: string;
  durationMs: number;
  agentCount: number;
  taskCount: number;
}

export interface TelemetryMissionEvent {
  type: "telemetry:mission_update";
  timestamp: number;
  missionId: string;
  status: string;
  stageKey?: string;
  progress: number;
  durationMs?: number;
}

export type TelemetryEvent =
  | TelemetryLLMCallEvent
  | TelemetryStageEvent
  | TelemetryMissionEvent;

// ---------------------------------------------------------------------------
// 成本事件
// ---------------------------------------------------------------------------

export interface CostEstimate {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 估算费用（美元），基于模型定价表 */
  estimatedCostUsd: number;
  /** 累计费用（当前会话/工作流） */
  cumulativeCostUsd: number;
}

export interface CostBudgetAlert {
  type: "cost:budget_alert";
  timestamp: number;
  level: "warning" | "critical";
  currentCostUsd: number;
  budgetLimitUsd: number;
  percentUsed: number;
  recommendation: string;
}

export interface CostLLMCallRecord {
  type: "cost:llm_call";
  timestamp: number;
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  workflowId?: string;
  missionId?: string;
  stage?: string;
}

export type CostEvent = CostBudgetAlert | CostLLMCallRecord;

// ---------------------------------------------------------------------------
// 持久化恢复事件
// ---------------------------------------------------------------------------

export interface RecoveryCheckpoint {
  type: "recovery:checkpoint";
  timestamp: number;
  sessionId: string;
  workflowId?: string;
  missionId?: string;
  stage?: string;
  progress: number;
  stateSnapshot: string;
}

export interface RecoveryRestoreEvent {
  type: "recovery:restore";
  timestamp: number;
  sessionId: string;
  restoredFromTimestamp: number;
  success: boolean;
  errorMessage?: string;
}

export type RecoveryEvent = RecoveryCheckpoint | RecoveryRestoreEvent;

// ---------------------------------------------------------------------------
// 统一事件联合类型
// ---------------------------------------------------------------------------

export type ObservabilityEvent = TelemetryEvent | CostEvent | RecoveryEvent;

// ---------------------------------------------------------------------------
// IndexedDB Store Key 命名规范
// ---------------------------------------------------------------------------

/** 所有可观测性模块的 IndexedDB store 名称 */
export const OBSERVABILITY_IDB_STORES = {
  /** 遥测事件历史 */
  telemetryEvents: "obs_telemetry_events",
  /** 遥测聚合统计（按小时/天） */
  telemetryAggregates: "obs_telemetry_aggregates",
  /** 成本记录 */
  costRecords: "obs_cost_records",
  /** 成本预算配置 */
  costBudgets: "obs_cost_budgets",
  /** 恢复检查点 */
  recoveryCheckpoints: "obs_recovery_checkpoints",
  /** 恢复会话状态 */
  recoverySessions: "obs_recovery_sessions",
} as const;

export type ObservabilityIDBStoreName =
  (typeof OBSERVABILITY_IDB_STORES)[keyof typeof OBSERVABILITY_IDB_STORES];

// ---------------------------------------------------------------------------
// 遥测聚合结构
// ---------------------------------------------------------------------------

export interface TelemetryAggregate {
  /** 聚合粒度 */
  granularity: "hour" | "day";
  /** 时间桶起始时间戳 */
  bucketStart: number;
  /** LLM 调用次数 */
  llmCallCount: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 总延迟（毫秒） */
  totalLatencyMs: number;
  /** 错误次数 */
  errorCount: number;
  /** 估算总费用 */
  estimatedCostUsd: number;
  /** 按模型分组统计 */
  byModel: Record<
    string,
    {
      callCount: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }
  >;
  /** 按智能体分组统计 */
  byAgent: Record<
    string,
    {
      callCount: number;
      totalTokens: number;
    }
  >;
}
