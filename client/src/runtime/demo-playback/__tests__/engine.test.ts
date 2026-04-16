/**
 * Unit tests for DemoPlaybackEngine
 *
 * Covers lifecycle, state transitions, empty timeline, rapid pause/resume,
 * stop, and dispose behaviors.
 *
 * @Requirements 3.1, 3.3, 3.6
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DemoTimelineEntry, DemoDataBundle } from "@shared/demo/contracts";
import type { AgentEvent } from "@shared/workflow-runtime";
import { DemoPlaybackEngine, type PlaybackCallbacks } from "../engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(offsetMs: number, stage = "direction"): DemoTimelineEntry {
  return {
    offsetMs,
    event: {
      type: "stage_change",
      workflowId: "wf-test",
      stage,
    } as AgentEvent,
  };
}

function makeBundle(timeline: DemoTimelineEntry[]): DemoDataBundle {
  return {
    version: 1,
    meta: {
      id: "test",
      title: "test",
      description: "test",
      createdAt: new Date().toISOString(),
      totalDurationMs:
        timeline.length > 0 ? timeline[timeline.length - 1].offsetMs : 0,
      locale: "en-US",
    },
    timeline,
    workflow: {} as any,
    organization: {} as any,
    agents: [],
    tasks: [],
    messages: [],
    finalReport: {} as any,
    evolutionPatches: [],
    capabilities: [],
  };
}

function makeCallbacks(overrides: Partial<PlaybackCallbacks> = {}): {
  callbacks: PlaybackCallbacks;
  firedEntries: DemoTimelineEntry[];
  stateChanges: string[];
  errors: Error[];
} {
  const firedEntries: DemoTimelineEntry[] = [];
  const stateChanges: string[] = [];
  const errors: Error[] = [];

  const callbacks: PlaybackCallbacks = {
    onEvent: overrides.onEvent ?? (entry => firedEntries.push(entry)),
    onStateChange:
      overrides.onStateChange ?? (state => stateChanges.push(state)),
    onError: overrides.onError ?? (err => errors.push(err)),
  };

  return { callbacks, firedEntries, stateChanges, errors };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. start() transitions state to 'playing'
// **Validates: Requirements 3.1**
// ---------------------------------------------------------------------------

describe("start() state transition", () => {
  it("transitions state to 'playing' and fires onStateChange", () => {
    const timeline = [makeEvent(100), makeEvent(200)];
    const bundle = makeBundle(timeline);
    const { callbacks, stateChanges } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    expect(engine.getState()).toBe("idle");

    engine.start();

    expect(engine.getState()).toBe("playing");
    expect(stateChanges).toContain("playing");

    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// 2. All events played → state transitions to 'completed'
// **Validates: Requirements 3.3, 3.6**
// ---------------------------------------------------------------------------

describe("completed state after all events", () => {
  it("transitions to 'completed' after all events fire", () => {
    const timeline = [makeEvent(50), makeEvent(100), makeEvent(200)];
    const bundle = makeBundle(timeline);
    const { callbacks, firedEntries, stateChanges } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();

    // Advance past all events
    vi.advanceTimersByTime(300);

    expect(engine.getState()).toBe("completed");
    expect(firedEntries).toHaveLength(3);
    expect(stateChanges).toContain("playing");
    expect(stateChanges).toContain("completed");

    engine.dispose();
  });

  it("fires onEvent for every timeline entry in order", () => {
    const timeline = [
      makeEvent(0, "direction"),
      makeEvent(100, "planning"),
      makeEvent(200, "execution"),
    ];
    const bundle = makeBundle(timeline);
    const { callbacks, firedEntries } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();
    vi.advanceTimersByTime(300);

    expect(firedEntries.map(e => e.event)).toEqual(timeline.map(e => e.event));

    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// 3. Empty event sequence → completed immediately
// **Validates: Requirements 3.6**
// ---------------------------------------------------------------------------

describe("empty timeline playback", () => {
  it("transitions to 'completed' immediately when timeline is empty", () => {
    const bundle = makeBundle([]);
    const { callbacks, stateChanges, firedEntries } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();

    expect(engine.getState()).toBe("completed");
    expect(stateChanges).toEqual(["playing", "completed"]);
    expect(firedEntries).toHaveLength(0);

    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// 4. Rapid consecutive pause/resume operations
// **Validates: Requirements 3.1, 3.3**
// ---------------------------------------------------------------------------

describe("rapid pause/resume", () => {
  it("correctly fires all events after rapid pause/resume cycles", () => {
    const timeline = [
      makeEvent(100, "direction"),
      makeEvent(200, "planning"),
      makeEvent(300, "execution"),
      makeEvent(400, "review"),
    ];
    const bundle = makeBundle(timeline);
    const { callbacks, firedEntries, stateChanges } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();

    // Advance to fire first event
    vi.advanceTimersByTime(150);
    expect(firedEntries).toHaveLength(1);

    // Rapid pause → resume → pause → resume
    engine.pause();
    expect(engine.getState()).toBe("paused");

    engine.resume();
    expect(engine.getState()).toBe("playing");

    engine.pause();
    expect(engine.getState()).toBe("paused");

    engine.resume();
    expect(engine.getState()).toBe("playing");

    // Advance past all remaining events
    vi.advanceTimersByTime(500);

    expect(firedEntries).toHaveLength(4);
    expect(engine.getState()).toBe("completed");

    // Verify state change sequence includes all transitions
    expect(stateChanges).toContain("playing");
    expect(stateChanges).toContain("paused");
    expect(stateChanges).toContain("completed");

    engine.dispose();
  });

  it("does not fire events while paused", () => {
    const timeline = [makeEvent(100), makeEvent(200)];
    const bundle = makeBundle(timeline);
    const { callbacks, firedEntries } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();

    // Advance to fire first event, then pause
    vi.advanceTimersByTime(150);
    expect(firedEntries).toHaveLength(1);

    engine.pause();

    // Advance a long time while paused — no new events should fire
    vi.advanceTimersByTime(1000);
    expect(firedEntries).toHaveLength(1);

    // Resume and advance to fire remaining
    engine.resume();
    vi.advanceTimersByTime(300);
    expect(firedEntries).toHaveLength(2);

    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// 5. stop() resets state to 'idle'
// **Validates: Requirements 3.1**
// ---------------------------------------------------------------------------

describe("stop()", () => {
  it("resets state to idle and prevents further events", () => {
    const timeline = [makeEvent(100), makeEvent(200), makeEvent(300)];
    const bundle = makeBundle(timeline);
    const { callbacks, firedEntries, stateChanges } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();

    vi.advanceTimersByTime(150);
    expect(firedEntries).toHaveLength(1);

    engine.stop();
    expect(engine.getState()).toBe("idle");
    expect(stateChanges).toContain("idle");

    // Advance more — no additional events should fire
    vi.advanceTimersByTime(500);
    expect(firedEntries).toHaveLength(1);

    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// 6. dispose() cleans up
// **Validates: Requirements 3.1**
// ---------------------------------------------------------------------------

describe("dispose()", () => {
  it("cleans up and sets state to idle", () => {
    const timeline = [makeEvent(100), makeEvent(200)];
    const bundle = makeBundle(timeline);
    const { callbacks, firedEntries } = makeCallbacks();

    const engine = new DemoPlaybackEngine(bundle, callbacks);
    engine.start();

    vi.advanceTimersByTime(50);
    engine.dispose();

    expect(engine.getState()).toBe("idle");

    // No more events fire after dispose
    vi.advanceTimersByTime(500);
    expect(firedEntries).toHaveLength(0);
  });
});
