/**
 * 血缘导入导出 属性测试 (Property-Based Testing)
 *
 * P8: 导出-导入往返一致性 — 导出后再导入的数据与原始数据一致
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fc from "fast-check";
import { JsonLineageStorage } from "../lineage/lineage-store.js";
import { LineageExportService } from "../lineage/lineage-export.js";
import type {
  DataLineageNode,
  LineageEdge,
} from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-pbt-export-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Arbitrary 生成器 ──────────────────────────────────────────────────────

const arbLineageId = fc
  .stringMatching(/^[a-zA-Z0-9_]+$/)
  .filter(s => s.length >= 1 && s.length <= 30)
  .map(s => `ln_${s}`);

const arbNodeType = fc.constantFrom(
  "source" as const,
  "transformation" as const,
  "decision" as const
);

const arbTimestamp = fc.integer({ min: 1000000000000, max: 2000000000000 });

const arbEdgeType = fc.constantFrom(
  "derived-from" as const,
  "input-to" as const,
  "decided-by" as const,
  "produced-by" as const
);

/** Generate a node with only CSV-safe flat fields (no commas/newlines in string values) */
const arbNode: fc.Arbitrary<DataLineageNode> = fc
  .record({
    lineageId: arbLineageId,
    type: arbNodeType,
    timestamp: arbTimestamp,
    sourceId: fc.option(
      fc
        .stringMatching(/^[a-zA-Z0-9_]+$/)
        .filter(s => s.length >= 1 && s.length <= 20),
      { nil: undefined }
    ),
    agentId: fc.option(
      fc
        .stringMatching(/^[a-zA-Z0-9_]+$/)
        .filter(s => s.length >= 1 && s.length <= 20),
      { nil: undefined }
    ),
    decisionId: fc.option(
      fc
        .stringMatching(/^[a-zA-Z0-9_]+$/)
        .filter(s => s.length >= 1 && s.length <= 20),
      { nil: undefined }
    ),
  })
  .map(
    ({ lineageId, type, timestamp, sourceId, agentId, decisionId }) =>
      ({
        lineageId,
        type,
        timestamp,
        context: {},
        sourceId,
        agentId:
          type === "transformation" ? (agentId ?? "agent_default") : agentId,
        decisionId:
          type === "decision" ? (decisionId ?? "dec_default") : decisionId,
      }) as DataLineageNode
  );

/** Generate unique nodes */
const arbUniqueNodes = fc
  .array(arbNode, { minLength: 1, maxLength: 20 })
  .map(nodes => {
    const seen = new Set<string>();
    return nodes.filter(n => {
      if (seen.has(n.lineageId)) return false;
      seen.add(n.lineageId);
      return true;
    });
  })
  .filter(arr => arr.length > 0);

/** Generate edges referencing existing node IDs */
function arbEdgesForNodes(
  nodes: DataLineageNode[]
): fc.Arbitrary<LineageEdge[]> {
  if (nodes.length < 2) return fc.constant([]);
  const ids = nodes.map(n => n.lineageId);
  const arbEdge = fc
    .record({
      fromIdx: fc.integer({ min: 0, max: ids.length - 1 }),
      toIdx: fc.integer({ min: 0, max: ids.length - 1 }),
      type: arbEdgeType,
      timestamp: arbTimestamp,
    })
    .filter(e => e.fromIdx !== e.toIdx)
    .map(
      e =>
        ({
          fromId: ids[e.fromIdx],
          toId: ids[e.toIdx],
          type: e.type,
          timestamp: e.timestamp,
        }) as LineageEdge
    );

  return fc
    .array(arbEdge, { minLength: 0, maxLength: Math.min(nodes.length, 10) })
    .map(edges => {
      // Deduplicate by fromId+toId+type
      const seen = new Set<string>();
      return edges.filter(e => {
        const key = `${e.fromId}|${e.toId}|${e.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
}

const arbFormat = fc.constantFrom("json" as const, "csv" as const);

// ─── P8: 导出-导入往返一致性 ──────────────────────────────────────────────

describe("P8: 导出-导入往返一致性", () => {
  it("JSON 格式：导出后导入到空 store，节点和边数量一致", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUniqueNodes.chain(nodes =>
          arbEdgesForNodes(nodes).map(edges => ({ nodes, edges }))
        ),
        async ({ nodes, edges }) => {
          const srcDir = makeTmpDir();
          const dstDir = makeTmpDir();
          try {
            // Source store: insert data
            const srcStore = new JsonLineageStorage(srcDir);
            srcStore.init();
            await srcStore.batchInsertNodes(nodes);
            await srcStore.batchInsertEdges(edges);

            const srcService = new LineageExportService(srcStore);

            // Export — range must cover both node and edge timestamps
            const allTimestamps = [
              ...nodes.map(n => n.timestamp),
              ...edges.map(e => e.timestamp),
            ];
            const minTs = Math.min(...allTimestamps);
            const maxTs = Math.max(...allTimestamps);
            const buf = await srcService.exportLineage(minTs, maxTs, "json");

            // Import into fresh store
            const dstStore = new JsonLineageStorage(dstDir);
            dstStore.init();
            const dstService = new LineageExportService(dstStore);
            const result = await dstService.importLineage(buf, "json");

            // Verify round-trip
            expect(result.importedNodes).toBe(nodes.length);
            expect(result.importedEdges).toBe(edges.length);
            expect(result.errors).toHaveLength(0);

            // Verify each node exists in destination
            for (const node of nodes) {
              const stored = await dstStore.getNode(node.lineageId);
              expect(stored).toBeDefined();
              expect(stored!.lineageId).toBe(node.lineageId);
              expect(stored!.type).toBe(node.type);
              expect(stored!.timestamp).toBe(node.timestamp);
            }

            // Verify edge count
            const dstStats = await dstStore.getStats();
            expect(dstStats.totalEdges).toBe(edges.length);
          } finally {
            cleanDir(srcDir);
            cleanDir(dstDir);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("CSV 格式：导出后导入到空 store，节点 lineageId 和 timestamp 一致", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUniqueNodes.chain(nodes =>
          arbEdgesForNodes(nodes).map(edges => ({ nodes, edges }))
        ),
        async ({ nodes, edges }) => {
          const srcDir = makeTmpDir();
          const dstDir = makeTmpDir();
          try {
            const srcStore = new JsonLineageStorage(srcDir);
            srcStore.init();
            await srcStore.batchInsertNodes(nodes);
            await srcStore.batchInsertEdges(edges);

            const srcService = new LineageExportService(srcStore);

            const allTimestamps = [
              ...nodes.map(n => n.timestamp),
              ...edges.map(e => e.timestamp),
            ];
            const minTs = Math.min(...allTimestamps);
            const maxTs = Math.max(...allTimestamps);
            const buf = await srcService.exportLineage(minTs, maxTs, "csv");

            const dstStore = new JsonLineageStorage(dstDir);
            dstStore.init();
            const dstService = new LineageExportService(dstStore);
            const result = await dstService.importLineage(buf, "csv");

            // CSV round-trip: verify node count and key fields
            expect(result.importedNodes).toBe(nodes.length);
            expect(result.importedEdges).toBe(edges.length);

            for (const node of nodes) {
              const stored = await dstStore.getNode(node.lineageId);
              expect(stored).toBeDefined();
              expect(stored!.lineageId).toBe(node.lineageId);
              expect(stored!.timestamp).toBe(node.timestamp);
              expect(stored!.type).toBe(node.type);
            }
          } finally {
            cleanDir(srcDir);
            cleanDir(dstDir);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("重复导入同一数据应全部跳过（去重）", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, arbFormat, async (nodes, format) => {
        const srcDir = makeTmpDir();
        const dstDir = makeTmpDir();
        try {
          const srcStore = new JsonLineageStorage(srcDir);
          srcStore.init();
          await srcStore.batchInsertNodes(nodes);

          const srcService = new LineageExportService(srcStore);
          const minTs = Math.min(...nodes.map(n => n.timestamp));
          const maxTs = Math.max(...nodes.map(n => n.timestamp));
          const buf = await srcService.exportLineage(minTs, maxTs, format);

          const dstStore = new JsonLineageStorage(dstDir);
          dstStore.init();
          const dstService = new LineageExportService(dstStore);

          // First import
          const r1 = await dstService.importLineage(buf, format);
          expect(r1.importedNodes).toBe(nodes.length);

          // Second import — all should be skipped
          const r2 = await dstService.importLineage(buf, format);
          expect(r2.importedNodes).toBe(0);
          expect(r2.skippedDuplicates).toBe(nodes.length);
        } finally {
          cleanDir(srcDir);
          cleanDir(dstDir);
        }
      }),
      { numRuns: 30 }
    );
  });
});
