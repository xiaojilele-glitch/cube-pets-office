/**
 * Memory 读写接口分层契约
 *
 * knowledge-graph 和 vector-db-rag-pipeline 都依赖 memory-system。
 * 本契约约定 Memory 的读接口（查询）和写接口（持久化）的分层边界，
 * 避免两个模块各自 fork 一套 Memory 访问逻辑。
 *
 * 分层原则：
 * - MemoryReader：只读查询，任何模块都可以调用
 * - MemoryWriter：写入/更新，只有 memory-system 内核和授权模块可以调用
 * - MemoryIndex：索引管理，knowledge-graph 和 vector-db-rag-pipeline 各自实现
 */

// ---------------------------------------------------------------------------
// 通用记忆条目
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  agentId: string;
  source: MemorySource;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
  updatedAt: number;
}

export type MemorySource =
  | "workflow_summary"
  | "llm_exchange"
  | "message_log"
  | "heartbeat_report"
  | "soul_patch"
  | "user_annotation"
  | "external_import";

export interface MemoryMetadata {
  workflowId?: string;
  missionId?: string;
  stage?: string;
  role?: string;
  keywords?: string[];
  score?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// 读接口（MemoryReader）
// ---------------------------------------------------------------------------

export interface MemorySearchQuery {
  agentId: string;
  query: string;
  topK?: number;
  source?: MemorySource[];
  minScore?: number;
  dateRange?: { from?: number; to?: number };
}

export interface MemorySearchHit {
  entry: MemoryEntry;
  score: number;
  matchedKeywords?: string[];
}

export interface MemoryReader {
  /** 语义搜索（向量检索 + 关键词匹配） */
  search(query: MemorySearchQuery): Promise<MemorySearchHit[]>;
  /** 按 ID 精确查询 */
  get(agentId: string, entryId: string): Promise<MemoryEntry | null>;
  /** 按来源列出最近条目 */
  listRecent(
    agentId: string,
    source?: MemorySource,
    limit?: number
  ): Promise<MemoryEntry[]>;
  /** 获取智能体的记忆统计 */
  getStats(agentId: string): Promise<MemoryStats>;
}

export interface MemoryStats {
  totalEntries: number;
  bySource: Record<MemorySource, number>;
  oldestEntryAt: number | null;
  newestEntryAt: number | null;
  vectorIndexSize: number;
}

// ---------------------------------------------------------------------------
// 写接口（MemoryWriter）
// ---------------------------------------------------------------------------

export interface MemoryWriteInput {
  agentId: string;
  source: MemorySource;
  content: string;
  metadata?: Partial<MemoryMetadata>;
}

export interface MemoryWriter {
  /** 写入新记忆条目 */
  write(input: MemoryWriteInput): Promise<MemoryEntry>;
  /** 批量写入 */
  writeBatch(inputs: MemoryWriteInput[]): Promise<MemoryEntry[]>;
  /** 更新已有条目的 metadata */
  updateMetadata(
    agentId: string,
    entryId: string,
    metadata: Partial<MemoryMetadata>
  ): Promise<void>;
  /** 删除条目（仅管理用途） */
  delete(agentId: string, entryId: string): Promise<void>;
  /** 物化工作流记忆（工作流完成后调用） */
  materializeWorkflow(workflowId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// 索引接口（MemoryIndex）
// ---------------------------------------------------------------------------

/**
 * knowledge-graph 和 vector-db-rag-pipeline 各自实现此接口。
 * memory-system 内核在写入时通知所有已注册的索引。
 */
export interface MemoryIndex {
  /** 索引名称（如 "vector"、"graph"） */
  name: string;
  /** 新条目写入时触发索引更新 */
  onEntryWritten(entry: MemoryEntry): Promise<void>;
  /** 条目删除时触发索引清理 */
  onEntryDeleted(agentId: string, entryId: string): Promise<void>;
  /** 重建索引（管理用途） */
  rebuild(agentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 索引注册表
// ---------------------------------------------------------------------------

export interface MemoryIndexRegistry {
  /** 注册索引实现 */
  register(index: MemoryIndex): void;
  /** 获取所有已注册索引 */
  getAll(): MemoryIndex[];
  /** 按名称获取索引 */
  get(name: string): MemoryIndex | undefined;
}

// ---------------------------------------------------------------------------
// 现有实现的适配说明
// ---------------------------------------------------------------------------

/**
 * 当前实现的映射关系：
 *
 * MemoryReader.search()     → VectorStore.searchMemorySummaries() (现有)
 * MemoryReader.listRecent() → SessionStore.buildPromptContext() (现有)
 * MemoryWriter.write()      → VectorStore.upsertMemorySummary() (现有)
 * MemoryWriter.materializeWorkflow() → SessionStore.materializeWorkflowMemories() (现有)
 *
 * 未来扩展：
 * - vector-db-rag-pipeline 实现 MemoryIndex，替换现有 VectorStore 的本地向量化
 * - knowledge-graph 实现 MemoryIndex，提供实体关系图谱索引
 * - 两者通过 MemoryIndexRegistry 注册，memory-system 内核在写入时自动通知
 */
