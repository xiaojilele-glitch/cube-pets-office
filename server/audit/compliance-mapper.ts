/**
 * ComplianceMapper — 合规框架映射引擎
 *
 * 将审计事件类型映射到合规框架要求（SOC2/GDPR/PCI-DSS/HIPAA/ISO27001），
 * 生成合规报告，计算合规性评分。
 */

import crypto from "node:crypto";
import type {
  AuditLogEntry,
  ComplianceFramework,
  ComplianceGap,
  ComplianceReport,
  ComplianceRequirement,
} from "../../shared/audit/contracts.js";
import {
  AuditEventType,
  DEFAULT_EVENT_TYPE_REGISTRY,
} from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";
import { auditChain } from "./audit-chain.js";

// ─── 9.1 合规框架映射数据 ──────────────────────────────────────────────────

const SOC2_REQUIREMENTS: ComplianceRequirement[] = [
  {
    requirementId: "SOC2-CC6.1",
    description: "Logical and physical access controls",
    requiredEventTypes: [AuditEventType.PERMISSION_GRANTED, AuditEventType.PERMISSION_REVOKED],
    minimumRetentionDays: 365,
  },
  {
    requirementId: "SOC2-CC6.2",
    description: "User authentication and authorization",
    requiredEventTypes: [AuditEventType.USER_LOGIN, AuditEventType.USER_LOGOUT],
    minimumRetentionDays: 365,
  },
  {
    requirementId: "SOC2-CC7.1",
    description: "System monitoring and anomaly detection",
    requiredEventTypes: [AuditEventType.ANOMALY_DETECTED],
    minimumRetentionDays: 365,
  },
  {
    requirementId: "SOC2-CC7.2",
    description: "Incident response and management",
    requiredEventTypes: [AuditEventType.AGENT_FAILED],
    minimumRetentionDays: 365,
  },
];

const GDPR_REQUIREMENTS: ComplianceRequirement[] = [
  {
    requirementId: "GDPR-Art.30",
    description: "Records of processing activities",
    requiredEventTypes: [AuditEventType.DATA_ACCESSED, AuditEventType.AGENT_EXECUTED],
    minimumRetentionDays: 1095,
  },
  {
    requirementId: "GDPR-Art.33",
    description: "Notification of personal data breach",
    requiredEventTypes: [AuditEventType.ANOMALY_DETECTED],
    minimumRetentionDays: 1095,
  },
  {
    requirementId: "GDPR-Art.25",
    description: "Data protection by design and by default",
    requiredEventTypes: [AuditEventType.CONFIG_CHANGED],
    minimumRetentionDays: 1095,
  },
];

const PCI_DSS_REQUIREMENTS: ComplianceRequirement[] = [
  {
    requirementId: "PCI-DSS-Req10.1",
    description: "Audit trails for all system components",
    requiredEventTypes: Object.values(AuditEventType),
    minimumRetentionDays: 365,
  },
  {
    requirementId: "PCI-DSS-Req10.2",
    description: "Audit trails for user actions",
    requiredEventTypes: [AuditEventType.USER_LOGIN, AuditEventType.USER_LOGOUT, AuditEventType.DATA_ACCESSED],
    minimumRetentionDays: 365,
  },
  {
    requirementId: "PCI-DSS-Req10.5",
    description: "Secure audit trail integrity",
    requiredEventTypes: [AuditEventType.AUDIT_DELETE],
    minimumRetentionDays: 365,
  },
];

const HIPAA_REQUIREMENTS: ComplianceRequirement[] = [
  {
    requirementId: "HIPAA-164.312(b)",
    description: "Audit controls for information systems",
    requiredEventTypes: [AuditEventType.DATA_ACCESSED, AuditEventType.PERMISSION_GRANTED],
    minimumRetentionDays: 2190,
  },
  {
    requirementId: "HIPAA-164.312(c)",
    description: "Integrity controls for electronic PHI",
    requiredEventTypes: [AuditEventType.CONFIG_CHANGED],
    minimumRetentionDays: 2190,
  },
];

const ISO27001_REQUIREMENTS: ComplianceRequirement[] = [
  {
    requirementId: "ISO27001-A.12.4",
    description: "Logging and monitoring",
    requiredEventTypes: [AuditEventType.AGENT_EXECUTED, AuditEventType.AGENT_FAILED],
    minimumRetentionDays: 365,
  },
  {
    requirementId: "ISO27001-A.9.2",
    description: "User access management",
    requiredEventTypes: [AuditEventType.PERMISSION_GRANTED, AuditEventType.PERMISSION_REVOKED],
    minimumRetentionDays: 365,
  },
];

const FRAMEWORK_MAP: Map<ComplianceFramework, ComplianceRequirement[]> = new Map([
  ["SOC2", SOC2_REQUIREMENTS],
  ["GDPR", GDPR_REQUIREMENTS],
  ["PCI-DSS", PCI_DSS_REQUIREMENTS],
  ["HIPAA", HIPAA_REQUIREMENTS],
  ["ISO27001", ISO27001_REQUIREMENTS],
]);

// ─── ComplianceMapper 类 ───────────────────────────────────────────────────

export class ComplianceMapper {
  private chain: AuditChain;
  private frameworks: Map<ComplianceFramework, ComplianceRequirement[]>;

  constructor(chain: AuditChain) {
    this.chain = chain;
    this.frameworks = FRAMEWORK_MAP;
  }

  // ─── 9.2 mapToFramework() ─────────────────────────────────────────────

  /** 获取框架要求与事件类型的映射 */
  mapToFramework(framework: ComplianceFramework): ComplianceRequirement[] {
    return this.frameworks.get(framework) ?? [];
  }

  // ─── 9.3 generateReport() ─────────────────────────────────────────────

  /** 生成合规报告（覆盖范围/评分/缺口/风险事件） */
  generateReport(
    framework: ComplianceFramework,
    timeRange: { start: number; end: number },
  ): ComplianceReport {
    const requirements = this.mapToFramework(framework);
    const entries = this.getEntriesInRange(timeRange);

    // Count events per type
    const eventStatistics = {} as Record<AuditEventType, number>;
    for (const t of Object.values(AuditEventType)) {
      eventStatistics[t] = 0;
    }
    for (const entry of entries) {
      eventStatistics[entry.event.eventType] =
        (eventStatistics[entry.event.eventType] || 0) + 1;
    }

    // Check coverage per requirement
    const gaps: ComplianceGap[] = [];
    let coveredCount = 0;

    for (const req of requirements) {
      const missingTypes = req.requiredEventTypes.filter(
        (et) => (eventStatistics[et] || 0) === 0,
      );
      if (missingTypes.length === 0) {
        coveredCount++;
      } else {
        gaps.push({
          requirementId: req.requirementId,
          description: req.description,
          missingEventTypes: missingTypes,
          recommendation: `Ensure events of type [${missingTypes.join(", ")}] are being recorded to satisfy ${req.requirementId}.`,
        });
      }
    }

    const totalRequirements = requirements.length;
    const coverageScore = totalRequirements > 0
      ? Math.round((coveredCount / totalRequirements) * 100)
      : 0;

    // Collect risk events (CRITICAL severity or failure/denied/error results)
    const riskEvents = entries.filter((entry) => {
      const def = DEFAULT_EVENT_TYPE_REGISTRY[entry.event.eventType];
      return (
        (def && def.severity === "CRITICAL") ||
        entry.event.result === "failure" ||
        entry.event.result === "denied" ||
        entry.event.result === "error"
      );
    });

    // Build report content for hashing (exclude reportHash itself)
    const reportContent = {
      framework,
      timeRange,
      coverageScore,
      totalRequirements,
      coveredRequirements: coveredCount,
      gaps,
      eventStatistics,
      riskEventCount: riskEvents.length,
    };
    const reportHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(reportContent))
      .digest("hex");

    return {
      framework,
      timeRange,
      generatedAt: Date.now(),
      coverageScore,
      totalRequirements,
      coveredRequirements: coveredCount,
      gaps,
      eventStatistics,
      riskEvents,
      reportHash,
    };
  }

  // ─── 9.4 getComplianceScore() ─────────────────────────────────────────

  /** 计算合规性评分: coveredRequirements / totalRequirements * 100 */
  getComplianceScore(
    framework: ComplianceFramework,
    timeRange: { start: number; end: number },
  ): number {
    const requirements = this.mapToFramework(framework);
    if (requirements.length === 0) return 0;

    const entries = this.getEntriesInRange(timeRange);

    // Build set of event types present
    const presentTypes = new Set<AuditEventType>();
    for (const entry of entries) {
      presentTypes.add(entry.event.eventType);
    }

    let covered = 0;
    for (const req of requirements) {
      const allPresent = req.requiredEventTypes.every((et) => presentTypes.has(et));
      if (allPresent) covered++;
    }

    return Math.round((covered / requirements.length) * 100);
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────

  /** 获取时间范围内的条目 */
  private getEntriesInRange(timeRange: { start: number; end: number }): AuditLogEntry[] {
    const count = this.chain.getEntryCount();
    if (count === 0) return [];
    const all = this.chain.getEntries(0, count - 1);
    return all.filter(
      (e) => e.event.timestamp >= timeRange.start && e.event.timestamp <= timeRange.end,
    );
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const complianceMapper = new ComplianceMapper(auditChain);
