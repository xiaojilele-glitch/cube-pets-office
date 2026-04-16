/**
 * VectorStoreAdapter — 向量数据库统一接口
 *
 * 抽象不同向量数据库后端（Qdrant / Milvus / Pgvector），
 * 提供 createCollection、upsert、search、delete、collectionInfo、healthCheck 方法。
 *
 * 优先实现 Qdrant 适配器，Milvus 和 Pgvector 作为后续扩展。
 * collection 按 `rag_{projectId}` 命名，每个项目独立 collection。
 *
 * Requirements: 3.3
 */

// Re-export VectorRecord from shared contracts for convenience
export type { VectorRecord } from "../../../shared/rag/contracts.js";

// ---------------------------------------------------------------------------
// SearchOptions — ANN 搜索参数
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** 返回的最近邻数量 */
  topK: number;
  /** 过滤条件（sourceType、agentId、timestamp、codeLanguage 等） */
  filter?: Record<string, any>;
  /** 最低相似度阈值，低于此分数的结果将被过滤 */
  minScore?: number;
}

// ---------------------------------------------------------------------------
// SearchHit — 单条搜索命中结果
// ---------------------------------------------------------------------------

export interface SearchHit {
  /** 向量记录 ID */
  id: string;
  /** 相似度分数 */
  score: number;
  /** 关联的元数据 */
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// CollectionInfo — collection 元信息
// ---------------------------------------------------------------------------

export interface CollectionInfo {
  /** collection 名称 */
  name: string;
  /** 向量总数 */
  vectorCount: number;
  /** 向量维度 */
  dimension: number;
  /** collection 状态（如 'ready' | 'building' | 'error'） */
  status: string;
}

// ---------------------------------------------------------------------------
// HealthStatus — 向量数据库健康状态
// ---------------------------------------------------------------------------

export interface HealthStatus {
  /** 是否已连接 */
  connected: boolean;
  /** 后端类型（qdrant / milvus / pgvector） */
  backend: string;
  /** 健康检查延迟（毫秒） */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// VectorStoreAdapter — 统一接口
// ---------------------------------------------------------------------------

export interface VectorStoreAdapter {
  /** 创建 collection（按 projectId 分隔，维度由 embedding 模型决定） */
  createCollection(name: string, dimension: number): Promise<void>;

  /** 插入或更新向量记录（upsert 语义） */
  upsert(
    collection: string,
    records: import("../../../shared/rag/contracts.js").VectorRecord[]
  ): Promise<void>;

  /** ANN 近似最近邻搜索 */
  search(
    collection: string,
    query: number[],
    options: SearchOptions
  ): Promise<SearchHit[]>;

  /** 按 ID 批量删除向量 */
  delete(collection: string, ids: string[]): Promise<void>;

  /** 获取 collection 元信息 */
  collectionInfo(name: string): Promise<CollectionInfo>;

  /** 健康检查 */
  healthCheck(): Promise<HealthStatus>;
}
