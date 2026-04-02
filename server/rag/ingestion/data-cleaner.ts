/**
 * DataCleaner — 数据清洗
 *
 * 去除多余空白、规范化编码、截断超长内容。
 *
 * Requirements: 1.5
 */

import type { IngestionPayload } from '../../../shared/rag/contracts.js';
import { createHash } from 'node:crypto';

/** 默认最大内容长度（字符数） */
const DEFAULT_MAX_CONTENT_LENGTH = 500_000;

export interface DataCleanerOptions {
  maxContentLength?: number;
}

export class DataCleaner {
  private readonly maxContentLength: number;

  constructor(options?: DataCleanerOptions) {
    this.maxContentLength = options?.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  }

  /**
   * 清洗 IngestionPayload 的 content 字段。
   * 返回清洗后的 payload（含 contentHash）。
   * @throws Error 如果 content 为空
   */
  clean(payload: IngestionPayload): IngestionPayload & { contentHash: string } {
    let content = payload.content ?? '';

    // 1. 去除首尾空白
    content = content.trim();

    // 2. 规范化换行符为 \n
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 3. 合并连续空行为最多两个换行
    content = content.replace(/\n{3,}/g, '\n\n');

    // 4. 去除行尾空白
    content = content.replace(/[ \t]+$/gm, '');

    // 5. 截断超长内容
    if (content.length > this.maxContentLength) {
      content = content.substring(0, this.maxContentLength);
    }

    // 6. 验证非空
    if (!content) {
      throw new Error('Content is empty after cleaning');
    }

    // 7. 计算 contentHash
    const contentHash = createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);

    return {
      ...payload,
      content,
      contentHash,
    };
  }
}
