/**
 * Task 10: 模块入口与 Socket 事件 单元测试
 *
 * 覆盖:
 * - 10.1 server/lineage/index.ts 模块导出
 * - 10.2 shared/lineage/socket.ts Socket 事件常量
 * - 10.3 采集器 Socket 事件广播回调
 * - 10.4 数据保留定时清理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  DataLineageNode,
  ChangeAlert,
} from "../../shared/lineage/contracts.js";
import type { LineageStorageAdapter } from "../lineage/lineage-store.js";

// ─── Mock Store ────────────────────────────────────────────────────────────

function createMockStore(): LineageStorageAdapter & {
  insertedNodes: DataLineageNode[];
  purgeCalledWith: number[];
} {
  const insertedNodes: DataLineageNode[] = [];
  const purgeCalledWith: number[] = [];
  return {
    insertedNodes,
    purgeCalledWith,
    async batchInsertNodes(nodes) {
      insertedNodes.push(...nodes);
    },
    async batchInsertEdges() {},
    async getNode(id) {
      return insertedNodes.find(n => n.lineageId === id);
    },
    async queryNodes() {
      return [];
    },
    async queryEdges() {
      return [];
    },
    async purgeExpired(before) {
      purgeCalledWith.push(before);
      return 5;
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

// ─── 10.1 模块导出 ────────────────────────────────────────────────────────

describe("10.1 server/lineage/index.ts exports", () => {
  it("should export all services and utilities", async () => {
    const mod = await import("../lineage/index.js");

    expect(mod.JsonLineageStorage).toBeDefined();
    expect(mod.getRetentionDays).toBeDefined();
    expect(mod.LineageCollector).toBeDefined();
    expect(mod.LineageQueryService).toBeDefined();
    expect(mod.LineageAuditService).toBeDefined();
    expect(mod.ChangeDetectionService).toBeDefined();
    expect(mod.LineageExportService).toBeDefined();
    expect(mod.startRetentionCleanup).toBeDefined();
  });
});

// ─── 10.2 Socket 事件常量 ─────────────────────────────────────────────────

describe("10.2 shared/lineage/socket.ts", () => {
  it("should export LINEAGE_SOCKET_EVENTS with correct event names", async () => {
    const { LINEAGE_SOCKET_EVENTS } =
      await import("../../shared/lineage/socket.js");

    expect(LINEAGE_SOCKET_EVENTS.nodeCreated).toBe("lineage:node_created");
    expect(LINEAGE_SOCKET_EVENTS.alertTriggered).toBe(
      "lineage:alert_triggered"
    );
  });

  it("should be re-exported from shared/lineage/index.ts", async () => {
    const mod = await import("../../shared/lineage/index.js");
    expect(mod.LINEAGE_SOCKET_EVENTS).toBeDefined();
    expect(mod.LINEAGE_SOCKET_EVENTS.nodeCreated).toBe("lineage:node_created");
  });
});

// ─── 10.3 Socket 事件广播回调 ─────────────────────────────────────────────

describe("10.3 LineageCollector socket broadcast callbacks", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createMockStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should call onNodeCreated for each buffered node", async () => {
    const { LineageCollector } =
      await import("../lineage/lineage-collector.js");
    const createdNodes: DataLineageNode[] = [];

    const collector = new LineageCollector(store, {
      onNodeCreated: node => createdNodes.push(node),
    });

    collector.recordSource({ sourceId: "s1", sourceName: "S1" });
    collector.recordTransformation({
      agentId: "a1",
      operation: "filter",
      inputLineageIds: ["ln-1"],
    });

    expect(createdNodes).toHaveLength(2);
    expect(createdNodes[0].type).toBe("source");
    expect(createdNodes[1].type).toBe("transformation");

    collector.destroy();
  });

  it("should call onAlertTriggered via emitAlert()", async () => {
    const { LineageCollector } =
      await import("../lineage/lineage-collector.js");
    const alerts: ChangeAlert[] = [];

    const collector = new LineageCollector(store, {
      onAlertTriggered: alert => alerts.push(alert),
    });

    const alert: ChangeAlert = {
      id: "alert-1",
      type: "hash_mismatch",
      dataId: "data-1",
      previousHash: "aaa",
      currentHash: "bbb",
      affectedAgents: [],
      affectedDecisions: [],
      riskLevel: "medium",
      timestamp: Date.now(),
    };

    collector.emitAlert(alert);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("alert-1");

    collector.destroy();
  });

  it("should not throw if onNodeCreated callback throws", async () => {
    const { LineageCollector } =
      await import("../lineage/lineage-collector.js");

    const collector = new LineageCollector(store, {
      onNodeCreated: () => {
        throw new Error("callback error");
      },
    });

    // Should not throw
    const id = collector.recordSource({ sourceId: "s1", sourceName: "S1" });
    expect(id).toBeDefined();

    collector.destroy();
  });

  it("should not throw if onAlertTriggered callback throws", async () => {
    const { LineageCollector } =
      await import("../lineage/lineage-collector.js");

    const collector = new LineageCollector(store, {
      onAlertTriggered: () => {
        throw new Error("alert callback error");
      },
    });

    const alert: ChangeAlert = {
      id: "a1",
      type: "hash_mismatch",
      dataId: "d1",
      affectedAgents: [],
      affectedDecisions: [],
      riskLevel: "low",
      timestamp: Date.now(),
    };

    // Should not throw
    expect(() => collector.emitAlert(alert)).not.toThrow();

    collector.destroy();
  });

  it("should still work with legacy logger argument (backward compat)", async () => {
    const { LineageCollector } =
      await import("../lineage/lineage-collector.js");
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const collector = new LineageCollector(store, logger);
    collector.recordSource({ sourceId: "s1", sourceName: "S1" });

    expect(logger.debug).toHaveBeenCalledWith(
      "recordSource",
      expect.any(Object)
    );

    collector.destroy();
  });
});

// ─── 10.4 数据保留定时清理 ────────────────────────────────────────────────

describe("10.4 startRetentionCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should call purgeExpired on the store at the specified interval", async () => {
    const { startRetentionCleanup } = await import("../lineage/index.js");
    const store = createMockStore();

    const timer = startRetentionCleanup(store, 1000);

    // Advance 1 tick of the interval
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.purgeCalledWith.length).toBeGreaterThanOrEqual(1);

    // The cutoff should be roughly now - 90 days
    const cutoff = store.purgeCalledWith[0];
    const expectedCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    // Allow 2 second tolerance
    expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(2000);

    clearInterval(timer);
  });

  it("should use default 1-hour interval when not specified", async () => {
    const { startRetentionCleanup } = await import("../lineage/index.js");
    const store = createMockStore();

    const timer = startRetentionCleanup(store);

    // Advance less than 1 hour — should not trigger
    await vi.advanceTimersByTimeAsync(3_599_000);
    expect(store.purgeCalledWith).toHaveLength(0);

    // Advance past 1 hour total
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.purgeCalledWith.length).toBeGreaterThanOrEqual(1);

    clearInterval(timer);
  });

  it("should log when nodes are purged", async () => {
    const { startRetentionCleanup } = await import("../lineage/index.js");
    const store = createMockStore();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const timer = startRetentionCleanup(store, 500);

    await vi.advanceTimersByTimeAsync(500);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Lineage] Purged 5 expired nodes")
    );

    consoleSpy.mockRestore();
    clearInterval(timer);
  });
});
