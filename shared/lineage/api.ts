/**
 * 数据血缘追踪 REST API 路由常量与请求/响应类型
 */

import type {
  AuditLogEntry,
  ChangeAlert,
  DataLineageNode,
  DataQualityMetrics,
  ImpactAnalysisResult,
  ImportResult,
  LineageFilters,
  LineageGraph,
  LineageReport,
  LineageStoreStats,
} from "./contracts.js";

// ─── REST API 路由常量 ─────────────────────────────────────────────────────

export const LINEAGE_API = {
  // 查询
  getUpstream:       "GET    /api/lineage/:id/upstream",
  getDownstream:     "GET    /api/lineage/:id/downstream",
  getFullPath:       "GET    /api/lineage/path",
  getImpactAnalysis: "GET    /api/lineage/:id/impact",
  getNode:           "GET    /api/lineage/:id",
  queryNodes:        "GET    /api/lineage",

  // 审计
  getAuditTrail:     "GET    /api/lineage/audit/trail",
  exportReport:      "GET    /api/lineage/audit/report/:decisionId",
  detectAnomalies:   "GET    /api/lineage/audit/anomalies",

  // 导入导出
  exportLineage:     "GET    /api/lineage/export",
  importLineage:     "POST   /api/lineage/import",

  // 变更检测
  detectChanges:     "POST   /api/lineage/changes/detect",
  getQualityMetrics: "GET    /api/lineage/quality/:dataId",

  // 统计
  getStats:          "GET    /api/lineage/stats",
} as const;

// ─── 通用错误响应 ──────────────────────────────────────────────────────────

export interface LineageApiErrorResponse {
  ok?: false;
  error: string;
}

// ─── 查询相关请求/响应 ────────────────────────────────────────────────────

export interface GetUpstreamQuery {
  depth?: number;
}

export interface GetUpstreamResponse {
  ok: true;
  graph: LineageGraph;
}

export interface GetDownstreamQuery {
  depth?: number;
}

export interface GetDownstreamResponse {
  ok: true;
  graph: LineageGraph;
}

export interface GetFullPathQuery {
  sourceId: string;
  decisionId: string;
}

export interface GetFullPathResponse {
  ok: true;
  graph: LineageGraph;
}

export interface GetImpactAnalysisResponse {
  ok: true;
  result: ImpactAnalysisResult;
}

export interface GetNodeResponse {
  ok: true;
  node: DataLineageNode;
}

export interface QueryNodesQuery {
  type?: string;
  agentId?: string;
  sessionId?: string;
  missionId?: string;
  decisionId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}

export interface QueryNodesResponse {
  ok: true;
  nodes: DataLineageNode[];
}

// ─── 审计相关请求/响应 ────────────────────────────────────────────────────

export interface GetAuditTrailQuery {
  userId: string;
  start: number;
  end: number;
}

export interface GetAuditTrailResponse {
  ok: true;
  entries: AuditLogEntry[];
}

export interface ExportReportResponse {
  ok: true;
  report: LineageReport;
}

export interface DetectAnomaliesQuery {
  start: number;
  end: number;
}

export interface DetectAnomaliesResponse {
  ok: true;
  alerts: ChangeAlert[];
}

// ─── 导入导出请求/响应 ────────────────────────────────────────────────────

export interface ExportLineageQuery {
  startTime: number;
  endTime: number;
  format?: "json" | "csv";
}

export interface ImportLineageRequest {
  format: "json" | "csv";
  data: string;
}

export interface ImportLineageResponse {
  ok: true;
  result: ImportResult;
}

// ─── 变更检测请求/响应 ────────────────────────────────────────────────────

export interface DetectChangesRequest {
  sourceId: string;
}

export interface DetectChangesResponse {
  ok: true;
  alert: ChangeAlert | null;
}

export interface GetQualityMetricsResponse {
  ok: true;
  metrics: DataQualityMetrics;
}

// ─── 统计请求/响应 ────────────────────────────────────────────────────────

export interface GetStatsResponse {
  ok: true;
  stats: LineageStoreStats;
}

// ─── 前端过滤器查询参数 ──────────────────────────────────────────────────

export interface LineageFilterQuery extends Partial<LineageFilters> {
  limit?: number;
}
