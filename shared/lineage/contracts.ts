/**
 * 数据血缘追踪 契约
 *
 * 定义血缘节点、边、审计日志、变更告警、数据质量指标等核心类型。
 * 前后端共享，保持类型一致性。
 */

// ─── 血缘节点类型 ──────────────────────────────────────────────────────────

/** 血缘节点类型常量 */
export const LINEAGE_NODE_TYPES = [
  "source",
  "transformation",
  "decision",
] as const;
/** 血缘节点类型 */
export type LineageNodeType = (typeof LINEAGE_NODE_TYPES)[number];

/** 血缘操作类型常量 */
export const LINEAGE_OPERATIONS = [
  "query",
  "filter",
  "aggregate",
  "join",
  "ml_inference",
  "transform",
  "enrich",
  "validate",
  "llm_call",
] as const;
/** 血缘操作类型（允许自定义扩展） */
export type LineageOperation = (typeof LINEAGE_OPERATIONS)[number] | string;

// ─── 血缘上下文 ────────────────────────────────────────────────────────────

/** 血缘采集上下文 */
export interface LineageContext {
  sessionId?: string;
  userId?: string;
  requestId?: string;
  environment?: string;
  missionId?: string;
  workflowId?: string;
}

// ─── 血缘节点 ──────────────────────────────────────────────────────────────

/** 数据血缘节点 */
export interface DataLineageNode {
  /** UUID v4 唯一标识 */
  lineageId: string;
  /** 节点类型 */
  type: LineageNodeType;
  /** 创建时间（epoch ms） */
  timestamp: number;
  /** 采集上下文 */
  context: LineageContext;

  // ── 源头节点字段 (type === "source") ──
  sourceId?: string;
  sourceName?: string;
  queryText?: string;
  /** SHA256 结果哈希 */
  resultHash?: string;
  resultSize?: number;

  // ── 变换节点字段 (type === "transformation") ──
  agentId?: string;
  operation?: LineageOperation;
  /** 代码位置 "filename:line" */
  codeLocation?: string;
  parameters?: Record<string, unknown>;
  inputLineageIds?: string[];
  outputLineageId?: string;
  dataChanged?: boolean;
  executionTimeMs?: number;

  // ── 决策节点字段 (type === "decision") ──
  decisionId?: string;
  decisionLogic?: string;
  result?: string;
  confidence?: number;
  modelVersion?: string;

  // ── 通用字段 ──
  metadata?: Record<string, unknown>;
  /** 合规标签（GDPR、PCI 等） */
  complianceTags?: string[];
  /** 上游 lineageId 列表 */
  upstream?: string[];
  /** 下游 lineageId 列表（运行时填充） */
  downstream?: string[];
}

// ─── 血缘边 ────────────────────────────────────────────────────────────────

/** 血缘边类型常量 */
export const LINEAGE_EDGE_TYPES = [
  "derived-from",
  "input-to",
  "decided-by",
  "produced-by",
] as const;
/** 血缘边类型 */
export type LineageEdgeType = (typeof LINEAGE_EDGE_TYPES)[number];

/** 血缘边（节点间依赖关系） */
export interface LineageEdge {
  /** 上游 lineageId */
  fromId: string;
  /** 下游 lineageId */
  toId: string;
  /** 边类型 */
  type: LineageEdgeType;
  /** 依赖权重 0-1 */
  weight?: number;
  /** 创建时间（epoch ms） */
  timestamp: number;
}

// ─── 审计日志 ──────────────────────────────────────────────────────────────

/** 血缘审计日志条目 */
export interface AuditLogEntry {
  id: string;
  userId: string;
  timestamp: number;
  dataId: string;
  agentId?: string;
  operation: string;
  decisionId?: string;
  result?: string;
  sourceIp?: string;
}

// ─── 变更告警 ──────────────────────────────────────────────────────────────

/** 变更告警类型常量 */
export const CHANGE_ALERT_TYPES = [
  "schema_change",
  "data_volume_anomaly",
  "quality_degradation",
  "hash_mismatch",
] as const;
/** 变更告警类型 */
export type ChangeAlertType = (typeof CHANGE_ALERT_TYPES)[number];

/** 风险等级常量 */
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
/** 风险等级 */
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** 变更告警 */
export interface ChangeAlert {
  id: string;
  type: ChangeAlertType;
  dataId: string;
  previousHash?: string;
  currentHash?: string;
  affectedAgents: string[];
  affectedDecisions: string[];
  riskLevel: RiskLevel;
  timestamp: number;
  details?: string;
}

// ─── 数据质量指标 ──────────────────────────────────────────────────────────

/** 数据质量指标 */
export interface DataQualityMetrics {
  dataId: string;
  /** 数据新鲜度 0-1 */
  freshness: number;
  /** 字段完整度 0-1 */
  completeness: number;
  /** 准确度估计 0-1 */
  accuracy: number;
  /** 测量时间（epoch ms） */
  measuredAt: number;
}

// ─── 查询过滤器 ────────────────────────────────────────────────────────────

/** 血缘节点查询过滤器 */
export interface LineageQueryFilter {
  type?: LineageNodeType;
  agentId?: string;
  sessionId?: string;
  missionId?: string;
  decisionId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}

/** 血缘边查询过滤器 */
export interface LineageEdgeFilter {
  fromId?: string;
  toId?: string;
  type?: LineageEdgeType;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}

/** 血缘存储统计信息 */
export interface LineageStoreStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<LineageNodeType, number>;
  oldestTimestamp: number;
  newestTimestamp: number;
}

// ─── 图查询结果 ────────────────────────────────────────────────────────────

/** 血缘图（节点 + 边） */
export interface LineageGraph {
  nodes: DataLineageNode[];
  edges: LineageEdge[];
}

/** 影响分析结果 */
export interface ImpactAnalysisResult {
  affectedNodes: DataLineageNode[];
  affectedDecisions: DataLineageNode[];
  riskLevel: RiskLevel;
  paths: LineageGraph;
}

// ─── 采集器输入类型 ────────────────────────────────────────────────────────

/** 记录数据源血缘输入 */
export interface RecordSourceInput {
  sourceId: string;
  sourceName: string;
  queryText?: string;
  resultHash?: string;
  resultSize?: number;
  context?: LineageContext;
  metadata?: Record<string, unknown>;
  complianceTags?: string[];
}

/** 记录变换血缘输入 */
export interface RecordTransformationInput {
  agentId: string;
  operation: LineageOperation;
  inputLineageIds: string[];
  parameters?: Record<string, unknown>;
  dataChanged?: boolean;
  executionTimeMs?: number;
  context?: LineageContext;
  metadata?: Record<string, unknown>;
  complianceTags?: string[];
}

/** 记录决策血缘输入 */
export interface RecordDecisionInput {
  decisionId: string;
  agentId?: string;
  inputLineageIds: string[];
  decisionLogic?: string;
  result?: string;
  confidence?: number;
  modelVersion?: string;
  context?: LineageContext;
  metadata?: Record<string, unknown>;
  complianceTags?: string[];
}

// ─── 时间范围与报告 ────────────────────────────────────────────────────────

/** 时间范围 */
export interface TimeRange {
  start: number;
  end: number;
}

/** 血缘报告 */
export interface LineageReport {
  decisionId: string;
  decision: DataLineageNode;
  upstreamGraph: LineageGraph;
  auditTrail: AuditLogEntry[];
  generatedAt: number;
}

/** 导入结果 */
export interface ImportResult {
  importedNodes: number;
  importedEdges: number;
  skippedDuplicates: number;
  errors: string[];
}

// ─── 前端过滤器 ────────────────────────────────────────────────────────────

/** 前端血缘过滤器 */
export interface LineageFilters {
  nodeType?: LineageNodeType;
  agentId?: string;
  timeRange?: TimeRange;
  sourceId?: string;
  searchText?: string;
}
