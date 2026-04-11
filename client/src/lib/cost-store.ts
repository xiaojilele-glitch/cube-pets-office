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
import { fetchJsonSafe, type ApiRequestError } from "./api-client";
import { useAppStore } from "./store";

interface CostState {
  snapshot: CostSnapshot | null;
  history: MissionCostSummary[];
  dashboardOpen: boolean;
  loading: boolean;
  hasLoaded: boolean;
  error: ApiRequestError | null;

  toggleDashboard: () => void;
  initSocket: (socket: Socket) => void;
  fetchInitial: () => Promise<void>;
  updateBudget: (budget: Partial<Budget>) => Promise<void>;
  releaseDegradation: () => Promise<void>;
}

function isFrontendMode(): boolean {
  return useAppStore.getState().runtimeMode === "frontend";
}

function createStorageError(message: string, detail: string): ApiRequestError {
  return {
    kind: "demo",
    source: "storage",
    endpoint: "browser-cost-store",
    message,
    detail,
    retryable: true,
  };
}

export const useCostStore = create<CostState>((set, get) => ({
  snapshot: null,
  history: [],
  dashboardOpen: false,
  loading: false,
  hasLoaded: false,
  error: null,

  toggleDashboard: () =>
    set(state => ({ dashboardOpen: !state.dashboardOpen })),

  initSocket: (socket: Socket) => {
    socket.on("cost.update", (snapshot: CostSnapshot) => {
      set({ snapshot, error: null, hasLoaded: true });
    });

    socket.on("cost.alert", (alert: CostAlert) => {
      const current = get().snapshot;
      if (!current) return;

      const existing = current.alerts.filter(item => item.id !== alert.id);
      set({
        snapshot: {
          ...current,
          alerts: [...existing, alert],
        },
      });
    });
  },

  fetchInitial: async () => {
    set({ loading: true, error: null });

    try {
      if (isFrontendMode()) {
        try {
          const snapshot = await computeBrowserCostSnapshot();
          set({ snapshot, history: [], hasLoaded: true, error: null });
        } catch {
          set({
            hasLoaded: true,
            error: createStorageError(
              "Local cost metrics are unavailable right now.",
              "The browser preview could not read cached cost data. Retry after storage is available again."
            ),
          });
        }
        return;
      }

      const [liveResult, historyResult] = await Promise.all([
        fetchJsonSafe<CostSnapshot>("/api/cost/live"),
        fetchJsonSafe<MissionCostSummary[]>("/api/cost/history"),
      ]);

      if (liveResult.ok) {
        set({ snapshot: liveResult.data, hasLoaded: true, error: null });
      } else {
        set({
          hasLoaded: true,
          error: get().snapshot ? null : liveResult.error,
        });
      }

      if (historyResult.ok) {
        set({ history: historyResult.data });
      }
    } finally {
      set({ loading: false });
    }
  },

  updateBudget: async (budget: Partial<Budget>) => {
    const current = get().snapshot?.budget;
    const merged: Budget = {
      maxCost: budget.maxCost ?? current?.maxCost ?? 1,
      maxTokens: budget.maxTokens ?? current?.maxTokens ?? 100000,
      warningThreshold:
        budget.warningThreshold ?? current?.warningThreshold ?? 0.8,
    };

    if (isFrontendMode()) {
      try {
        await saveBrowserBudget(merged);
        const snapshot = await computeBrowserCostSnapshot(merged);
        set({ snapshot, error: null, hasLoaded: true });
        return;
      } catch {
        const error = createStorageError(
          "Budget settings could not be saved locally.",
          "The browser preview failed to persist the updated budget."
        );
        set({ error });
        throw new Error(error.message);
      }
    }

    const result = await fetchJsonSafe<Budget>("/api/cost/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    });

    if (!result.ok) {
      set({ error: result.error });
      throw new Error(result.error.message);
    }

    set({ error: null });
    await get().fetchInitial();
  },

  releaseDegradation: async () => {
    if (isFrontendMode()) {
      await get().fetchInitial();
      return;
    }

    const result = await fetchJsonSafe<{
      ok?: boolean;
      downgradeLevel?: string;
    }>("/api/cost/downgrade/release", {
      method: "POST",
    });

    if (!result.ok) {
      set({ error: result.error });
      throw new Error(result.error.message);
    }

    set({ error: null });
    await get().fetchInitial();
  },
}));
