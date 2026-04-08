/**
 * 血缘存储层 单元测试
 * 覆盖 Task 2.1 ~ 2.3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonLineageStorage, getRetentionDays } from "../lineage/lineage-store.js";
import type {
  DataLineageNode,
  LineageEdge,
} from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-store-test-"));
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
    timestamp: Date.now() + counter,
    context: { sessionId: "sess-1" },
    sourceId: `src_${counter}`,
    sourceName: `Source ${counter}`,
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

describe("JsonLineageStorage", () => {
  let tmpDir: string;
  let store: JsonLineageStorage;

  beforeEach(() => {
    counter = 0;
    tmpDir = makeTmpDir();
    store = new JsonLineageStorage(tmpDir);
    store.init();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── 2.1 JSONL 文件写入与恢复 ────────────────────────────────────────

  describe("2.1 JSONL file persistence", () => {
    it("should create JSONL files on first insert", async () => {
      await store.batchInsertNodes([makeNode()]);
      expect(fs.existsSync(path.join(tmpDir, "nodes.jsonl"))).toBe(true);
    });

    it("should write one JSON line per node", async () => {
      await store.batchInsertNodes([makeNode(), makeNode()]);
      const content = fs.readFileSync(path.join(tmpDir, "nodes.jsonl"), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });

    it("should persist edge data in edges.jsonl", async () => {
      await store.batchInsertEdges([makeEdge()]);
      expect(fs.existsSync(path.join(tmpDir, "edges.jsonl"))).toBe(true);
      const content = fs.readFileSync(path.join(tmpDir, "edges.jsonl"), "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.fromId).toBe("ln_1");
    });

    it("should recover nodes from JSONL on re-init", async () => {
      const node = makeNode();
      await store.batchInsertNodes([node]);

      const store2 = new JsonLineageStorage(tmpDir);
      store2.init();
      const recovered = await store2.getNode(node.lineageId);
      expect(recovered).toBeDefined();
      expect(recovered!.lineageId).toBe(node.lineageId);
    });

    it("should recover edges from JSONL on re-init", async () => {
      const edge = makeEdge();
      await store.batchInsertEdges([edge]);

      const store2 = new JsonLineageStorage(tmpDir);
      store2.init();
      const edges = await store2.queryEdges({ fromId: edge.fromId });
      expect(edges).toHaveLength(1);
    });

    it("should skip corrupted lines gracefully", async () => {
      await store.batchInsertNodes([makeNode()]);
      fs.appendFileSync(path.join(tmpDir, "nodes.jsonl"), "NOT_JSON\n");
      await store.batchInsertNodes([makeNode()]);

      const store2 = new JsonLineageStorage(tmpDir);
      store2.init();
      const stats = await store2.getStats();
      expect(stats.totalNodes).toBe(2);
    });

    it("should handle empty directory on init", () => {
      const freshDir = makeTmpDir();
      try {
        const freshStore = new JsonLineageStorage(freshDir);
        freshStore.init();
        // no throw
      } finally {
        cleanDir(freshDir);
      }
    });

    it("should not insert when nodes array is empty", async () => {
      await store.batchInsertNodes([]);
      const nodesPath = path.join(tmpDir, "nodes.jsonl");
      expect(fs.existsSync(nodesPath)).toBe(false);
    });
  });

  // ─── 2.1 getNode 查询 ────────────────────────────────────────────────

  describe("2.1 getNode()", () => {
    it("should return node by lineageId", async () => {
      const node = makeNode();
      await store.batchInsertNodes([node]);
      const result = await store.getNode(node.lineageId);
      expect(result).toBeDefined();
      expect(result!.type).toBe("source");
    });

    it("should return undefined for unknown id", async () => {
      const result = await store.getNode("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  // ─── 2.2 内存索引 ────────────────────────────────────────────────────

  describe("2.2 Memory indexes", () => {
    it("byAgent: queryNodes with agentId filter", async () => {
      await store.batchInsertNodes([
        makeNode({ type: "transformation", agentId: "agent-A" }),
        makeNode({ type: "transformation", agentId: "agent-B" }),
        makeNode({ type: "transformation", agentId: "agent-A" }),
      ]);
      const results = await store.queryNodes({ agentId: "agent-A" });
      expect(results).toHaveLength(2);
      expect(results.every((n) => n.agentId === "agent-A")).toBe(true);
    });

    it("bySession: queryNodes with sessionId filter", async () => {
      await store.batchInsertNodes([
        makeNode({ context: { sessionId: "s1" } }),
        makeNode({ context: { sessionId: "s2" } }),
        makeNode({ context: { sessionId: "s1" } }),
      ]);
      const results = await store.queryNodes({ sessionId: "s1" });
      expect(results).toHaveLength(2);
    });

    it("byDecision: queryNodes with decisionId filter", async () => {
      await store.batchInsertNodes([
        makeNode({ type: "decision", decisionId: "d1" }),
        makeNode({ type: "decision", decisionId: "d2" }),
      ]);
      const results = await store.queryNodes({ decisionId: "d1" });
      expect(results).toHaveLength(1);
      expect(results[0].decisionId).toBe("d1");
    });

    it("byTimestamp: queryNodes with time range", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({ timestamp: now - 3000 }),
        makeNode({ timestamp: now - 1000 }),
        makeNode({ timestamp: now }),
      ]);
      const results = await store.queryNodes({
        fromTimestamp: now - 2000,
        toTimestamp: now,
      });
      expect(results).toHaveLength(2);
    });

    it("byType: queryNodes with type filter", async () => {
      await store.batchInsertNodes([
        makeNode({ type: "source" }),
        makeNode({ type: "transformation", agentId: "a1" }),
        makeNode({ type: "decision", decisionId: "d1" }),
      ]);
      const results = await store.queryNodes({ type: "decision" });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("decision");
    });

    it("limit: queryNodes respects limit", async () => {
      await store.batchInsertNodes([makeNode(), makeNode(), makeNode()]);
      const results = await store.queryNodes({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("combined filters work together", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({ type: "transformation", agentId: "a1", timestamp: now - 5000 }),
        makeNode({ type: "transformation", agentId: "a1", timestamp: now }),
        makeNode({ type: "source", agentId: "a1", timestamp: now }),
      ]);
      const results = await store.queryNodes({
        agentId: "a1",
        type: "transformation",
        fromTimestamp: now - 1000,
      });
      expect(results).toHaveLength(1);
    });
  });

  // ─── 2.2 queryEdges ──────────────────────────────────────────────────

  describe("2.2 queryEdges()", () => {
    it("should filter edges by fromId", async () => {
      await store.batchInsertEdges([
        makeEdge({ fromId: "a", toId: "b" }),
        makeEdge({ fromId: "c", toId: "d" }),
      ]);
      const results = await store.queryEdges({ fromId: "a" });
      expect(results).toHaveLength(1);
      expect(results[0].toId).toBe("b");
    });

    it("should filter edges by type", async () => {
      await store.batchInsertEdges([
        makeEdge({ type: "derived-from" }),
        makeEdge({ type: "input-to" }),
      ]);
      const results = await store.queryEdges({ type: "input-to" });
      expect(results).toHaveLength(1);
    });

    it("should respect limit on edges", async () => {
      await store.batchInsertEdges([makeEdge(), makeEdge(), makeEdge()]);
      const results = await store.queryEdges({ limit: 1 });
      expect(results).toHaveLength(1);
    });
  });

  // ─── 2.3 purgeExpired 数据保留策略 ───────────────────────────────────

  describe("2.3 purgeExpired()", () => {
    it("should remove nodes older than beforeTimestamp", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({ timestamp: now - 100000 }),
        makeNode({ timestamp: now - 50000 }),
        makeNode({ timestamp: now }),
      ]);
      const purged = await store.purgeExpired(now - 60000);
      expect(purged).toBe(1);
      const stats = await store.getStats();
      expect(stats.totalNodes).toBe(2);
    });

    it("should remove all expired nodes", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({ timestamp: now - 3000 }),
        makeNode({ timestamp: now - 2000 }),
        makeNode({ timestamp: now - 1000 }),
      ]);
      const purged = await store.purgeExpired(now);
      expect(purged).toBe(3);
      const stats = await store.getStats();
      expect(stats.totalNodes).toBe(0);
    });

    it("should return 0 when nothing to purge", async () => {
      const now = Date.now();
      await store.batchInsertNodes([makeNode({ timestamp: now })]);
      const purged = await store.purgeExpired(now - 10000);
      expect(purged).toBe(0);
    });

    it("should remove associated edges when nodes are purged", async () => {
      const now = Date.now();
      const n1 = makeNode({ timestamp: now - 5000 });
      const n2 = makeNode({ timestamp: now });
      await store.batchInsertNodes([n1, n2]);
      await store.batchInsertEdges([
        makeEdge({ fromId: n1.lineageId, toId: n2.lineageId }),
      ]);

      await store.purgeExpired(now - 1000);
      const edges = await store.queryEdges({});
      expect(edges).toHaveLength(0);
    });

    it("should update JSONL files after purge", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({ timestamp: now - 5000 }),
        makeNode({ timestamp: now }),
      ]);
      await store.purgeExpired(now - 1000);

      // Re-init from disk
      const store2 = new JsonLineageStorage(tmpDir);
      store2.init();
      const stats = await store2.getStats();
      expect(stats.totalNodes).toBe(1);
    });

    it("should clean up all indexes after purge", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({
          timestamp: now - 5000,
          type: "transformation",
          agentId: "a1",
          context: { sessionId: "s1" },
        }),
        makeNode({
          timestamp: now,
          type: "decision",
          decisionId: "d1",
          context: { sessionId: "s2" },
        }),
      ]);

      await store.purgeExpired(now - 1000);

      // Agent index should be cleaned
      const byAgent = await store.queryNodes({ agentId: "a1" });
      expect(byAgent).toHaveLength(0);

      // Session index should be cleaned
      const bySession = await store.queryNodes({ sessionId: "s1" });
      expect(bySession).toHaveLength(0);

      // Decision node should still exist
      const byDecision = await store.queryNodes({ decisionId: "d1" });
      expect(byDecision).toHaveLength(1);
    });
  });

  // ─── 2.3 getRetentionDays ────────────────────────────────────────────

  describe("2.3 getRetentionDays()", () => {
    const originalEnv = process.env.LINEAGE_RETENTION_DAYS;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.LINEAGE_RETENTION_DAYS;
      } else {
        process.env.LINEAGE_RETENTION_DAYS = originalEnv;
      }
    });

    it("should return 90 by default", () => {
      delete process.env.LINEAGE_RETENTION_DAYS;
      expect(getRetentionDays()).toBe(90);
    });

    it("should return env value when set", () => {
      process.env.LINEAGE_RETENTION_DAYS = "30";
      expect(getRetentionDays()).toBe(30);
    });

    it("should fallback to 90 for invalid env value", () => {
      process.env.LINEAGE_RETENTION_DAYS = "not_a_number";
      expect(getRetentionDays()).toBe(90);
    });
  });

  // ─── getStats ────────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("should return zeros for empty store", async () => {
      const stats = await store.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.oldestTimestamp).toBe(0);
      expect(stats.newestTimestamp).toBe(0);
    });

    it("should count nodes by type", async () => {
      await store.batchInsertNodes([
        makeNode({ type: "source" }),
        makeNode({ type: "source" }),
        makeNode({ type: "transformation", agentId: "a1" }),
        makeNode({ type: "decision", decisionId: "d1" }),
      ]);
      const stats = await store.getStats();
      expect(stats.totalNodes).toBe(4);
      expect(stats.nodesByType.source).toBe(2);
      expect(stats.nodesByType.transformation).toBe(1);
      expect(stats.nodesByType.decision).toBe(1);
    });

    it("should track oldest and newest timestamps", async () => {
      const now = Date.now();
      await store.batchInsertNodes([
        makeNode({ timestamp: now - 5000 }),
        makeNode({ timestamp: now }),
        makeNode({ timestamp: now - 2000 }),
      ]);
      const stats = await store.getStats();
      expect(stats.oldestTimestamp).toBe(now - 5000);
      expect(stats.newestTimestamp).toBe(now);
    });

    it("should count edges", async () => {
      await store.batchInsertEdges([makeEdge(), makeEdge()]);
      const stats = await store.getStats();
      expect(stats.totalEdges).toBe(2);
    });
  });
});
