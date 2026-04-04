/**
 * Unit tests for HeartbeatMonitor.
 *
 * Covers: heartbeat timeout → failMission, timer reset on event,
 *         timer clear on terminal state, hasHeartbeat, dispose.
 * Requirements: 6.3
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  HeartbeatMonitor,
  HEARTBEAT_TIMEOUT_MS,
} from "../core/execution-bridge.js";

// ─── Mock MissionRuntime ────────────────────────────────────────────────────

function createMockMissionRuntime() {
  return {
    failMission: vi.fn(),
  };
}

describe("HeartbeatMonitor", () => {
  let runtime: ReturnType<typeof createMockMissionRuntime>;
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    runtime = createMockMissionRuntime();
    monitor = new HeartbeatMonitor(runtime as any);
  });

  afterEach(() => {
    monitor.dispose();
    vi.useRealTimers();
  });

  it("calls failMission after 30s with no events", () => {
    monitor.startHeartbeat("m-1");

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);

    expect(runtime.failMission).toHaveBeenCalledOnce();
    expect(runtime.failMission).toHaveBeenCalledWith(
      "m-1",
      "Executor heartbeat timeout",
      "brain",
    );
  });

  it("does NOT call failMission before the timeout elapses", () => {
    monitor.startHeartbeat("m-1");

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1);

    expect(runtime.failMission).not.toHaveBeenCalled();
  });

  it("resets the timer when resetHeartbeat is called", () => {
    monitor.startHeartbeat("m-1");

    // Advance to just before timeout
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000);
    expect(runtime.failMission).not.toHaveBeenCalled();

    // Reset — timer restarts from zero
    monitor.resetHeartbeat("m-1");

    // Advance the original remaining 1s — should NOT fire because timer was reset
    vi.advanceTimersByTime(1000);
    expect(runtime.failMission).not.toHaveBeenCalled();

    // Advance the full timeout from the reset point
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000);
    expect(runtime.failMission).toHaveBeenCalledOnce();
  });

  it("clears the timer so failMission is never called", () => {
    monitor.startHeartbeat("m-1");

    monitor.clearHeartbeat("m-1");

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 2);

    expect(runtime.failMission).not.toHaveBeenCalled();
  });

  it("hasHeartbeat returns true while timer is active", () => {
    expect(monitor.hasHeartbeat("m-1")).toBe(false);

    monitor.startHeartbeat("m-1");
    expect(monitor.hasHeartbeat("m-1")).toBe(true);

    monitor.clearHeartbeat("m-1");
    expect(monitor.hasHeartbeat("m-1")).toBe(false);
  });

  it("hasHeartbeat returns false after timeout fires", () => {
    monitor.startHeartbeat("m-1");

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);

    expect(monitor.hasHeartbeat("m-1")).toBe(false);
  });

  it("dispose clears all active timers", () => {
    monitor.startHeartbeat("m-1");
    monitor.startHeartbeat("m-2");

    monitor.dispose();

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 2);

    expect(runtime.failMission).not.toHaveBeenCalled();
    expect(monitor.hasHeartbeat("m-1")).toBe(false);
    expect(monitor.hasHeartbeat("m-2")).toBe(false);
  });

  it("resetHeartbeat is a no-op for unknown missionId", () => {
    // Should not throw or create a new timer
    monitor.resetHeartbeat("unknown");

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);

    expect(runtime.failMission).not.toHaveBeenCalled();
    expect(monitor.hasHeartbeat("unknown")).toBe(false);
  });

  it("startHeartbeat replaces an existing timer for the same missionId", () => {
    monitor.startHeartbeat("m-1");

    // Advance halfway
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS / 2);

    // Start again — should replace the timer
    monitor.startHeartbeat("m-1");

    // Advance the original remaining half — should NOT fire
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS / 2);
    expect(runtime.failMission).not.toHaveBeenCalled();

    // Advance the rest from the second start
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS / 2);
    expect(runtime.failMission).toHaveBeenCalledOnce();
  });

  it("supports a custom timeout value", () => {
    const customMs = 5_000;
    const customMonitor = new HeartbeatMonitor(runtime as any, customMs);

    customMonitor.startHeartbeat("m-1");

    vi.advanceTimersByTime(customMs - 1);
    expect(runtime.failMission).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(runtime.failMission).toHaveBeenCalledOnce();

    customMonitor.dispose();
  });
});
