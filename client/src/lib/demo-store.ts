/**
 * Demo 专属 Zustand Store
 *
 * 管理 Demo 模式特有的状态：记忆时间线、进化评分、回放状态。
 * 与 workflow-store / tasks-store 解耦，仅服务于演示引导体验层。
 *
 * @Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { create } from "zustand";

import type { PlaybackState } from "../runtime/demo-playback/engine";

// ---------------------------------------------------------------------------
// Local type definitions
// These mirror the types from demo-data-engine (client/src/runtime/demo-data/schema.ts)
// which may not yet exist. Once L01 is implemented, these can be replaced with
// re-exports from that module.
// ---------------------------------------------------------------------------

export type MemoryEntryKind = "short_term" | "medium_term" | "long_term";

export interface DemoMemoryEntry {
  agentId: string;
  kind: MemoryEntryKind;
  stage: string;
  content: string;
  /** 相对于演示开始时间的毫秒偏移 */
  timestampOffset: number;
}

export interface DemoEvolutionLog {
  agentId: string;
  dimension: string;
  oldScore: number;
  newScore: number;
  patchContent: string;
  applied: boolean;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface DemoState {
  isActive: boolean;
  playbackState: PlaybackState;
  memoryTimeline: DemoMemoryEntry[];
  evolutionLogs: DemoEvolutionLog[];
  currentStage: string | null;

  activate: () => void;
  deactivate: () => void;
  setPlaybackState: (state: PlaybackState) => void;
  appendMemoryEntry: (entry: DemoMemoryEntry) => void;
  setEvolutionLogs: (logs: DemoEvolutionLog[]) => void;
  setCurrentStage: (stage: string | null) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDemoStore = create<DemoState>(set => ({
  isActive: false,
  playbackState: "idle",
  memoryTimeline: [],
  evolutionLogs: [],
  currentStage: null,

  activate: () => set({ isActive: true }),

  deactivate: () => set({ isActive: false }),

  setPlaybackState: playbackState => set({ playbackState }),

  appendMemoryEntry: entry =>
    set(state => ({ memoryTimeline: [...state.memoryTimeline, entry] })),

  setEvolutionLogs: evolutionLogs => set({ evolutionLogs }),

  setCurrentStage: currentStage => set({ currentStage }),

  reset: () =>
    set({
      isActive: false,
      playbackState: "idle",
      memoryTimeline: [],
      evolutionLogs: [],
      currentStage: null,
    }),
}));
