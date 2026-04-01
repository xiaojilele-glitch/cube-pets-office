/**
 * 前端遥测 Zustand Store
 *
 * 服务端模式：通过 Socket.IO 实时接收 telemetry.update 事件 + REST 初始加载
 * 纯前端模式：从 IndexedDB 加载（Task 8 实现）
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";
import type {
  TelemetrySnapshot,
  MissionTelemetrySummary,
} from "@shared/telemetry";

export interface TelemetryState {
  snapshot: TelemetrySnapshot | null;
  history: MissionTelemetrySummary[];
  dashboardOpen: boolean;

  toggleDashboard: () => void;
  setSnapshot: (snapshot: TelemetrySnapshot) => void;
  setHistory: (history: MissionTelemetrySummary[]) => void;

  /** 注册 Socket.IO 监听，接收实时遥测更新 */
  initSocket: (socket: Socket) => void;

  /** 从 REST API 加载初始数据（服务端模式） */
  fetchInitial: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  snapshot: null,
  history: [],
  dashboardOpen: false,

  toggleDashboard: () =>
    set((state) => ({ dashboardOpen: !state.dashboardOpen })),

  setSnapshot: (snapshot) => set({ snapshot }),
  setHistory: (history) => set({ history }),

  initSocket: (socket) => {
    socket.on("telemetry.update", (snapshot: TelemetrySnapshot) => {
      set({ snapshot });
    });
  },

  fetchInitial: async () => {
    try {
      const [liveRes, historyRes] = await Promise.all([
        fetch("/api/telemetry/live"),
        fetch("/api/telemetry/history"),
      ]);
      if (liveRes.ok) {
        const snapshot: TelemetrySnapshot = await liveRes.json();
        set({ snapshot });
      }
      if (historyRes.ok) {
        const history: MissionTelemetrySummary[] = await historyRes.json();
        set({ history });
      }
    } catch (err) {
      console.warn("[TelemetryStore] Failed to fetch initial data:", err);
    }
  },
}));
