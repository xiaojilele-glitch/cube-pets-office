import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  MissionTelemetrySummary,
  TelemetrySnapshot,
} from "@shared/telemetry";

import { fetchJsonSafe, type ApiRequestError } from "./api-client";

export interface TelemetryState {
  snapshot: TelemetrySnapshot | null;
  history: MissionTelemetrySummary[];
  dashboardOpen: boolean;
  loading: boolean;
  hasLoaded: boolean;
  error: ApiRequestError | null;

  toggleDashboard: () => void;
  setSnapshot: (snapshot: TelemetrySnapshot) => void;
  setHistory: (history: MissionTelemetrySummary[]) => void;
  initSocket: (socket: Socket) => void;
  fetchInitial: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  snapshot: null,
  history: [],
  dashboardOpen: false,
  loading: false,
  hasLoaded: false,
  error: null,

  toggleDashboard: () =>
    set(state => ({ dashboardOpen: !state.dashboardOpen })),

  setSnapshot: snapshot => set({ snapshot, error: null }),
  setHistory: history => set({ history }),

  initSocket: socket => {
    socket.on("telemetry.update", (snapshot: TelemetrySnapshot) => {
      set({ snapshot, error: null, hasLoaded: true });
    });
  },

  fetchInitial: async () => {
    set({ loading: true, error: null });

    try {
      const [liveResult, historyResult] = await Promise.all([
        fetchJsonSafe<TelemetrySnapshot>("/api/telemetry/live"),
        fetchJsonSafe<MissionTelemetrySummary[]>("/api/telemetry/history"),
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
}));
