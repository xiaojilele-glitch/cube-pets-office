/**
 * TokenBudgetManager — Token 预算控制
 *
 * 按 score 降序选择 chunk，直到 token 总量达到预算。
 * 标记 injected/pruned/below_threshold 状态。
 *
 * Requirements: 5.3, 9.2
 */

import type { RetrievalResult } from '../../../shared/rag/contracts.js';

export type ChunkStatus = 'injected' | 'pruned' | 'below_threshold';

export interface BudgetedChunk {
  result: RetrievalResult;
  status: ChunkStatus;
  tokenCount: number;
}

export interface AllocationResult {
  chunks: BudgetedChunk[];
  injectedTokens: number;
  totalCandidates: number;
}

export class TokenBudgetManager {
  constructor(
    private readonly budget: number = 4096,
    private readonly minScore: number = 0.3,
  ) {}

  /**
   * 按 score 降序分配 token 预算。
   * - score < minScore → below_threshold
   * - 累计 token > budget → pruned
   * - 其余 → injected
   */
  allocate(results: RetrievalResult[]): AllocationResult {
    // Sort by score descending
    const sorted = [...results].sort((a, b) => b.score - a.score);

    let usedTokens = 0;
    const chunks: BudgetedChunk[] = [];

    for (const result of sorted) {
      const tokenCount = this.estimateTokens(result.content);

      if (result.score < this.minScore) {
        chunks.push({ result, status: 'below_threshold', tokenCount });
        continue;
      }

      if (usedTokens + tokenCount <= this.budget) {
        chunks.push({ result, status: 'injected', tokenCount });
        usedTokens += tokenCount;
      } else {
        chunks.push({ result, status: 'pruned', tokenCount });
      }
    }

    return {
      chunks,
      injectedTokens: usedTokens,
      totalCandidates: results.length,
    };
  }

  private estimateTokens(content: string): number {
    if (!content) return 0;
    return content.split(/\s+/).filter(Boolean).length;
  }
}
