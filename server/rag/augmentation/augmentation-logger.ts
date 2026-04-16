/**
 * AugmentationLogger — 增强执行日志
 *
 * 写入 rag_augmentation_log 记录每次 RAG 增强的执行详情。
 *
 * Requirements: 5.6
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { RAGAugmentationLog } from "../../../shared/rag/contracts.js";

interface LogFile {
  version: 1;
  logs: RAGAugmentationLog[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_FILE_PATH = resolve(
  __dirname,
  "../../../data/rag_augmentation_log.json"
);

export class AugmentationLogger {
  private logs: RAGAugmentationLog[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = DEFAULT_FILE_PATH) {
    this.load();
  }

  log(
    entry: Omit<RAGAugmentationLog, "logId" | "timestamp">
  ): RAGAugmentationLog {
    const record: RAGAugmentationLog = {
      ...entry,
      logId: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.logs.push(record);
    this.scheduleSave();
    return record;
  }

  getByTaskId(taskId: string): RAGAugmentationLog[] {
    return this.logs.filter(l => l.taskId === taskId);
  }

  recent(limit: number = 100): RAGAugmentationLog[] {
    return this.logs.slice(-limit);
  }

  count(): number {
    return this.logs.length;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as LogFile;
      this.logs = Array.isArray(parsed?.logs) ? parsed.logs : [];
    } catch {
      /* start empty */
    }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.save());
  }

  private save(): void {
    const data: LogFile = { version: 1, logs: this.logs };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[AugmentationLogger] Failed to save:", err);
    }
  }
}
