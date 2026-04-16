/**
 * 审计链 (Audit Trail)
 *
 * 记录 NL Command Center 所有操作的不可变审计日志。
 * 使用本地 JSON 文件持久化 (`data/nl-audit.json`)。
 *
 * @see Requirements 16.1, 16.2, 16.3, 16.4
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AuditEntry,
  AuditQueryFilter,
} from "../../../shared/nl-command/contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_AUDIT_PATH = resolve(__dirname, "../../../data/nl-audit.json");

interface AuditFile {
  version: number;
  entries: AuditEntry[];
}

export class AuditTrail {
  private entries: AuditEntry[] = [];
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_AUDIT_PATH;
    this.load();
  }

  /**
   * 记录审计条目（追加写入）。
   * @see Requirement 16.1, 16.2
   */
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    this.persist();
  }

  /**
   * 查询审计日志，支持按时间范围、操作者、操作类型、实体 ID 过滤。
   * 结果按 timestamp 降序排列。
   * @see Requirement 16.3
   */
  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    let result = this.entries.slice();

    if (filter.startTime !== undefined) {
      result = result.filter(e => e.timestamp >= filter.startTime!);
    }
    if (filter.endTime !== undefined) {
      result = result.filter(e => e.timestamp <= filter.endTime!);
    }
    if (filter.operator !== undefined) {
      result = result.filter(e => e.operator === filter.operator);
    }
    if (filter.operationType !== undefined) {
      result = result.filter(e => e.operationType === filter.operationType);
    }
    if (filter.entityId !== undefined) {
      result = result.filter(e => e.entityId === filter.entityId);
    }

    // 按 timestamp 降序排列
    result.sort((a, b) => b.timestamp - a.timestamp);

    // 分页
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? result.length;
    result = result.slice(offset, offset + limit);

    return result;
  }

  /**
   * 导出审计日志为 JSON 字符串。
   * @see Requirement 16.4
   */
  async export(filter: AuditQueryFilter, format: "json"): Promise<string> {
    const entries = await this.query(filter);
    return JSON.stringify(entries, null, 2);
  }

  // ---------------------------------------------------------------------------
  // 持久化
  // ---------------------------------------------------------------------------

  private load(): void {
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
    }
  }

  private persist(): void {
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
}
