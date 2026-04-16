/**
 * 审计链 (Audit Trail) — 成本治理
 *
 * 记录所有成本治理操作的完整审计日志，支持按多维度过滤查询。
 * 使用本地 JSON 文件持久化 (`data/cost-governance-audit.json`)。
 *
 * @see Requirements 3.5, 4.4, 4.7, 5.6, 6.7, 7.5, 14.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import type {
  AuditEntry,
  AuditAction,
} from "../../../shared/cost-governance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_AUDIT_PATH = resolve(
  __dirname,
  "../../../data/cost-governance-audit.json"
);

interface AuditFile {
  version: number;
  entries: AuditEntry[];
}

export interface AuditQueryFilters {
  missionId?: string;
  action?: AuditAction;
  userId?: string;
  timeRange?: { start: number; end: number };
}

export class AuditTrail {
  private entries: AuditEntry[] = [];
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_AUDIT_PATH;
    this.load();
  }

  /**
   * 记录审计事件，自动生成 id 和 timestamp。
   */
  record(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.entries.push(full);
    return full;
  }

  /**
   * 按 missionId、action、userId、timeRange 过滤查询审计记录。
   * 结果按 timestamp 降序排列。
   */
  query(filters: AuditQueryFilters): AuditEntry[] {
    let result = this.entries.slice();

    if (filters.missionId !== undefined) {
      result = result.filter(e => e.missionId === filters.missionId);
    }
    if (filters.action !== undefined) {
      result = result.filter(e => e.action === filters.action);
    }
    if (filters.userId !== undefined) {
      result = result.filter(e => e.userId === filters.userId);
    }
    if (filters.timeRange !== undefined) {
      const { start, end } = filters.timeRange;
      result = result.filter(e => e.timestamp >= start && e.timestamp <= end);
    }

    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  }

  /**
   * 持久化到 JSON 文件。写入失败仅记录错误，不影响内存状态。
   */
  persist(): void {
    const data: AuditFile = {
      version: 1,
      entries: this.entries,
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[AuditTrail] 持久化写入失败:", err);
    }
  }

  /**
   * 启动时加载历史审计数据。文件不存在或损坏时以空状态启动。
   */
  load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AuditFile;
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries;
      }
    } catch {
      console.warn(
        `[AuditTrail] 持久化文件损坏，以空日志启动: ${this.filePath}`
      );
      this.entries = [];
    }
  }
}

/** 单例 */
export const auditTrail = new AuditTrail();
