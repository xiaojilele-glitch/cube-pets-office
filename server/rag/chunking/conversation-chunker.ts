/**
 * 对话轮次分块器
 *
 * 用于 conversation 类型数据。
 * 按对话轮次（speaker 切换）分割内容，每个轮次作为一个分块单元。
 *
 * 支持的 speaker 模式：
 *   - "Speaker: message"
 *   - "User: message"  / "Agent: message"
 *   - "[Speaker] message"
 *   - "**Speaker**: message"  (Markdown bold)
 *   - "Speaker (timestamp): message"
 *
 * 小轮次（< minTokens）合并到相邻轮次；
 * 大轮次（> maxTokens）按 token 拆分。
 * 每个 chunk 的 metadata 中设置 turnIndex 和 speaker。
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

export interface ConversationChunkerOptions {
  /** 单个 chunk 最小 token 数，默认 64 */
  minTokens?: number;
  /** 单个 chunk 最大 token 数，默认 1024 */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Speaker 检测
// ---------------------------------------------------------------------------

/**
 * Speaker 行匹配模式（按优先级排列）。
 * 每个模式的第一个捕获组为 speaker 名称。
 */
const SPEAKER_PATTERNS: RegExp[] = [
  // [Speaker] message
  /^\[([^\]]+)\]\s*/,
  // **Speaker**: message  (Markdown bold)
  /^\*\*([^*]+)\*\*\s*:\s*/,
  // Speaker (timestamp): message
  /^([A-Za-z][\w\s]*?)\s*\([^)]+\)\s*:\s*/,
  // Speaker: message  (generic — must start with letter, name ≤ 40 chars)
  /^([A-Za-z][\w\s]{0,39})\s*:\s*/,
];

/**
 * 尝试从一行文本中提取 speaker 名称。
 * 返回 speaker 名称（已 trim），或 null 表示非 speaker 行。
 */
export function extractSpeaker(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  for (const pattern of SPEAKER_PATTERNS) {
    const m = pattern.exec(trimmed);
    if (m && m[1]) {
      return m[1].trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Turn 解析
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  speaker: string;
  content: string;
  tokenCount: number;
}

/**
 * 将对话内容按 speaker 切换分割为轮次数组。
 * 连续属于同一 speaker 的行合并为一个轮次。
 * 无法识别 speaker 的行归入当前轮次。
 */
export function parseConversationTurns(content: string): ConversationTurn[] {
  const lines = content.split('\n');
  const turns: ConversationTurn[] = [];
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  function flushTurn(): void {
    const text = currentLines.join('\n').trim();
    if (text && currentSpeaker) {
      turns.push({
        speaker: currentSpeaker,
        content: text,
        tokenCount: estimateTokenCount(text),
      });
    } else if (text && !currentSpeaker) {
      // Content before any speaker detected — assign to "unknown"
      turns.push({
        speaker: 'unknown',
        content: text,
        tokenCount: estimateTokenCount(text),
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const speaker = extractSpeaker(line);

    if (speaker !== null && speaker !== currentSpeaker) {
      // Speaker change — flush previous turn
      flushTurn();
      currentSpeaker = speaker;
    }

    currentLines.push(line);
  }

  // Flush last turn
  flushTurn();

  return turns;
}

// ---------------------------------------------------------------------------
// ConversationChunker
// ---------------------------------------------------------------------------

export class ConversationChunker implements Chunker {
  private readonly minTokens: number;
  private readonly maxTokens: number;

  constructor(options?: ConversationChunkerOptions) {
    this.minTokens = options?.minTokens ?? 64;
    this.maxTokens = options?.maxTokens ?? 1024;
  }

  /**
   * 从 ChunkingConfig 创建实例。
   */
  static fromConfig(config?: ChunkingConfig): ConversationChunker {
    return new ConversationChunker({
      minTokens: config?.minTokens ?? 64,
      maxTokens: config?.maxTokens ?? 1024,
    });
  }

  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
    if (!content || !content.trim()) {
      return [];
    }

    // 1. 按 speaker 切换解析轮次
    const turns = parseConversationTurns(content);

    if (turns.length === 0) {
      return [];
    }

    // 2. 合并小轮次、拆分大轮次
    const processed = this.processChunks(turns);

    // 3. 构建 ChunkRecord 数组
    return processed.map((chunk, index) =>
      this.buildChunkRecord(chunk, index, metadata),
    );
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * 合并过小的轮次，拆分过大的轮次，确保 token 范围在 [minTokens, maxTokens]。
   */
  private processChunks(turns: ConversationTurn[]): ProcessedChunk[] {
    // First pass: split large turns
    const split = this.splitLargeTurns(turns);

    // Second pass: merge small turns with adjacent
    return this.mergeSmallTurns(split);
  }

  /** 拆分 tokenCount > maxTokens 的轮次 */
  private splitLargeTurns(turns: ConversationTurn[]): ProcessedChunk[] {
    const result: ProcessedChunk[] = [];

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];

      if (turn.tokenCount <= this.maxTokens) {
        result.push({
          content: turn.content,
          tokenCount: turn.tokenCount,
          speaker: turn.speaker,
          turnIndex: i,
        });
        continue;
      }

      // Split by words
      const words = turn.content.split(/\s+/).filter(Boolean);
      let pos = 0;
      while (pos < words.length) {
        const end = Math.min(pos + this.maxTokens, words.length);
        const slice = words.slice(pos, end);
        const text = slice.join(' ');
        result.push({
          content: text,
          tokenCount: slice.length,
          speaker: turn.speaker,
          turnIndex: i,
        });
        pos = end;
      }
    }

    return result;
  }

  /** 合并 tokenCount < minTokens 的 chunk 到相邻 chunk */
  private mergeSmallTurns(chunks: ProcessedChunk[]): ProcessedChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: ProcessedChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.tokenCount < this.minTokens && result.length > 0) {
        const prev = result[result.length - 1];
        // Merge if combined doesn't exceed maxTokens
        if (prev.tokenCount + chunk.tokenCount <= this.maxTokens) {
          prev.content = prev.content + '\n' + chunk.content;
          prev.tokenCount = estimateTokenCount(prev.content);
          // Keep the first speaker for the merged chunk
          continue;
        }
      }
      result.push({ ...chunk });
    }

    // Handle case where first chunk is small — try merging forward
    if (result.length > 1 && result[0].tokenCount < this.minTokens) {
      const first = result[0];
      const second = result[1];
      if (first.tokenCount + second.tokenCount <= this.maxTokens) {
        second.content = first.content + '\n' + second.content;
        second.tokenCount = estimateTokenCount(second.content);
        second.turnIndex = first.turnIndex;
        second.speaker = first.speaker;
        result.shift();
      }
    }

    return result;
  }

  /** 构建 ChunkRecord，设置 turnIndex 和 speaker 元数据 */
  private buildChunkRecord(
    chunk: ProcessedChunk,
    chunkIndex: number,
    metadata: ChunkMetadata,
  ): ChunkRecord {
    const chunkMeta: ChunkMetadata = {
      ...metadata,
      turnIndex: chunk.turnIndex,
      speaker: chunk.speaker,
    };

    return {
      chunkId: `chunk:${chunkIndex}`,
      sourceType: 'conversation' as SourceType,
      sourceId: '',
      projectId: '',
      chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      metadata: chunkMeta,
    };
  }
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

interface ProcessedChunk {
  content: string;
  tokenCount: number;
  speaker: string;
  turnIndex: number;
}
