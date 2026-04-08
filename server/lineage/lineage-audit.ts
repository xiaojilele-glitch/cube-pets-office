/**
 * 审计与合规服务 (LineageAuditService)
 *
 * - getAuditTrail: 审计追踪查询 (AC-6.1 ~ AC-6.2)
 * - exportLineageReport: 决策血缘报告导出 (AC-6.3)
 * - detectAnomalies: 异常检测 (AC-6.4)
 * - detectPII: PII 检测标记 + 合规标签 (AC-6.5)
 */

import { randomUUID } from "node:crypto";
import type {
  DataLineageNode,
  AuditLogEntry,
  ChangeAlert,
  LineageReport,
  TimeRange,
} from "../../shared/lineage/contracts.js";
import type { LineageStorageAdapter } from "./lineage-store.js";
import type { LineageQueryService } from "./lineage-query.js";

// ─── PII 正则模式 ──────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, tag: "PII" },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, tag: "PII" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, tag: "PII" },
  { pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/, tag: "PCI" },
];

/** GDPR-sensitive keywords found in metadata / queryText */
const GDPR_KEYWORDS = [
  "personal_data", "gdpr", "name", "address", "date_of_birth",
  "national_id", "passport", "biometric",
];

// ─── LineageAuditService ───────────────────────────────────────────────────

export class LineageAuditService {
  constructor(
    private store: LineageStorageAdapter,
    private queryService: LineageQueryService,
  ) {}

  // ─── AC-6.1 ~ AC-6.2: 审计追踪 ────────────────────────────────────────

  async getAuditTrail(userId: string, timeRange: TimeRange): Promise<AuditLogEntry[]> {
    const nodes = await this.store.queryNodes({
      fromTimestamp: timeRange.start,
      toTimestamp: timeRange.end,
    });

    // Filter nodes whose context.userId matches
    const userNodes = nodes.filter((n) => n.context.userId === userId);

    return userNodes.map((node) => this.nodeToAuditEntry(node));
  }

  // ─── AC-6.3: 决策血缘报告导出 ──────────────────────────────────────────

  async exportLineageReport(decisionId: string): Promise<LineageReport> {
    // Find the decision node by decisionId field
    const candidates = await this.store.queryNodes({ decisionId });
    const decision = candidates[0];
    if (!decision) {
      throw new Error(`Decision node not found: ${decisionId}`);
    }

    // Get full upstream graph
    const upstreamGraph = await this.queryService.getUpstream(decision.lineageId);

    // Build audit trail from the decision's context
    const auditTrail: AuditLogEntry[] = [];
    if (decision.context.userId) {
      // Get audit entries for the user around the decision time window
      const trail = await this.getAuditTrail(decision.context.userId, {
        start: decision.timestamp - 3600_000, // 1 hour before
        end: decision.timestamp + 3600_000,   // 1 hour after
      });
      auditTrail.push(...trail);
    }

    return {
      decisionId,
      decision,
      upstreamGraph,
      auditTrail,
      generatedAt: Date.now(),
    };
  }

  // ─── AC-6.4: 异常检测 ──────────────────────────────────────────────────

  async detectAnomalies(timeRange: TimeRange): Promise<ChangeAlert[]> {
    const alerts: ChangeAlert[] = [];

    const nodes = await this.store.queryNodes({
      fromTimestamp: timeRange.start,
      toTimestamp: timeRange.end,
    });

    // 1) Hash mismatch detection: source nodes with same sourceId but different resultHash
    const sourceNodes = nodes.filter((n) => n.type === "source" && n.sourceId);
    const sourceGroups = new Map<string, DataLineageNode[]>();
    for (const node of sourceNodes) {
      const group = sourceGroups.get(node.sourceId!) ?? [];
      group.push(node);
      sourceGroups.set(node.sourceId!, group);
    }

    sourceGroups.forEach((group, sourceId) => {
      if (group.length < 2) return;
      // Sort by timestamp to compare consecutive records
      group.sort((a: DataLineageNode, b: DataLineageNode) => a.timestamp - b.timestamp);
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1];
        const curr = group[i];
        if (
          prev.resultHash &&
          curr.resultHash &&
          prev.resultHash !== curr.resultHash
        ) {
          alerts.push({
            id: randomUUID(),
            type: "hash_mismatch",
            dataId: sourceId,
            previousHash: prev.resultHash,
            currentHash: curr.resultHash,
            affectedAgents: [],
            affectedDecisions: [],
            riskLevel: "high",
            timestamp: curr.timestamp,
            details: `Hash changed for source ${sourceId}: ${prev.resultHash.slice(0, 8)}… → ${curr.resultHash.slice(0, 8)}…`,
          });
        }
      }
    });

    // 2) Abnormal access detection: transformation nodes with unexpected agentId
    const transformNodes = nodes.filter((n) => n.type === "transformation" && n.agentId);
    // Build expected agent set from all agents seen in the full store
    const allNodes = await this.store.queryNodes({});
    const knownAgents = new Set<string>();
    for (const n of allNodes) {
      if (n.agentId) knownAgents.add(n.agentId);
    }
    // Agents seen only in the time range but not before are "new/unexpected"
    const agentsBefore = new Set<string>();
    const nodesBefore = allNodes.filter((n) => n.timestamp < timeRange.start);
    for (const n of nodesBefore) {
      if (n.agentId) agentsBefore.add(n.agentId);
    }

    for (const node of transformNodes) {
      if (node.agentId && !agentsBefore.has(node.agentId)) {
        // This agent was never seen before the time range — abnormal access
        alerts.push({
          id: randomUUID(),
          type: "data_volume_anomaly",
          dataId: node.lineageId,
          affectedAgents: [node.agentId],
          affectedDecisions: node.decisionId ? [node.decisionId] : [],
          riskLevel: "medium",
          timestamp: node.timestamp,
          details: `Unexpected agent access: ${node.agentId} was not seen before ${new Date(timeRange.start).toISOString()}`,
        });
      }
    }

    // 3) Permission violation: nodes with complianceTags accessed without proper authorization
    const taggedNodes = nodes.filter(
      (n) => n.complianceTags && n.complianceTags.length > 0,
    );
    for (const node of taggedNodes) {
      // If a tagged node has no userId in context, it's a potential violation
      if (!node.context.userId) {
        alerts.push({
          id: randomUUID(),
          type: "quality_degradation",
          dataId: node.lineageId,
          affectedAgents: node.agentId ? [node.agentId] : [],
          affectedDecisions: node.decisionId ? [node.decisionId] : [],
          riskLevel: "critical",
          timestamp: node.timestamp,
          details: `Compliance-tagged data (${node.complianceTags!.join(", ")}) accessed without user context`,
        });
      }
    }

    return alerts;
  }

  // ─── AC-6.5: PII 检测 ─────────────────────────────────────────────────

  detectPII(node: DataLineageNode): string[] {
    const tags = new Set<string>();

    const textsToScan: string[] = [];

    // Scan queryText
    if (node.queryText) textsToScan.push(node.queryText);

    // Scan metadata values
    if (node.metadata) {
      for (const [key, value] of Object.entries(node.metadata)) {
        // Check key names for GDPR keywords
        if (GDPR_KEYWORDS.some((kw) => key.toLowerCase().includes(kw))) {
          tags.add("GDPR");
        }
        if (typeof value === "string") {
          textsToScan.push(value);
        }
      }
    }

    // Scan all collected text against PII patterns
    for (const text of textsToScan) {
      for (const { pattern, tag } of PII_PATTERNS) {
        if (pattern.test(text)) {
          tags.add(tag);
        }
      }
    }

    // If PII detected, also add GDPR tag
    if (tags.has("PII") || tags.has("PCI")) {
      tags.add("GDPR");
    }

    return Array.from(tags);
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────

  private nodeToAuditEntry(node: DataLineageNode): AuditLogEntry {
    return {
      id: randomUUID(),
      userId: node.context.userId ?? "unknown",
      timestamp: node.timestamp,
      dataId: node.lineageId,
      agentId: node.agentId,
      operation: node.operation ?? node.type,
      decisionId: node.decisionId,
      result: node.result,
      sourceIp: (node.metadata?.sourceIp as string) ?? undefined,
    };
  }
}
