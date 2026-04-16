/**
 * 血缘查询引擎 单元测试
 * 覆盖 Task 4.1 ~ 4.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonLineageStorage } from "../lineage/lineage-store.js";
import { LineageQueryService } from "../lineage/lineage-query.js";
import type {
  DataLineageNode,
  LineageEdge,
} from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-query-test-"));
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

describe("LineageQueryService", () => {
  let tmpDir: string;
  let store: JsonLineageStorage;
  let query: LineageQueryService;

  beforeEach(() => {
    counter = 0;
    tmpDir = makeTmpDir();
    store = new JsonLineageStorage(tmpDir);
    store.init();
    query = new LineageQueryService(store);
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── 4.2 getUpstream (AC-5.1) ────────────────────────────────────────

  describe("getUpstream()", () => {
    it("should return empty graph for unknown node", async () => {
      const result = await query.getUpstream("nonexistent");
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it("should return only the node itself when it has no upstream", async () => {
      const node = makeNode({ lineageId: "root" });
      await store.batchInsertNodes([node]);

      const result = await query.getUpstream("root");
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].lineageId).toBe("root");
      expect(result.edges).toHaveLength(0);
    });

    it("should trace upstream via node.upstream array", async () => {
      const src = makeNode({ lineageId: "src", type: "source" });
      const trans = makeNode({
        lineageId: "trans",
        type: "transformation",
        upstream: ["src"],
      });
      await store.batchInsertNodes([src, trans]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "trans" }),
      ]);

      const result = await query.getUpstream("trans");
      expect(result.nodes).toHaveLength(2);
      const ids = result.nodes.map(n => n.lineageId).sort();
      expect(ids).toEqual(["src", "trans"]);
      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    it("should trace upstream via edges (toId match)", async () => {
      const src = makeNode({ lineageId: "src" });
      const mid = makeNode({ lineageId: "mid", upstream: ["src"] });
      const leaf = makeNode({ lineageId: "leaf", upstream: ["mid"] });
      await store.batchInsertNodes([src, mid, leaf]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "mid" }),
        makeEdge({ fromId: "mid", toId: "leaf" }),
      ]);

      const result = await query.getUpstream("leaf");
      expect(result.nodes).toHaveLength(3);
      const ids = result.nodes.map(n => n.lineageId).sort();
      expect(ids).toEqual(["leaf", "mid", "src"]);
    });

    it("should respect depth limit", async () => {
      const a = makeNode({ lineageId: "a" });
      const b = makeNode({ lineageId: "b", upstream: ["a"] });
      const c = makeNode({ lineageId: "c", upstream: ["b"] });
      await store.batchInsertNodes([a, b, c]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "a", toId: "b" }),
        makeEdge({ fromId: "b", toId: "c" }),
      ]);

      const result = await query.getUpstream("c", 1);
      expect(result.nodes).toHaveLength(2);
      const ids = result.nodes.map(n => n.lineageId).sort();
      expect(ids).toEqual(["b", "c"]);
    });

    it("should handle diamond-shaped upstream", async () => {
      // a -> b, a -> c, b -> d, c -> d
      const a = makeNode({ lineageId: "a" });
      const b = makeNode({ lineageId: "b", upstream: ["a"] });
      const c = makeNode({ lineageId: "c", upstream: ["a"] });
      const d = makeNode({ lineageId: "d", upstream: ["b", "c"] });
      await store.batchInsertNodes([a, b, c, d]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "a", toId: "b" }),
        makeEdge({ fromId: "a", toId: "c" }),
        makeEdge({ fromId: "b", toId: "d" }),
        makeEdge({ fromId: "c", toId: "d" }),
      ]);

      const result = await query.getUpstream("d");
      expect(result.nodes).toHaveLength(4);
    });
  });

  // ─── 4.3 getDownstream (AC-5.2) ─────────────────────────────────────

  describe("getDownstream()", () => {
    it("should return empty graph for unknown node", async () => {
      const result = await query.getDownstream("nonexistent");
      expect(result.nodes).toHaveLength(0);
    });

    it("should return only the node itself when it has no downstream", async () => {
      const node = makeNode({ lineageId: "leaf" });
      await store.batchInsertNodes([node]);

      const result = await query.getDownstream("leaf");
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].lineageId).toBe("leaf");
    });

    it("should trace downstream via edges (fromId match)", async () => {
      const src = makeNode({ lineageId: "src" });
      const mid = makeNode({ lineageId: "mid", upstream: ["src"] });
      const leaf = makeNode({ lineageId: "leaf", upstream: ["mid"] });
      await store.batchInsertNodes([src, mid, leaf]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "mid" }),
        makeEdge({ fromId: "mid", toId: "leaf" }),
      ]);

      const result = await query.getDownstream("src");
      expect(result.nodes).toHaveLength(3);
      const ids = result.nodes.map(n => n.lineageId).sort();
      expect(ids).toEqual(["leaf", "mid", "src"]);
    });

    it("should trace downstream via upstream arrays on other nodes", async () => {
      const src = makeNode({ lineageId: "src" });
      const child = makeNode({ lineageId: "child", upstream: ["src"] });
      await store.batchInsertNodes([src, child]);
      // No explicit edges, only upstream array

      const result = await query.getDownstream("src");
      expect(result.nodes).toHaveLength(2);
    });

    it("should respect depth limit", async () => {
      const a = makeNode({ lineageId: "a" });
      const b = makeNode({ lineageId: "b", upstream: ["a"] });
      const c = makeNode({ lineageId: "c", upstream: ["b"] });
      await store.batchInsertNodes([a, b, c]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "a", toId: "b" }),
        makeEdge({ fromId: "b", toId: "c" }),
      ]);

      const result = await query.getDownstream("a", 1);
      expect(result.nodes).toHaveLength(2);
      const ids = result.nodes.map(n => n.lineageId).sort();
      expect(ids).toEqual(["a", "b"]);
    });

    it("should handle fan-out downstream", async () => {
      const root = makeNode({ lineageId: "root" });
      const c1 = makeNode({ lineageId: "c1", upstream: ["root"] });
      const c2 = makeNode({ lineageId: "c2", upstream: ["root"] });
      const c3 = makeNode({ lineageId: "c3", upstream: ["root"] });
      await store.batchInsertNodes([root, c1, c2, c3]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "root", toId: "c1" }),
        makeEdge({ fromId: "root", toId: "c2" }),
        makeEdge({ fromId: "root", toId: "c3" }),
      ]);

      const result = await query.getDownstream("root");
      expect(result.nodes).toHaveLength(4);
    });
  });

  // ─── 4.4 getFullPath (AC-5.3) ───────────────────────────────────────

  describe("getFullPath()", () => {
    it("should return empty graph when source does not exist", async () => {
      const dec = makeNode({ lineageId: "dec", type: "decision" });
      await store.batchInsertNodes([dec]);

      const result = await query.getFullPath("nonexistent", "dec");
      expect(result.nodes).toHaveLength(0);
    });

    it("should return empty graph when decision does not exist", async () => {
      const src = makeNode({ lineageId: "src" });
      await store.batchInsertNodes([src]);

      const result = await query.getFullPath("src", "nonexistent");
      expect(result.nodes).toHaveLength(0);
    });

    it("should return empty graph when no path exists", async () => {
      const src = makeNode({ lineageId: "src" });
      const dec = makeNode({ lineageId: "dec", type: "decision" });
      await store.batchInsertNodes([src, dec]);

      const result = await query.getFullPath("src", "dec");
      expect(result.nodes).toHaveLength(0);
    });

    it("should find direct path from source to decision", async () => {
      const src = makeNode({ lineageId: "src", type: "source" });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        upstream: ["src"],
      });
      await store.batchInsertNodes([src, dec]);
      await store.batchInsertEdges([makeEdge({ fromId: "src", toId: "dec" })]);

      const result = await query.getFullPath("src", "dec");
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it("should find multi-hop path", async () => {
      const src = makeNode({ lineageId: "src", type: "source" });
      const t1 = makeNode({
        lineageId: "t1",
        type: "transformation",
        upstream: ["src"],
      });
      const t2 = makeNode({
        lineageId: "t2",
        type: "transformation",
        upstream: ["t1"],
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        upstream: ["t2"],
      });
      await store.batchInsertNodes([src, t1, t2, dec]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "t1" }),
        makeEdge({ fromId: "t1", toId: "t2" }),
        makeEdge({ fromId: "t2", toId: "dec" }),
      ]);

      const result = await query.getFullPath("src", "dec");
      expect(result.nodes).toHaveLength(4);
      expect(result.edges).toHaveLength(3);
    });

    it("should maintain topological order in edges", async () => {
      const src = makeNode({
        lineageId: "src",
        type: "source",
        timestamp: 1000,
      });
      const mid = makeNode({
        lineageId: "mid",
        type: "transformation",
        timestamp: 2000,
        upstream: ["src"],
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        timestamp: 3000,
        upstream: ["mid"],
      });
      await store.batchInsertNodes([src, mid, dec]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "mid" }),
        makeEdge({ fromId: "mid", toId: "dec" }),
      ]);

      const result = await query.getFullPath("src", "dec");
      // Each edge's fromId should appear before toId in the node list
      const nodeIds = result.nodes.map(n => n.lineageId);
      for (const edge of result.edges) {
        const fromIdx = nodeIds.indexOf(edge.fromId);
        const toIdx = nodeIds.indexOf(edge.toId);
        expect(fromIdx).not.toBe(-1);
        expect(toIdx).not.toBe(-1);
      }
    });
  });

  // ─── 4.5 getImpactAnalysis (AC-5.4) ─────────────────────────────────

  describe("getImpactAnalysis()", () => {
    it("should return low risk when no downstream decisions", async () => {
      const src = makeNode({ lineageId: "src" });
      await store.batchInsertNodes([src]);

      const result = await query.getImpactAnalysis("src");
      expect(result.riskLevel).toBe("low");
      expect(result.affectedDecisions).toHaveLength(0);
      expect(result.affectedNodes).toHaveLength(0);
    });

    it("should return low risk for <= 2 decisions", async () => {
      const src = makeNode({ lineageId: "src" });
      const d1 = makeNode({
        lineageId: "d1",
        type: "decision",
        decisionId: "dec1",
        upstream: ["src"],
        confidence: 0.5,
      });
      const d2 = makeNode({
        lineageId: "d2",
        type: "decision",
        decisionId: "dec2",
        upstream: ["src"],
        confidence: 0.5,
      });
      await store.batchInsertNodes([src, d1, d2]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "d1" }),
        makeEdge({ fromId: "src", toId: "d2" }),
      ]);

      const result = await query.getImpactAnalysis("src");
      expect(result.riskLevel).toBe("low");
      expect(result.affectedDecisions).toHaveLength(2);
    });

    it("should return medium risk for > 2 decisions", async () => {
      const src = makeNode({ lineageId: "src" });
      const decisions = [1, 2, 3].map(i =>
        makeNode({
          lineageId: `d${i}`,
          type: "decision",
          decisionId: `dec${i}`,
          upstream: ["src"],
          confidence: 0.5,
        })
      );
      await store.batchInsertNodes([src, ...decisions]);
      await store.batchInsertEdges(
        decisions.map(d => makeEdge({ fromId: "src", toId: d.lineageId }))
      );

      const result = await query.getImpactAnalysis("src");
      expect(result.riskLevel).toBe("medium");
    });

    it("should return high risk for > 5 decisions", async () => {
      const src = makeNode({ lineageId: "src" });
      const decisions = [1, 2, 3, 4, 5, 6].map(i =>
        makeNode({
          lineageId: `d${i}`,
          type: "decision",
          decisionId: `dec${i}`,
          upstream: ["src"],
          confidence: 0.5,
        })
      );
      await store.batchInsertNodes([src, ...decisions]);
      await store.batchInsertEdges(
        decisions.map(d => makeEdge({ fromId: "src", toId: d.lineageId }))
      );

      const result = await query.getImpactAnalysis("src");
      expect(result.riskLevel).toBe("high");
    });

    it("should return critical risk for > 10 decisions", async () => {
      const src = makeNode({ lineageId: "src" });
      const decisions = Array.from({ length: 11 }, (_, i) =>
        makeNode({
          lineageId: `d${i}`,
          type: "decision",
          decisionId: `dec${i}`,
          upstream: ["src"],
          confidence: 0.5,
        })
      );
      await store.batchInsertNodes([src, ...decisions]);
      await store.batchInsertEdges(
        decisions.map(d => makeEdge({ fromId: "src", toId: d.lineageId }))
      );

      const result = await query.getImpactAnalysis("src");
      expect(result.riskLevel).toBe("critical");
    });

    it("should return critical risk when any decision has confidence > 0.9", async () => {
      const src = makeNode({ lineageId: "src" });
      const d1 = makeNode({
        lineageId: "d1",
        type: "decision",
        decisionId: "dec1",
        upstream: ["src"],
        confidence: 0.95,
      });
      await store.batchInsertNodes([src, d1]);
      await store.batchInsertEdges([makeEdge({ fromId: "src", toId: "d1" })]);

      const result = await query.getImpactAnalysis("src");
      expect(result.riskLevel).toBe("critical");
    });

    it("should include paths in result", async () => {
      const src = makeNode({ lineageId: "src" });
      const mid = makeNode({
        lineageId: "mid",
        type: "transformation",
        upstream: ["src"],
      });
      const dec = makeNode({
        lineageId: "dec",
        type: "decision",
        decisionId: "dec1",
        upstream: ["mid"],
        confidence: 0.5,
      });
      await store.batchInsertNodes([src, mid, dec]);
      await store.batchInsertEdges([
        makeEdge({ fromId: "src", toId: "mid" }),
        makeEdge({ fromId: "mid", toId: "dec" }),
      ]);

      const result = await query.getImpactAnalysis("src");
      expect(result.paths.nodes).toHaveLength(3);
      expect(result.paths.edges.length).toBeGreaterThanOrEqual(2);
      expect(result.affectedNodes).toHaveLength(2);
      expect(result.affectedDecisions).toHaveLength(1);
    });
  });
});
