/**
 * 血缘采集器 属性测试 (Property-Based Testing)
 *
 * P5: computeHash(data) 对相同输入始终返回相同结果（确定性）
 * P6: 血缘采集失败不会抛出异常到调用方（降级保证）
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import fc from "fast-check";
import { LineageCollector } from "../lineage/lineage-collector.js";
import type { LineageStorageAdapter } from "../lineage/lineage-store.js";
import type { DataLineageNode, LineageOperation } from "../../shared/lineage/contracts.js";

// ─── Mock Store helpers ────────────────────────────────────────────────────

function createMockStore(): LineageStorageAdapter {
  return {
    async batchInsertNodes() {},
    async batchInsertEdges() {},
    async getNode() { return undefined; },
    async queryNodes() { return []; },
    async queryEdges() { return []; },
    async purgeExpired() { return 0; },
    async getStats() {
      return {
        totalNodes: 0, totalEdges: 0,
        nodesByType: { source: 0, transformation: 0, decision: 0 },
        oldestTimestamp: 0, newestTimestamp: 0,
      };
    },
  };
}

function createFailingStore(): LineageStorageAdapter {
  return {
    async batchInsertNodes() { throw new Error("Storage exploded"); },
    async batchInsertEdges() { throw new Error("Storage exploded"); },
    async getNode() { throw new Error("Storage exploded"); },
    async queryNodes() { throw new Error("Storage exploded"); },
    async queryEdges() { throw new Error("Storage exploded"); },
    async purgeExpired() { throw new Error("Storage exploded"); },
    async getStats() { throw new Error("Storage exploded"); },
  };
}

// ─── Arbitrary generators ──────────────────────────────────────────────────

/** Arbitrary JSON-serializable value */
const arbJsonValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)), { maxLength: 10 }),
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    { maxKeys: 10 },
  ),
);

const arbSourceId = fc.string({ minLength: 1, maxLength: 30 }).map(
  (s) => `src_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`,
);

const arbSourceName = fc.string({ minLength: 1, maxLength: 50 });

const arbAgentId = fc.string({ minLength: 1, maxLength: 20 }).map(
  (s) => `agent_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`,
);

const arbOperation: fc.Arbitrary<LineageOperation> = fc.constantFrom(
  "query", "filter", "aggregate", "join", "ml_inference",
  "transform", "enrich", "validate", "llm_call",
);

const arbLineageIds = fc.array(
  fc.uuid().map((u) => `ln_${u}`),
  { minLength: 0, maxLength: 5 },
);

const arbDecisionId = fc.string({ minLength: 1, maxLength: 20 }).map(
  (s) => `dec_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`,
);

const arbConfidence = fc.double({ min: 0, max: 1, noNaN: true });

// ─── P5: 哈希确定性 ───────────────────────────────────────────────────────
// **Validates: Requirements 1.3**

describe("P5: computeHash 确定性", () => {
  it("computeHash(data) 对相同输入始终返回相同结果", () => {
    fc.assert(
      fc.property(arbJsonValue, (data) => {
        const h1 = LineageCollector.computeHash(data);
        const h2 = LineageCollector.computeHash(data);
        expect(h1).toBe(h2);
      }),
      { numRuns: 200 },
    );
  });

  it("computeHash 始终返回 64 字符十六进制字符串", () => {
    fc.assert(
      fc.property(arbJsonValue, (data) => {
        const hash = LineageCollector.computeHash(data);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }),
      { numRuns: 200 },
    );
  });

  it("不同输入大概率产生不同哈希（碰撞概率极低）", () => {
    fc.assert(
      fc.property(arbJsonValue, arbJsonValue, (a, b) => {
        // Only check when inputs are actually different
        const jsonA = JSON.stringify(a);
        const jsonB = JSON.stringify(b);
        if (jsonA === jsonB) return; // skip identical inputs

        const hA = LineageCollector.computeHash(a);
        const hB = LineageCollector.computeHash(b);
        expect(hA).not.toBe(hB);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── P6: 采集失败降级保证 ─────────────────────────────────────────────────
// **Validates: Requirements 9.4**

describe("P6: 采集失败降级保证", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recordSource 在存储失败时不抛出异常，始终返回有效 UUID", () => {
    vi.useFakeTimers();
    fc.assert(
      fc.property(arbSourceId, arbSourceName, (sourceId, sourceName) => {
        const collector = new LineageCollector(createFailingStore());
        try {
          const id = collector.recordSource({ sourceId, sourceName });
          expect(typeof id).toBe("string");
          expect(id.length).toBeGreaterThan(0);
        } finally {
          collector.destroy();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("recordTransformation 在存储失败时不抛出异常，始终返回有效 UUID", () => {
    vi.useFakeTimers();
    fc.assert(
      fc.property(
        arbAgentId,
        arbOperation,
        arbLineageIds,
        (agentId, operation, inputLineageIds) => {
          const collector = new LineageCollector(createFailingStore());
          try {
            const id = collector.recordTransformation({
              agentId,
              operation,
              inputLineageIds,
            });
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
          } finally {
            collector.destroy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("recordDecision 在存储失败时不抛出异常，始终返回有效 UUID", () => {
    vi.useFakeTimers();
    fc.assert(
      fc.property(
        arbDecisionId,
        arbLineageIds,
        arbConfidence,
        (decisionId, inputLineageIds, confidence) => {
          const collector = new LineageCollector(createFailingStore());
          try {
            const id = collector.recordDecision({
              decisionId,
              inputLineageIds,
              confidence,
            });
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
          } finally {
            collector.destroy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("forceFlush 在存储失败时不抛出异常", async () => {
    vi.useFakeTimers();
    await fc.assert(
      fc.asyncProperty(arbSourceId, arbSourceName, async (sourceId, sourceName) => {
        const collector = new LineageCollector(createFailingStore());
        try {
          collector.recordSource({ sourceId, sourceName });
          // forceFlush triggers the failing store — should not throw
          await collector.forceFlush();
        } finally {
          collector.destroy();
        }
      }),
      { numRuns: 50 },
    );
  });
});
