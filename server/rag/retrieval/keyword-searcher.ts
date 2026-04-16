/**
 * KeywordSearcher — 关键词检索
 *
 * 基于元数据表的全文匹配，作为语义检索的补充。
 * 用于 hybrid 模式下与向量检索结果进行 RRF 合并。
 *
 * Requirements: 4.4
 */

import type {
  MetadataStore,
  RagChunkMetadataRow,
} from "../store/metadata-store.js";
import type { SearchHit } from "../store/vector-store-adapter.js";

export interface KeywordSearchOptions {
  projectId: string;
  topK?: number;
  sourceTypes?: string[];
  agentId?: string;
  codeLanguage?: string;
}

export class KeywordSearcher {
  constructor(private readonly metadataStore: MetadataStore) {}

  /**
   * 对 query 进行关键词匹配，返回按相关度排序的结果。
   * 使用简单的 token 匹配 + TF 评分。
   */
  search(query: string, options: KeywordSearchOptions): SearchHit[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const topK = options.topK ?? 10;

    // 获取候选行
    const candidates = this.metadataStore.query({
      projectId: options.projectId,
      sourceType: options.sourceTypes?.[0] as any,
      agentId: options.agentId,
    });

    // 对每个候选计算关键词匹配分数
    const scored: Array<{ row: RagChunkMetadataRow; score: number }> = [];

    for (const row of candidates) {
      // 从 metadata_json 中提取 content（如果存在）
      let content = "";
      try {
        const meta = JSON.parse(row.metadata_json);
        content = meta.content ?? "";
      } catch {
        /* ignore */
      }

      // 也搜索 source_id 和 function_signature
      const searchText = [
        content,
        row.source_id,
        row.function_signature ?? "",
        row.code_language ?? "",
      ]
        .join(" ")
        .toLowerCase();

      const score = computeMatchScore(queryTokens, searchText);
      if (score > 0) {
        scored.push({ row, score });
      }
    }

    // 按分数降序排序，取 topK
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ row, score }) => ({
      id: row.chunk_id,
      score,
      metadata: {
        sourceType: row.source_type,
        sourceId: row.source_id,
        projectId: row.project_id,
      },
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function computeMatchScore(queryTokens: string[], text: string): number {
  let matches = 0;
  for (const token of queryTokens) {
    if (text.includes(token)) matches++;
  }
  return queryTokens.length > 0 ? matches / queryTokens.length : 0;
}
