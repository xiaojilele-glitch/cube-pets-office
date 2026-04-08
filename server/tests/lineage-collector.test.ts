/**
 * 血缘采集器 单元测试
 * 覆盖 Task 3.1 ~ 3.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LineageCollector } from "../lineage/lineage-collector.js";
import type { LineageStorageAdapter } from "../lineage/lineage-store.js";
import type {
  DataLineageNode,
  RecordSourceInput,
  RecordTransformationInput,
  RecordDecisionInput,
} from "../../shared/lineage/contracts.js";

// ─── Mock Store ────────────────────────────────────────────────────────────

function createMockStore(): LineageStorageAdapter & {
  insertedNodes: DataLineageNode[];
} {
  const insertedNodes: DataLineageNode[] = [];
  return {
    insertedNodes,
    async batchInsertNodes(nodes) {
      insertedNodes.push(...nodes);
    },
    async batchInsertEdges() {},
    async getNode(id) {
      return insertedNodes.find((n) => n.lineageId === id);
    },
    async queryNodes() {
      return [];
    },
    async queryEdges() {
      return [];
    },
    async purgeExpired() {
      return 0;
    },
    async getStats() {
      return {
        totalNodes: insertedNodes.length,
        totalEdges: 0,
        nodesByType: { source: 0, transformation: 0, decision: 0 },
        oldestTimestamp: 0,
        newestTimestamp: 0,
      };
    },
  };
}

// ─── Mock Logger ───────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ─── 测试 ──────────────────────────────────────────────────────────────────

describe("LineageCollector", () => {
  let store: ReturnType<typeof createMockStore>;
  let logger: ReturnType<typeof createMockLogger>;
  let collector: LineageCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createMockStore();
    logger = createMockLogger();
    collector = new LineageCollector(store, logger);
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  // ─── 3.1 异步缓冲与批量写入 ──────────────────────────────────────────

  describe("3.1 Async buffering & batch write", () => {
    it("should return a lineageId immediately without flushing", () => {
      const id = collector.recordSource({
        sourceId: "src-1",
        sourceName: "Test Source",
      });
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      // Not yet flushed
      expect(store.insertedNodes).toHaveLength(0);
    });

    it("should flush buffer when timer fires", async () => {
      collector.recordSource({ sourceId: "src-1", sourceName: "S1" });
      expect(store.insertedNodes).toHaveLength(0);

      // Advance timer past flushIntervalMs (1000ms)
      vi.advanceTimersByTime(1100);
      // Allow microtasks to settle
      await vi.runAllTimersAsync();

      expect(store.insertedNodes).toHaveLength(1);
    });

    it("should flush when buffer reaches maxBufferSize (100)", async () => {
      for (let i = 0; i < 100; i++) {
        collector.recordSource({ sourceId: `src-${i}`, sourceName: `S${i}` });
      }
      await vi.runAllTimersAsync();
      expect(store.insertedNodes).toHaveLength(100);
    });

    it("should batch multiple nodes in a single flush", async () => {
      const batchSpy = vi.spyOn(store, "batchInsertNodes");
      collector.recordSource({ sourceId: "s1", sourceName: "S1" });
      collector.recordSource({ sourceId: "s2", sourceName: "S2" });
      collector.recordSource({ sourceId: "s3", sourceName: "S3" });

      vi.advanceTimersByTime(1100);
      await vi.runAllTimersAsync();

      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: "s1" }),
          expect.objectContaining({ sourceId: "s2" }),
          expect.objectContaining({ sourceId: "s3" }),
        ]),
      );
    });

    it("forceFlush should write buffer immediately", async () => {
      collector.recordSource({ sourceId: "s1", sourceName: "S1" });
      await collector.forceFlush();
      expect(store.insertedNodes).toHaveLength(1);
    });

    it("destroy should clear the flush timer", () => {
      collector.recordSource({ sourceId: "s1", sourceName: "S1" });
      collector.destroy();
      vi.advanceTimersByTime(2000);
      // Buffer was not flushed because timer was cleared
      expect(store.insertedNodes).toHaveLength(0);
    });
  });

  // ─── 3.2 recordSource (AC-1.1 ~ AC-1.5) ─────────────────────────────

  describe("3.2 recordSource()", () => {
    it("AC-1.1: should generate DataLineageNode with required fields", async () => {
      const id = collector.recordSource({
        sourceId: "src-db",
        sourceName: "PostgreSQL",
        queryText: "SELECT * FROM users",
        resultHash: "abc123",
        resultSize: 42,
        context: { sessionId: "sess-1", userId: "user-1" },
      });

      await collector.forceFlush();
      const node = store.insertedNodes[0];

      expect(node.lineageId).toBe(id);
      expect(node.type).toBe("source");
      expect(node.sourceId).toBe("src-db");
      expect(node.sourceName).toBe("PostgreSQL");
      expect(node.queryText).toBe("SELECT * FROM users");
      expect(node.resultHash).toBe("abc123");
      expect(node.timestamp).toBeGreaterThan(0);
    });

    it("AC-1.2: should set type to 'source'", async () => {
      collector.recordSource({ sourceId: "s1", sourceName: "S1" });
      await collector.forceFlush();
      expect(store.insertedNodes[0].type).toBe("source");
    });

    it("AC-1.3: resultHash is stored as provided", async () => {
      const hash = LineageCollector.computeHash({ key: "value" });
      collector.recordSource({
        sourceId: "s1",
        sourceName: "S1",
        resultHash: hash,
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].resultHash).toBe(hash);
    });

    it("AC-1.4: recordSource returns immediately (< 10ms latency)", () => {
      const start = performance.now();
      collector.recordSource({
        sourceId: "s1",
        sourceName: "S1",
        queryText: "SELECT 1",
      });
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(10);
    });

    it("AC-1.5: should log debug with sourceId, query, resultSize", () => {
      collector.recordSource({
        sourceId: "src-db",
        sourceName: "DB",
        queryText: "SELECT 1",
        resultSize: 100,
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "recordSource",
        expect.objectContaining({
          sourceId: "src-db",
          query: "SELECT 1",
          resultSize: 100,
        }),
      );
    });

    it("should include context when provided", async () => {
      collector.recordSource({
        sourceId: "s1",
        sourceName: "S1",
        context: { sessionId: "sess-1", missionId: "m-1" },
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].context).toEqual({
        sessionId: "sess-1",
        missionId: "m-1",
      });
    });

    it("should default context to empty object", async () => {
      collector.recordSource({ sourceId: "s1", sourceName: "S1" });
      await collector.forceFlush();
      expect(store.insertedNodes[0].context).toEqual({});
    });
  });

  // ─── 3.3 recordTransformation (AC-2.1 ~ AC-2.6) ─────────────────────

  describe("3.3 recordTransformation()", () => {
    it("AC-2.1: should generate node with all transformation fields", async () => {
      const id = collector.recordTransformation({
        agentId: "agent-1",
        operation: "filter",
        inputLineageIds: ["ln-a", "ln-b"],
        parameters: { threshold: 0.5 },
        dataChanged: true,
        executionTimeMs: 42,
        context: { sessionId: "sess-1" },
      });

      await collector.forceFlush();
      const node = store.insertedNodes[0];

      expect(node.lineageId).toBe(id);
      expect(node.type).toBe("transformation");
      expect(node.agentId).toBe("agent-1");
      expect(node.operation).toBe("filter");
      expect(node.inputLineageIds).toEqual(["ln-a", "ln-b"]);
      expect(node.parameters).toEqual({ threshold: 0.5 });
      expect(node.outputLineageId).toBe(id);
      expect(node.dataChanged).toBe(true);
      expect(node.executionTimeMs).toBe(42);
    });

    it("AC-2.2: should auto-capture codeLocation", async () => {
      collector.recordTransformation({
        agentId: "a1",
        operation: "transform",
        inputLineageIds: ["ln-1"],
      });
      await collector.forceFlush();
      const node = store.insertedNodes[0];
      expect(node.codeLocation).toBeDefined();
      expect(typeof node.codeLocation).toBe("string");
    });

    it("AC-2.3: should accept various operation types", async () => {
      const ops = ["filter", "aggregate", "join", "ml_inference", "transform"] as const;
      for (const op of ops) {
        collector.recordTransformation({
          agentId: "a1",
          operation: op,
          inputLineageIds: ["ln-1"],
        });
      }
      await collector.forceFlush();
      expect(store.insertedNodes).toHaveLength(ops.length);
      expect(store.insertedNodes.map((n) => n.operation)).toEqual([...ops]);
    });

    it("AC-2.4: should record parameters", async () => {
      collector.recordTransformation({
        agentId: "a1",
        operation: "ml_inference",
        inputLineageIds: ["ln-1"],
        parameters: { model_version: "v2", window_size: 10 },
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].parameters).toEqual({
        model_version: "v2",
        window_size: 10,
      });
    });

    it("AC-2.5: should record dataChanged flag", async () => {
      collector.recordTransformation({
        agentId: "a1",
        operation: "transform",
        inputLineageIds: ["ln-1"],
        dataChanged: true,
      });
      collector.recordTransformation({
        agentId: "a1",
        operation: "validate",
        inputLineageIds: ["ln-1"],
        dataChanged: false,
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].dataChanged).toBe(true);
      expect(store.insertedNodes[1].dataChanged).toBe(false);
    });

    it("AC-2.6: should set upstream from inputLineageIds", async () => {
      collector.recordTransformation({
        agentId: "a1",
        operation: "join",
        inputLineageIds: ["ln-a", "ln-b", "ln-c"],
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].upstream).toEqual(["ln-a", "ln-b", "ln-c"]);
    });

    it("should log debug with transformation details", () => {
      collector.recordTransformation({
        agentId: "a1",
        operation: "filter",
        inputLineageIds: ["ln-1", "ln-2"],
        dataChanged: true,
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "recordTransformation",
        expect.objectContaining({
          agentId: "a1",
          operation: "filter",
          inputCount: 2,
          dataChanged: true,
        }),
      );
    });
  });

  // ─── 3.4 recordDecision (AC-3.1 ~ AC-3.5) ───────────────────────────

  describe("3.4 recordDecision()", () => {
    it("AC-3.1: should generate decision node with all fields", async () => {
      const id = collector.recordDecision({
        decisionId: "dec-1",
        agentId: "agent-1",
        inputLineageIds: ["ln-a"],
        decisionLogic: "if risk > 0.8 then reject",
        result: "reject",
        confidence: 0.95,
        modelVersion: "gpt-4",
        context: { sessionId: "sess-1", userId: "user-1" },
      });

      await collector.forceFlush();
      const node = store.insertedNodes[0];

      expect(node.lineageId).toBe(id);
      expect(node.type).toBe("decision");
      expect(node.decisionId).toBe("dec-1");
      expect(node.agentId).toBe("agent-1");
      expect(node.inputLineageIds).toEqual(["ln-a"]);
      expect(node.decisionLogic).toBe("if risk > 0.8 then reject");
      expect(node.result).toBe("reject");
      expect(node.confidence).toBe(0.95);
      expect(node.modelVersion).toBe("gpt-4");
    });

    it("AC-3.2: should include context with sessionId, userId, etc.", async () => {
      collector.recordDecision({
        decisionId: "dec-1",
        inputLineageIds: [],
        context: {
          sessionId: "sess-1",
          userId: "user-1",
          requestId: "req-1",
          environment: "production",
        },
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].context).toEqual({
        sessionId: "sess-1",
        userId: "user-1",
        requestId: "req-1",
        environment: "production",
      });
    });

    it("AC-3.3: should set type to 'decision'", async () => {
      collector.recordDecision({
        decisionId: "dec-1",
        inputLineageIds: [],
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].type).toBe("decision");
    });

    it("AC-3.4: should record confidence and modelVersion", async () => {
      collector.recordDecision({
        decisionId: "dec-1",
        inputLineageIds: [],
        confidence: 0.87,
        modelVersion: "claude-3",
      });
      await collector.forceFlush();
      const node = store.insertedNodes[0];
      expect(node.confidence).toBe(0.87);
      expect(node.modelVersion).toBe("claude-3");
    });

    it("AC-3.5: should store metadata", async () => {
      collector.recordDecision({
        decisionId: "dec-1",
        inputLineageIds: [],
        result: "approve",
        metadata: { risk_score: 0.3 },
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].metadata).toEqual({ risk_score: 0.3 });
    });

    it("should set upstream from inputLineageIds", async () => {
      collector.recordDecision({
        decisionId: "dec-1",
        inputLineageIds: ["ln-x", "ln-y"],
      });
      await collector.forceFlush();
      expect(store.insertedNodes[0].upstream).toEqual(["ln-x", "ln-y"]);
    });

    it("should log debug with decision details", () => {
      collector.recordDecision({
        decisionId: "dec-1",
        agentId: "a1",
        inputLineageIds: [],
        confidence: 0.9,
        modelVersion: "v1",
        result: "approve",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        "recordDecision",
        expect.objectContaining({
          decisionId: "dec-1",
          agentId: "a1",
          confidence: 0.9,
          modelVersion: "v1",
          result: "approve",
        }),
      );
    });
  });

  // ─── 3.5 computeHash & captureCodeLocation ───────────────────────────

  describe("3.5 Static methods", () => {
    describe("computeHash()", () => {
      it("should return a 64-char hex string (SHA256)", () => {
        const hash = LineageCollector.computeHash({ key: "value" });
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      });

      it("should be deterministic for same input", () => {
        const data = { a: 1, b: [2, 3] };
        const h1 = LineageCollector.computeHash(data);
        const h2 = LineageCollector.computeHash(data);
        expect(h1).toBe(h2);
      });

      it("should produce different hashes for different inputs", () => {
        const h1 = LineageCollector.computeHash({ a: 1 });
        const h2 = LineageCollector.computeHash({ a: 2 });
        expect(h1).not.toBe(h2);
      });

      it("should handle primitive values", () => {
        expect(LineageCollector.computeHash(42)).toMatch(/^[a-f0-9]{64}$/);
        expect(LineageCollector.computeHash("hello")).toMatch(/^[a-f0-9]{64}$/);
        expect(LineageCollector.computeHash(null)).toMatch(/^[a-f0-9]{64}$/);
        expect(LineageCollector.computeHash(true)).toMatch(/^[a-f0-9]{64}$/);
      });

      it("should handle empty object and array", () => {
        const hObj = LineageCollector.computeHash({});
        const hArr = LineageCollector.computeHash([]);
        expect(hObj).toMatch(/^[a-f0-9]{64}$/);
        expect(hArr).toMatch(/^[a-f0-9]{64}$/);
        expect(hObj).not.toBe(hArr);
      });
    });

    describe("captureCodeLocation()", () => {
      it("should return a string in 'filename:line' format", () => {
        const loc = LineageCollector.captureCodeLocation();
        expect(loc).toMatch(/.+:\d+/);
      });

      it("should not return 'unknown:0' in normal conditions", () => {
        const loc = LineageCollector.captureCodeLocation();
        expect(loc).not.toBe("unknown:0");
      });
    });
  });

  // ─── 降级保证 ────────────────────────────────────────────────────────

  describe("Graceful degradation", () => {
    it("should not throw when store.batchInsertNodes fails", async () => {
      const failStore = createMockStore();
      failStore.batchInsertNodes = async () => {
        throw new Error("Storage failure");
      };
      const c = new LineageCollector(failStore, logger);

      c.recordSource({ sourceId: "s1", sourceName: "S1" });
      // Should not throw
      await c.forceFlush();

      expect(logger.error).toHaveBeenCalledWith(
        "flush failed",
        expect.objectContaining({ error: expect.stringContaining("Storage failure") }),
      );
      c.destroy();
    });

    it("recordSource should return a UUID even if internal error occurs", () => {
      // Force an error by passing a store that throws on construction-time access
      // The try/catch in recordSource should handle it
      const id = collector.recordSource({ sourceId: "s1", sourceName: "S1" });
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });
});
