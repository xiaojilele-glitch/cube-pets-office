/**
 * RAG Pipeline 步骤链契约
 *
 * 从 rbac-system-pc/backend/src/ai/rag/ 迁移并改造。
 * 原版依赖 Sequelize + Milvus SDK，此版改为纯接口，
 * 适配 cube-pets-office 的本地向量存储和浏览器/服务端双运行时。
 *
 * 使用场景：
 * - vector-db-rag-pipeline: 完整 RAG 管道实现
 * - knowledge-graph: 图谱检索步骤可作为 Pipeline Step 注册
 * - memory-system: 中期记忆检索可复用 Retrieve 步骤
 */

// ---------------------------------------------------------------------------
// Pipeline 上下文（从 rbac-system-pc PipelineContext 迁移）
// ---------------------------------------------------------------------------

export interface RAGRetrievedDoc {
  content: string;
  score: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RAGPipelineContext {
  /** 输入 */
  query?: string;
  fileContent?: string;
  filePath?: string;
  agentId?: string;
  workflowId?: string;
  missionId?: string;

  /** 中间状态 */
  parsedText?: string;
  chunks?: string[];
  vectors?: number[][];
  retrievedDocs?: RAGRetrievedDoc[];

  /** 输出 */
  answer?: string;
  sources?: RAGRetrievedDoc[];

  /** 错误 */
  error?: string;

  /** 元数据（步骤间传递的额外信息） */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pipeline 步骤接口（从 rbac-system-pc IPipelineStep 迁移）
// ---------------------------------------------------------------------------

export interface IRAGPipelineStep {
  /** 步骤名称（如 "parse"、"chunk"、"embed"、"store"、"retrieve"、"generate"） */
  readonly name: string;
  /** 执行步骤，接收上下文并返回更新后的上下文 */
  execute(ctx: RAGPipelineContext): Promise<RAGPipelineContext>;
}

// ---------------------------------------------------------------------------
// Pipeline 配置
// ---------------------------------------------------------------------------

export const RAG_STEP_TYPES = [
  "parse",      // 文档解析（PDF/Word/Excel/HTML → 纯文本）
  "chunk",      // 文本分片（按段落/句子/固定长度）
  "embed",      // 向量化（调用 embedding 模型）
  "store",      // 存储（写入向量库）
  "retrieve",   // 检索（从向量库查询 topK）
  "rerank",     // 重排序（可选，对检索结果二次排序）
  "generate",   // 生成（基于检索结果调用 LLM 生成答案）
] as const;

export type RAGStepType = (typeof RAG_STEP_TYPES)[number];

export interface RAGStepConfig {
  type: RAGStepType;
  options?: Record<string, unknown>;
}

export interface RAGPipelineConfig {
  /** 管道名称 */
  name: string;
  /** 步骤序列 */
  steps: RAGStepConfig[];
}

// ---------------------------------------------------------------------------
// Pipeline 执行结果
// ---------------------------------------------------------------------------

export interface RAGStepLog {
  stepName: string;
  stepType: RAGStepType;
  durationMs: number;
  status: "success" | "failed" | "skipped";
  error?: string;
  /** 步骤产出的中间数据摘要（如 chunk 数量、检索结果数量） */
  summary?: string;
}

export interface RAGPipelineResult {
  status: "completed" | "failed";
  answer?: string;
  sources?: RAGRetrievedDoc[];
  logs: RAGStepLog[];
  totalDurationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pipeline 步骤注册表
// ---------------------------------------------------------------------------

export type RAGStepFactory = (options?: Record<string, unknown>) => IRAGPipelineStep;

export interface IRAGStepRegistry {
  /** 注册步骤工厂 */
  register(type: RAGStepType, factory: RAGStepFactory): void;
  /** 创建步骤实例 */
  create(config: RAGStepConfig): IRAGPipelineStep;
  /** 检查是否已注册 */
  has(type: RAGStepType): boolean;
  /** 列出所有已注册类型 */
  list(): RAGStepType[];
}

// ---------------------------------------------------------------------------
// 向量库抽象接口（从 rbac-system-pc VectorDbService 简化）
// ---------------------------------------------------------------------------

export interface VectorRecord {
  id: string;
  vector: number[];
  content: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface IVectorStore {
  /** 插入向量记录 */
  insert(collection: string, records: VectorRecord[]): Promise<void>;
  /** 语义搜索 */
  search(collection: string, queryVector: number[], topK: number): Promise<VectorSearchResult[]>;
  /** 删除记录 */
  delete(collection: string, ids: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// 现有实现的适配说明
// ---------------------------------------------------------------------------

/**
 * 当前 cube-pets-office 的映射关系：
 *
 * IVectorStore.search()  → VectorStore.searchMemorySummaries() (现有 96 维本地向量)
 * IVectorStore.insert()  → VectorStore.upsertMemorySummary() (现有)
 *
 * 未来升级路径：
 * - 本地模式：继续使用现有 VectorStore（96 维 token hash）
 * - 生产模式：替换为 Milvus/pgvector 适配器，实现 IVectorStore 接口
 * - 两者通过 IVectorStore 接口统一，上层 RAG Pipeline 无感切换
 */
