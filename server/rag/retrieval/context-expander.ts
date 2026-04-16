/**
 * ContextExpander — 上下文扩展
 *
 * 根据 chunkIndex 查询前后相邻 chunk，扩展检索结果的上下文窗口。
 *
 * Requirements: 4.5
 */

import type {
  MetadataStore,
  RagChunkMetadataRow,
} from "../store/metadata-store.js";
import type { RetrievalResult } from "../../../shared/rag/contracts.js";

export class ContextExpander {
  constructor(private readonly metadataStore: MetadataStore) {}

  /**
   * 对每个命中的 chunk，扩展前后 windowSize 个相邻 chunk。
   * 返回去重后的扩展结果列表。
   */
  expand(
    results: RetrievalResult[],
    windowSize: number = 1
  ): RetrievalResult[] {
    if (windowSize <= 0 || results.length === 0) return results;

    const seen = new Set<string>();
    const expanded: RetrievalResult[] = [];

    for (const result of results) {
      // Add the original result
      if (!seen.has(result.chunkId)) {
        seen.add(result.chunkId);
        expanded.push(result);
      }

      // Find adjacent chunks by sourceId
      const siblings = this.metadataStore.getBySourceId(result.sourceId);
      if (siblings.length === 0) continue;

      const targetIndex = this.findChunkIndex(result.chunkId, siblings);
      if (targetIndex < 0) continue;

      // Expand window: [targetIndex - windowSize, targetIndex + windowSize]
      for (let offset = -windowSize; offset <= windowSize; offset++) {
        if (offset === 0) continue;
        const adjacentIndex = targetIndex + offset;
        const adjacent = siblings.find(s => s.chunk_index === adjacentIndex);
        if (adjacent && !seen.has(adjacent.chunk_id)) {
          seen.add(adjacent.chunk_id);
          expanded.push(
            this.rowToResult(
              adjacent,
              result.score * 0.8,
              result.totalCandidates
            )
          );
        }
      }
    }

    return expanded;
  }

  private findChunkIndex(
    chunkId: string,
    siblings: RagChunkMetadataRow[]
  ): number {
    const row = siblings.find(s => s.chunk_id === chunkId);
    return row?.chunk_index ?? -1;
  }

  private rowToResult(
    row: RagChunkMetadataRow,
    score: number,
    totalCandidates: number
  ): RetrievalResult {
    let content = "";
    try {
      const meta = JSON.parse(row.metadata_json);
      content = meta.content ?? "";
    } catch {
      /* ignore */
    }

    return {
      chunkId: row.chunk_id,
      score,
      content,
      sourceType: row.source_type,
      sourceId: row.source_id,
      metadata: {
        ingestedAt: row.ingested_at,
        lastAccessedAt: row.last_accessed_at,
        contentHash: row.content_hash,
        codeLanguage: row.code_language ?? undefined,
        functionSignature: row.function_signature ?? undefined,
      },
      totalCandidates,
    };
  }
}
