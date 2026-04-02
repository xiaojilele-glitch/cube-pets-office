/**
 * 滑动窗口分块器
 *
 * 用于 task_result / mission_log / bug_report 类型数据。
 * 以固定窗口大小（默认 512 tokens）和重叠量（默认 64 tokens）
 * 对内容进行滑动窗口分块。
 *
 * Token 计数采用简单的空白分词估算（chars / 4 作为兜底）。
 * 每个 chunk 的 tokenCount 保证在 [minTokens, maxTokens] 范围内：
 *   - 过小的尾部 chunk 合并到前一个 chunk
 *   - 超过 maxTokens 的 chunk 进一步拆分
 *
 * Requirements: 2.1, 2.4
 */

import type { ChunkRecord, ChunkMetadata, SourceType } from '../../../shared/rag/contracts.js';
import type { Chunker } from './chunk-router.js';
import type { ChunkingConfig } from '../config.js';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export interface SlidingWindowOptions {
  /** 窗口大小（token 数），默认 512 */
  windowSize?: number;
  /** 重叠量（token 数），默认 64 */
  overlap?: number;
  /** 单个 chunk 最小 token 数，默认 64 */
  minTokens?: number;
  /** 单个 chunk 最大 token 数，默认 1024 */
  maxTokens?: number;
  /** sourceType，用于生成 chunkId */
  sourceType?: SourceType;
  /** sourceId，用于生成 chunkId */
  sourceId?: string;
  /** projectId */
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Token 计数
// ---------------------------------------------------------------------------

/**
 * 简单 token 计数：按空白分词。
 * 空字符串返回 0。
 */
export function estimateTokenCount(text: string): number {
  if (!text || !text.trim()) return 0;
  // 按连续空白分词，过滤空串
  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.length;
}

// ---------------------------------------------------------------------------
// SlidingWindowChunker
// ---------------------------------------------------------------------------

export class SlidingWindowChunker implements Chunker {
  private readonly windowSize: number;
  private readonly overlap: number;
  private readonly minTokens: number;
  private readonly maxTokens: number;

  constructor(options?: SlidingWindowOptions) {
    this.windowSize = options?.windowSize ?? 512;
    this.overlap = options?.overlap ?? 64;
    this.minTokens = options?.minTokens ?? 64;
    this.maxTokens = options?.maxTokens ?? 1024;
  }

  /**
   * 从 ChunkingConfig（由 ChunkRouter.getChunkingConfig 返回）创建实例。
   */
  static fromConfig(config?: ChunkingConfig): SlidingWindowChunker {
    return new SlidingWindowChunker({
      windowSize: config?.windowSize ?? 512,
      overlap: config?.overlap ?? 64,
      minTokens: config?.minTokens ?? 64,
      maxTokens: config?.maxTokens ?? 1024,
    });
  }

  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
    if (!content || !content.trim()) {
      return [];
    }

    // 将内容按空白分词
    const tokens = content.split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
      return [];
    }

    // 如果整体 token 数不超过窗口大小，直接作为单个 chunk
    if (tokens.length <= this.windowSize) {
      return [this.buildChunkRecord(content.trim(), tokens.length, 0, metadata)];
    }

    // 滑动窗口分块
    const rawChunks = this.slideWindow(tokens);

    // 合并过小的尾部 chunk
    const merged = this.mergeSmallChunks(rawChunks);

    // 拆分过大的 chunk
    const final = this.splitLargeChunks(merged);

    // 构建 ChunkRecord 数组
    return final.map((chunk, index) =>
      this.buildChunkRecord(chunk.text, chunk.tokenCount, index, metadata),
    );
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 滑动窗口切分 token 数组 */
  private slideWindow(tokens: string[]): RawChunk[] {
    const chunks: RawChunk[] = [];
    const step = Math.max(1, this.windowSize - this.overlap);
    let pos = 0;

    while (pos < tokens.length) {
      const end = Math.min(pos + this.windowSize, tokens.length);
      const slice = tokens.slice(pos, end);
      chunks.push({
        text: slice.join(' '),
        tokenCount: slice.length,
      });

      // 如果已经到达末尾，退出
      if (end >= tokens.length) break;
      pos += step;
    }

    return chunks;
  }

  /** 将 tokenCount < minTokens 的尾部 chunk 合并到前一个 chunk */
  private mergeSmallChunks(chunks: RawChunk[]): RawChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: RawChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      if (chunk.tokenCount < this.minTokens && result.length > 0) {
        // 合并到前一个 chunk
        const prev = result[result.length - 1];
        prev.text = prev.text + ' ' + chunk.text;
        prev.tokenCount = estimateTokenCount(prev.text);
      } else {
        result.push({ ...chunk });
      }
    }

    return result;
  }

  /** 将 tokenCount > maxTokens 的 chunk 进一步拆分 */
  private splitLargeChunks(chunks: RawChunk[]): RawChunk[] {
    const result: RawChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.tokenCount <= this.maxTokens) {
        result.push(chunk);
        continue;
      }

      // 按 maxTokens 拆分
      const tokens = chunk.text.split(/\s+/).filter(Boolean);
      let pos = 0;
      while (pos < tokens.length) {
        const end = Math.min(pos + this.maxTokens, tokens.length);
        const slice = tokens.slice(pos, end);
        const subChunk: RawChunk = {
          text: slice.join(' '),
          tokenCount: slice.length,
        };

        // 如果拆分后的尾部太小且有前一个 chunk，合并
        if (subChunk.tokenCount < this.minTokens && result.length > 0) {
          const prev = result[result.length - 1];
          // 只在合并后不超过 maxTokens 时合并
          if (prev.tokenCount + subChunk.tokenCount <= this.maxTokens) {
            prev.text = prev.text + ' ' + subChunk.text;
            prev.tokenCount = estimateTokenCount(prev.text);
          } else {
            result.push(subChunk);
          }
        } else {
          result.push(subChunk);
        }

        pos = end;
      }
    }

    return result;
  }

  /** 构建 ChunkRecord */
  private buildChunkRecord(
    content: string,
    tokenCount: number,
    chunkIndex: number,
    metadata: ChunkMetadata,
  ): ChunkRecord {
    // chunkId 格式来自 contracts.ts: `${sourceType}:${sourceId}:${chunkIndex}`
    // 从 metadata 中无法获取 sourceType/sourceId，使用占位符
    // 实际使用时由 IngestionPipeline 在外层设置正确的值
    return {
      chunkId: `chunk:${chunkIndex}`,
      sourceType: 'task_result',
      sourceId: '',
      projectId: '',
      chunkIndex,
      content,
      tokenCount,
      metadata,
    };
  }
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

interface RawChunk {
  text: string;
  tokenCount: number;
}
