/**
 * Cost observability Zustand store.
 *
 * Manages CostSnapshot, MissionCostSummary history, and dashboard visibility.
 * Integrates with Socket.IO for real-time cost.update / cost.alert events
 * and REST API for initial data loading, budget updates, and degradation release.
 *
 * In pure frontend mode (runtimeMode === "frontend"), the store reads from
 * IndexedDB via browser-cost-store instead of the REST API.
 *
 * @see Requirements 8.3, 12.1, 12.2, 12.3, 13.2
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  Budget,
  CostAlert,
  CostSnapshot,
  MissionCostSummary,
} from "@shared/cost";

import {
  computeBrowserCostSnapshot,
  saveBrowserBudget,
} from "./browser-cost-store";
import { useAppStore } from "./store";

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface CostState {
  snapshot: CostSnapshot | null;
  history: MissionCostSummary[];
  dashboardOpen: boolean;

  toggleDashboard: () => void;
  initSocket: (socket: Socket) => void;
  fetchInitial: () => Promise<void>;
  updateBudget: (budget: Partial<Budget>) => Promise<void>;
  releaseDegradation: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFrontendMode(): boolean {
  return useAppStore.getState().runtimeMode === "frontend";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCostStore = create<CostState>((set, get) => ({
  snapshot: null,
  history: [],
  dashboardOpen: false,

  toggleDashboard: () => set((s) => ({ dashboardOpen: !s.dashboardOpen })),

  initSocket: (socket: Socket) => {
    socket.on("cost.update", (snapshot: CostSnapshot) => {
      set({ snapshot });
    });

    socket.on("cost.alert", (alert: CostAlert) => {
      const current = get().snapshot;
      if (!current) return;

      // Merge the new alert into the existing snapshot alerts list,
      // replacing any alert with the same id.
      const existing = current.alerts.filter((a) => a.id !== alert.id);
      set({
        snapshot: {
          ...current,
          alerts: [...existing, alert],
        },
      });
    });
  },

  fetchInitial: async () => {
    if (isFrontendMode()) {
      // Pure frontend mode — load from IndexedDB
      try {
        const snapshot = await computeBrowserCostSnapshot();
        set({ snapshot, history: [] });
      } catch {
        // IndexedDB unavailable — keep current state
      }
      return;
    }

    try {
      const [liveRes, historyRes] = await Promise.all([
        fetch("/api/cost/live"),
        fetch("/api/cost/history"),
      ]);

      if (liveRes.ok) {
        const snapshot: CostSnapshot = await liveRes.json();
        set({ snapshot });
      }

      if (historyRes.ok) {
        const history: MissionCostSummary[] = await historyRes.json();
        set({ history });
      }
    } catch {
      // Network error — keep current state, dashboard will show stale/empty data
    }
  },

  updateBudget: async (budget: Partial<Budget>) => {
    const current = get().snapshot?.budget;
    const merged: Budget = {
      maxCost: budget.maxCost ?? current?.maxCost ?? 1.0,
      maxTokens: budget.maxTokens ?? current?.maxTokens ?? 100000,
      warningThreshold: budget.warningThreshold ?? current?.warningThreshold ?? 0.8,
    };

    if (isFrontendMode()) {
      // Pure frontend mode — persist to IndexedDB and recompute snapshot
      await saveBrowserBudget(merged);
      const snapshot = await computeBrowserCostSnapshot(merged);
      set({ snapshot });
      return;
    }

    const response = await fetch("/api/cost/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        (data as { error?: string }).error ?? `Budget update failed (${response.status})`
      );
    }

    // Refresh snapshot to pick up re-evaluated alerts / budget state
    await get().fetchInitial();
  },

  releaseDegradation: async () => {
    if (isFrontendMode()) {
      // No server-side degradation in frontend mode — just refresh snapshot
      await get().fetchInitial();
      return;
    }

    const response = await fetch("/api/cost/downgrade/release", {
      method: "POST",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        (data as { error?: string }).error ??
          `Degradation release failed (${response.status})`
      );
    }

    // Refresh snapshot to reflect updated downgrade level
    await get().fetchInitial();
  },
}));
