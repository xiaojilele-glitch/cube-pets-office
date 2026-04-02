/**
 * HardNegativeSet — 硬负例集
 *
 * 维护 irrelevant chunk 集合，在检索时降低硬负例的排名权重。
 *
 * Requirements: 6.4
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface HardNegFile {
  version: 1;
  chunkIds: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_FILE_PATH = resolve(__dirname, '../../../data/rag_hard_negatives.json');

export class HardNegativeSet {
  private negatives = new Set<string>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = DEFAULT_FILE_PATH) {
    this.load();
  }

  /** 添加 chunk 到硬负例集 */
  add(chunkId: string): void {
    if (!this.negatives.has(chunkId)) {
      this.negatives.add(chunkId);
      this.scheduleSave();
    }
  }

  /** 批量添加 */
  addBatch(chunkIds: string[]): void {
    let changed = false;
    for (const id of chunkIds) {
      if (!this.negatives.has(id)) {
        this.negatives.add(id);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  /** 检查是否为硬负例 */
  isNegative(chunkId: string): boolean {
    return this.negatives.has(chunkId);
  }

  /** 移除（如果后续被标记为 helpful） */
  remove(chunkId: string): boolean {
    const deleted = this.negatives.delete(chunkId);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  /** 对检索结果应用惩罚权重 */
  applyPenalty<T extends { chunkId: string; score: number }>(
    results: T[],
    penaltyFactor: number = 0.5,
  ): T[] {
    return results.map(r => ({
      ...r,
      score: this.negatives.has(r.chunkId) ? r.score * penaltyFactor : r.score,
    }));
  }

  count(): number { return this.negatives.size; }

  all(): string[] { return Array.from(this.negatives); }

  async flush(): Promise<void> { await this.writeQueue; }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as HardNegFile;
      const ids = Array.isArray(parsed?.chunkIds) ? parsed.chunkIds : [];
      for (const id of ids) {
        if (typeof id === 'string') this.negatives.add(id);
      }
    } catch { /* start empty */ }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.save());
  }

  private save(): void {
    const data: HardNegFile = { version: 1, chunkIds: Array.from(this.negatives) };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[HardNegativeSet] Failed to save:', err);
    }
  }
}
