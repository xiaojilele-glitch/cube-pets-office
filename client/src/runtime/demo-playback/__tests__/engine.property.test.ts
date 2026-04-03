/**
 * Property-based tests for DemoPlaybackEngine
 *
 * Uses fast-check to verify core invariants of the playback engine:
 * - Property 1: Events fire in non-decreasing timestampOffset order
 * - Property 2: Pause/resume produces identical event set as uninterrupted playback
 * - Property 3: Callback exceptions transition to 'failed' state with exactly one onError call
 *
 * @Requirements 3.2, 3.4, 3.5, 3.7
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type { DemoTimelineEntry, DemoDataBundle } from "@shared/demo/contracts";
import type { AgentEvent } from "@shared/workflow-runtime";
import { DemoPlaybackEngine, type PlaybackCallbacks } from "../engine";

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Generate a simple stage_change AgentEvent */
const arbAgentEvent: fc.Arbitrary<AgentEvent> = fc
  .record({
    workflowId: fc.string({ minLength: 1, maxLength: 8 }),
    stage: fc.constantFrom(
      "direction",
      "planning",
      "execution",
      "review",
      "summary",
      "evolution",
    ),
  })
  .map(({ workflowId, stage }) => ({
    type: "stage_change" as const,
    workflowId,
    stage,
  }));

/**
 * Generate a sorted array of DemoTimelineEntry (non-decreasing offsetMs).
 * We generate offsets independently then sort to guarantee ordering.
 */
const arbTimeline: fc.Arbitrary<DemoTimelineEntry[]> = fc
  .array(
    fc.record({
      offsetMs: fc.integer({ min: 0, max: 5000 }),
      event: arbAgentEvent,
    }),
    { minLength: 1, maxLength: 30 },
  )
  .map((entries) =>
    entries
      .sort((a, b) => a.offsetMs - b.offsetMs)
      .map((e) => ({ offsetMs: e.offsetMs, event: e.event })),
  );

/** Build a minimal DemoDataBundle from a timeline */
function makeBundle(timeline: DemoTimelineEntry[]): DemoDataBundle {
  return {
    version: 1,
    meta: {
      id: "test",
      title: "test",
      description: "test",
      createdAt: new Date().toISOString(),
      totalDurationMs: timeline.length > 0 ? timeline[timeline.length - 1].offsetMs : 0,
      locale: "en-US",
    },
    timeline,
    // Stub remaining required fields — engine only reads `timeline`
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function collectEvents(
  bundle: DemoDataBundle,
): { firedEntries: DemoTimelineEntry[]; stateChanges: string[]; errors: Error[] } {
  const firedEntries: DemoTimelineEntry[] = [];
  const stateChanges: string[] = [];
  const errors: Error[] = [];

  const callbacks: PlaybackCallbacks = {
    onEvent: (entry) => firedEntries.push(entry),
    onStateChange: (state) => stateChanges.push(state),
    onError: (err) => errors.push(err),
  };

  const engine = new DemoPlaybackEngine(bundle, callbacks);
  engine.start();

  // Advance fake timers past all scheduled events
  const maxOffset = bundle.timeline.length > 0
    ? bundle.timeline[bundle.timeline.length - 1].offsetMs
    : 0;
  vi.advanceTimersByTime(maxOffset + 100);

  engine.dispose();
  return { firedEntries, stateChanges, errors };
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
// Property 1: 事件按时间戳顺序发射
// **Validates: Requirements 3.2, 3.4**
// ---------------------------------------------------------------------------

describe("Property 1: 事件按时间戳顺序发射", () => {
  it("events fired by DemoPlaybackEngine are in non-decreasing timestampOffset order", () => {
    fc.assert(
      fc.property(arbTimeline, (timeline) => {
        const bundle = makeBundle(timeline);
        const { firedEntries } = collectEvents(bundle);

        // All events should have been fired
        expect(firedEntries).toHaveLength(timeline.length);

        // Verify non-decreasing offsetMs order
        for (let i = 1; i < firedEntries.length; i++) {
          if (firedEntries[i].offsetMs < firedEntries[i - 1].offsetMs) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: 暂停恢复不丢失不重复事件
// **Validates: Requirements 3.5**
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a pause point: an offsetMs value within the timeline range
 * plus a small delta to pause "during" that offset window.
 */
const arbPausePoint = (maxMs: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: Math.max(0, maxMs) });

describe("Property 2: 暂停恢复不丢失不重复事件", () => {
  it("pause then resume produces the exact same events as playing without pause", () => {
    fc.assert(
      fc.property(
        arbTimeline,
        fc.integer({ min: 0, max: 5000 }),
        (timeline, rawPauseAt) => {
          const bundle = makeBundle(timeline);
          const maxOffset = timeline.length > 0 ? timeline[timeline.length - 1].offsetMs : 0;
          // Clamp pause point within the timeline range
          const pauseAt = rawPauseAt % (maxOffset + 1);

          // --- Run 1: no pause (baseline) ---
          const baselineEntries: DemoTimelineEntry[] = [];
          const baselineCallbacks: PlaybackCallbacks = {
            onEvent: (entry) => baselineEntries.push(entry),
            onStateChange: () => {},
            onError: () => {},
          };

          const engine1 = new DemoPlaybackEngine(bundle, baselineCallbacks);
          engine1.start();
          vi.advanceTimersByTime(maxOffset + 100);
          engine1.dispose();

          // --- Run 2: with pause and resume ---
          const pausedEntries: DemoTimelineEntry[] = [];
          const pausedCallbacks: PlaybackCallbacks = {
            onEvent: (entry) => pausedEntries.push(entry),
            onStateChange: () => {},
            onError: () => {},
          };

          const engine2 = new DemoPlaybackEngine(bundle, pausedCallbacks);
          engine2.start();

          // Advance to the pause point
          vi.advanceTimersByTime(pauseAt);
          engine2.pause();

          // Wait a bit while paused (no events should fire)
          vi.advanceTimersByTime(500);

          engine2.resume();

          // Advance past all remaining events
          vi.advanceTimersByTime(maxOffset + 100);
          engine2.dispose();

          // --- Compare ---
          // Same number of events
          if (baselineEntries.length !== pausedEntries.length) return false;

          // Same events in same order
          for (let i = 0; i < baselineEntries.length; i++) {
            if (baselineEntries[i].offsetMs !== pausedEntries[i].offsetMs) return false;
            if (baselineEntries[i].event.type !== pausedEntries[i].event.type) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: 异常导致 failed 状态转换
// **Validates: Requirements 3.7**
// ---------------------------------------------------------------------------

describe("Property 3: 异常导致 failed 状态转换", () => {
  it("when onEvent throws, engine transitions to failed and onError is called exactly once", () => {
    fc.assert(
      fc.property(
        arbTimeline,
        fc.integer({ min: 0, max: 29 }),
        (timeline, rawThrowIndex) => {
          const bundle = makeBundle(timeline);
          // Pick which event index will throw
          const throwIndex = rawThrowIndex % timeline.length;

          let eventCount = 0;
          let errorCount = 0;
          let finalState: string | null = null;
          const receivedErrors: Error[] = [];

          const callbacks: PlaybackCallbacks = {
            onEvent: (_entry) => {
              if (eventCount === throwIndex) {
                eventCount++;
                throw new Error(`Intentional throw at index ${throwIndex}`);
              }
              eventCount++;
            },
            onStateChange: (state) => {
              finalState = state;
            },
            onError: (err) => {
              errorCount++;
              receivedErrors.push(err);
            },
          };

          const engine = new DemoPlaybackEngine(bundle, callbacks);
          engine.start();

          // Advance past all events
          const maxOffset = timeline.length > 0 ? timeline[timeline.length - 1].offsetMs : 0;
          vi.advanceTimersByTime(maxOffset + 100);

          const engineState = engine.getState();
          engine.dispose();

          // Engine must be in 'failed' state
          if (engineState !== "failed") return false;

          // onError must have been called exactly once
          if (errorCount !== 1) return false;

          // The error message should contain our intentional throw info
          if (!receivedErrors[0].message.includes("Intentional throw")) return false;

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
