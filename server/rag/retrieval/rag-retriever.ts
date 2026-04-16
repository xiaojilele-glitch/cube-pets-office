/**
 * RAGRetriever — 语义检索服务
 *
 * 串联：query 向量化 → ANN 搜索 → 关键词搜索 → RRF 合并
 *       → 元数据获取 → 上下文扩展 → 组装 RetrievalResult
 *
 * 支持 semantic/keyword/hybrid 三种模式。
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import type {
  RetrievalResult,
  SourceType,
  ChunkMetadata,
} from "../../../shared/rag/contracts.js";
import type { RetrievalOptions } from "../../../shared/rag/api.js";
import type { EmbeddingGenerator } from "../embedding/embedding-generator.js";
import type {
  VectorStoreAdapter,
  SearchHit,
} from "../store/vector-store-adapter.js";
import type { MetadataStore } from "../store/metadata-store.js";
import type { KeywordSearcher } from "./keyword-searcher.js";
import type { ContextExpander } from "./context-expander.js";
import { rrfMerge } from "./rrf-merger.js";
import { getRAGConfig } from "../config.js";

// ---------------------------------------------------------------------------
// RAGRetriever
// ---------------------------------------------------------------------------

export interface RAGRetrieverDeps {
  embeddingGenerator: EmbeddingGenerator;
  vectorStore: VectorStoreAdapter;
  metadataStore: MetadataStore;
  keywordSearcher: KeywordSearcher;
  contextExpander: ContextExpander;
}

export class RAGRetriever {
  private readonly deps: RAGRetrieverDeps;

  constructor(deps: RAGRetrieverDeps) {
    this.deps = deps;
  }

  async search(
    query: string,
    options: RetrievalOptions
  ): Promise<RetrievalResult[]> {
    const config = getRAGConfig();
    const topK = options.topK ?? config.retrieval.defaultTopK;
    const minScore = options.minScore ?? config.retrieval.defaultMinScore;
    const mode = options.mode ?? config.retrieval.defaultMode;
    const expandContext = options.expandContext ?? false;
    const contextWindowChunks =
      options.contextWindowChunks ?? config.retrieval.contextWindowChunks;

    const collectionName = `rag_${options.projectId}`;

    let hits: SearchHit[] = [];

    if (mode === "semantic" || mode === "hybrid") {
      // Vectorize query
      try {
        const queryVector =
          await this.deps.embeddingGenerator.generateSingle(query);

        // Build filter
        const filter: Record<string, any> = {};
        if (options.sourceTypes?.length) {
          filter.sourceType =
            options.sourceTypes.length === 1
              ? options.sourceTypes[0]
              : options.sourceTypes;
        }
        if (options.agentId) filter.agentId = options.agentId;
        if (options.codeLanguage) filter.codeLanguage = options.codeLanguage;
        if (options.timeRange) {
          filter.timestamp = {
            gte:
              options.timeRange.start instanceof Date
                ? options.timeRange.start.toISOString()
                : options.timeRange.start,
            lte:
              options.timeRange.end instanceof Date
                ? options.timeRange.end.toISOString()
                : options.timeRange.end,
          };
        }

        hits = await this.deps.vectorStore.search(collectionName, queryVector, {
          topK: topK * 2, // fetch more for merging
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          minScore,
        });
      } catch {
        // Vectorization failed — fall back to keyword-only if hybrid
        if (mode === "semantic") return [];
      }
    }

    if (mode === "keyword" || mode === "hybrid") {
      const keywordHits = this.deps.keywordSearcher.search(query, {
        projectId: options.projectId,
        topK: topK * 2,
        sourceTypes: options.sourceTypes,
        agentId: options.agentId,
        codeLanguage: options.codeLanguage,
      });

      if (mode === "hybrid" && hits.length > 0) {
        hits = rrfMerge(hits, keywordHits);
      } else if (mode === "keyword" || hits.length === 0) {
        hits = keywordHits;
      }
    }

    // Trim to topK
    hits = hits.slice(0, topK);

    // Assemble RetrievalResult with metadata
    let results = this.assembleResults(hits, hits.length);

    // Update access timestamps
    for (const result of results) {
      this.deps.metadataStore.updateAccessTime(result.chunkId);
    }

    // Context expansion
    if (expandContext && contextWindowChunks > 0) {
      results = this.deps.contextExpander.expand(results, contextWindowChunks);
    }

    return results;
  }

  private assembleResults(
    hits: SearchHit[],
    totalCandidates: number
  ): RetrievalResult[] {
    return hits.map(hit => {
      const metaRow = this.deps.metadataStore.getByChunkId(hit.id);
      const metadata: ChunkMetadata = metaRow
        ? {
            ingestedAt: metaRow.ingested_at,
            lastAccessedAt: metaRow.last_accessed_at,
            contentHash: metaRow.content_hash,
            codeLanguage: metaRow.code_language ?? undefined,
            functionSignature: metaRow.function_signature ?? undefined,
          }
        : {
            ingestedAt: "",
            lastAccessedAt: "",
            contentHash: "",
          };

      return {
        chunkId: hit.id,
        score: hit.score,
        content: (hit.metadata?.content as string) ?? "",
        sourceType: (hit.metadata?.sourceType as SourceType) ?? "document",
        sourceId: (hit.metadata?.sourceId as string) ?? "",
        metadata,
        totalCandidates,
      };
    });
  }
}
