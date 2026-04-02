/**
 * Reranker — 重排器接口和三种实现
 *
 * NoopReranker（默认）、LLMReranker、CrossEncoderReranker
 * 默认使用 NoopReranker，用户可通过配置切换。
 *
 * Requirements: 5.2
 */

import type { RetrievalResult } from '../../../shared/rag/contracts.js';

export interface Reranker {
  rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]>;
}

/** 不重排，直接返回原始结果 */
export class NoopReranker implements Reranker {
  async rerank(_query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
    return results;
  }
}

/** 使用 LLM 对 query-chunk 对进行相关性评分重排 */
export class LLMReranker implements Reranker {
  async rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
    // Simplified: score by query token overlap (real impl would call LLM)
    const queryTokens = new Set(query.toLowerCase().split(/\s+/));
    const scored = results.map(r => {
      const contentTokens = r.content.toLowerCase().split(/\s+/);
      const overlap = contentTokens.filter(t => queryTokens.has(t)).length;
      const relevance = contentTokens.length > 0 ? overlap / contentTokens.length : 0;
      return { ...r, score: r.score * (1 + relevance) };
    });
    return scored.sort((a, b) => b.score - a.score);
  }
}

/** 使用 Cross-Encoder 模型进行重排 */
export class CrossEncoderReranker implements Reranker {
  async rerank(_query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
    // Placeholder: real impl would call a cross-encoder model API
    return results;
  }
}

/** 根据配置名称创建 Reranker */
export function createReranker(type: 'noop' | 'llm' | 'cross_encoder'): Reranker {
  switch (type) {
    case 'llm': return new LLMReranker();
    case 'cross_encoder': return new CrossEncoderReranker();
    default: return new NoopReranker();
  }
}
