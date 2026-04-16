/**
 * AnomalyDetector — 基于规则的异常检测引擎
 *
 * 功能：
 * - 规则引擎框架（AnomalyRule 注册 + 匹配）
 * - 内置规则：异常访问频率、异常时间访问、权限提升滥用、暴力破解模式、批量导出
 * - detectAnomalies()：在指定时间窗口内运行所有规则
 * - 告警生成和状态管理（open/acknowledged/resolved/dismissed）
 * - 告警写入审计链（ANOMALY_DETECTED 事件）
 */

import crypto from "node:crypto";
import type {
  AnomalyAlert,
  AnomalyRule,
  AuditLogEntry,
} from "../../shared/audit/contracts.js";
import { AuditEventType } from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";
import { auditChain } from "./audit-chain.js";
import type { AuditCollector } from "./audit-collector.js";
import { auditCollector } from "./audit-collector.js";

// ─── 内置规则定义 ──────────────────────────────────────────────────────────

const BUILTIN_RULES: AnomalyRule[] = [
  {
    ruleId: "high_frequency_access",
    name: "异常访问频率",
    description: "> 100 events/minute",
    severity: "high",
    threshold: 100,
    timeWindowMs: 60_000,
    eventTypes: [AuditEventType.DATA_ACCESSED, AuditEventType.AGENT_EXECUTED],
    enabled: true,
  },
  {
    ruleId: "off_hours_access",
    name: "异常时间访问",
    description: "Access during 22:00-06:00",
    severity: "medium",
    threshold: 1,
    timeWindowMs: 3_600_000,
    eventTypes: [AuditEventType.DATA_ACCESSED, AuditEventType.USER_LOGIN],
    enabled: true,
  },
  {
    ruleId: "privilege_escalation_abuse",
    name: "权限提升滥用",
    description: "Sensitive access within 5min of escalation",
    severity: "critical",
    threshold: 1,
    timeWindowMs: 300_000,
    eventTypes: [
      AuditEventType.ESCALATION_APPROVED,
      AuditEventType.DATA_ACCESSED,
    ],
    enabled: true,
  },
  {
    ruleId: "brute_force_pattern",
    name: "暴力破解模式",
    description: "> 5 failures then success",
    severity: "high",
    threshold: 5,
    timeWindowMs: 300_000,
    eventTypes: [AuditEventType.USER_LOGIN],
    enabled: true,
  },
  {
    ruleId: "bulk_data_export",
    name: "批量数据导出",
    description: "> 1000 records exported",
    severity: "medium",
    threshold: 1000,
    timeWindowMs: 3_600_000,
    eventTypes: [AuditEventType.AUDIT_EXPORT, AuditEventType.DATA_ACCESSED],
    enabled: true,
  },
];

// ─── AnomalyDetector 类 ───────────────────────────────────────────────────

export class AnomalyDetector {
  private rules: Map<string, AnomalyRule> = new Map();
  private alerts: Map<string, AnomalyAlert> = new Map();
  private chain: AuditChain;
  private collector: AuditCollector;

  constructor(chain: AuditChain, collector: AuditCollector) {
    this.chain = chain;
    this.collector = collector;

    // Register built-in rules
    for (const rule of BUILTIN_RULES) {
      this.rules.set(rule.ruleId, { ...rule });
    }
  }

  // ─── 8.1 规则引擎框架 ──────────────────────────────────────────────────

  addRule(rule: AnomalyRule): void {
    this.rules.set(rule.ruleId, { ...rule });
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  getRules(): AnomalyRule[] {
    return Array.from(this.rules.values());
  }

  // ─── 8.3 detectAnomalies() ─────────────────────────────────────────────

  detectAnomalies(timeWindow: { start: number; end: number }): AnomalyAlert[] {
    const entryCount = this.chain.getEntryCount();
    if (entryCount === 0) return [];

    // Get all entries from chain within the time window
    const allEntries = this.chain.getEntries(0, entryCount - 1);
    const windowEntries = allEntries.filter(
      e =>
        e.event.timestamp >= timeWindow.start &&
        e.event.timestamp <= timeWindow.end
    );

    const newAlerts: AnomalyAlert[] = [];

    const ruleList = Array.from(this.rules.values());
    for (const rule of ruleList) {
      if (!rule.enabled) continue;

      const relevantEntries = windowEntries.filter(e =>
        rule.eventTypes.includes(e.event.eventType)
      );

      const triggered = this.evaluateRule(rule, relevantEntries, windowEntries);
      if (triggered) {
        const alert = this.createAlert(
          rule,
          triggered.affectedEvents,
          triggered.description
        );
        newAlerts.push(alert);
        this.alerts.set(alert.alertId, alert);

        // 8.5 Record ANOMALY_DETECTED event
        this.recordAnomalyEvent(alert);
      }
    }

    return newAlerts;
  }

  // ─── 8.4 告警状态管理 ──────────────────────────────────────────────────

  getAlerts(timeRange?: { start: number; end: number }): AnomalyAlert[] {
    const all = Array.from(this.alerts.values());
    if (!timeRange) return all;
    return all.filter(
      a => a.detectedAt >= timeRange.start && a.detectedAt <= timeRange.end
    );
  }

  getAlert(alertId: string): AnomalyAlert | null {
    return this.alerts.get(alertId) ?? null;
  }

  updateAlertStatus(
    alertId: string,
    status: AnomalyAlert["status"]
  ): AnomalyAlert | null {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;
    alert.status = status;
    return alert;
  }

  // ─── 内部：规则评估 ────────────────────────────────────────────────────

  private evaluateRule(
    rule: AnomalyRule,
    relevantEntries: AuditLogEntry[],
    allEntries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    switch (rule.ruleId) {
      case "high_frequency_access":
        return this.evalHighFrequency(rule, relevantEntries);
      case "off_hours_access":
        return this.evalOffHours(rule, relevantEntries);
      case "privilege_escalation_abuse":
        return this.evalPrivilegeEscalation(rule, allEntries);
      case "brute_force_pattern":
        return this.evalBruteForce(rule, relevantEntries);
      case "bulk_data_export":
        return this.evalBulkExport(rule, relevantEntries);
      default:
        // Generic count-based threshold for custom rules
        return this.evalGenericThreshold(rule, relevantEntries);
    }
  }

  // ─── 8.2 内置规则评估 ──────────────────────────────────────────────────

  /** 异常访问频率：> threshold events in timeWindowMs */
  private evalHighFrequency(
    rule: AnomalyRule,
    entries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    if (entries.length > rule.threshold) {
      return {
        affectedEvents: entries.map(e => e.event.eventId),
        description: `High frequency access detected: ${entries.length} events (threshold: ${rule.threshold})`,
      };
    }
    return null;
  }

  /** 异常时间访问：events during 22:00-06:00 */
  private evalOffHours(
    rule: AnomalyRule,
    entries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    const offHourEntries = entries.filter(e => {
      const hour = new Date(e.event.timestamp).getHours();
      return hour >= 22 || hour < 6;
    });
    if (offHourEntries.length >= rule.threshold) {
      return {
        affectedEvents: offHourEntries.map(e => e.event.eventId),
        description: `Off-hours access detected: ${offHourEntries.length} events during 22:00-06:00`,
      };
    }
    return null;
  }

  /** 权限提升滥用：ESCALATION_APPROVED followed by DATA_ACCESSED within timeWindowMs */
  private evalPrivilegeEscalation(
    rule: AnomalyRule,
    allEntries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    const escalations = allEntries.filter(
      e => e.event.eventType === AuditEventType.ESCALATION_APPROVED
    );
    const dataAccesses = allEntries.filter(
      e => e.event.eventType === AuditEventType.DATA_ACCESSED
    );

    const affected: string[] = [];
    for (const esc of escalations) {
      for (const da of dataAccesses) {
        const diff = da.event.timestamp - esc.event.timestamp;
        if (diff > 0 && diff <= rule.timeWindowMs) {
          affected.push(esc.event.eventId, da.event.eventId);
        }
      }
    }

    if (affected.length >= rule.threshold) {
      return {
        affectedEvents: Array.from(new Set(affected)),
        description: `Privilege escalation abuse: sensitive data accessed within ${rule.timeWindowMs / 1000}s of escalation`,
      };
    }
    return null;
  }

  /** 暴力破解模式：> threshold failures followed by a success */
  private evalBruteForce(
    rule: AnomalyRule,
    entries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    // Sort by timestamp
    const sorted = [...entries].sort(
      (a, b) => a.event.timestamp - b.event.timestamp
    );

    let consecutiveFailures = 0;
    const failureEvents: string[] = [];

    for (const entry of sorted) {
      if (entry.event.result === "failure") {
        consecutiveFailures++;
        failureEvents.push(entry.event.eventId);
      } else if (
        entry.event.result === "success" &&
        consecutiveFailures > rule.threshold
      ) {
        // Brute force detected: many failures then success
        failureEvents.push(entry.event.eventId);
        return {
          affectedEvents: failureEvents,
          description: `Brute force pattern: ${consecutiveFailures} failures followed by success`,
        };
      } else {
        // Reset on non-failure/non-matching-success
        consecutiveFailures = 0;
        failureEvents.length = 0;
      }
    }
    return null;
  }

  /** 批量数据导出：> threshold records exported */
  private evalBulkExport(
    rule: AnomalyRule,
    entries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    let totalRecords = 0;
    const affected: string[] = [];

    for (const entry of entries) {
      const count =
        (entry.event.metadata?.recordCount as number) ??
        (entry.event.metadata?.record_count as number) ??
        1;
      totalRecords += count;
      affected.push(entry.event.eventId);
    }

    if (totalRecords > rule.threshold) {
      return {
        affectedEvents: affected,
        description: `Bulk data export detected: ${totalRecords} records (threshold: ${rule.threshold})`,
      };
    }
    return null;
  }

  /** Generic count-based threshold for custom rules */
  private evalGenericThreshold(
    rule: AnomalyRule,
    entries: AuditLogEntry[]
  ): { affectedEvents: string[]; description: string } | null {
    if (entries.length > rule.threshold) {
      return {
        affectedEvents: entries.map(e => e.event.eventId),
        description: `Rule "${rule.name}" triggered: ${entries.length} events (threshold: ${rule.threshold})`,
      };
    }
    return null;
  }

  // ─── 内部：告警创建 ────────────────────────────────────────────────────

  private createAlert(
    rule: AnomalyRule,
    affectedEvents: string[],
    description: string
  ): AnomalyAlert {
    return {
      alertId: `aa_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      ruleId: rule.ruleId,
      severity: rule.severity,
      anomalyType: rule.ruleId,
      description,
      affectedEvents,
      suggestedActions: this.getSuggestedActions(rule.ruleId),
      detectedAt: Date.now(),
      status: "open",
    };
  }

  private getSuggestedActions(ruleId: string): string[] {
    switch (ruleId) {
      case "high_frequency_access":
        return [
          "Review access patterns",
          "Consider rate limiting",
          "Check for automated scripts",
        ];
      case "off_hours_access":
        return [
          "Verify user identity",
          "Check if access is authorized",
          "Review access policy",
        ];
      case "privilege_escalation_abuse":
        return [
          "Revoke escalated privileges",
          "Review escalation approval",
          "Investigate data access",
        ];
      case "brute_force_pattern":
        return [
          "Lock account temporarily",
          "Require MFA",
          "Review login attempts",
        ];
      case "bulk_data_export":
        return [
          "Review export authorization",
          "Check data classification",
          "Audit export contents",
        ];
      default:
        return ["Review affected events", "Investigate anomaly"];
    }
  }

  // ─── 8.5 告警写入审计链 ───────────────────────────────────────────────

  private recordAnomalyEvent(alert: AnomalyAlert): void {
    this.collector.record({
      eventType: AuditEventType.ANOMALY_DETECTED,
      actor: { type: "system", id: "anomaly-detector" },
      action: `anomaly_detected:${alert.ruleId}`,
      resource: { type: "alert", id: alert.alertId },
      result: "success",
      metadata: {
        alertId: alert.alertId,
        ruleId: alert.ruleId,
        severity: alert.severity,
        anomalyType: alert.anomalyType,
        description: alert.description,
        affectedEventCount: alert.affectedEvents.length,
      },
    });
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const anomalyDetector = new AnomalyDetector(auditChain, auditCollector);
