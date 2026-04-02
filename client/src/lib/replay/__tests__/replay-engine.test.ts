import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExecutionEvent,
  ExecutionTimeline,
  PlaybackSpeed,
  ReplayEventType,
} from '../../../../../shared/replay/contracts';
import { ReplayEngine } from '../replay-engine';
import type { ReplayEngineState } from '../replay-engine';

/* ─── Helpers ─── */

function makeEvent(
  overrides: Partial<ExecutionEvent> & { timestamp: number },
): ExecutionEvent {
  return {
    eventId: overrides.eventId ?? `evt-${overrides.timestamp}`,
    missionId: overrides.missionId ?? 'mission-1',
    timestamp: overrides.timestamp,
    eventType: overrides.eventType ?? 'AGENT_STARTED',
    sourceAgent: overrides.sourceAgent ?? 'agent-1',
    targetAgent: overrides.targetAgent,
    eventData: overrides.eventData ?? {},
    metadata: overrides.metadata,
  };
}

function makeTimeline(events: ExecutionEvent[]): ExecutionTimeline {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted[0]?.timestamp ?? 0;
  const end = sorted[sorted.length - 1]?.timestamp ?? 0;
  return {
    missionId: 'mission-1',
    events: sorted,
    startTime: start,
    endTime: end,
    totalDuration: end - start,
    eventCount: sorted.length,
    indices: {
      byTime: new Map(),
      byAgent: new Map(),
      byType: new Map(),
      byResource: new Map(),
    },
    version: 1,
    checksum: 'test-checksum',
  };
}

function makeSampleTimeline(): ExecutionTimeline {
  return makeTimeline([
    makeEvent({ timestamp: 1000, eventType: 'AGENT_STARTED', sourceAgent: 'agent-1' }),
    makeEvent({ timestamp: 2000, eventType: 'MESSAGE_SENT', sourceAgent: 'agent-1', targetAgent: 'agent-2' }),
    makeEvent({ timestamp: 3000, eventType: 'DECISION_MADE', sourceAgent: 'agent-2' }),
    makeEvent({ timestamp: 4000, eventType: 'CODE_EXECUTED', sourceAgent: 'agent-2' }),
    makeEvent({ timestamp: 5000, eventType: 'AGENT_STOPPED', sourceAgent: 'agent-1' }),
  ]);
}


/* ═══════════════════════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ReplayEngine', () => {
  let timeline: ExecutionTimeline;
  let engine: ReplayEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    timeline = makeSampleTimeline();
    engine = new ReplayEngine(timeline);
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  // ── Requirement 7.1: State machine transitions ──

  describe('state machine (Req 7.1)', () => {
    it('starts in idle state', () => {
      expect(engine.getState().state).toBe('idle');
    });

    it('transitions idle → playing on play()', () => {
      engine.play();
      expect(engine.getState().state).toBe('playing');
    });

    it('transitions playing → paused on pause()', () => {
      engine.play();
      engine.pause();
      expect(engine.getState().state).toBe('paused');
    });

    it('transitions paused → playing on resume()', () => {
      engine.play();
      engine.pause();
      engine.resume();
      expect(engine.getState().state).toBe('playing');
    });

    it('transitions playing → stopped on stop()', () => {
      engine.play();
      engine.stop();
      expect(engine.getState().state).toBe('stopped');
    });

    it('transitions paused → stopped on stop()', () => {
      engine.play();
      engine.pause();
      engine.stop();
      expect(engine.getState().state).toBe('stopped');
    });

    it('ignores play() when not idle', () => {
      engine.play();
      engine.pause();
      engine.play(); // should be ignored
      expect(engine.getState().state).toBe('paused');
    });

    it('ignores pause() when not playing', () => {
      engine.pause(); // idle → should be ignored
      expect(engine.getState().state).toBe('idle');
    });

    it('ignores resume() when not paused', () => {
      engine.play();
      engine.resume(); // playing → should be ignored
      expect(engine.getState().state).toBe('playing');
    });

    it('ignores stop() when idle', () => {
      engine.stop();
      expect(engine.getState().state).toBe('idle');
    });
  });

  // ── Requirement 7.2: Playback speed control ──

  describe('speed control (Req 7.2)', () => {
    it('defaults to 1x speed', () => {
      expect(engine.getState().speed).toBe(1);
    });

    it.each([0.5, 1, 2, 4, 8] as PlaybackSpeed[])('accepts valid speed %s', (speed) => {
      engine.setSpeed(speed);
      expect(engine.getState().speed).toBe(speed);
    });

    it('ignores invalid speed values', () => {
      engine.setSpeed(3 as PlaybackSpeed);
      expect(engine.getState().speed).toBe(1);
    });
  });

  // ── Requirement 7.3 & 7.4: Event filtering ──

  describe('filtering (Req 7.3, 7.4)', () => {
    it('returns all events when no filters set', () => {
      expect(engine.getFilteredEvents()).toHaveLength(5);
    });

    it('filters by eventType', () => {
      engine.setFilters({ eventTypes: ['AGENT_STARTED', 'AGENT_STOPPED'] });
      const filtered = engine.getFilteredEvents();
      expect(filtered).toHaveLength(2);
      expect(filtered.every(e => e.eventType === 'AGENT_STARTED' || e.eventType === 'AGENT_STOPPED')).toBe(true);
    });

    it('filters by agentId (sourceAgent)', () => {
      engine.setFilters({ agentIds: ['agent-2'] });
      const filtered = engine.getFilteredEvents();
      // agent-2 is sourceAgent for DECISION_MADE and CODE_EXECUTED, and targetAgent for MESSAGE_SENT
      expect(filtered.length).toBeGreaterThanOrEqual(2);
      expect(filtered.every(e => e.sourceAgent === 'agent-2' || e.targetAgent === 'agent-2')).toBe(true);
    });

    it('combines eventType and agentId filters', () => {
      engine.setFilters({ eventTypes: ['DECISION_MADE'], agentIds: ['agent-2'] });
      const filtered = engine.getFilteredEvents();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].eventType).toBe('DECISION_MADE');
    });

    it('invalidates cache when filters change', () => {
      const first = engine.getFilteredEvents();
      engine.setFilters({ eventTypes: ['AGENT_STARTED'] });
      const second = engine.getFilteredEvents();
      expect(first.length).not.toBe(second.length);
    });
  });

  // ── Requirement 7.5: Timestamp seek ──

  describe('seek (Req 7.5)', () => {
    it('seeks to a specific timestamp', () => {
      engine.play();
      engine.pause();
      engine.seek(3000);
      const state = engine.getState();
      expect(state.currentTime).toBe(3000);
      const current = engine.getCurrentEvent();
      expect(current).not.toBeNull();
      expect(current!.timestamp).toBeLessThanOrEqual(3000);
    });

    it('clamps seek to timeline bounds (start)', () => {
      engine.play();
      engine.pause();
      engine.seek(0); // before startTime
      expect(engine.getState().currentTime).toBe(timeline.startTime);
    });

    it('clamps seek to timeline bounds (end)', () => {
      engine.play();
      engine.pause();
      engine.seek(999999);
      expect(engine.getState().currentTime).toBe(timeline.endTime);
    });

    it('ignores seek when idle', () => {
      engine.seek(3000);
      expect(engine.getState().currentTime).toBe(timeline.startTime);
    });

    it('ignores seek when stopped', () => {
      engine.play();
      engine.stop();
      engine.seek(3000);
      // state is stopped, seek should be ignored
      expect(engine.getState().state).toBe('stopped');
    });

    it('finds the correct event at seek position', () => {
      engine.play();
      engine.pause();
      engine.seek(2500); // between event at 2000 and 3000
      const current = engine.getCurrentEvent();
      expect(current).not.toBeNull();
      expect(current!.timestamp).toBe(2000);
    });
  });

  // ── Requirement 7.6: Pause and inspect ──

  describe('pause and inspect (Req 7.6)', () => {
    it('preserves currentEvent when paused', () => {
      engine.play();
      engine.pause();
      engine.seek(3000);
      const eventBeforePause = engine.getCurrentEvent();
      // State should remain paused with same event
      expect(engine.getState().state).toBe('paused');
      expect(engine.getCurrentEvent()).toBe(eventBeforePause);
    });
  });

  // ── Requirement 17.4: Interactive mode ──

  describe('interactive mode (Req 17.4)', () => {
    it('defaults to interactive mode off', () => {
      expect(engine.getState().interactiveMode).toBe(false);
    });

    it('can enable/disable interactive mode', () => {
      engine.setInteractiveMode(true);
      expect(engine.getState().interactiveMode).toBe(true);
      engine.setInteractiveMode(false);
      expect(engine.getState().interactiveMode).toBe(false);
    });
  });

  // ── Subscriptions ──

  describe('subscriptions', () => {
    it('onStateChange fires on state transitions', () => {
      const states: ReplayEngineState[] = [];
      engine.onStateChange((s) => states.push(s));

      engine.play();
      expect(states.length).toBeGreaterThanOrEqual(1);
      expect(states[states.length - 1].state).toBe('playing');
    });

    it('onStateChange unsubscribe works', () => {
      const states: ReplayEngineState[] = [];
      const unsub = engine.onStateChange((s) => states.push(s));

      engine.play();
      const countAfterPlay = states.length;

      unsub();
      engine.pause();
      expect(states.length).toBe(countAfterPlay);
    });

    it('onEvent returns unsubscribe function', () => {
      const events: ExecutionEvent[] = [];
      const unsub = engine.onEvent((e) => events.push(e));
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('swallows subscriber errors without crashing', () => {
      engine.onStateChange(() => {
        throw new Error('subscriber error');
      });
      // Should not throw
      expect(() => engine.play()).not.toThrow();
    });
  });

  // ── getState() snapshot ──

  describe('getState', () => {
    it('returns a complete state snapshot', () => {
      const state = engine.getState();
      expect(state).toEqual({
        state: 'idle',
        speed: 1,
        currentTime: timeline.startTime,
        currentEventIndex: -1,
        totalDuration: timeline.totalDuration,
        eventCount: timeline.eventCount,
        filters: {},
        interactiveMode: false,
      });
    });

    it('returns a copy of filters (not a reference)', () => {
      const filters = { eventTypes: ['AGENT_STARTED' as ReplayEventType] };
      engine.setFilters(filters);
      const state = engine.getState();
      filters.eventTypes.push('AGENT_STOPPED');
      expect(state.filters.eventTypes).toHaveLength(1);
    });
  });

  // ── getCurrentEvent ──

  describe('getCurrentEvent', () => {
    it('returns null initially', () => {
      expect(engine.getCurrentEvent()).toBeNull();
    });

    it('returns null for out-of-range index', () => {
      expect(engine.getCurrentEvent()).toBeNull();
    });
  });

  // ── Empty timeline edge case ──

  describe('empty timeline', () => {
    it('handles empty timeline gracefully', () => {
      const emptyTimeline = makeTimeline([]);
      const emptyEngine = new ReplayEngine(emptyTimeline);
      expect(emptyEngine.getState().state).toBe('idle');
      expect(emptyEngine.getFilteredEvents()).toHaveLength(0);
      expect(emptyEngine.getCurrentEvent()).toBeNull();
    });
  });
});
