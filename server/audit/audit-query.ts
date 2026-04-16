/**
 * AuditQuery — 查询引擎
 *
 * 支持多条件过滤、分页查询、全文搜索、权限变更历史、
 * 权限违规事件查询、数据血缘关联审计事件查询。
 * 每次查询操作自身也会记录 AUDIT_QUERY 事件。
 */

import type {
  AuditLogEntry,
  AuditQueryFilters,
  AuditQueryResult,
  PageOptions,
} from "../../shared/audit/contracts.js";
import {
  AuditEventType,
  DEFAULT_EVENT_TYPE_REGISTRY,
} from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";
import { auditChain } from "./audit-chain.js";
import type { AuditCollector } from "./audit-collector.js";
import { auditCollector } from "./audit-collector.js";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// ─── AuditQuery 类 ─────────────────────────────────────────────────────────

export class AuditQuery {
  private chain: AuditChain;
  private collector: AuditCollector;

  constructor(chain: AuditChain, collector: AuditCollector) {
    this.chain = chain;
    this.collector = collector;
  }

  // ─── 7.1 query() — 多条件过滤 + 分页查询 ─────────────────────────────────

  /**
   * 多条件过滤 + 分页查询。
   * 从链中获取所有条目，依次应用过滤条件，然后分页返回。
   */
  query(filters: AuditQueryFilters, page: PageOptions): AuditQueryResult {
    const allEntries = this.getAllEntries();
    const filtered = allEntries.filter(entry =>
      this.matchFilters(entry, filters)
    );
    const result = this.paginate(filtered, page);

    // 7.6 记录查询操作自身的审计事件
    this.recordQueryAudit("query", { filters, page });

    return result;
  }

  // ─── 7.2 search() — 全文搜索 ─────────────────────────────────────────────

  /**
   * 全文搜索：在 action、resource.type、resource.id、resource.name、
   * JSON.stringify(metadata) 中进行大小写不敏感的关键词匹配。
   */
  search(keyword: string, page: PageOptions): AuditQueryResult {
    const allEntries = this.getAllEntries();
    const lowerKeyword = keyword.toLowerCase();

    const filtered = allEntries.filter(entry => {
      const event = entry.event;
      const fields: string[] = [
        event.action,
        event.resource.type,
        event.resource.id,
        event.resource.name ?? "",
        event.metadata ? JSON.stringify(event.metadata) : "",
      ];
      return fields.some(f => f.toLowerCase().includes(lowerKeyword));
    });

    const result = this.paginate(filtered, page);

    // 7.6 记录搜索操作自身的审计事件
    this.recordQueryAudit("search", { keyword, page });

    return result;
  }

  // ─── 7.3 getPermissionTrail() — Agent 权限变更历史 ────────────────────────

  /**
   * 获取指定 Agent 的权限变更历史。
   * 过滤 PERMISSION_GRANTED、PERMISSION_REVOKED、ESCALATION_APPROVED 事件，
   * 其中 actor.id === agentId 或 resource.id === agentId。
   */
  getPermissionTrail(
    agentId: string,
    timeRange?: { start: number; end: number }
  ): AuditLogEntry[] {
    const permissionTypes = new Set([
      AuditEventType.PERMISSION_GRANTED,
      AuditEventType.PERMISSION_REVOKED,
      AuditEventType.ESCALATION_APPROVED,
    ]);

    const allEntries = this.getAllEntries();
    const filtered = allEntries.filter(entry => {
      if (!permissionTypes.has(entry.event.eventType)) return false;
      const isActorOrTarget =
        entry.event.actor.id === agentId || entry.event.resource.id === agentId;
      if (!isActorOrTarget) return false;
      if (timeRange) {
        const ts = entry.event.timestamp;
        if (ts < timeRange.start || ts > timeRange.end) return false;
      }
      return true;
    });

    // 7.6 记录查询操作
    this.recordQueryAudit("getPermissionTrail", { agentId, timeRange });

    return filtered.sort((a, b) => a.event.timestamp - b.event.timestamp);
  }

  // ─── 7.4 getPermissionViolations() — 权限违规事件查询 ─────────────────────

  /**
   * 获取权限违规事件：result === 'denied' 的所有条目。
   */
  getPermissionViolations(timeRange?: {
    start: number;
    end: number;
  }): AuditLogEntry[] {
    const allEntries = this.getAllEntries();
    const filtered = allEntries.filter(entry => {
      if (entry.event.result !== "denied") return false;
      if (timeRange) {
        const ts = entry.event.timestamp;
        if (ts < timeRange.start || ts > timeRange.end) return false;
      }
      return true;
    });

    // 7.6 记录查询操作
    this.recordQueryAudit("getPermissionViolations", { timeRange });

    return filtered.sort((a, b) => a.event.timestamp - b.event.timestamp);
  }

  // ─── 7.5 getDataLineageAudit() — 数据血缘关联审计事件 ────────────────────

  /**
   * 获取与指定 dataId 关联的审计事件。
   * 匹配 lineageId === dataId 或 resource.id === dataId。
   */
  getDataLineageAudit(dataId: string): AuditLogEntry[] {
    const allEntries = this.getAllEntries();
    const filtered = allEntries.filter(entry => {
      return (
        entry.event.lineageId === dataId || entry.event.resource.id === dataId
      );
    });

    // 7.6 记录查询操作
    this.recordQueryAudit("getDataLineageAudit", { dataId });

    return filtered.sort((a, b) => a.event.timestamp - b.event.timestamp);
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────────

  /** 获取链中所有条目 */
  private getAllEntries(): AuditLogEntry[] {
    const count = this.chain.getEntryCount();
    if (count === 0) return [];
    return this.chain.getEntries(0, count - 1);
  }

  /** 应用过滤条件 */
  private matchFilters(
    entry: AuditLogEntry,
    filters: AuditQueryFilters
  ): boolean {
    const event = entry.event;

    // eventType filter (single or array)
    if (filters.eventType !== undefined) {
      const types = Array.isArray(filters.eventType)
        ? filters.eventType
        : [filters.eventType];
      if (!types.includes(event.eventType)) return false;
    }

    // actorId
    if (filters.actorId !== undefined && event.actor.id !== filters.actorId) {
      return false;
    }

    // actorType
    if (
      filters.actorType !== undefined &&
      event.actor.type !== filters.actorType
    ) {
      return false;
    }

    // resourceType
    if (
      filters.resourceType !== undefined &&
      event.resource.type !== filters.resourceType
    ) {
      return false;
    }

    // resourceId
    if (
      filters.resourceId !== undefined &&
      event.resource.id !== filters.resourceId
    ) {
      return false;
    }

    // result
    if (filters.result !== undefined && event.result !== filters.result) {
      return false;
    }

    // severity — look up from DEFAULT_EVENT_TYPE_REGISTRY
    if (filters.severity !== undefined) {
      const def = DEFAULT_EVENT_TYPE_REGISTRY[event.eventType];
      if (!def || def.severity !== filters.severity) return false;
    }

    // category — look up from DEFAULT_EVENT_TYPE_REGISTRY
    if (filters.category !== undefined) {
      const def = DEFAULT_EVENT_TYPE_REGISTRY[event.eventType];
      if (!def || def.category !== filters.category) return false;
    }

    // timeRange
    if (filters.timeRange) {
      const ts = event.timestamp;
      if (ts < filters.timeRange.start || ts > filters.timeRange.end)
        return false;
    }

    // keyword — search in action, resource fields, metadata
    if (filters.keyword !== undefined) {
      const lowerKeyword = filters.keyword.toLowerCase();
      const fields: string[] = [
        event.action,
        event.resource.type,
        event.resource.id,
        event.resource.name ?? "",
        event.metadata ? JSON.stringify(event.metadata) : "",
      ];
      if (!fields.some(f => f.toLowerCase().includes(lowerKeyword)))
        return false;
    }

    return true;
  }

  /** 分页 */
  private paginate(
    entries: AuditLogEntry[],
    page: PageOptions
  ): AuditQueryResult {
    const pageSize = Math.min(
      Math.max(page.pageSize || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );
    const pageNum = Math.max(page.pageNum || 1, 1);
    const total = entries.length;
    const start = (pageNum - 1) * pageSize;
    const paged = entries.slice(start, start + pageSize);

    return {
      entries: paged,
      total,
      page: { pageSize, pageNum },
    };
  }

  // ─── 7.6 查询操作自身的审计记录 ──────────────────────────────────────────

  /**
   * 记录 AUDIT_QUERY 事件。
   * 使用 collector.record() 异步写入（INFO severity，不会触发同步写入，避免递归）。
   */
  private recordQueryAudit(
    operation: string,
    params: Record<string, unknown>
  ): void {
    this.collector.record({
      eventType: AuditEventType.AUDIT_QUERY,
      actor: { type: "system", id: "audit-query" },
      action: `audit.${operation}`,
      resource: { type: "audit", id: "audit-log" },
      result: "success",
      metadata: params,
    });
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const auditQuery = new AuditQuery(auditChain, auditCollector);
