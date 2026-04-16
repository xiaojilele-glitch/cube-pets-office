/**
 * AuditExport — 审计日志导出模块
 *
 * 支持 JSON 和 CSV 格式导出，包含完整性验证信息（总哈希 + 签名），
 * 导出操作自身记录 AUDIT_EXPORT 事件。
 */

import crypto from "node:crypto";
import type {
  AuditLogEntry,
  AuditQueryFilters,
} from "../../shared/audit/contracts.js";
import {
  AuditEventType,
  DEFAULT_EVENT_TYPE_REGISTRY,
} from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";
import { auditChain } from "./audit-chain.js";
import type { AuditCollector } from "./audit-collector.js";
import { auditCollector } from "./audit-collector.js";

// ─── CSV 列定义 ────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "entryId",
  "sequenceNumber",
  "eventId",
  "eventType",
  "timestamp",
  "actorType",
  "actorId",
  "action",
  "resourceType",
  "resourceId",
  "result",
  "currentHash",
  "signature",
];

// ─── AuditExport 类 ───────────────────────────────────────────────────────

export class AuditExport {
  private chain: AuditChain;
  private collector: AuditCollector;

  constructor(chain: AuditChain, collector: AuditCollector) {
    this.chain = chain;
    this.collector = collector;
  }

  // ─── exportLog() ──────────────────────────────────────────────────────

  /**
   * 导出审计日志。
   * - JSON 格式：完整 AuditLogEntry 数组（含哈希链和签名）
   * - CSV 格式：扁平化关键字段
   * - 附带完整性验证信息（总哈希 + 签名）
   * - 记录 AUDIT_EXPORT 事件
   */
  exportLog(
    filters: AuditQueryFilters,
    format: "json" | "csv"
  ): { data: string; hash: string; signature: string } {
    const entries = this.getFilteredEntries(filters);

    // 10.1 / 10.2 格式化导出数据
    const data =
      format === "json" ? this.formatJson(entries) : this.formatCsv(entries);

    // 10.3 完整性验证信息
    const hash = crypto.createHash("sha256").update(data).digest("hex");
    const signature = this.chain.signEntry(hash);

    // 10.4 记录导出操作审计事件
    this.recordExportAudit(filters, format, entries.length, hash);

    return { data, hash, signature };
  }

  // ─── 10.1 JSON 格式导出 ───────────────────────────────────────────────

  private formatJson(entries: AuditLogEntry[]): string {
    return JSON.stringify(entries, null, 2);
  }

  // ─── 10.2 CSV 格式导出 ────────────────────────────────────────────────

  private formatCsv(entries: AuditLogEntry[]): string {
    const rows: string[] = [CSV_HEADERS.join(",")];

    for (const entry of entries) {
      const row = [
        this.escapeCsv(entry.entryId),
        String(entry.sequenceNumber),
        this.escapeCsv(entry.eventId),
        this.escapeCsv(entry.event.eventType),
        String(entry.event.timestamp),
        this.escapeCsv(entry.event.actor.type),
        this.escapeCsv(entry.event.actor.id),
        this.escapeCsv(entry.event.action),
        this.escapeCsv(entry.event.resource.type),
        this.escapeCsv(entry.event.resource.id),
        this.escapeCsv(entry.event.result),
        this.escapeCsv(entry.currentHash),
        this.escapeCsv(entry.signature),
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────

  /** 获取过滤后的条目 */
  private getFilteredEntries(filters: AuditQueryFilters): AuditLogEntry[] {
    const count = this.chain.getEntryCount();
    if (count === 0) return [];
    const all = this.chain.getEntries(0, count - 1);
    return all.filter(entry => this.matchFilters(entry, filters));
  }

  /** 应用过滤条件（与 AuditQuery 逻辑一致） */
  private matchFilters(
    entry: AuditLogEntry,
    filters: AuditQueryFilters
  ): boolean {
    const event = entry.event;

    if (filters.eventType !== undefined) {
      const types = Array.isArray(filters.eventType)
        ? filters.eventType
        : [filters.eventType];
      if (!types.includes(event.eventType)) return false;
    }
    if (filters.actorId !== undefined && event.actor.id !== filters.actorId)
      return false;
    if (
      filters.actorType !== undefined &&
      event.actor.type !== filters.actorType
    )
      return false;
    if (
      filters.resourceType !== undefined &&
      event.resource.type !== filters.resourceType
    )
      return false;
    if (
      filters.resourceId !== undefined &&
      event.resource.id !== filters.resourceId
    )
      return false;
    if (filters.result !== undefined && event.result !== filters.result)
      return false;

    if (filters.severity !== undefined) {
      const def = DEFAULT_EVENT_TYPE_REGISTRY[event.eventType];
      if (!def || def.severity !== filters.severity) return false;
    }
    if (filters.category !== undefined) {
      const def = DEFAULT_EVENT_TYPE_REGISTRY[event.eventType];
      if (!def || def.category !== filters.category) return false;
    }
    if (filters.timeRange) {
      const ts = event.timestamp;
      if (ts < filters.timeRange.start || ts > filters.timeRange.end)
        return false;
    }
    if (filters.keyword !== undefined) {
      const lk = filters.keyword.toLowerCase();
      const fields = [
        event.action,
        event.resource.type,
        event.resource.id,
        event.resource.name ?? "",
        event.metadata ? JSON.stringify(event.metadata) : "",
      ];
      if (!fields.some(f => f.toLowerCase().includes(lk))) return false;
    }

    return true;
  }

  /** CSV 字段转义 */
  private escapeCsv(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  // ─── 10.4 导出操作审计记录 ────────────────────────────────────────────

  private recordExportAudit(
    filters: AuditQueryFilters,
    format: string,
    entryCount: number,
    hash: string
  ): void {
    this.collector.record({
      eventType: AuditEventType.AUDIT_EXPORT,
      actor: { type: "system", id: "audit-export" },
      action: `audit.export.${format}`,
      resource: { type: "audit", id: "audit-log" },
      result: "success",
      metadata: { filters, format, entryCount, exportHash: hash },
    });
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const auditExport = new AuditExport(auditChain, auditCollector);
