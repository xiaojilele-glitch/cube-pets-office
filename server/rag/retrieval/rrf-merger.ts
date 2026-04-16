/**
 * RRF (Reciprocal Rank Fusion) 混合合并算法
 *
 * 将语义检索和关键词检索的结果按排名倒数加权合并。
 * score(d) = Σ 1 / (k + rank_i(d))
 * k = 60 (常数，平衡高排名和低排名的权重差异)
 *
 * Requirements: 4.4
 */

import type { SearchHit } from "../store/vector-store-adapter.js";

/**
 * RRF 合并两个排序列表。
 * 同时出现在两个列表中的项会获得更高的合并分数。
 */
export function rrfMerge(
  semanticResults: SearchHit[],
  keywordResults: SearchHit[],
  k: number = 60
): SearchHit[] {
  const scores = new Map<string, number>();
  const hitMap = new Map<string, SearchHit>();

  for (const [rank, hit] of semanticResults.entries()) {
    const id = hit.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    if (!hitMap.has(id)) hitMap.set(id, hit);
  }

  for (const [rank, hit] of keywordResults.entries()) {
    const id = hit.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    if (!hitMap.has(id)) hitMap.set(id, hit);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({
      ...hitMap.get(id)!,
      id,
      score,
    }));
}
