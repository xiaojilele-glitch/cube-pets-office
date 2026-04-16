/**
 * RAG REST API 路由常量与请求/响应类型
 *
 * 前后端共享的 API 契约，确保路由和数据结构一致。
 * 类型依赖 shared/rag/contracts.ts 中的核心数据模型。
 */

import type {
  IngestionPayload,
  RetrievalResult,
  SourceType,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// RAG REST API 路由常量
// ---------------------------------------------------------------------------

export const RAG_API = {
  // 摄入
  INGEST: "POST /api/rag/ingest",
  INGEST_BATCH: "POST /api/rag/ingest/batch",

  // 检索
  SEARCH: "POST /api/rag/search",

  // 反馈
  FEEDBACK: "POST /api/rag/feedback",
  FEEDBACK_STATS: "GET  /api/rag/feedback/stats",

  // 任务 RAG 数据
  TASK_RAG: "GET  /api/workflows/:workflowId/tasks/:taskId/rag",

  // 管理
  ADMIN_HEALTH: "GET  /api/admin/rag/health",
  ADMIN_REEMBED: "POST /api/admin/rag/reembed",
  ADMIN_PURGE: "POST /api/admin/rag/purge",
  ADMIN_BACKFILL: "POST /api/admin/rag/backfill",
  ADMIN_DLQ: "GET  /api/admin/rag/dlq",
  ADMIN_DLQ_RETRY: "POST /api/admin/rag/dlq/:entryId/retry",
  ADMIN_METRICS: "GET  /api/admin/rag/metrics",
} as const;

// ---------------------------------------------------------------------------
// 检索选项（SearchRequest 使用）
// ---------------------------------------------------------------------------

export interface RetrievalOptions {
  projectId: string;
  topK?: number; // 默认 10
  sourceTypes?: SourceType[];
  timeRange?: { start: Date; end: Date };
  agentId?: string;
  codeLanguage?: string;
  minScore?: number; // 默认 0.5
  mode?: "semantic" | "keyword" | "hybrid"; // 默认 hybrid
  expandContext?: boolean;
  contextWindowChunks?: number; // 默认 1
}

// ---------------------------------------------------------------------------
// POST /api/rag/ingest — 请求/响应
// ---------------------------------------------------------------------------

export interface IngestRequest {
  payload: IngestionPayload;
}

export interface IngestResponse {
  success: boolean;
  chunkCount: number;
  deduplicated: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// POST /api/rag/search — 请求/响应
// ---------------------------------------------------------------------------

export interface SearchRequest {
  query: string;
  options: RetrievalOptions;
}

export interface SearchResponse {
  results: RetrievalResult[];
  totalCandidates: number;
  latencyMs: number;
  mode: "semantic" | "keyword" | "hybrid";
}

// ---------------------------------------------------------------------------
// POST /api/rag/feedback — 请求
// ---------------------------------------------------------------------------

export interface FeedbackRequest {
  taskId: string;
  agentId: string;
  helpfulChunkIds?: string[];
  irrelevantChunkIds?: string[];
  missingContext?: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/rag/health — 响应
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  vectorStore: { connected: boolean; backend: string };
  embeddingModel: { available: boolean; model: string };
  collections: Array<{ name: string; vectorCount: number; status: string }>;
  deadLetterQueue: { count: number };
}

// ---------------------------------------------------------------------------
// POST /api/admin/rag/purge — 请求/响应
// ---------------------------------------------------------------------------

export interface PurgeRequest {
  projectId?: string;
  sourceType?: SourceType;
  before?: string; // ISO 8601
}

export interface PurgeResponse {
  deletedCount: number;
  durationMs: number;
}
