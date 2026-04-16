/**
 * 审计与合规服务 单元测试
 * 覆盖 Task 5.1 ~ 5.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonLineageStorage } from "../lineage/lineage-store.js";
import { LineageQueryService } from "../lineage/lineage-query.js";
import { LineageAuditService } from "../lineage/lineage-audit.js";
import type {
  DataLineageNode,
  LineageEdge,
} from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-audit-test-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let counter = 0;
function makeNode(overrides?: Partial<DataLineageNode>): DataLineageNode {
  counter++;
  return {
    lineageId: `ln_${counter}`,
    type: "source",
    timestamp: 1000000000000 + counter * 1000,
    context: {},
    ...overrides,
  };
}

function makeEdge(overrides?: Partial<LineageEdge>): LineageEdge {
  return {
    fromId: "ln_1",
    toId: "ln_2",
    type: "derived-from",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── 测试 ──────────────────────────────────────────────────────────────────

describe("LineageAuditService", () => {
  let tmpDir: string;
  let store: JsonLineageStorage;
  let queryService: LineageQueryService;
  let audit: LineageAuditService;

  beforeEach(() => {
    counter = 0;
    tmpDir = makeTmpDir();
    store = new JsonLineageStorage(tmpDir);
    store.init();
    queryService = new LineageQueryService(store);
    audit = new LineageAuditService(store, queryService);
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── 5.2 getAuditTrail (AC-6.1 ~ AC-6.2) ────────────────────────────

  describe("getAuditTrail()", () => {
    it("should return empty array when no nodes match userId", async () => {
      const node = makeNode({ context: { userId: "alice" } });
      await store.batchInsertNodes([node]);

      const result = await audit.getAuditTrail("bob", {
        start: 0,
        end: Date.now(),
      });
      expect(result).toHaveLength(0);
    });

    it("should return audit entries for matching userId within time range", async () => {
      const t = 1000000000000;
      const n1 = makeNode({
        lineageId: "n1",
        timestamp: t + 1000,
        context: { userId: "alice" },
        operation: "query",
      });
      const n2 = makeNode({
        lineageId: "n2",
        timestamp: t + 2000,
        context: { userId: "alice" },
        operation: "filter",
        agentId: "agent-1",
      });
      const n3 = makeNode({
        lineageId: "n3",
        timestamp: t + 3000,
        context: { userId: "bob" },
      });
      await store.batchInsertNodes([n1, n2, n3]);

      const result = await audit.getAuditTrail("alice", {
        start: t,
        end: t + 5000,
      });
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe("alice");
      expect(result[0].dataId).toBe("n1");
      expect(result[1].dataId).toBe("n2");
      expect(result[1].agentId).toBe("agent-1");
    });

    it("should filter by time range", async () => {
      const t = 1000000000000;
      const n1 = makeNode({
        lineageId: "n1",
        timestamp: t + 1000,
        context: { userId: "alice" },
      });
      const n2 = makeNode({
        lineageId: "n2",
        timestamp: t + 5000,
        context: { userId: "alice" },
      });
      await store.batchInsertNodes([n1, n2]);

      const result = await audit.getAuditTrail("alice", {
        start: t + 2000,
        end: t + 6000,
      });
      expect(result).toHaveLength(1);
      expect(result[0].dataId).toBe("n2");
    });

    it("should include all required AuditLogEntry fields (AC-6.2)", async () => {
      const t = 1000000000000;
      const node = makeNode({
        lineageId: "n1",
        timestamp: t,
        context: { userId: "alice" },
        agentId: "agent-1",
        operation: "query",
        decisionId: "dec-1",
        result: "approve",
        metadata: { sourceIp: "192.168.1.1" },
      });
      await store.batchInsertNodes([node]);

      const result = await audit.getAuditTrail("alice", {
        start: t - 1000,
        end: t + 1000,
      });
      expect(result).toHaveLength(1);
      const entry = result[0];
      expect(entry.id).toBeDefined();
      expect(entry.userId).toBe("alice");
      expect(entry.timestamp).toBe(t);
      expect(entry.dataId).toBe("n1");
      expect(entry.agentId).toBe("agent-1");
      expect(entry.operation).toBe("query");
      expect(entry.decisionId).toBe("dec-1");
      expect(entry.result).toBe("approve");
      expect(entry.sourceIp).toBe("192.168.1.1");
    });
  });

  // ─── 5.3 exportLineageReport (AC-6.3) ────────────────────────────────

  describe("exportLineageReport()", () => {
    it("should throw when decision not found", async () => {
      await expect(audit.exportLineageReport("nonexistent")).rejects.toThrow(
        "Decision node not found"
      );
    });

    it("should return a complete LineageReport", async () => {
      const t = 1000000000000;
      const src = makeNode({
        lineageId: "src",
        type: "source",
        timestamp: t,
        context: { userId: "alice" },
      });
      const trans = makeNode({
        lineageId: "trans",
        type: "transformation",
        timestamp: t + 1000,
        upstream: ["src"],
        agentId: "agent-1",
        context: { userId: "alice" },
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        timestamp: t + 2000,
        decisionId: "dec-001",
        upstream: ["trans"],
        context: { userId: "alice" },
        result: "approve",
      });
      await store.batchInsertNodes([src, trans, dec]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "trans" }),
        makeEdge({ fromId: "trans", toId: "dec" }),
      ]);

      const report = await audit.exportLineageReport("dec-001");
      expect(report.decisionId).toBe("dec-001");
      expect(report.decision.lineageId).toBe("dec");
      expect(report.upstreamGraph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it("should include audit trail in report when userId is present", async () => {
      const t = 1000000000000;
      const src = makeNode({
        lineageId: "src",
        type: "source",
        timestamp: t,
        context: { userId: "alice" },
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        timestamp: t + 1000,
        decisionId: "dec-002",
        upstream: ["src"],
        context: { userId: "alice" },
      });
      await store.batchInsertNodes([src, dec]);
      await store.batchInsertEdges([makeEdge({ fromId: "src", toId: "dec" })]);

      const report = await audit.exportLineageReport("dec-002");
      expect(report.auditTrail.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 5.4 detectAnomalies (AC-6.4) ────────────────────────────────────

  describe("detectAnomalies()", () => {
    it("should return empty array when no anomalies", async () => {
      const t = 1000000000000;
      const node = makeNode({
        type: "source",
        sourceId: "db-1",
        resultHash: "abc123",
        timestamp: t,
        context: { userId: "alice" },
      });
      await store.batchInsertNodes([node]);

      const result = await audit.detectAnomalies({
        start: t - 1000,
        end: t + 1000,
      });
      expect(result).toHaveLength(0);
    });

    it("should detect hash mismatch for same sourceId", async () => {
      const t = 1000000000000;
      const n1 = makeNode({
        lineageId: "s1",
        type: "source",
        sourceId: "db-1",
        resultHash: "hash_old",
        timestamp: t + 1000,
      });
      const n2 = makeNode({
        lineageId: "s2",
        type: "source",
        sourceId: "db-1",
        resultHash: "hash_new",
        timestamp: t + 2000,
      });
      await store.batchInsertNodes([n1, n2]);

      const alerts = await audit.detectAnomalies({ start: t, end: t + 5000 });
      const hashAlerts = alerts.filter(a => a.type === "hash_mismatch");
      expect(hashAlerts).toHaveLength(1);
      expect(hashAlerts[0].previousHash).toBe("hash_old");
      expect(hashAlerts[0].currentHash).toBe("hash_new");
      expect(hashAlerts[0].riskLevel).toBe("high");
    });

    it("should not flag hash mismatch when hashes are the same", async () => {
      const t = 1000000000000;
      const n1 = makeNode({
        lineageId: "s1",
        type: "source",
        sourceId: "db-1",
        resultHash: "same_hash",
        timestamp: t + 1000,
      });
      const n2 = makeNode({
        lineageId: "s2",
        type: "source",
        sourceId: "db-1",
        resultHash: "same_hash",
        timestamp: t + 2000,
      });
      await store.batchInsertNodes([n1, n2]);

      const alerts = await audit.detectAnomalies({ start: t, end: t + 5000 });
      const hashAlerts = alerts.filter(a => a.type === "hash_mismatch");
      expect(hashAlerts).toHaveLength(0);
    });

    it("should detect abnormal agent access (new agent not seen before)", async () => {
      const t = 1000000000000;
      // Agent seen before the time range
      const old = makeNode({
        lineageId: "old",
        type: "transformation",
        agentId: "known-agent",
        timestamp: t - 5000,
      });
      // New agent only in the time range
      const suspicious = makeNode({
        lineageId: "sus",
        type: "transformation",
        agentId: "unknown-agent",
        timestamp: t + 1000,
      });
      await store.batchInsertNodes([old, suspicious]);

      const alerts = await audit.detectAnomalies({ start: t, end: t + 5000 });
      const accessAlerts = alerts.filter(a => a.type === "data_volume_anomaly");
      expect(accessAlerts).toHaveLength(1);
      expect(accessAlerts[0].affectedAgents).toContain("unknown-agent");
    });

    it("should detect permission violation on compliance-tagged data without userId", async () => {
      const t = 1000000000000;
      const tagged = makeNode({
        lineageId: "tagged",
        type: "source",
        timestamp: t + 1000,
        complianceTags: ["GDPR", "PII"],
        context: {}, // no userId
      });
      await store.batchInsertNodes([tagged]);

      const alerts = await audit.detectAnomalies({ start: t, end: t + 5000 });
      const permAlerts = alerts.filter(a => a.type === "quality_degradation");
      expect(permAlerts).toHaveLength(1);
      expect(permAlerts[0].riskLevel).toBe("critical");
      expect(permAlerts[0].details).toContain("without user context");
    });
  });

  // ─── 5.5 detectPII (AC-6.5) ──────────────────────────────────────────

  describe("detectPII()", () => {
    it("should return empty array for node without PII", () => {
      const node = makeNode({
        queryText: "SELECT * FROM products",
        metadata: { table: "products" },
      });
      const tags = audit.detectPII(node);
      expect(tags).toHaveLength(0);
    });

    it("should detect email in queryText", () => {
      const node = makeNode({
        queryText: "SELECT * FROM users WHERE email = 'test@example.com'",
      });
      const tags = audit.detectPII(node);
      expect(tags).toContain("PII");
      expect(tags).toContain("GDPR");
    });

    it("should detect phone number in queryText", () => {
      const node = makeNode({
        queryText: "SELECT * FROM contacts WHERE phone = '555-123-4567'",
      });
      const tags = audit.detectPII(node);
      expect(tags).toContain("PII");
    });

    it("should detect SSN pattern in metadata", () => {
      const node = makeNode({
        metadata: { ssn: "123-45-6789" },
      });
      const tags = audit.detectPII(node);
      expect(tags).toContain("PII");
    });

    it("should detect credit card number (PCI)", () => {
      const node = makeNode({
        queryText: "Payment with card 4111111111111111",
      });
      const tags = audit.detectPII(node);
      expect(tags).toContain("PCI");
      expect(tags).toContain("GDPR");
    });

    it("should detect GDPR keywords in metadata keys", () => {
      const node = makeNode({
        metadata: { personal_data: "some value", date_of_birth: "1990-01-01" },
      });
      const tags = audit.detectPII(node);
      expect(tags).toContain("GDPR");
    });

    it("should handle node with no queryText or metadata", () => {
      const node = makeNode({});
      const tags = audit.detectPII(node);
      expect(tags).toHaveLength(0);
    });
  });
});
