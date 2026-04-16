/**
 * Collaboration Replay System — Zustand UI Store
 *
 * Manages replay UI state: active mission, engine instance, timeline,
 * selected event, fullscreen/demo/comparison modes, snapshots, and
 * analysis panel toggles.
 *
 * Requirements: 7.1, 14.1, 14.2, 14.3, 17.1
 */

import { create } from "zustand";

import type {
  ExecutionTimeline,
  ReplaySnapshot,
  PlaybackSpeed,
  ReplayFilters,
} from "../../../../shared/replay/contracts";
import { ReplayEngine } from "./replay-engine";
import { BrowserReplayStore } from "./browser-replay-store";

/* ─── Store Interface ─── */

export interface ReplayUIState {
  // Replay core
  missionId: string | null;
  engine: ReplayEngine | null;
  timeline: ExecutionTimeline | null;

  // UI state
  selectedEventId: string | null;
  isFullscreen: boolean;
  isDemoMode: boolean;
  isComparisonMode: boolean;
  comparisonMissionId: string | null;

  // Snapshots
  snapshots: ReplaySnapshot[];

  // Analysis panel toggles
  showCostTracker: boolean;
  showPerformance: boolean;
  showDataLineage: boolean;
  showPermissionAudit: boolean;

  // Actions
  loadReplay: (missionId: string) => Promise<void>;
  selectEvent: (eventId: string | null) => void;
  createSnapshot: (label: string, note?: string) => void;
  jumpToSnapshot: (snapshotId: string) => void;
  toggleDemoMode: () => void;
  toggleFullscreen: () => void;
  startComparison: (missionId: string) => void;
  stopComparison: () => void;
  togglePanel: (
    panel: "costTracker" | "performance" | "dataLineage" | "permissionAudit"
  ) => void;
  reset: () => void;
}

/* ─── Shared store instance (lazy) ─── */

let _browserStore: BrowserReplayStore | null = null;
function getBrowserStore(): BrowserReplayStore {
  if (!_browserStore) _browserStore = new BrowserReplayStore();
  return _browserStore;
}

/* ─── Initial state (for reset) ─── */

const INITIAL_STATE = {
  missionId: null as string | null,
  engine: null as ReplayEngine | null,
  timeline: null as ExecutionTimeline | null,
  selectedEventId: null as string | null,
  isFullscreen: false,
  isDemoMode: false,
  isComparisonMode: false,
  comparisonMissionId: null as string | null,
  snapshots: [] as ReplaySnapshot[],
  showCostTracker: false,
  showPerformance: false,
  showDataLineage: false,
  showPermissionAudit: false,
};

/* ─── Store ─── */

export const useReplayStore = create<ReplayUIState>((set, get) => ({
  ...INITIAL_STATE,

  /* ── Load a mission replay ── */
  async loadReplay(missionId: string) {
    // Stop any existing engine
    const prev = get().engine;
    if (prev) {
      try {
        prev.stop();
      } catch {
        /* ignore if already stopped */
      }
    }

    const store = getBrowserStore();
    const timeline = await store.getTimeline(missionId);
    const engine = new ReplayEngine(timeline);

    set({
      missionId,
      engine,
      timeline,
      selectedEventId: null,
      snapshots: [],
    });
  },

  /* ── Select / deselect an event ── */
  selectEvent(eventId: string | null) {
    set({ selectedEventId: eventId });
  },

  /* ── Create a snapshot of the current replay state ── */
  createSnapshot(label: string, note?: string) {
    const { engine, missionId, snapshots } = get();
    if (!engine || !missionId) return;

    const engineState = engine.getState();
    const snapshot: ReplaySnapshot = {
      snapshotId: crypto.randomUUID(),
      missionId,
      timestamp: engineState.currentTime,
      createdAt: Date.now(),
      label,
      note,
      version: snapshots.length + 1,
      state: {
        eventCursorIndex: engineState.currentEventIndex,
        filters: engineState.filters,
        cameraPosition: [0, 5, 10],
        cameraTarget: [0, 0, 0],
        speed: engineState.speed,
      },
    };

    set({ snapshots: [...snapshots, snapshot] });
  },

  /* ── Jump to a previously saved snapshot ── */
  jumpToSnapshot(snapshotId: string) {
    const { engine, snapshots } = get();
    if (!engine) return;

    const snapshot = snapshots.find(s => s.snapshotId === snapshotId);
    if (!snapshot) return;

    engine.seek(snapshot.timestamp);
    engine.setSpeed(snapshot.state.speed);
    engine.setFilters(snapshot.state.filters);

    set({ selectedEventId: null });
  },

  /* ── Toggle demo mode (simplified UI for teaching) ── */
  toggleDemoMode() {
    set(s => ({ isDemoMode: !s.isDemoMode }));
  },

  /* ── Toggle fullscreen ── */
  toggleFullscreen() {
    set(s => ({ isFullscreen: !s.isFullscreen }));
  },

  /* ── Start comparison with another mission ── */
  startComparison(missionId: string) {
    set({ isComparisonMode: true, comparisonMissionId: missionId });
  },

  /* ── Stop comparison mode ── */
  stopComparison() {
    set({ isComparisonMode: false, comparisonMissionId: null });
  },

  /* ── Toggle analysis panels ── */
  togglePanel(panel) {
    const keyMap = {
      costTracker: "showCostTracker",
      performance: "showPerformance",
      dataLineage: "showDataLineage",
      permissionAudit: "showPermissionAudit",
    } as const;
    const key = keyMap[panel];
    set(s => ({ [key]: !s[key] }) as Partial<ReplayUIState>);
  },

  /* ── Reset store to initial state ── */
  reset() {
    const prev = get().engine;
    if (prev) {
      try {
        prev.stop();
      } catch {
        /* ignore */
      }
    }
    set({ ...INITIAL_STATE, snapshots: [] });
  },
}));
