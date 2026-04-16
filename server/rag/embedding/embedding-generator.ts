/**
 * 批量嵌入生成器
 *
 * 设计文档 §3 EmbeddingGenerator：
 *   批量处理 batchSize=64，失败时降级为单条重试。
 *   EmbeddingProvider 接口抽象允许热切换模型。
 *
 * Requirements: 3.1 — 支持运行时热切换模型
 * Requirements: 3.2 — 批量调用失败时按单条逐一重试
 */

import type { ChunkRecord } from "../../../shared/rag/contracts.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { getRAGConfig } from "../config.js";

// ---------------------------------------------------------------------------
// EmbeddedChunk 接口
// ---------------------------------------------------------------------------

export interface EmbeddedChunk {
  chunk: ChunkRecord;
  vector: number[];
}

// ---------------------------------------------------------------------------
// EmbeddingGenerator
// ---------------------------------------------------------------------------

export class EmbeddingGenerator {
  private provider: EmbeddingProvider;

  constructor(provider: EmbeddingProvider) {
    this.provider = provider;
  }

  /**
   * 批量生成嵌入向量。
   *
   * 将 chunks 按 batchSize（从 RAGConfig 读取，默认 64）分批调用 provider.embed()。
   * 如果某批调用失败，降级为逐条调用 generateSingle 重试，
   * 单条仍失败的 chunk 会被跳过（调用方可通过返回数量判断丢失）。
   */
  async generateBatch(chunks: ChunkRecord[]): Promise<EmbeddedChunk[]> {
    if (chunks.length === 0) return [];

    const batchSize = getRAGConfig().embedding.batchSize;
    const results: EmbeddedChunk[] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(c => c.content);

      try {
        const vectors = await this.provider.embed(texts);
        for (let j = 0; j < batch.length; j++) {
          results.push({ chunk: batch[j], vector: vectors[j] });
        }
      } catch {
        // 批量失败 → 降级为单条重试
        for (const chunk of batch) {
          try {
            const vector = await this.generateSingle(chunk.content);
            results.push({ chunk, vector });
          } catch {
            // 单条也失败，跳过该 chunk（调用方可检测丢失）
          }
        }
      }
    }

    return results;
  }

  /**
   * 为单条文本生成嵌入向量。
   */
  async generateSingle(text: string): Promise<number[]> {
    const [vector] = await this.provider.embed([text]);
    return vector;
  }

  /**
   * 运行时热切换 EmbeddingProvider。
   */
  switchProvider(provider: EmbeddingProvider): void {
    this.provider = provider;
  }
}
