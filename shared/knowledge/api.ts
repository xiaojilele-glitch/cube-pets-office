/**
 * 知识图谱 API 路由常量与请求/响应类型
 *
 * 前后端共享，确保路由路径和数据结构的一致性。
 * 类型依赖 ./types.ts 中的核心数据结构。
 */

import type {
  Entity,
  Relation,
  EntityStatus,
  ReviewAction,
  UnifiedKnowledgeResult,
  UnifiedQueryOptions,
  EntityTypeDefinition,
  RelationTypeDefinition,
} from "./types.js";

// ---------------------------------------------------------------------------
// API 路由常量
// ---------------------------------------------------------------------------

export const KNOWLEDGE_API = {
  // 公开 API
  graph: "/api/knowledge/graph",
  reviewQueue: "/api/knowledge/review-queue",
  review: "/api/knowledge/review/:entityId",
  query: "/api/knowledge/query",

  // 管理 API
  stats: "/api/admin/knowledge/stats",
  reindex: "/api/admin/knowledge/reindex",
  reindexStatus: "/api/admin/knowledge/reindex/:taskId",
  export: "/api/admin/knowledge/export",
} as const;

// ---------------------------------------------------------------------------
// 通用错误响应
// ---------------------------------------------------------------------------

export interface KnowledgeApiErrorResponse {
  ok?: false;
  error: string;
}

// ---------------------------------------------------------------------------
// GET /api/knowledge/graph
// ---------------------------------------------------------------------------

export interface GetKnowledgeGraphQuery {
  projectId: string;
  entityTypes?: string;   // 逗号分隔的实体类型列表
  depth?: number;         // 遍历深度，默认 2
}

export interface GetKnowledgeGraphResponse {
  ok: true;
  nodes: Entity[];
  edges: Relation[];
}

// ---------------------------------------------------------------------------
// GET /api/knowledge/review-queue
// ---------------------------------------------------------------------------

export interface GetReviewQueueQuery {
  projectId?: string;
  entityType?: string;
  sortBy?: "confidence" | "createdAt";
}

export interface GetReviewQueueResponse {
  ok: true;
  items: Entity[];
}

// ---------------------------------------------------------------------------
// POST /api/knowledge/review/:entityId
// ---------------------------------------------------------------------------

export type PostReviewRequest = ReviewAction;

export interface PostReviewResponse {
  ok: true;
  entity: Entity;
}

// ---------------------------------------------------------------------------
// POST /api/knowledge/query
// ---------------------------------------------------------------------------

export interface PostKnowledgeQueryRequest {
  question: string;
  projectId: string;
  options?: UnifiedQueryOptions;
}

export interface PostKnowledgeQueryResponse {
  ok: true;
  result: UnifiedKnowledgeResult;
}

// ---------------------------------------------------------------------------
// GET /api/admin/knowledge/stats
// ---------------------------------------------------------------------------

export interface EntityTypeCount {
  entityType: string;
  count: number;
}

export interface StatusDistribution {
  status: EntityStatus;
  count: number;
}

export interface DailyTrend {
  date: string;           // YYYY-MM-DD
  entitiesCreated: number;
  relationsCreated: number;
}

export interface ProjectStats {
  projectId: string;
  entityCount: number;
  relationCount: number;
}

export interface GetKnowledgeStatsResponse {
  ok: true;
  stats: {
    totalEntities: number;
    totalRelations: number;
    byProject: ProjectStats[];
    byEntityType: EntityTypeCount[];
    statusDistribution: StatusDistribution[];
    averageConfidence: number;
    trends: DailyTrend[];   // 最近 7 天
  };
}

// ---------------------------------------------------------------------------
// POST /api/admin/knowledge/reindex
// ---------------------------------------------------------------------------

export interface PostReindexResponse {
  ok: true;
  taskId: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/knowledge/reindex/:taskId
// ---------------------------------------------------------------------------

export interface GetReindexStatusResponse {
  ok: true;
  taskId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;       // 0-100
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/knowledge/export
// ---------------------------------------------------------------------------

export interface GetKnowledgeExportQuery {
  projectId: string;
  format?: "json";        // 目前仅支持 json
}

export interface GetKnowledgeExportResponse {
  ok: true;
  projectId: string;
  exportedAt: string;
  ontology: {
    entityTypes: EntityTypeDefinition[];
    relationTypes: RelationTypeDefinition[];
  };
  entities: Entity[];
  relations: Relation[];
}
