/**
 * AuditLogger — 权限审计日志
 *
 * 记录所有权限检查、授予、撤销、提升等操作，
 * 提供审计追踪、使用报告、违规查询和报告导出。
 *
 * Validates: Requirements 11.1–11.5
 */

import { randomUUID } from "node:crypto";
import type {
  PermissionAuditEntry,
  PermissionUsageReport,
  ResourceType,
  Action,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES } from "../../shared/permission/contracts.js";
import type { AuditLogger as IAuditLogger } from "./check-engine.js";

// ─── Database interface (subset used by this module) ────────────────────────

export interface AuditLoggerDb {
  getPermissionAudit(): PermissionAuditEntry[];
  addPermissionAudit(entry: PermissionAuditEntry): void;
}

// ─── AuditLogger ────────────────────────────────────────────────────────────

export class AuditLogger implements IAuditLogger {
  constructor(private db: AuditLoggerDb) {}

  /**
   * Record an audit entry. Auto-generates id and timestamp.
   */
  log(
    entry: Omit<PermissionAuditEntry, "id" | "timestamp">,
  ): void {
    const full: PermissionAuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.db.addPermissionAudit(full);
  }

  /**
   * Get audit trail for a specific agent, optionally filtered by time range.
   */
  getAuditTrail(
    agentId: string,
    timeRange?: { from: string; to: string },
  ): PermissionAuditEntry[] {
    const all = this.db.getPermissionAudit();
    return all.filter((e) => {
      if (e.agentId !== agentId) return false;
      if (timeRange) {
        if (e.timestamp < timeRange.from) return false;
        if (e.timestamp > timeRange.to) return false;
      }
      return true;
    });
  }

  /**
   * Generate a usage report for an agent within a time range.
   * Aggregates allowed/denied counts overall and per resource type.
   */
  getUsageReport(
    agentId: string,
    timeRange: { from: string; to: string },
  ): PermissionUsageReport {
    const entries = this.getAuditTrail(agentId, timeRange);

    let allowedCount = 0;
    let deniedCount = 0;
    const resourceBreakdown = {} as Record<
      ResourceType,
      { allowed: number; denied: number }
    >;

    // Initialize all resource types to zero
    for (const rt of RESOURCE_TYPES) {
      resourceBreakdown[rt] = { allowed: 0, denied: 0 };
    }

    for (const entry of entries) {
      if (entry.result === "allowed") {
        allowedCount++;
        if (resourceBreakdown[entry.resourceType]) {
          resourceBreakdown[entry.resourceType].allowed++;
        }
      } else if (entry.result === "denied") {
        deniedCount++;
        if (resourceBreakdown[entry.resourceType]) {
          resourceBreakdown[entry.resourceType].denied++;
        }
      }
      // "error" entries are not counted in allowed/denied
    }

    return {
      agentId,
      timeRange,
      totalChecks: entries.length,
      allowedCount,
      deniedCount,
      resourceBreakdown,
    };
  }

  /**
   * Get all denied entries (violations), optionally filtered by time range.
   */
  getViolations(
    timeRange?: { from: string; to: string },
  ): PermissionAuditEntry[] {
    const all = this.db.getPermissionAudit();
    return all.filter((e) => {
      if (e.result !== "denied") return false;
      if (timeRange) {
        if (e.timestamp < timeRange.from) return false;
        if (e.timestamp > timeRange.to) return false;
      }
      return true;
    });
  }

  /**
   * Export audit data as a JSON string.
   */
  exportReport(
    format: "json",
    timeRange?: { from: string; to: string },
  ): string {
    const all = this.db.getPermissionAudit();
    const filtered = timeRange
      ? all.filter(
          (e) => e.timestamp >= timeRange.from && e.timestamp <= timeRange.to,
        )
      : all;

    return JSON.stringify(
      {
        format,
        generatedAt: new Date().toISOString(),
        totalEntries: filtered.length,
        entries: filtered,
      },
      null,
      2,
    );
  }
}
