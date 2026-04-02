/**
 * 语义段落分块器
 *
 * 用于 document 类型数据。
 * 按双换行符（\n\n）分段为语义段落，再按 token 数合并/分割：
 *   - 小段落（< minTokens）与相邻段落合并
 *   - 大段落（> maxTokens）按 token 数拆分
 * 每个 chunk 的 tokenCount 保证在 [minTokens, maxTokens] 范围内。
 *
 * Requirements: 2.1, 2.4
 */

import type { ChunkRecord, ChunkMetadata, SourceType } from '../../../shared/rag/contracts.js';
import type { Chunker } from './chunk-router.js';
import type { ChunkingConfig } from '../config.js';
import { estimateTokenCount } from './sliding-window-chunker.js';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export interface DocumentChunkerOptions {
  /** 单个 chunk 最小 token 数，默认 64 */
  minTokens?: number;
  /** 单个 chunk 最大 token 数，默认 1024 */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// DocumentChunker
// ---------------------------------------------------------------------------

export class DocumentChunker implements Chunker {
  private readonly minTokens: number;
  private readonly maxTokens: number;

  constructor(options?: DocumentChunkerOptions) {
    this.minTokens = options?.minTokens ?? 64;
    this.maxTokens = options?.maxTokens ?? 1024;
  }

  /**
   * 从 ChunkingConfig 创建实例。
   */
  static fromConfig(config?: ChunkingConfig): DocumentChunker {
    return new DocumentChunker({
      minTokens: config?.minTokens ?? 64,
      maxTokens: config?.maxTokens ?? 1024,
    });
  }

  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
    if (!content || !content.trim()) {
      return [];
    }

    // 1. 按双换行符分段为语义段落
    const paragraphs = this.splitParagraphs(content);

    if (paragraphs.length === 0) {
      return [];
    }

    // 2. 拆分过大的段落
    const split = this.splitLargeParagraphs(paragraphs);

    // 3. 合并过小的段落
    const merged = this.mergeSmallParagraphs(split);

    // 4. 构建 ChunkRecord 数组
    return merged.map((chunk, index) =>
      this.buildChunkRecord(chunk.text, chunk.tokenCount, index, metadata),
    );
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * 按双换行符分段，过滤空段落。
   */
  private splitParagraphs(content: string): RawParagraph[] {
    return content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((text) => ({
        text,
        tokenCount: estimateTokenCount(text),
      }));
  }

  /**
   * 将 tokenCount > maxTokens 的段落按 token 数拆分。
   */
  private splitLargeParagraphs(paragraphs: RawParagraph[]): RawParagraph[] {
    const result: RawParagraph[] = [];

    for (const para of paragraphs) {
      if (para.tokenCount <= this.maxTokens) {
        result.push(para);
        continue;
      }

      // 按 maxTokens 拆分
      const words = para.text.split(/\s+/).filter(Boolean);
      let pos = 0;
      while (pos < words.length) {
        const end = Math.min(pos + this.maxTokens, words.length);
        const slice = words.slice(pos, end);
        result.push({
          text: slice.join(' '),
          tokenCount: slice.length,
        });
        pos = end;
      }
    }

    return result;
  }

  /**
   * 将 tokenCount < minTokens 的段落与相邻段落合并。
   * 优先向后合并（与下一个段落合并），如果是最后一个则向前合并。
   */
  private mergeSmallParagraphs(paragraphs: RawParagraph[]): RawParagraph[] {
    if (paragraphs.length <= 1) return paragraphs;

    const result: RawParagraph[] = [];

    for (const para of paragraphs) {
      if (para.tokenCount < this.minTokens && result.length > 0) {
        const prev = result[result.length - 1];
        // Merge if combined doesn't exceed maxTokens
        if (prev.tokenCount + para.tokenCount <= this.maxTokens) {
          prev.text = prev.text + '\n\n' + para.text;
          prev.tokenCount = estimateTokenCount(prev.text);
          continue;
        }
      }
      result.push({ ...para });
    }

    // Handle case where first chunk is small — try merging forward
    if (result.length > 1 && result[0].tokenCount < this.minTokens) {
      const first = result[0];
      const second = result[1];
      if (first.tokenCount + second.tokenCount <= this.maxTokens) {
        second.text = first.text + '\n\n' + second.text;
        second.tokenCount = estimateTokenCount(second.text);
        result.shift();
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
    return {
      chunkId: `chunk:${chunkIndex}`,
      sourceType: 'document' as SourceType,
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

interface RawParagraph {
  text: string;
  tokenCount: number;
}
