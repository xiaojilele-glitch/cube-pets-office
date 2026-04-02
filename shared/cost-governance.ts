/**
 * 成本治理策略 — 共享类型定义
 *
 * 前后端共享的成本治理数据结构、常量和工具函数。
 * 在 cost-observability 基础上扩展，提供多级预算、告警、降级、限流、
 * 暂停审批、预测、优化、分摊、报表、权限和审计等完整治理能力。
 *
 * @see Requirements 1.1, 1.2, 1.4, 1.5, 3.1, 4.1, 5.1, 6.1, 9.1, 14.1
 */

import type { CostRecord, Budget, ModelPricing } from './cost';

// ===== 预算类型 =====

/** 预算类型：固定 / 按比例 / 动态 */
export type BudgetType = 'FIXED' | 'PERCENTAGE' | 'DYNAMIC';

/** 预算周期：整个 Mission / 每天 / 每小时 */
export type BudgetPeriod = 'MISSION' | 'DAILY' | 'HOURLY';

/** 支持的币种 */
export type Currency = 'USD' | 'CNY';

/** 按模型分配的 Token 额度 */
export interface TokenBudgetByModel {
  model: string;
  maxTokens: number;
}

/** 告警阈值配置 */
export interface AlertThresholdConfig {
  /** 百分比 0-100 */
  percent: number;
  responseStrategy: AlertResponseStrategy;
}

/** 告警响应策略 */
export type AlertResponseStrategy = 'LOG' | 'REDUCE_CONCURRENCY' | 'DOWNGRADE_MODEL' | 'PAUSE_TASK';

/** Mission 级成本预算 */
export interface MissionBudget {
  missionId: string;
  budgetType: BudgetType;
  tokenBudget: number;
  tokenBudgetByModel?: TokenBudgetByModel[];
  costBudget: number;
  currency: Currency;
  budgetPeriod: BudgetPeriod;
  alertThresholds: AlertThresholdConfig[];
  /** 上级预算 ID */
  parentBudgetId?: string;
  createdAt: number;
  updatedAt: number;
}

// ===== 告警类型 =====

/** 四级告警类型 */
export type AlertType = 'WARNING' | 'CAUTION' | 'CRITICAL' | 'EXCEEDED';

/** 预算告警事件 */
export interface BudgetAlert {
  alertId: string;
  missionId: string;
  alertType: AlertType;
  threshold: number;
  currentCost: number;
  budgetRemaining: number;
  timestamp: number;
  action: AlertResponseStrategy;
  resolved: boolean;
}

// ===== 模型降级 =====

/** 模型降级策略 */
export interface ModelDowngradePolicy {
  sourceModel: string;
  targetModel: string;
  /** 触发阈值 0-100 */
  triggerThreshold: number;
  downgradeConditions: DowngradeCondition[];
}

/** 降级条件 */
export interface DowngradeCondition {
  type: 'COST_THRESHOLD' | 'TASK_COMPLEXITY' | 'AGENT_TYPE';
  value: string | number;
}

/** 降级记录 */
export interface DowngradeRecord {
  id: string;
  missionId: string;
  sourceModel: string;
  targetModel: string;
  reason: string;
  expectedSaving: number;
  timestamp: number;
  status: 'APPLIED' | 'ROLLED_BACK' | 'FAILED';
  rollbackReason?: string;
}

// ===== 并发/速率限制 =====

/** 并发限制级别 */
export type ConcurrencyLevel = 'NORMAL' | 'LOW' | 'MINIMAL' | 'SINGLE';

/** 速率限制级别 */
export type RateLevel = 'NORMAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** 并发限制策略 */
export interface ConcurrencyLimitPolicy {
  missionId: string;
  maxConcurrency: number;
  /** req/min */
  rateLimit: number;
  triggerThreshold: number;
  currentConcurrencyLevel: ConcurrencyLevel;
  currentRateLevel: RateLevel;
}

// ===== 任务暂停与审批 =====

/** 暂停触发条件 */
export type PauseTrigger = 'BUDGET_EXCEEDED' | 'CRITICAL_THRESHOLD' | 'ANOMALY_DETECTED';

/** 审批操作 */
export type ApprovalAction = 'CONTINUE' | 'INCREASE_BUDGET' | 'DOWNGRADE_AND_CONTINUE' | 'CANCEL';

/** 审批状态 */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMEOUT';

/** 任务暂停策略 */
export interface TaskPausePolicy {
  missionId: string;
  pauseTrigger: PauseTrigger;
  /** 暂停时长（ms） */
  pauseDuration: number;
  requiresApproval: boolean;
}

/** 审批请求 */
export interface ApprovalRequest {
  requestId: string;
  missionId: string;
  reason: string;
  currentCost: number;
  budgetRemaining: number;
  suggestedActions: ApprovalAction[];
  /** 审批级别 */
  approvalLevel: number;
  status: ApprovalStatus;
  createdAt: number;
  timeoutAt: number;
  resolvedAt?: number;
  resolvedAction?: ApprovalAction;
  resolvedBy?: string;
}

// ===== 成本优化 =====

/** 优化建议类型 */
export type OptimizationType = 'MODEL' | 'PROMPT' | 'CACHE' | 'CONCURRENCY';

/** 风险级别 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** 优化建议状态 */
export type OptimizationStatus = 'SUGGESTED' | 'APPLIED' | 'REJECTED' | 'FAILED';

/** 成本优化建议 */
export interface CostOptimizationSuggestion {
  id: string;
  missionId: string;
  type: OptimizationType;
  description: string;
  expectedSaving: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  riskLevel: RiskLevel;
  status: OptimizationStatus;
  createdAt: number;
  appliedAt?: number;
}

// ===== 成本预测 =====

/** 预测方法 */
export type PredictionMethod = 'HISTORICAL_ANALOGY' | 'COMPLEXITY_ESTIMATE' | 'PRICING_CALCULATION';

/** 成本预测结果 */
export interface CostPrediction {
  missionId: string;
  pointEstimate: number;
  confidenceInterval: { low: number; high: number };
  method: PredictionMethod;
  /** 置信度 0-1 */
  confidence: number;
  predictedAt: number;
  /** 基于多少进度预测 0-1 */
  basedOnProgress?: number;
}

// ===== 成本分摊 =====

/** 分摊类型 */
export type AllocationType = 'EQUAL' | 'WEIGHTED' | 'USAGE';

/** 分摊维度 */
export type AllocationDimension = 'DEPARTMENT' | 'USER' | 'PROJECT' | 'COST_CENTER';

/** 分摊目标 */
export interface AllocationTarget {
  dimension: AllocationDimension;
  targetId: string;
  targetName: string;
  /** WEIGHTED 模式下的权重 */
  weight?: number;
  /** 分摊后的金额 */
  amount?: number;
}

/** 成本分摊规则 */
export interface CostAllocation {
  allocationId: string;
  missionId: string;
  allocationType: AllocationType;
  totalCost: number;
  allocations: AllocationTarget[];
  createdAt: number;
  updatedAt: number;
}

// ===== 成本报表 =====

/** 报表类型 */
export type ReportType = 'SUMMARY' | 'DETAIL' | 'TREND' | 'DISTRIBUTION' | 'COMPARISON';

/** 报表维度 */
export type ReportDimension = 'MISSION' | 'AGENT' | 'MODEL' | 'USER' | 'DEPARTMENT' | 'TIME_PERIOD';

/** 报表请求 */
export interface CostReportRequest {
  reportType: ReportType;
  dimensions: ReportDimension[];
  timeRange: { start: number; end: number };
  filters?: Record<string, string>;
}

/** 报表结果 */
export interface CostReportResult {
  reportType: ReportType;
  generatedAt: number;
  data: CostReportDataItem[];
  anomalies: CostAnomaly[];
  trends?: TrendData;
}

/** 报表数据项 */
export interface CostReportDataItem {
  dimension: string;
  dimensionValue: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
  avgCostPerCall: number;
}

/** 成本异常 */
export interface CostAnomaly {
  entityType: 'MISSION' | 'AGENT';
  entityId: string;
  entityName: string;
  anomalyType: 'HIGH_COST' | 'RAPID_GROWTH' | 'UNUSUAL_PATTERN';
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** 趋势数据 */
export interface TrendData {
  dailyAvg: number;
  weeklyAvg: number;
  monthlyAvg: number;
  /** 增长率百分比 */
  growthRate: number;
}

// ===== 预算层级 =====

/** 预算层级 */
export type BudgetLevel = 'ORGANIZATION' | 'DEPARTMENT' | 'PROJECT' | 'MISSION';

/** 层级预算 */
export interface HierarchicalBudget {
  id: string;
  level: BudgetLevel;
  name: string;
  parentId?: string;
  totalBudget: number;
  usedBudget: number;
  currency: Currency;
  children?: HierarchicalBudget[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** 预算模板 */
export interface BudgetTemplate {
  id: string;
  /** 如 "标准编程任务预算" */
  name: string;
  description: string;
  defaultBudget: number;
  defaultTokenBudget: number;
  defaultPeriod: BudgetPeriod;
  defaultAlertThresholds: AlertThresholdConfig[];
}

// ===== 成本权限 =====

/** 基于成本的权限控制 */
export interface CostPermission {
  userId: string;
  monthlyBudget: number;
  dailyBudget: number;
  /** 允许使用的模型列表 */
  modelRestrictions: string[];
  usedMonthly: number;
  usedDaily: number;
  updatedAt: number;
}

// ===== 审计链 =====

/** 审计操作类型 */
export type AuditAction =
  | 'ALERT_TRIGGERED' | 'DOWNGRADE_APPLIED' | 'DOWNGRADE_ROLLED_BACK'
  | 'CONCURRENCY_LIMITED' | 'RATE_LIMITED'
  | 'TASK_PAUSED' | 'TASK_RESUMED' | 'APPROVAL_REQUESTED' | 'APPROVAL_RESOLVED'
  | 'OPTIMIZATION_APPLIED' | 'BUDGET_CREATED' | 'BUDGET_MODIFIED'
  | 'PERMISSION_CHANGED';

/** 审计条目 */
export interface AuditEntry {
  id: string;
  action: AuditAction;
  missionId?: string;
  userId?: string;
  details: Record<string, unknown>;
  timestamp: number;
}

// ===== 治理状态快照 =====

/** Mission 治理状态快照 */
export interface GovernanceSnapshot {
  missionId: string;
  budget: MissionBudget | null;
  currentCost: number;
  budgetUsedPercent: number;
  activeAlerts: BudgetAlert[];
  concurrencyLevel: ConcurrencyLevel;
  rateLevel: RateLevel;
  downgradeRecords: DowngradeRecord[];
  pendingApprovals: ApprovalRequest[];
  optimizationSuggestions: CostOptimizationSuggestion[];
  prediction: CostPrediction | null;
  updatedAt: number;
}

// ===== 常量 =====

/** 汇率表 */
export const EXCHANGE_RATES: Record<string, number> = {
  'USD_TO_CNY': 7.2,
  'CNY_TO_USD': 1 / 7.2,
};

/** 并发限制映射（倍率或绝对值） */
export const CONCURRENCY_LIMITS: Record<ConcurrencyLevel, number> = {
  NORMAL: Infinity,
  LOW: 0.5,
  MINIMAL: 0.25,
  SINGLE: 1,
};

/** 速率限制映射（req/min） */
export const RATE_LIMITS: Record<RateLevel, number> = {
  NORMAL: Infinity,
  HIGH: 100,
  MEDIUM: 10,
  LOW: 1,
};

/** 预定义降级链 */
export const DOWNGRADE_CHAIN: Record<string, string> = {
  'gpt-4o': 'gpt-4o-mini',
  'gpt-4o-mini': 'glm-4.6',
  'glm-4.6': 'glm-5-turbo',
};

/** 默认预算模板 */
export const DEFAULT_BUDGET_TEMPLATES: BudgetTemplate[] = [
  {
    id: 'standard-coding',
    name: '标准编程任务预算',
    description: '适用于一般编程任务，中等成本预算',
    defaultBudget: 5.0,
    defaultTokenBudget: 500000,
    defaultPeriod: 'MISSION',
    defaultAlertThresholds: [
      { percent: 50, responseStrategy: 'LOG' },
      { percent: 75, responseStrategy: 'REDUCE_CONCURRENCY' },
      { percent: 90, responseStrategy: 'DOWNGRADE_MODEL' },
      { percent: 100, responseStrategy: 'PAUSE_TASK' },
    ],
  },
  {
    id: 'data-analysis',
    name: '数据分析任务预算',
    description: '适用于数据分析任务，较高成本预算',
    defaultBudget: 20.0,
    defaultTokenBudget: 2000000,
    defaultPeriod: 'MISSION',
    defaultAlertThresholds: [
      { percent: 50, responseStrategy: 'LOG' },
      { percent: 75, responseStrategy: 'REDUCE_CONCURRENCY' },
      { percent: 90, responseStrategy: 'DOWNGRADE_MODEL' },
      { percent: 100, responseStrategy: 'PAUSE_TASK' },
    ],
  },
];

// ===== 工具函数 =====

/**
 * 币种转换
 *
 * 使用 EXCHANGE_RATES 中的固定汇率进行换算。
 * 同币种直接返回原值。
 */
export function convertCurrency(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const key = `${from}_TO_${to}`;
  return amount * (EXCHANGE_RATES[key] ?? 1);
}
