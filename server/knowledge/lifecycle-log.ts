/**
 * LifecycleLog — 生命周期日志
 *
 * 管理 append-only JSONL 日志文件，记录实体生命周期操作
 * （状态变更、垃圾回收、合并、审核）。
 *
 * 存储路径：data/knowledge/lifecycle-log.jsonl
 *
 * Requirements: 6.5
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { LifecycleLogEntry } from "../../shared/knowledge/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");
const LOG_FILE = path.join(DATA_DIR, "lifecycle-log.jsonl");

export interface LifecycleLogQueryFilters {
  entityId?: string;
  action?: string;
  triggeredBy?: string;
  since?: string; // ISO 8601 timestamp
}

export class LifecycleLog {
  private readonly logFilePath: string;

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath ?? LOG_FILE;
  }

  /**
   * Append a log entry as a single JSON line to the JSONL file.
   * Creates the directory if it doesn't exist.
   */
  append(entry: LifecycleLogEntry): void {
    try {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.logFilePath, line, "utf-8");
    } catch (e) {
      console.error("[LifecycleLog] Failed to append entry:", e);
    }
  }

  /**
   * Query log entries with optional filters.
   *
   * - If the file doesn't exist, returns an empty array.
   * - If some lines are invalid JSON, they are skipped.
   */
  query(filters?: LifecycleLogQueryFilters): LifecycleLogEntry[] {
    let lines: string[];
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(this.logFilePath, "utf-8");
      lines = raw.split("\n").filter((l) => l.trim().length > 0);
    } catch (e) {
      console.error("[LifecycleLog] Failed to read log file:", e);
      return [];
    }

    const entries: LifecycleLogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LifecycleLogEntry);
      } catch {
        // Skip invalid JSON lines
        console.warn("[LifecycleLog] Skipping invalid JSON line:", line);
      }
    }

    if (!filters) return entries;

    return entries.filter((entry) => {
      if (filters.entityId && entry.entityId !== filters.entityId) return false;
      if (filters.action && entry.action !== filters.action) return false;
      if (filters.triggeredBy && entry.triggeredBy !== filters.triggeredBy) return false;
      if (filters.since && entry.timestamp < filters.since) return false;
      return true;
    });
  }
}
