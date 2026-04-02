/**
 * 直通分块器
 *
 * 用于 architecture_decision 类型数据。
 * 整体作为单个 chunk，不分割。
 *
 * Requirements: 2.1
 */

import type { ChunkRecord, ChunkMetadata, SourceType } from '../../../shared/rag/contracts.js';
import type { Chunker } from './chunk-router.js';
import type { ChunkingConfig } from '../config.js';
import { estimateTokenCount } from './sliding-window-chunker.js';

export class PassthroughChunker implements Chunker {
  static fromConfig(_config?: ChunkingConfig): PassthroughChunker {
    return new PassthroughChunker();
  }

  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
    if (!content || !content.trim()) {
      return [];
    }

    const trimmed = content.trim();
    return [{
      chunkId: `chunk:0`,
      sourceType: 'architecture_decision' as SourceType,
      sourceId: '',
      projectId: '',
      chunkIndex: 0,
      content: trimmed,
      tokenCount: estimateTokenCount(trimmed),
      metadata,
    }];
  }
}
