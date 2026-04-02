/**
 * MetadataStore — rag_chunk_metadata 元数据存储
 *
 * 使用本地 JSON 文件持久化（与现有 database.json 模式一致）。
 * 提供 CRUD 操作：upsert、getByChunkId、getBySourceId、query、delete、updateAccessTime。
 * 通过写入队列保证顺序写入安全。
 *
 * Requirements: 3.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SourceType } from '../../../shared/rag/contracts.js';

// ---------------------------------------------------------------------------
// RagChunkMetadataRow — 元数据行结构（与设计文档一致）
// ---------------------------------------------------------------------------

export interface RagChunkMetadataRow {
  chunk_id: string;                          // PK
  source_type: SourceType;
  source_id: string;
  project_id: string;
  chunk_index: number;
  content_hash: string;
  token_count: number;
  code_language: string | null;
  function_signature: string | null;
  agent_id: string | null;
  ingested_at: string;                       // ISO 8601
  last_accessed_at: string;                  // ISO 8601
  storage_tier: 'hot' | 'cold';
  metadata_json: string;                     // 扩展元数据 JSON
}

// ---------------------------------------------------------------------------
// MetadataQueryFilter — 查询过滤条件
// ---------------------------------------------------------------------------

export interface MetadataQueryFilter {
  projectId?: string;
  sourceType?: SourceType;
  agentId?: string;
  storageTier?: 'hot' | 'cold';
  sourceId?: string;
  /** 仅返回 ingested_at >= since 的记录 */
  since?: string;
  /** 仅返回 ingested_at <= until 的记录 */
  until?: string;
}

// ---------------------------------------------------------------------------
// 序列化格式
// ---------------------------------------------------------------------------

interface MetadataStoreFile {
  version: 1;
  rows: RagChunkMetadataRow[];
}

// ---------------------------------------------------------------------------
// 默认文件路径
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_FILE_PATH = resolve(__dirname, '../../../data/rag_chunk_metadata.json');

// ---------------------------------------------------------------------------
// MetadataStore — 元数据 CRUD
// ---------------------------------------------------------------------------

export class MetadataStore {
  /** 内存索引：chunk_id → RagChunkMetadataRow */
  private rows = new Map<string, RagChunkMetadataRow>();

  /** 写入队列，保证顺序写入 */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = DEFAULT_FILE_PATH) {
    this.load();
  }

  // -------------------------------------------------------------------------
  // CRUD 操作
  // -------------------------------------------------------------------------

  /** 插入或更新一条元数据行（chunk_id 为主键） */
  upsert(row: RagChunkMetadataRow): void {
    this.rows.set(row.chunk_id, { ...row });
    this.scheduleSave();
  }

  /** 批量 upsert */
  upsertBatch(rows: RagChunkMetadataRow[]): void {
    for (const row of rows) {
      this.rows.set(row.chunk_id, { ...row });
    }
    this.scheduleSave();
  }

  /** 按 chunk_id 查询单条 */
  getByChunkId(chunkId: string): RagChunkMetadataRow | undefined {
    return this.rows.get(chunkId);
  }

  /** 按 source_id 查询所有关联的 chunk 元数据 */
  getBySourceId(sourceId: string): RagChunkMetadataRow[] {
    return Array.from(this.rows.values())
      .filter((row) => row.source_id === sourceId)
      .sort((a, b) => a.chunk_index - b.chunk_index);
  }

  /** 按过滤条件查询 */
  query(filter: MetadataQueryFilter): RagChunkMetadataRow[] {
    return Array.from(this.rows.values())
      .filter((row) => matchesFilter(row, filter))
      .sort((a, b) => a.chunk_index - b.chunk_index);
  }

  /** 按 chunk_id 删除 */
  delete(chunkId: string): boolean {
    const deleted = this.rows.delete(chunkId);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  /** 批量删除 */
  deleteBatch(chunkIds: string[]): number {
    let count = 0;
    for (const id of chunkIds) {
      if (this.rows.delete(id)) count++;
    }
    if (count > 0) this.scheduleSave();
    return count;
  }

  /** 更新 last_accessed_at 时间戳 */
  updateAccessTime(chunkId: string, accessedAt: string = new Date().toISOString()): boolean {
    const row = this.rows.get(chunkId);
    if (!row) return false;
    row.last_accessed_at = accessedAt;
    this.scheduleSave();
    return true;
  }

  /** 更新 storage_tier */
  updateStorageTier(chunkId: string, tier: 'hot' | 'cold'): boolean {
    const row = this.rows.get(chunkId);
    if (!row) return false;
    row.storage_tier = tier;
    this.scheduleSave();
    return true;
  }

  /** 返回当前记录总数 */
  count(): number {
    return this.rows.size;
  }

  /** 返回所有行（用于调试/导出） */
  all(): RagChunkMetadataRow[] {
    return Array.from(this.rows.values());
  }

  /** 等待所有挂起的写入完成 */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  // -------------------------------------------------------------------------
  // 持久化
  // -------------------------------------------------------------------------

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as MetadataStoreFile;
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      for (const row of rows) {
        if (row && typeof row.chunk_id === 'string') {
          this.rows.set(row.chunk_id, row);
        }
      }
    } catch {
      // 文件损坏时从空状态开始
    }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.save());
  }

  private save(): void {
    const data: MetadataStoreFile = {
      version: 1,
      rows: Array.from(this.rows.values()),
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[MetadataStore] Failed to save:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// 过滤匹配辅助函数
// ---------------------------------------------------------------------------

function matchesFilter(row: RagChunkMetadataRow, filter: MetadataQueryFilter): boolean {
  if (filter.projectId != null && row.project_id !== filter.projectId) return false;
  if (filter.sourceType != null && row.source_type !== filter.sourceType) return false;
  if (filter.agentId != null && row.agent_id !== filter.agentId) return false;
  if (filter.storageTier != null && row.storage_tier !== filter.storageTier) return false;
  if (filter.sourceId != null && row.source_id !== filter.sourceId) return false;
  if (filter.since != null && row.ingested_at < filter.since) return false;
  if (filter.until != null && row.ingested_at > filter.until) return false;
  return true;
}
