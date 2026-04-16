/**
 * 变更检测服务 单元测试
 * 覆盖 Task 6.1 ~ 6.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonLineageStorage } from "../lineage/lineage-store.js";
import { LineageQueryService } from "../lineage/lineage-query.js";
import { ChangeDetectionService } from "../lineage/change-detection.js";
import type {
  DataLineageNode,
  LineageEdge,
  ChangeAlert,
} from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-change-test-"));
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

describe("ChangeDetectionService", () => {
  let tmpDir: string;
  let store: JsonLineageStorage;
  let queryService: LineageQueryService;
  let service: ChangeDetectionService;

  beforeEach(() => {
    counter = 0;
    tmpDir = makeTmpDir();
    store = new JsonLineageStorage(tmpDir);
    store.init();
    queryService = new LineageQueryService(store);
    service = new ChangeDetectionService(store, queryService);
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── 6.2 detectChanges (AC-8.1) ─────────────────────────────────────

  describe("detectChanges()", () => {
    it("should return null when no source nodes exist", async () => {
      const result = await service.detectChanges("unknown-source");
      expect(result).toBeNull();
    });

    it("should return null when only one source record exists", async () => {
      const node = makeNode({
        sourceId: "db-1",
        resultHash: "hash_a",
      });
      await store.batchInsertNodes([node]);

      const result = await service.detectChanges("db-1");
      expect(result).toBeNull();
    });

    it("should return null when hashes are the same", async () => {
      const n1 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_a",
        timestamp: 1000,
      });
      const n2 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_a",
        timestamp: 2000,
      });
      await store.batchInsertNodes([n1, n2]);

      const result = await service.detectChanges("db-1");
      expect(result).toBeNull();
    });

    it("should return ChangeAlert when hashes differ", async () => {
      const n1 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_a",
        timestamp: 1000,
      });
      const n2 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_b",
        timestamp: 2000,
      });
      await store.batchInsertNodes([n1, n2]);

      const result = await service.detectChanges("db-1");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("hash_mismatch");
      expect(result!.previousHash).toBe("hash_a");
      expect(result!.currentHash).toBe("hash_b");
      expect(result!.dataId).toBe(n2.lineageId);
    });

    it("should compare only the latest two records by timestamp", async () => {
      const n1 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_a",
        timestamp: 1000,
      });
      const n2 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_b",
        timestamp: 2000,
      });
      const n3 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_b",
        timestamp: 3000,
      });
      await store.batchInsertNodes([n1, n2, n3]);

      // n2 and n3 have same hash → no alert
      const result = await service.detectChanges("db-1");
      expect(result).toBeNull();
    });

    it("should not match nodes from different sourceIds", async () => {
      const n1 = makeNode({
        sourceId: "db-1",
        resultHash: "hash_a",
        timestamp: 1000,
      });
      const n2 = makeNode({
        sourceId: "db-2",
        resultHash: "hash_b",
        timestamp: 2000,
      });
      await store.batchInsertNodes([n1, n2]);

      const result = await service.detectChanges("db-1");
      expect(result).toBeNull();
    });
  });

  // ─── 6.3 analyzeChangeImpact (AC-8.2 ~ AC-8.3) ─────────────────────

  describe("analyzeChangeImpact()", () => {
    it("should populate affectedAgents and affectedDecisions on alert", async () => {
      const src = makeNode({
        lineageId: "src",
        type: "source",
        sourceId: "db-1",
        resultHash: "hash_a",
      });
      const trans = makeNode({
        lineageId: "trans",
        type: "transformation",
        agentId: "agent-1",
        upstream: ["src"],
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        decisionId: "decision-1",
        upstream: ["trans"],
        confidence: 0.5,
      });
      await store.batchInsertNodes([src, trans, dec]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "trans" }),
        makeEdge({ fromId: "trans", toId: "dec" }),
      ]);

      const alert: ChangeAlert = {
        id: "alert-1",
        type: "hash_mismatch",
        dataId: "src",
        previousHash: "hash_a",
        currentHash: "hash_b",
        affectedAgents: [],
        affectedDecisions: [],
        riskLevel: "medium",
        timestamp: Date.now(),
      };

      const impact = await service.analyzeChangeImpact(alert);

      expect(alert.affectedAgents).toContain("agent-1");
      expect(alert.affectedDecisions).toContain("decision-1");
      expect(impact.affectedDecisions).toHaveLength(1);
      expect(impact.affectedNodes.length).toBeGreaterThanOrEqual(1);
    });

    it("should sync riskLevel from impact analysis to alert", async () => {
      const src = makeNode({ lineageId: "src", type: "source" });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        decisionId: "d1",
        upstream: ["src"],
        confidence: 0.95,
      });
      await store.batchInsertNodes([src, dec]);
      await store.batchInsertEdges([makeEdge({ fromId: "src", toId: "dec" })]);

      const alert: ChangeAlert = {
        id: "alert-2",
        type: "hash_mismatch",
        dataId: "src",
        affectedAgents: [],
        affectedDecisions: [],
        riskLevel: "low",
        timestamp: Date.now(),
      };

      const impact = await service.analyzeChangeImpact(alert);
      expect(alert.riskLevel).toBe(impact.riskLevel);
      expect(alert.riskLevel).toBe("critical");
    });

    it("should return empty arrays when no downstream exists", async () => {
      const src = makeNode({ lineageId: "isolated", type: "source" });
      await store.batchInsertNodes([src]);

      const alert: ChangeAlert = {
        id: "alert-3",
        type: "hash_mismatch",
        dataId: "isolated",
        affectedAgents: [],
        affectedDecisions: [],
        riskLevel: "medium",
        timestamp: Date.now(),
      };

      const impact = await service.analyzeChangeImpact(alert);
      expect(alert.affectedAgents).toHaveLength(0);
      expect(alert.affectedDecisions).toHaveLength(0);
      expect(impact.affectedNodes).toHaveLength(0);
    });
  });

  // ─── 6.4 getStateAtTime (AC-8.4) ────────────────────────────────────

  describe("getStateAtTime()", () => {
    it("should return empty graph for unknown decisionId", async () => {
      const result = await service.getStateAtTime("nonexistent", Date.now());
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it("should return only nodes with timestamp <= given time", async () => {
      const src = makeNode({
        lineageId: "src",
        type: "source",
        timestamp: 1000,
      });
      const trans = makeNode({
        lineageId: "trans",
        type: "transformation",
        timestamp: 2000,
        upstream: ["src"],
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        decisionId: "dec-1",
        timestamp: 3000,
        upstream: ["trans"],
      });
      await store.batchInsertNodes([src, trans, dec]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "trans" }),
        makeEdge({ fromId: "trans", toId: "dec" }),
      ]);

      // Query state at time 2500 → should include src and trans, but not dec
      const result = await service.getStateAtTime("dec-1", 2500);
      const ids = result.nodes.map(n => n.lineageId).sort();
      expect(ids).toEqual(["src", "trans"]);
      // Edge between src and trans should be present
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].fromId).toBe("src");
      expect(result.edges[0].toId).toBe("trans");
    });

    it("should include all nodes when timestamp is far in the future", async () => {
      const src = makeNode({
        lineageId: "src",
        type: "source",
        timestamp: 1000,
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        decisionId: "dec-1",
        timestamp: 2000,
        upstream: ["src"],
      });
      await store.batchInsertNodes([src, dec]);
      await store.batchInsertEdges([makeEdge({ fromId: "src", toId: "dec" })]);

      const result = await service.getStateAtTime("dec-1", 999999999999);
      expect(result.nodes).toHaveLength(2);
    });

    it("should return empty nodes when timestamp is before all nodes", async () => {
      const src = makeNode({
        lineageId: "src",
        type: "source",
        timestamp: 5000,
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        decisionId: "dec-1",
        timestamp: 6000,
        upstream: ["src"],
      });
      await store.batchInsertNodes([src, dec]);
      await store.batchInsertEdges([makeEdge({ fromId: "src", toId: "dec" })]);

      const result = await service.getStateAtTime("dec-1", 1000);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  // ─── 6.5 measureQuality (AC-8.5) ────────────────────────────────────

  describe("measureQuality()", () => {
    it("should return zero metrics for unknown dataId", async () => {
      const result = await service.measureQuality("nonexistent");
      expect(result.dataId).toBe("nonexistent");
      expect(result.freshness).toBe(0);
      expect(result.completeness).toBe(0);
      expect(result.accuracy).toBe(0);
    });

    it("should return high freshness for recent data", async () => {
      const node = makeNode({
        lineageId: "fresh",
        timestamp: Date.now() - 1000, // 1 second ago
        resultHash: "abc123",
      });
      await store.batchInsertNodes([node]);

      const result = await service.measureQuality("fresh");
      expect(result.freshness).toBeGreaterThan(0.99);
    });

    it("should return low freshness for old data", async () => {
      const node = makeNode({
        lineageId: "old",
        timestamp: Date.now() - 80 * 24 * 60 * 60 * 1000, // 80 days ago
      });
      await store.batchInsertNodes([node]);

      const result = await service.measureQuality("old");
      expect(result.freshness).toBeLessThan(0.2);
      expect(result.freshness).toBeGreaterThanOrEqual(0);
    });

    it("should return zero freshness for data older than 90 days", async () => {
      const node = makeNode({
        lineageId: "ancient",
        timestamp: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
      });
      await store.batchInsertNodes([node]);

      const result = await service.measureQuality("ancient");
      expect(result.freshness).toBe(0);
    });

    it("should calculate completeness based on filled optional fields", async () => {
      const sparseNode = makeNode({
        lineageId: "sparse",
      });
      await store.batchInsertNodes([sparseNode]);

      const sparseResult = await service.measureQuality("sparse");

      const richNode = makeNode({
        lineageId: "rich",
        sourceId: "db-1",
        sourceName: "main-db",
        queryText: "SELECT *",
        resultHash: "abc",
        resultSize: 100,
        agentId: "agent-1",
        operation: "query",
        metadata: { key: "val" },
        complianceTags: ["GDPR"],
        upstream: ["other"],
      });
      await store.batchInsertNodes([richNode]);

      const richResult = await service.measureQuality("rich");
      expect(richResult.completeness).toBeGreaterThan(
        sparseResult.completeness
      );
    });

    it("should return accuracy 0.5 when no resultHash", async () => {
      const node = makeNode({
        lineageId: "no-hash",
        timestamp: Date.now(),
      });
      await store.batchInsertNodes([node]);

      const result = await service.measureQuality("no-hash");
      expect(result.accuracy).toBe(0.5);
    });

    it("should return accuracy 1.0 when hash exists and no changes detected", async () => {
      const node = makeNode({
        lineageId: "stable",
        sourceId: "db-stable",
        resultHash: "consistent_hash",
        timestamp: Date.now(),
      });
      await store.batchInsertNodes([node]);

      // Only one record for this sourceId → no change detected → accuracy 1.0
      const result = await service.measureQuality("stable");
      expect(result.accuracy).toBe(1.0);
    });

    it("should return all metrics between 0 and 1", async () => {
      const node = makeNode({
        lineageId: "bounded",
        sourceId: "db-bounded",
        resultHash: "hash_x",
        timestamp: Date.now() - 45 * 24 * 60 * 60 * 1000, // 45 days ago
      });
      await store.batchInsertNodes([node]);

      const result = await service.measureQuality("bounded");
      expect(result.freshness).toBeGreaterThanOrEqual(0);
      expect(result.freshness).toBeLessThanOrEqual(1);
      expect(result.completeness).toBeGreaterThanOrEqual(0);
      expect(result.completeness).toBeLessThanOrEqual(1);
      expect(result.accuracy).toBeGreaterThanOrEqual(0);
      expect(result.accuracy).toBeLessThanOrEqual(1);
    });

    it("should include measuredAt timestamp", async () => {
      const node = makeNode({ lineageId: "timed" });
      await store.batchInsertNodes([node]);

      const before = Date.now();
      const result = await service.measureQuality("timed");
      const after = Date.now();

      expect(result.measuredAt).toBeGreaterThanOrEqual(before);
      expect(result.measuredAt).toBeLessThanOrEqual(after);
    });
  });
});
