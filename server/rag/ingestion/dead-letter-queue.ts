/**
 * DeadLetterQueue — 摄入失败暂存队列
 *
 * 将摄入管道中任意阶段失败的数据写入本地 JSON 文件，
 * 支持查询和重试。
 *
 * Requirements: 1.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  DeadLetterEntry,
  IngestionPayload,
} from "../../../shared/rag/contracts.js";

// ---------------------------------------------------------------------------
// 序列化格式
// ---------------------------------------------------------------------------

interface DLQFile {
  version: 1;
  entries: DeadLetterEntry[];
}

// ---------------------------------------------------------------------------
// 默认文件路径
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_FILE_PATH = resolve(__dirname, "../../../data/rag_dlq.json");

// ---------------------------------------------------------------------------
// DeadLetterQueue
// ---------------------------------------------------------------------------

export class DeadLetterQueue {
  private entries = new Map<string, DeadLetterEntry>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = DEFAULT_FILE_PATH) {
    this.load();
  }

  /** 将失败的 payload 写入 DLQ */
  push(
    payload: IngestionPayload,
    error: string,
    stage: DeadLetterEntry["stage"]
  ): DeadLetterEntry {
    const entry: DeadLetterEntry = {
      entryId: randomUUID(),
      payload,
      error,
      failedAt: new Date().toISOString(),
      retryCount: 0,
      stage,
    };
    this.entries.set(entry.entryId, entry);
    this.scheduleSave();
    return entry;
  }

  /** 查询 DLQ 条目 */
  list(options?: { limit?: number; offset?: number }): DeadLetterEntry[] {
    const all = Array.from(this.entries.values());
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  /** 按 entryId 获取 */
  get(entryId: string): DeadLetterEntry | undefined {
    return this.entries.get(entryId);
  }

  /** 标记重试（增加 retryCount），返回 payload 供重新摄入 */
  markRetry(entryId: string): IngestionPayload | undefined {
    const entry = this.entries.get(entryId);
    if (!entry) return undefined;
    entry.retryCount++;
    this.scheduleSave();
    return entry.payload;
  }

  /** 移除已成功重试的条目 */
  remove(entryId: string): boolean {
    const deleted = this.entries.delete(entryId);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  /** 当前积压量 */
  count(): number {
    return this.entries.size;
  }

  /** 等待所有挂起的写入完成 */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  // -----------------------------------------------------------------------
  // 持久化
  // -----------------------------------------------------------------------

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as DLQFile;
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const entry of entries) {
        if (entry && typeof entry.entryId === "string") {
          this.entries.set(entry.entryId, entry);
        }
      }
    } catch {
      /* corrupt file — start empty */
    }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.save());
  }

  private save(): void {
    const data: DLQFile = {
      version: 1,
      entries: Array.from(this.entries.values()),
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[DeadLetterQueue] Failed to save:", err);
    }
  }
}
