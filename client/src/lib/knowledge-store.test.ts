/**
 * Unit tests for knowledge-store.ts
 *
 * Tests the Zustand store actions: fetchGraph, fetchReviewQueue, setFilters,
 * selectEntity, reviewEntity, and subscribeToChanges (WebSocket).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Entity, ReviewAction } from "@shared/knowledge/types";
import { createDefaultFilterState } from "../components/knowledge/KnowledgeFilters";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entityId: "e-1",
    entityType: "CodeModule",
    name: "TestModule",
    description: "desc",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    source: "code_analysis",
    confidence: 0.9,
    projectId: "proj-1",
    status: "active",
    needsReview: false,
    linkedMemoryIds: [],
    extendedAttributes: {},
    ...overrides,
  };
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

describe("useKnowledgeStore", () => {
  // Re-import store fresh for each test to reset state
  let useKnowledgeStore: typeof import("./knowledge-store").useKnowledgeStore;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    const mod = await import("./knowledge-store");
    useKnowledgeStore = mod.useKnowledgeStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- initial state --------------------------------------------------------

  it("should have correct initial state", () => {
    const state = useKnowledgeStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
    expect(state.reviewQueue).toEqual([]);
    expect(state.selectedEntity).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.filters.status).toBe("active");
  });

  // -- fetchGraph -----------------------------------------------------------

  it("fetchGraph should populate nodes and edges", async () => {
    const entity = makeEntity();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, nodes: [entity], edges: [] }),
    });

    await useKnowledgeStore.getState().fetchGraph("proj-1");

    const state = useKnowledgeStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].entityId).toBe("e-1");
    expect(state.edges).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("fetchGraph should set loading during fetch", async () => {
    let resolvePromise: Function;
    fetchMock.mockReturnValueOnce(
      new Promise(resolve => {
        resolvePromise = resolve;
      })
    );

    const promise = useKnowledgeStore.getState().fetchGraph("proj-1");
    expect(useKnowledgeStore.getState().loading).toBe(true);

    resolvePromise!({
      ok: true,
      json: async () => ({ ok: true, nodes: [], edges: [] }),
    });
    await promise;

    expect(useKnowledgeStore.getState().loading).toBe(false);
  });

  it("fetchGraph should handle network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    await useKnowledgeStore.getState().fetchGraph("proj-1");

    expect(useKnowledgeStore.getState().loading).toBe(false);
    expect(useKnowledgeStore.getState().nodes).toEqual([]);
  });

  // -- fetchReviewQueue -----------------------------------------------------

  it("fetchReviewQueue should populate reviewQueue", async () => {
    const entity = makeEntity({ needsReview: true, confidence: 0.3 });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, items: [entity] }),
    });

    await useKnowledgeStore
      .getState()
      .fetchReviewQueue({ projectId: "proj-1" });

    expect(useKnowledgeStore.getState().reviewQueue).toHaveLength(1);
  });

  it("fetchReviewQueue should handle no filters", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, items: [] }),
    });

    await useKnowledgeStore.getState().fetchReviewQueue();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/knowledge/review-queue")
    );
  });

  // -- setFilters -----------------------------------------------------------

  it("setFilters should update filter state", () => {
    const newFilters = createDefaultFilterState();
    newFilters.confidenceMin = 0.5;
    newFilters.status = "deprecated";

    useKnowledgeStore.getState().setFilters(newFilters);

    const state = useKnowledgeStore.getState();
    expect(state.filters.confidenceMin).toBe(0.5);
    expect(state.filters.status).toBe("deprecated");
  });

  // -- selectEntity ---------------------------------------------------------

  it("selectEntity should set and clear selected entity", () => {
    const entity = makeEntity();

    useKnowledgeStore.getState().selectEntity(entity);
    expect(useKnowledgeStore.getState().selectedEntity?.entityId).toBe("e-1");

    useKnowledgeStore.getState().selectEntity(null);
    expect(useKnowledgeStore.getState().selectedEntity).toBeNull();
  });

  // -- reviewEntity ---------------------------------------------------------

  it("reviewEntity should update nodes and remove from reviewQueue", async () => {
    const entity = makeEntity({ needsReview: true, confidence: 0.3 });
    const approved = { ...entity, confidence: 0.8, needsReview: false };

    // Pre-populate state
    useKnowledgeStore.setState({
      nodes: [entity],
      reviewQueue: [entity],
      selectedEntity: entity,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, entity: approved }),
    });

    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "user-1",
      reviewerType: "human",
    };

    await useKnowledgeStore.getState().reviewEntity("e-1", action);

    const state = useKnowledgeStore.getState();
    expect(state.nodes[0].confidence).toBe(0.8);
    expect(state.reviewQueue).toHaveLength(0);
    expect(state.selectedEntity?.confidence).toBe(0.8);
  });

  it("reviewEntity should throw on API error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Entity not found" }),
    });

    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "user-1",
      reviewerType: "human",
    };

    await expect(
      useKnowledgeStore.getState().reviewEntity("e-999", action)
    ).rejects.toThrow("Entity not found");
  });

  // -- subscribeToChanges ---------------------------------------------------

  it("subscribeToChanges should add new entity on 'created'", () => {
    const socket = makeSocket();
    useKnowledgeStore.getState().subscribeToChanges(socket as any);

    const entity = makeEntity({ entityId: "e-new" });
    socket.emit("knowledge.entityChanged", { entity, action: "created" });

    expect(useKnowledgeStore.getState().nodes).toHaveLength(1);
    expect(useKnowledgeStore.getState().nodes[0].entityId).toBe("e-new");
  });

  it("subscribeToChanges should update existing entity on 'updated'", () => {
    const original = makeEntity();
    useKnowledgeStore.setState({ nodes: [original] });

    const socket = makeSocket();
    useKnowledgeStore.getState().subscribeToChanges(socket as any);

    const updated = { ...original, name: "UpdatedModule" };
    socket.emit("knowledge.entityChanged", {
      entity: updated,
      action: "updated",
    });

    expect(useKnowledgeStore.getState().nodes[0].name).toBe("UpdatedModule");
  });

  it("subscribeToChanges should remove entity on 'deleted'", () => {
    const entity = makeEntity();
    useKnowledgeStore.setState({ nodes: [entity], selectedEntity: entity });

    const socket = makeSocket();
    useKnowledgeStore.getState().subscribeToChanges(socket as any);

    socket.emit("knowledge.entityChanged", { entity, action: "deleted" });

    expect(useKnowledgeStore.getState().nodes).toHaveLength(0);
    expect(useKnowledgeStore.getState().selectedEntity).toBeNull();
  });

  it("subscribeToChanges should sync selectedEntity on update", () => {
    const entity = makeEntity();
    useKnowledgeStore.setState({ nodes: [entity], selectedEntity: entity });

    const socket = makeSocket();
    useKnowledgeStore.getState().subscribeToChanges(socket as any);

    const updated = { ...entity, confidence: 0.95 };
    socket.emit("knowledge.entityChanged", {
      entity: updated,
      action: "updated",
    });

    expect(useKnowledgeStore.getState().selectedEntity?.confidence).toBe(0.95);
  });
});
