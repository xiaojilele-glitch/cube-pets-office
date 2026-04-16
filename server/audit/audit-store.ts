/**
 * AuditStore — Append-Only WAL 持久化存储
 *
 * 基于 Write-Ahead Log (JSONL) 实现不可篡改的审计日志存储：
 * - WAL 文件：data/audit/chain.wal（每行一条 JSON 序列化的 AuditLogEntry）
 * - 索引文件：data/audit/chain.idx（entryId → 字节偏移量）
 * - 内存索引：启动时从 WAL 恢复
 */

import fs from "node:fs";
import path from "node:path";
import type { AuditLogEntry } from "../../shared/audit/contracts.js";
import type { IAuditStore } from "./audit-chain.js";

export class AuditStore implements IAuditStore {
  private walPath: string;
  private idxPath: string;
  private entries: AuditLogEntry[] = [];
  private indexMap: Map<string, number> = new Map(); // entryId → array index
  private locked = false;

  constructor(dataDir?: string) {
    const base = dataDir ?? path.resolve("data/audit");
    this.walPath = path.join(base, "chain.wal");
    this.idxPath = path.join(base, "chain.idx");
  }

  /**
   * 3.6 启动时从 WAL 恢复内存索引
   * 逐行读取 WAL 文件，解析 JSON，重建 entries 数组和 indexMap。
   * 损坏的行会被跳过并输出警告。
   */
  init(): void {
    this.entries = [];
    this.indexMap.clear();

    // 确保目录存在
    const dir = path.dirname(this.walPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.walPath)) {
      return;
    }

    const content = fs.readFileSync(this.walPath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry: AuditLogEntry = JSON.parse(line);
        const idx = this.entries.length;
        this.entries.push(entry);
        this.indexMap.set(entry.entryId, idx);
      } catch {
        console.warn(`[AuditStore] Skipping corrupted line ${i + 1} in WAL`);
      }
    }

    // 持久化恢复后的索引
    this.persistIndex();
  }

  /**
   * 3.2 追加条目到 WAL（文件锁 + fsync）
   * - 简单的内存锁防止并发写入
   * - 追加 JSON 行到 WAL 文件
   * - fsync 确保持久化
   * - 更新内存索引
   */
  appendEntry(entry: AuditLogEntry): void {
    if (this.locked) {
      throw new Error("[AuditStore] WAL is locked, concurrent write rejected");
    }
    this.locked = true;
    try {
      // 确保目录存在
      const dir = path.dirname(this.walPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 3.1 WAL 文件写入（JSONL 格式）
      const line = JSON.stringify(entry) + "\n";
      const fd = fs.openSync(this.walPath, "a");
      try {
        fs.writeSync(fd, line);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      // 更新内存索引
      const idx = this.entries.length;
      this.entries.push(entry);
      this.indexMap.set(entry.entryId, idx);

      // 3.5 持久化索引文件
      this.persistIndex();
    } finally {
      this.locked = false;
    }
  }

  /**
   * 3.3 按序号范围读取条目
   * 从内存索引中过滤，按 sequenceNumber 排序返回。
   */
  readEntries(startSeq: number, endSeq: number): AuditLogEntry[] {
    return this.entries
      .filter(e => e.sequenceNumber >= startSeq && e.sequenceNumber <= endSeq)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  /**
   * 3.4 返回总条目数
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * 3.4 返回最后一条条目
   */
  getLastEntry(): AuditLogEntry | null {
    return this.entries.length > 0
      ? this.entries[this.entries.length - 1]
      : null;
  }

  /**
   * 按 entryId 查找条目
   */
  getEntryById(entryId: string): AuditLogEntry | null {
    const idx = this.indexMap.get(entryId);
    if (idx === undefined) return null;
    return this.entries[idx] ?? null;
  }

  /**
   * 3.5 持久化索引文件（entryId → 数组索引）
   */
  private persistIndex(): void {
    const indexObj: Record<string, number> = {};
    for (const [key, val] of this.indexMap) {
      indexObj[key] = val;
    }
    try {
      fs.writeFileSync(this.idxPath, JSON.stringify(indexObj), "utf-8");
    } catch {
      console.warn("[AuditStore] Failed to persist index file");
    }
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const auditStore = new AuditStore();
