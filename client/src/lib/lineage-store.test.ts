/**
 * Unit tests for lineage-store.ts
 *
 * Tests the Zustand store: fetch actions, socket integration,
 * filter management, and node selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataLineageNode, LineageGraph } from "@shared/lineage/contracts";
import { LINEAGE_SOCKET_EVENTS } from "@shared/lineage/socket";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<DataLineageNode> = {}): DataLineageNode {
  return {
    lineageId: "node-1",
    type: "source",
    timestamp: Date.now(),
    context: {},
    ...overrides,
  };
}

function makeGraph(nodes: DataLineageNode[] = []): LineageGraph {
  return { nodes, edges: [] };
}

function makeSocket() {
  const handlers: Record<string, Function> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      handlers[event] = handler;
    }),
    emit: (event: string, data: unknown) => handlers[event]?.(data),
    _handlers: handlers,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLineageStore", () => {
  let useLineageStore: typeof import("./lineage-store").useLineageStore;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    const mod = await import("./lineage-store");
    useLineageStore = mod.useLineageStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- initial state --------------------------------------------------------

  it("should have correct initial state", () => {
    const state = useLineageStore.getState();
    expect(state.graph).toBeNull();
    expect(state.selectedNodeId).toBeNull();
    expect(state.filters).toEqual({});
    expect(state.loading).toBe(false);
    expect(state.impactResult).toBeNull();
    expect(state.alerts).toEqual([]);
  });

  // -- 11.1 fetchUpstream ---------------------------------------------------

  it("fetchUpstream should populate graph", async () => {
    const node = makeNode();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, graph: makeGraph([node]) }),
    });

    await useLineageStore.getState().fetchUpstream("data-1", 3);

    const state = useLineageStore.getState();
    expect(state.graph).not.toBeNull();
    expect(state.graph!.nodes).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/lineage/data-1/upstream"),
    );
  });

  it("fetchUpstream should set loading during fetch", async () => {
    let resolve: Function;
    fetchMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    const promise = useLineageStore.getState().fetchUpstream("data-1");
    expect(useLineageStore.getState().loading).toBe(true);

    resolve!({ ok: true, json: async () => ({ ok: true, graph: makeGraph() }) });
    await promise;
    expect(useLineageStore.getState().loading).toBe(false);
  });

  it("fetchUpstream should handle network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    await useLineageStore.getState().fetchUpstream("data-1");
    expect(useLineageStore.getState().loading).toBe(false);
    expect(useLineageStore.getState().graph).toBeNull();
  });

  // -- 11.1 fetchDownstream -------------------------------------------------

  it("fetchDownstream should populate graph", async () => {
    const node = makeNode({ lineageId: "node-2", type: "transformation" });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, graph: makeGraph([node]) }),
    });

    await useLineageStore.getState().fetchDownstream("data-1", 2);

    expect(useLineageStore.getState().graph!.nodes[0].lineageId).toBe("node-2");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/lineage/data-1/downstream"),
    );
  });

  // -- 11.1 fetchFullPath ---------------------------------------------------

  it("fetchFullPath should populate graph", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, graph: makeGraph([makeNode()]) }),
    });

    await useLineageStore.getState().fetchFullPath("src-1", "dec-1");

    expect(useLineageStore.getState().graph).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/lineage/path?sourceId=src-1&decisionId=dec-1"),
    );
  });

  // -- 11.1 fetchImpactAnalysis ---------------------------------------------

  it("fetchImpactAnalysis should populate impactResult", async () => {
    const result = {
      affectedNodes: [makeNode()],
      affectedDecisions: [],
      riskLevel: "low" as const,
      paths: makeGraph(),
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result }),
    });

    await useLineageStore.getState().fetchImpactAnalysis("data-1");

    expect(useLineageStore.getState().impactResult).toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/lineage/data-1/impact"),
    );
  });

  // -- 11.1 selectNode ------------------------------------------------------

  it("selectNode should set and clear selectedNodeId", () => {
    useLineageStore.getState().selectNode("node-1");
    expect(useLineageStore.getState().selectedNodeId).toBe("node-1");

    useLineageStore.getState().selectNode(null);
    expect(useLineageStore.getState().selectedNodeId).toBeNull();
  });

  // -- 11.2 Socket integration ----------------------------------------------

  it("initSocket should add new node on lineage:node_created", () => {
    const existingNode = makeNode({ lineageId: "existing" });
    useLineageStore.setState({ graph: makeGraph([existingNode]) });

    const socket = makeSocket();
    useLineageStore.getState().initSocket(socket as any);

    const newNode = makeNode({ lineageId: "new-node" });
    socket.emit(LINEAGE_SOCKET_EVENTS.nodeCreated, {
      node: newNode,
      issuedAt: Date.now(),
    });

    const graph = useLineageStore.getState().graph!;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1].lineageId).toBe("new-node");
  });

  it("initSocket should not duplicate existing node", () => {
    const node = makeNode({ lineageId: "existing" });
    useLineageStore.setState({ graph: makeGraph([node]) });

    const socket = makeSocket();
    useLineageStore.getState().initSocket(socket as any);

    socket.emit(LINEAGE_SOCKET_EVENTS.nodeCreated, {
      node,
      issuedAt: Date.now(),
    });

    expect(useLineageStore.getState().graph!.nodes).toHaveLength(1);
  });

  it("initSocket should ignore node_created when no graph loaded", () => {
    const socket = makeSocket();
    useLineageStore.getState().initSocket(socket as any);

    socket.emit(LINEAGE_SOCKET_EVENTS.nodeCreated, {
      node: makeNode(),
      issuedAt: Date.now(),
    });

    expect(useLineageStore.getState().graph).toBeNull();
  });

  it("initSocket should store alerts on lineage:alert_triggered", () => {
    const socket = makeSocket();
    useLineageStore.getState().initSocket(socket as any);

    const alert = {
      id: "alert-1",
      type: "hash_mismatch" as const,
      dataId: "data-1",
      affectedAgents: [],
      affectedDecisions: [],
      riskLevel: "high" as const,
      timestamp: Date.now(),
    };

    socket.emit(LINEAGE_SOCKET_EVENTS.alertTriggered, {
      alert,
      issuedAt: Date.now(),
    });

    expect(useLineageStore.getState().alerts).toHaveLength(1);
    expect(useLineageStore.getState().alerts[0].id).toBe("alert-1");
  });

  // -- 11.3 Filter management -----------------------------------------------

  it("setFilters should merge partial filters", () => {
    useLineageStore.getState().setFilters({ agentId: "agent-1" });
    expect(useLineageStore.getState().filters.agentId).toBe("agent-1");

    useLineageStore.getState().setFilters({ nodeType: "source" });
    const filters = useLineageStore.getState().filters;
    expect(filters.agentId).toBe("agent-1");
    expect(filters.nodeType).toBe("source");
  });

  it("setFilters should support timeRange filter", () => {
    useLineageStore.getState().setFilters({
      timeRange: { start: 1000, end: 2000 },
    });
    expect(useLineageStore.getState().filters.timeRange).toEqual({
      start: 1000,
      end: 2000,
    });
  });

  it("setFilters should support searchText filter", () => {
    useLineageStore.getState().setFilters({ searchText: "query" });
    expect(useLineageStore.getState().filters.searchText).toBe("query");
  });

  it("resetFilters should clear all filters", () => {
    useLineageStore.getState().setFilters({
      agentId: "agent-1",
      nodeType: "decision",
      sourceId: "src-1",
    });

    useLineageStore.getState().resetFilters();
    expect(useLineageStore.getState().filters).toEqual({});
  });
});
