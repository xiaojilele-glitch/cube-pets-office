/**
 * DedupChecker — 摄入幂等去重
 *
 * 以 sourceType + sourceId + contentHash 为去重键，
 * 使用内存 Map 做快速查找 + 持久化 JSON 文件保证重启后不丢失。
 * 写入队列模式与 MetadataStore 一致（scheduleSave → writeQueue）。
 *
 * Requirements: 1.6
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 去重键格式：`${sourceType}:${sourceId}:${contentHash}`
// ---------------------------------------------------------------------------

export function buildDedupKey(
  sourceType: string,
  sourceId: string,
  contentHash: string
): string {
  return `${sourceType}:${sourceId}:${contentHash}`;
}

// ---------------------------------------------------------------------------
// 序列化格式
// ---------------------------------------------------------------------------

interface DedupStoreFile {
  version: 1;
  keys: string[];
}

// ---------------------------------------------------------------------------
// 默认文件路径
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_FILE_PATH = resolve(__dirname, "../../../data/rag_dedup.json");

// ---------------------------------------------------------------------------
// DedupChecker
// ---------------------------------------------------------------------------

export class DedupChecker {
  /** 内存去重集合 */
  private keys = new Set<string>();

  /** 写入队列，保证顺序写入 */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = DEFAULT_FILE_PATH) {
    this.load();
  }

  /**
   * 检查是否已摄入过（重复）
   */
  isDuplicate(
    sourceType: string,
    sourceId: string,
    contentHash: string
  ): boolean {
    return this.keys.has(buildDedupKey(sourceType, sourceId, contentHash));
  }

  /**
   * 标记为已摄入
   */
  markIngested(
    sourceType: string,
    sourceId: string,
    contentHash: string
  ): void {
    const key = buildDedupKey(sourceType, sourceId, contentHash);
    if (!this.keys.has(key)) {
      this.keys.add(key);
      this.scheduleSave();
    }
  }

  /** 当前已记录的去重键数量 */
  count(): number {
    return this.keys.size;
  }

  /** 等待所有挂起的写入完成 */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  // -------------------------------------------------------------------------
  // 持久化
  // -------------------------------------------------------------------------

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as DedupStoreFile;
      const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
      for (const key of keys) {
        if (typeof key === "string") {
          this.keys.add(key);
        }
      }
    } catch {
      // 文件损坏时从空状态开始
    }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.save());
  }

  private save(): void {
    const data: DedupStoreFile = {
      version: 1,
      keys: Array.from(this.keys),
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[DedupChecker] Failed to save:", err);
    }
  }
}
