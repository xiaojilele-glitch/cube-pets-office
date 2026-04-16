/**
 * IngestionPipeline — 摄入管道主流程
 *
 * 串联：DedupCheck → DataCleaner.clean → ChunkRouter.route → chunker.chunk
 *       → EmbeddingGenerator.generateBatch → VectorStoreAdapter.upsert
 *       → MetadataStore.upsertBatch
 *
 * 任何环节失败写入 DeadLetterQueue。
 *
 * Requirements: 1.2, 1.4, 1.5, 1.6
 */

import type {
  IngestionPayload,
  ChunkRecord,
  DeadLetterEntry,
  VectorRecord,
} from "../../../shared/rag/contracts.js";
import type { DedupChecker } from "./dedup-checker.js";
import type { DataCleaner } from "./data-cleaner.js";
import type { DeadLetterQueue } from "./dead-letter-queue.js";
import type { ChunkRouter } from "../chunking/chunk-router.js";
import type {
  EmbeddingGenerator,
  EmbeddedChunk,
} from "../embedding/embedding-generator.js";
import type { VectorStoreAdapter } from "../store/vector-store-adapter.js";
import type {
  MetadataStore,
  RagChunkMetadataRow,
} from "../store/metadata-store.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface IngestionResult {
  success: boolean;
  chunkCount: number;
  sourceId: string;
  deduplicated: boolean;
  error?: string;
}

export interface IngestionBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  results: IngestionResult[];
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface IngestionPipelineDeps {
  dedupChecker: DedupChecker;
  dataCleaner: DataCleaner;
  chunkRouter: ChunkRouter;
  embeddingGenerator: EmbeddingGenerator;
  vectorStore: VectorStoreAdapter;
  metadataStore: MetadataStore;
  deadLetterQueue: DeadLetterQueue;
}

// ---------------------------------------------------------------------------
// IngestionPipeline
// ---------------------------------------------------------------------------

export class IngestionPipeline {
  private readonly deps: IngestionPipelineDeps;

  constructor(deps: IngestionPipelineDeps) {
    this.deps = deps;
  }

  /**
   * 摄入单条数据。
   *
   * 流程：DedupCheck → DataCleaner → ChunkRouter → Chunker → EmbeddingGenerator
   *       → VectorStoreAdapter.upsert → MetadataStore.upsertBatch
   */
  async ingest(payload: IngestionPayload): Promise<IngestionResult> {
    const {
      dedupChecker,
      dataCleaner,
      chunkRouter,
      embeddingGenerator,
      vectorStore,
      metadataStore,
      deadLetterQueue,
    } = this.deps;

    // --- Stage: clean ---
    let cleaned: IngestionPayload & { contentHash: string };
    try {
      cleaned = dataCleaner.clean(payload);
    } catch (err) {
      deadLetterQueue.push(payload, errorMessage(err), "clean");
      return {
        success: false,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
        error: errorMessage(err),
      };
    }

    // --- Stage: dedup ---
    if (
      dedupChecker.isDuplicate(
        cleaned.sourceType,
        cleaned.sourceId,
        cleaned.contentHash
      )
    ) {
      return {
        success: true,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: true,
      };
    }

    // --- Stage: chunk ---
    let chunks: ChunkRecord[];
    try {
      const chunker = chunkRouter.route(cleaned.sourceType);
      const now = new Date().toISOString();
      chunks = chunker.chunk(cleaned.content, {
        ingestedAt: now,
        lastAccessedAt: now,
        contentHash: cleaned.contentHash,
      });
      // Enrich each ChunkRecord with source-level fields
      chunks = chunks.map((c, idx) => ({
        ...c,
        chunkId: `${cleaned.sourceType}:${cleaned.sourceId}:${idx}`,
        sourceType: cleaned.sourceType,
        sourceId: cleaned.sourceId,
        projectId: cleaned.projectId,
        chunkIndex: idx,
      }));
    } catch (err) {
      deadLetterQueue.push(payload, errorMessage(err), "chunk");
      return {
        success: false,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
        error: errorMessage(err),
      };
    }

    if (chunks.length === 0) {
      // Nothing to embed — mark as ingested and return
      dedupChecker.markIngested(
        cleaned.sourceType,
        cleaned.sourceId,
        cleaned.contentHash
      );
      return {
        success: true,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
      };
    }

    // --- Stage: embed ---
    let embedded: EmbeddedChunk[];
    try {
      embedded = await embeddingGenerator.generateBatch(chunks);
    } catch (err) {
      deadLetterQueue.push(payload, errorMessage(err), "embed");
      return {
        success: false,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
        error: errorMessage(err),
      };
    }

    if (embedded.length === 0) {
      deadLetterQueue.push(payload, "All chunks failed embedding", "embed");
      return {
        success: false,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
        error: "All chunks failed embedding",
      };
    }

    // --- Stage: store (vector) ---
    const collectionName = `rag_${cleaned.projectId}`;
    const vectorRecords: VectorRecord[] = embedded.map(ec => ({
      id: ec.chunk.chunkId,
      vector: ec.vector,
      content: ec.chunk.content,
      metadata: {
        sourceType: ec.chunk.sourceType,
        sourceId: ec.chunk.sourceId,
        projectId: ec.chunk.projectId,
        agentId: cleaned.agentId ?? null,
        timestamp: cleaned.timestamp,
        codeLanguage: ec.chunk.metadata.codeLanguage ?? null,
        chunkIndex: ec.chunk.chunkIndex,
      },
    }));

    try {
      await vectorStore.upsert(collectionName, vectorRecords);
    } catch (err) {
      deadLetterQueue.push(payload, errorMessage(err), "store");
      return {
        success: false,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
        error: errorMessage(err),
      };
    }

    // --- Stage: metadata ---
    const now = new Date().toISOString();
    const metadataRows: RagChunkMetadataRow[] = embedded.map(ec => ({
      chunk_id: ec.chunk.chunkId,
      source_type: ec.chunk.sourceType,
      source_id: ec.chunk.sourceId,
      project_id: ec.chunk.projectId,
      chunk_index: ec.chunk.chunkIndex,
      content_hash: cleaned.contentHash,
      token_count: ec.chunk.tokenCount,
      code_language: ec.chunk.metadata.codeLanguage ?? null,
      function_signature: ec.chunk.metadata.functionSignature ?? null,
      agent_id: cleaned.agentId ?? null,
      ingested_at: now,
      last_accessed_at: now,
      storage_tier: "hot" as const,
      metadata_json: JSON.stringify(ec.chunk.metadata),
    }));

    try {
      metadataStore.upsertBatch(metadataRows);
    } catch (err) {
      deadLetterQueue.push(payload, errorMessage(err), "metadata");
      return {
        success: false,
        chunkCount: 0,
        sourceId: payload.sourceId,
        deduplicated: false,
        error: errorMessage(err),
      };
    }

    // --- Success: mark dedup ---
    dedupChecker.markIngested(
      cleaned.sourceType,
      cleaned.sourceId,
      cleaned.contentHash
    );

    return {
      success: true,
      chunkCount: embedded.length,
      sourceId: payload.sourceId,
      deduplicated: false,
    };
  }

  /**
   * 批量摄入。逐条调用 ingest()，汇总结果。
   */
  async ingestBatch(
    payloads: IngestionPayload[]
  ): Promise<IngestionBatchResult> {
    const results: IngestionResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const payload of payloads) {
      const result = await this.ingest(payload);
      results.push(result);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return { total: payloads.length, succeeded, failed, results };
  }

  /**
   * 获取 Dead Letter Queue 中的失败记录。
   */
  getDeadLetters(options?: {
    limit?: number;
    offset?: number;
  }): Promise<DeadLetterEntry[]> {
    return Promise.resolve(this.deps.deadLetterQueue.list(options));
  }

  /**
   * 重试 Dead Letter Queue 中的记录。
   */
  async retryDeadLetter(entryId: string): Promise<IngestionResult> {
    const { deadLetterQueue } = this.deps;
    const payload = deadLetterQueue.markRetry(entryId);
    if (!payload) {
      return {
        success: false,
        chunkCount: 0,
        sourceId: "",
        deduplicated: false,
        error: `DLQ entry not found: ${entryId}`,
      };
    }
    const result = await this.ingest(payload);
    if (result.success) {
      deadLetterQueue.remove(entryId);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
