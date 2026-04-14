/**
 * Sandbox Live Preview — Zustand store
 *
 * Manages real-time log lines, screenshot frames, and streaming state
 * for the sandbox monitor in the 3D scene.
 *
 * @see Requirements 4.1, 4.2, 4.3, 5.1, 5.3
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogLine {
  stepIndex: number;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

export interface ScreenshotFrame {
  stepIndex: number;
  imageData: string;
  width: number;
  height: number;
  timestamp: string;
}

export type SandboxFocusedPane = "terminal" | "task" | "browser";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_LINES = 500;
let sandboxSocket: Socket | null = null;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a log line for terminal display.
 * stderr lines are wrapped in ANSI red; stdout lines are returned as-is.
 */
export function formatLogLine(line: LogLine): string {
  if (line.stream === "stderr") {
    return `\x1b[31m${line.data}\x1b[0m`;
  }
  return line.data;
}

/**
 * Format an ISO 8601 timestamp to HH:MM:SS.
 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface SandboxStoreState {
  activeMissionId: string | null;
  logLines: LogLine[];
  latestScreenshot: ScreenshotFrame | null;
  previousScreenshot: ScreenshotFrame | null;
  isStreaming: boolean;
  fullscreen: boolean;
  focusedPane: SandboxFocusedPane | null;

  appendLog: (line: LogLine) => void;
  setLogHistory: (lines: LogLine[]) => void;
  updateScreenshot: (frame: ScreenshotFrame) => void;
  setActiveMission: (missionId: string | null) => void;
  requestLogHistory: (missionId?: string | null) => void;
  setFullscreen: (
    value: boolean,
    pane?: SandboxFocusedPane
  ) => void;
  setFocusedPane: (pane: SandboxFocusedPane | null) => void;
  reset: () => void;
  initSocket: (socket: Socket) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSandboxStore = create<SandboxStoreState>((set, get) => ({
  activeMissionId: null,
  logLines: [],
  latestScreenshot: null,
  previousScreenshot: null,
  isStreaming: false,
  fullscreen: false,
  focusedPane: null,

  appendLog: (line: LogLine) => {
    set(s => {
      const next = [...s.logLines, line];
      return {
        logLines:
          next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next,
        isStreaming: true,
      };
    });
  },

  setLogHistory: (lines: LogLine[]) => {
    set({
      logLines: lines.slice(-MAX_LOG_LINES),
      isStreaming: lines.length > 0,
    });
  },

  updateScreenshot: (frame: ScreenshotFrame) => {
    set(s => ({
      previousScreenshot: s.latestScreenshot,
      latestScreenshot: frame,
      isStreaming: true,
    }));
  },

  setActiveMission: (missionId: string | null) => {
    set({
      activeMissionId: missionId,
      logLines: [],
      latestScreenshot: null,
      previousScreenshot: null,
      isStreaming: false,
    });
    if (sandboxSocket && missionId) {
      sandboxSocket.emit("request_log_history", { missionId });
    }
  },

  requestLogHistory: missionId => {
    const targetMissionId = missionId ?? get().activeMissionId;
    if (!sandboxSocket || !targetMissionId) {
      return;
    }
    sandboxSocket.emit("request_log_history", {
      missionId: targetMissionId,
    });
  },

  setFullscreen: (value, pane = "terminal") => {
    set({
      fullscreen: value,
      focusedPane: value ? pane : null,
    });
  },

  setFocusedPane: pane => {
    set({
      focusedPane: pane,
      fullscreen: pane !== null,
    });
  },

  reset: () => {
    set({
      activeMissionId: null,
      logLines: [],
      latestScreenshot: null,
      previousScreenshot: null,
      isStreaming: false,
      fullscreen: false,
      focusedPane: null,
    });
  },

  initSocket: (socket: Socket) => {
    sandboxSocket = socket;
    socket.on("mission_log", (payload: LogLine & { missionId?: string }) => {
      const state = get();
      if (
        state.activeMissionId &&
        payload.missionId === state.activeMissionId
      ) {
        state.appendLog(payload);
      }
    });

    socket.on(
      "mission_screen",
      (payload: ScreenshotFrame & { missionId?: string }) => {
        const state = get();
        if (
          state.activeMissionId &&
          payload.missionId === state.activeMissionId
        ) {
          state.updateScreenshot(payload);
        }
      }
    );

    socket.on(
      "mission_log_history",
      (payload: { missionId?: string; lines?: LogLine[] }) => {
        const state = get();
        if (
          state.activeMissionId &&
          payload.missionId === state.activeMissionId &&
          payload.lines
        ) {
          state.setLogHistory(payload.lines);
        }
      }
    );

    // Request history on connect for active mission
    socket.on("connect", () => {
      get().requestLogHistory();
    });
  },
}));
