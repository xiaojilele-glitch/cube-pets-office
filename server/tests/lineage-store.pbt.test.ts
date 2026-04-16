/**
 * 血缘存储层 属性测试 (Property-Based Testing)
 *
 * P1: 写入后可查询 — 任何通过 batchInsertNodes 写入的节点都能通过 getNode 查询到
 * P7: 过期清理正确性 — purgeExpired 后，所有过期节点不再可查询
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fc from "fast-check";
import { JsonLineageStorage } from "../lineage/lineage-store.js";
import type { DataLineageNode } from "../../shared/lineage/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lineage-pbt-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Arbitrary：随机 DataLineageNode 生成器 ────────────────────────────────

const arbLineageId = fc
  .string({ minLength: 1, maxLength: 30 })
  .map(s => `ln_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`);

const arbNodeType = fc.constantFrom(
  "source" as const,
  "transformation" as const,
  "decision" as const
);

const arbSessionId = fc.option(
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map(s => `sess_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`),
  { nil: undefined }
);

const arbAgentId = fc.option(
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map(s => `agent_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`),
  { nil: undefined }
);

const arbDecisionId = fc.option(
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map(s => `dec_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`),
  { nil: undefined }
);

const arbTimestamp = fc.integer({ min: 1000000000000, max: 2000000000000 });

const arbDataLineageNode: fc.Arbitrary<DataLineageNode> = fc
  .record({
    lineageId: arbLineageId,
    type: arbNodeType,
    timestamp: arbTimestamp,
    sessionId: arbSessionId,
    agentId: arbAgentId,
    decisionId: arbDecisionId,
  })
  .map(({ lineageId, type, timestamp, sessionId, agentId, decisionId }) => {
    const node: DataLineageNode = {
      lineageId,
      type,
      timestamp,
      context: { sessionId },
      agentId:
        type === "transformation" ? (agentId ?? "agent_default") : agentId,
      decisionId:
        type === "decision" ? (decisionId ?? "dec_default") : decisionId,
    };
    return node;
  });

/** Generate array of nodes with unique lineageIds */
const arbUniqueNodes = fc
  .array(arbDataLineageNode, { minLength: 1, maxLength: 50 })
  .map(nodes => {
    const seen = new Set<string>();
    return nodes.filter(n => {
      if (seen.has(n.lineageId)) return false;
      seen.add(n.lineageId);
      return true;
    });
  })
  .filter(arr => arr.length > 0);

// ─── P1: 写入后可查询 ─────────────────────────────────────────────────────
// **Validates: Requirements 4.1, 4.2**

describe("P1: 写入后可查询", () => {
  it("任何通过 batchInsertNodes 写入的节点都能通过 getNode(lineageId) 查询到", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, async nodes => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();

          await store.batchInsertNodes(nodes);

          for (const node of nodes) {
            const retrieved = await store.getNode(node.lineageId);
            expect(retrieved).toBeDefined();
            expect(retrieved!.lineageId).toBe(node.lineageId);
            expect(retrieved!.type).toBe(node.type);
            expect(retrieved!.timestamp).toBe(node.timestamp);
          }
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("写入后 queryNodes 能按 type 过滤到对应节点", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, async nodes => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();

          await store.batchInsertNodes(nodes);

          for (const nodeType of [
            "source",
            "transformation",
            "decision",
          ] as const) {
            const expected = nodes.filter(n => n.type === nodeType);
            const results = await store.queryNodes({ type: nodeType });
            expect(results.length).toBe(expected.length);
          }
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 50 }
    );
  });

  it("写入后 getStats 的 totalNodes 等于写入数量", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, async nodes => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();

          await store.batchInsertNodes(nodes);

          const stats = await store.getStats();
          expect(stats.totalNodes).toBe(nodes.length);
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 50 }
    );
  });
});

// ─── P7: 过期清理正确性 ───────────────────────────────────────────────────
// **Validates: Requirements 4.5**

describe("P7: 过期清理正确性", () => {
  it("purgeExpired 后，所有 timestamp < beforeTimestamp 的节点不再可查询", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, arbTimestamp, async (nodes, cutoff) => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();

          await store.batchInsertNodes(nodes);
          await store.purgeExpired(cutoff);

          // 验证：所有过期节点不可查询
          for (const node of nodes) {
            const retrieved = await store.getNode(node.lineageId);
            if (node.timestamp < cutoff) {
              expect(retrieved).toBeUndefined();
            } else {
              expect(retrieved).toBeDefined();
              expect(retrieved!.lineageId).toBe(node.lineageId);
            }
          }

          // 验证：stats 中的 totalNodes 正确
          const expectedRemaining = nodes.filter(
            n => n.timestamp >= cutoff
          ).length;
          const stats = await store.getStats();
          expect(stats.totalNodes).toBe(expectedRemaining);
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("purgeExpired 返回值等于被删除的节点数", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, arbTimestamp, async (nodes, cutoff) => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();

          await store.batchInsertNodes(nodes);
          const purged = await store.purgeExpired(cutoff);

          const expectedPurged = nodes.filter(n => n.timestamp < cutoff).length;
          expect(purged).toBe(expectedPurged);
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("purgeExpired 后 queryNodes 时间范围查询不返回过期节点", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniqueNodes, arbTimestamp, async (nodes, cutoff) => {
        const tmpDir = makeTmpDir();
        try {
          const store = new JsonLineageStorage(tmpDir);
          store.init();

          await store.batchInsertNodes(nodes);
          await store.purgeExpired(cutoff);

          // 查询所有节点
          const allResults = await store.queryNodes({});
          for (const result of allResults) {
            expect(result.timestamp).toBeGreaterThanOrEqual(cutoff);
          }
        } finally {
          cleanDir(tmpDir);
        }
      }),
      { numRuns: 50 }
    );
  });
});
