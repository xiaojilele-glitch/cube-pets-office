/**
 * Data Lineage Tracking Zustand store.
 *
 * Manages lineage graph state, filters, impact analysis results,
 * and integrates with Socket.IO for real-time lineage events.
 *
 * @see Requirements AC-7.2 (filters), AC-5.1–AC-5.4 (queries)
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  LineageGraph,
  LineageFilters,
  ImpactAnalysisResult,
  ChangeAlert,
} from "@shared/lineage/contracts.js";
import { LINEAGE_SOCKET_EVENTS } from "@shared/lineage/socket.js";
import type {
  LineageNodeCreatedPayload,
  LineageAlertTriggeredPayload,
} from "@shared/lineage/socket.js";

// ---------------------------------------------------------------------------
// Default filters
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: LineageFilters = {};

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface LineageState {
  graph: LineageGraph | null;
  selectedNodeId: string | null;
  filters: LineageFilters;
  loading: boolean;
  impactResult: ImpactAnalysisResult | null;
  alerts: ChangeAlert[];

  fetchUpstream(dataId: string, depth?: number): Promise<void>;
  fetchDownstream(dataId: string, depth?: number): Promise<void>;
  fetchFullPath(sourceId: string, decisionId: string): Promise<void>;
  fetchImpactAnalysis(dataId: string): Promise<void>;
  selectNode(nodeId: string | null): void;
  setFilters(filters: Partial<LineageFilters>): void;
  resetFilters(): void;

  initSocket(socket: Socket): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLineageStore = create<LineageState>((set, get) => ({
  graph: null,
  selectedNodeId: null,
  filters: { ...DEFAULT_FILTERS },
  loading: false,
  impactResult: null,
  alerts: [],

  // ── Query actions ────────────────────────────────────────────────────────

  fetchUpstream: async (dataId: string, depth?: number) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (depth !== undefined) params.set("depth", String(depth));
      const res = await fetch(
        `/api/lineage/${encodeURIComponent(dataId)}/upstream?${params.toString()}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) set({ graph: data.graph });
    } catch {
      // network error — keep current state
    } finally {
      set({ loading: false });
    }
  },

  fetchDownstream: async (dataId: string, depth?: number) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (depth !== undefined) params.set("depth", String(depth));
      const res = await fetch(
        `/api/lineage/${encodeURIComponent(dataId)}/downstream?${params.toString()}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) set({ graph: data.graph });
    } catch {
      // network error — keep current state
    } finally {
      set({ loading: false });
    }
  },

  fetchFullPath: async (sourceId: string, decisionId: string) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams({ sourceId, decisionId });
      const res = await fetch(`/api/lineage/path?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) set({ graph: data.graph });
    } catch {
      // network error — keep current state
    } finally {
      set({ loading: false });
    }
  },

  fetchImpactAnalysis: async (dataId: string) => {
    set({ loading: true });
    try {
      const res = await fetch(
        `/api/lineage/${encodeURIComponent(dataId)}/impact`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) set({ impactResult: data.result });
    } catch {
      // network error — keep current state
    } finally {
      set({ loading: false });
    }
  },

  // ── Selection ────────────────────────────────────────────────────────────

  selectNode: (nodeId: string | null) => set({ selectedNodeId: nodeId }),

  // ── Filters (AC-7.2) ────────────────────────────────────────────────────

  setFilters: (filters: Partial<LineageFilters>) =>
    set((s) => ({ filters: { ...s.filters, ...filters } })),

  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  // ── Socket integration ──────────────────────────────────────────────────

  initSocket: (socket: Socket) => {
    socket.on(
      LINEAGE_SOCKET_EVENTS.nodeCreated,
      (payload: LineageNodeCreatedPayload) => {
        const { graph } = get();
        if (!graph) return;
        // Add the new node to the current graph if not already present
        const exists = graph.nodes.some(
          (n) => n.lineageId === payload.node.lineageId,
        );
        if (!exists) {
          set({
            graph: {
              ...graph,
              nodes: [...graph.nodes, payload.node],
            },
          });
        }
      },
    );

    socket.on(
      LINEAGE_SOCKET_EVENTS.alertTriggered,
      (payload: LineageAlertTriggeredPayload) => {
        set((s) => ({ alerts: [payload.alert, ...s.alerts] }));
      },
    );
  },
}));
