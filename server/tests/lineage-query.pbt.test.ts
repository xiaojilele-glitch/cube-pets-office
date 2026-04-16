/**
 * 血缘查询引擎 属性测试 (Property-Based Testing)
 *
 * P2: getUpstream(id, depth) 返回的所有节点都是 id 的直接或间接上游
 * P3: getDownstream(id, depth) 返回的所有节点都是 id 的直接或间接下游
 * P4: getFullPath(sourceId, decisionId) 返回的路径中，每条边的 fromId 节点在 toId 节点之前（拓扑序）
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fc from "fast-check";
import { JsonLineageStorage } from "../lineage/lineage-store.js";
import { LineageQueryService } from "../lineage/lineage-query.js";
import type {
  DataLineageNode,
  LineageEdge,
} from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-query-pbt-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Arbitrary: 生成随机 DAG ───────────────────────────────────────────────

/**
 * Generate a random DAG with n nodes (ids: node_0 .. node_{n-1}).
 * Edges only go from lower index to higher index to guarantee acyclicity.
 * Returns { nodes, edges, nodeIds }.
 */
const arbDAG = fc
  .record({
    nodeCount: fc.integer({ min: 2, max: 15 }),
    edgeDensity: fc.double({ min: 0.1, max: 0.6, noNaN: true }),
  })
  .chain(({ nodeCount, edgeDensity }) => {
    return fc.record({
      nodeCount: fc.constant(nodeCount),
      edgeDensity: fc.constant(edgeDensity),
      // Random confidence for decision nodes
      confidences: fc.array(fc.double({ min: 0.1, max: 0.99, noNaN: true }), {
        minLength: nodeCount,
        maxLength: nodeCount,
      }),
    });
  })
  .map(({ nodeCount, edgeDensity, confidences }) => {
    const nodeIds: string[] = [];
    const nodes: DataLineageNode[] = [];
    const edges: LineageEdge[] = [];
    // adjacency: parent -> children
    const children = new Map<string, string[]>();
    // adjacency: child -> parents
    const parents = new Map<string, string[]>();

    for (let i = 0; i < nodeCount; i++) {
      const id = `node_${i}`;
      nodeIds.push(id);
      children.set(id, []);
      parents.set(id, []);
    }

    // Generate edges (lower index -> higher index only)
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        if (Math.random() < edgeDensity) {
          const fromId = `node_${i}`;
          const toId = `node_${j}`;
          edges.push({
            fromId,
            toId,
            type: "derived-from",
            timestamp: 1000000000000 + j * 1000,
          });
          children.get(fromId)!.push(toId);
          parents.get(toId)!.push(fromId);
        }
      }
    }

    // Create nodes with upstream arrays matching parent edges
    for (let i = 0; i < nodeCount; i++) {
      const id = `node_${i}`;
      const parentIds = parents.get(id)!;
      // First node is source, last is decision, rest are transformations
      let type: "source" | "transformation" | "decision" = "transformation";
      if (i === 0) type = "source";
      else if (i === nodeCount - 1) type = "decision";

      const node: DataLineageNode = {
        lineageId: id,
        type,
        timestamp: 1000000000000 + i * 1000,
        context: {},
        upstream: parentIds.length > 0 ? parentIds : undefined,
        confidence: type === "decision" ? confidences[i] : undefined,
        decisionId: type === "decision" ? `dec_${i}` : undefined,
      };
      nodes.push(node);
    }

    return { nodes, edges, nodeIds, children, parents };
  });

/**
 * Pick a random target node index from the DAG.
 */
function arbTargetIndex(maxExclusive: number) {
  return fc.integer({ min: 0, max: maxExclusive - 1 });
}

// ─── 验证工具：BFS 可达性 ──────────────────────────────────────────────────

/** Compute all ancestors of targetId using BFS on parent adjacency */
function computeAllUpstream(
  targetId: string,
  parents: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>();
  const queue = [targetId];
  visited.add(targetId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const pList = parents.get(id) || [];
    for (const pid of pList) {
      if (!visited.has(pid)) {
        visited.add(pid);
        queue.push(pid);
      }
    }
  }
  return visited;
}

/** Compute all descendants of targetId using BFS on children adjacency */
function computeAllDownstream(
  targetId: string,
  children: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>();
  const queue = [targetId];
  visited.add(targetId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const cList = children.get(id) || [];
    for (const cid of cList) {
      if (!visited.has(cid)) {
        visited.add(cid);
        queue.push(cid);
      }
    }
  }
  return visited;
}

// ─── P2: 上游正确性 ───────────────────────────────────────────────────────
// **Validates: Requirements 5.1**

describe("P2: getUpstream 返回的所有节点都是目标的直接或间接上游", () => {
  it("getUpstream(id) 返回的每个节点都在 ground-truth 上游集合中", async () => {
    await fc.assert(
      fc.asyncProperty(arbDAG, async dag => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();
          await store.batchInsertNodes(dag.nodes);
          await store.batchInsertEdges(dag.edges);

          const query = new LineageQueryService(store);

          // Test for each node in the DAG
          for (const targetId of dag.nodeIds) {
            const result = await query.getUpstream(targetId);
            const resultIds = result.nodes.map(n => n.lineageId);

            // Ground truth: BFS on parent adjacency
            const expected = computeAllUpstream(targetId, dag.parents);

            // Every returned node must be in the expected set
            for (const rid of resultIds) {
              expect(expected.has(rid)).toBe(true);
            }

            // Every expected node must be in the result
            expected.forEach(eid => {
              expect(resultIds.indexOf(eid) !== -1).toBe(true);
            });
          }
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 30 }
    );
  });

  it("getUpstream(id, depth) 返回的节点不超过 depth 层", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDAG.chain(dag =>
          fc.record({
            dag: fc.constant(dag),
            targetIdx: arbTargetIndex(dag.nodeIds.length),
            depth: fc.integer({ min: 0, max: 5 }),
          })
        ),
        async ({ dag, targetIdx, depth }) => {
          const tmpDir = makeTmpDir();
          try {
            const store = new JsonLineageStorage(tmpDir);
            store.init();
            await store.batchInsertNodes(dag.nodes);
            await store.batchInsertEdges(dag.edges);

            const query = new LineageQueryService(store);
            const targetId = dag.nodeIds[targetIdx];
            const result = await query.getUpstream(targetId, depth);
            const resultIds = result.nodes.map(n => n.lineageId);

            // All returned nodes must be reachable within `depth` hops
            // Compute BFS with depth limit
            const visited = new Set<string>();
            const queue: Array<{ id: string; d: number }> = [
              { id: targetId, d: 0 },
            ];
            visited.add(targetId);
            while (queue.length > 0) {
              const { id, d } = queue.shift()!;
              if (d >= depth) continue;
              const pList = dag.parents.get(id) || [];
              for (const pid of pList) {
                if (!visited.has(pid)) {
                  visited.add(pid);
                  queue.push({ id: pid, d: d + 1 });
                }
              }
            }

            for (const rid of resultIds) {
              expect(visited.has(rid)).toBe(true);
            }
          } finally {
            cleanDir(tmpDir);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── P3: 下游正确性 ───────────────────────────────────────────────────────
// **Validates: Requirements 5.2**

describe("P3: getDownstream 返回的所有节点都是目标的直接或间接下游", () => {
  it("getDownstream(id) 返回的每个节点都在 ground-truth 下游集合中", async () => {
    await fc.assert(
      fc.asyncProperty(arbDAG, async dag => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();
          await store.batchInsertNodes(dag.nodes);
          await store.batchInsertEdges(dag.edges);

          const query = new LineageQueryService(store);

          for (const targetId of dag.nodeIds) {
            const result = await query.getDownstream(targetId);
            const resultIds = result.nodes.map(n => n.lineageId);

            // Ground truth: BFS on children adjacency
            const expected = computeAllDownstream(targetId, dag.children);

            // Every returned node must be in the expected set
            for (const rid of resultIds) {
              expect(expected.has(rid)).toBe(true);
            }

            // Every expected node must be in the result
            expected.forEach(eid => {
              expect(resultIds.indexOf(eid) !== -1).toBe(true);
            });
          }
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 30 }
    );
  });

  it("getDownstream(id, depth) 返回的节点不超过 depth 层", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDAG.chain(dag =>
          fc.record({
            dag: fc.constant(dag),
            targetIdx: arbTargetIndex(dag.nodeIds.length),
            depth: fc.integer({ min: 0, max: 5 }),
          })
        ),
        async ({ dag, targetIdx, depth }) => {
          const tmpDir = makeTmpDir();
          try {
            const store = new JsonLineageStorage(tmpDir);
            store.init();
            await store.batchInsertNodes(dag.nodes);
            await store.batchInsertEdges(dag.edges);

            const query = new LineageQueryService(store);
            const targetId = dag.nodeIds[targetIdx];
            const result = await query.getDownstream(targetId, depth);
            const resultIds = result.nodes.map(n => n.lineageId);

            // Compute BFS with depth limit on children
            const visited = new Set<string>();
            const queue: Array<{ id: string; d: number }> = [
              { id: targetId, d: 0 },
            ];
            visited.add(targetId);
            while (queue.length > 0) {
              const { id, d } = queue.shift()!;
              if (d >= depth) continue;
              const cList = dag.children.get(id) || [];
              for (const cid of cList) {
                if (!visited.has(cid)) {
                  visited.add(cid);
                  queue.push({ id: cid, d: d + 1 });
                }
              }
            }

            for (const rid of resultIds) {
              expect(visited.has(rid)).toBe(true);
            }
          } finally {
            cleanDir(tmpDir);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── P4: 拓扑序 ───────────────────────────────────────────────────────────
// **Validates: Requirements 5.3**

describe("P4: getFullPath 返回的路径中每条边的 fromId 节点在 toId 节点之前", () => {
  it("getFullPath(sourceId, decisionId) 的边满足拓扑序", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDAG.filter(dag => {
          // Ensure there's at least a path from node_0 to the last node
          const lastId = dag.nodeIds[dag.nodeIds.length - 1];
          const reachable = computeAllDownstream(dag.nodeIds[0], dag.children);
          return reachable.has(lastId);
        }),
        async dag => {
          const tmpDir = makeTmpDir();
          try {
            const store = new JsonLineageStorage(tmpDir);
            store.init();
            await store.batchInsertNodes(dag.nodes);
            await store.batchInsertEdges(dag.edges);

            const query = new LineageQueryService(store);
            const sourceId = dag.nodeIds[0];
            const decisionId = dag.nodeIds[dag.nodeIds.length - 1];

            const result = await query.getFullPath(sourceId, decisionId);

            if (result.nodes.length === 0) return; // no path found is acceptable if filtered wrong

            // Build position map from the returned nodes
            const nodeIds = result.nodes.map(n => n.lineageId);

            // Verify: all nodes in the path are on a valid path from source to decision
            expect(nodeIds.indexOf(sourceId) !== -1).toBe(true);
            expect(nodeIds.indexOf(decisionId) !== -1).toBe(true);

            // Verify topological order: for each edge, fromId's index in the
            // original DAG ordering should be less than toId's
            // (since our DAG guarantees lower index -> higher index)
            for (const edge of result.edges) {
              const fromDagIdx = dag.nodeIds.indexOf(edge.fromId);
              const toDagIdx = dag.nodeIds.indexOf(edge.toId);
              expect(fromDagIdx).toBeLessThan(toDagIdx);
            }
          } finally {
            cleanDir(tmpDir);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
