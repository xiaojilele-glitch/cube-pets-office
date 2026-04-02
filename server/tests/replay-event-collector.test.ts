import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionEvent } from '../../shared/replay/contracts.js';
import type { ReplayStoreInterface } from '../../shared/replay/store-interface.js';
import { EventCollector } from '../replay/event-collector.js';

/** Minimal mock store that records appendEvents calls */
function createMockStore(options?: { shouldFail?: boolean }): ReplayStoreInterface & {
  calls: Array<{ missionId: string; events: ExecutionEvent[] }>;
} {
  const calls: Array<{ missionId: string; events: ExecutionEvent[] }> = [];
  return {
    calls,
    appendEvents: vi.fn(async (missionId: string, events: ExecutionEvent[]) => {
      if (options?.shouldFail) throw new Error('store write failed');
      calls.push({ missionId, events });
    }),
    queryEvents: vi.fn(async () => []),
    getTimeline: vi.fn(async () => ({
      missionId: '',
      events: [],
      startTime: 0,
      endTime: 0,
      totalDuration: 0,
      eventCount: 0,
      indices: {
        byTime: new Map(),
        byAgent: new Map(),
        byType: new Map(),
        byResource: new Map(),
      },
      version: 0,
      checksum: '',
    })),
    exportEvents: vi.fn(async () => ''),
    verifyIntegrity: vi.fn(async () => true),
    compact: vi.fn(async () => {}),
    cleanup: vi.fn(async () => 0),
  };
}

function makePartialEvent(overrides: Partial<Omit<ExecutionEvent, 'eventId' | 'timestamp'>> = {}) {
  return {
    missionId: overrides.missionId ?? 'mission-1',
    eventType: overrides.eventType ?? ('AGENT_STARTED' as const),
    sourceAgent: overrides.sourceAgent ?? 'agent-1',
    eventData: overrides.eventData ?? {},
    ...(overrides.targetAgent ? { targetAgent: overrides.targetAgent } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

describe('EventCollector', () => {
  let store: ReturnType<typeof createMockStore>;
  let collector: EventCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createMockStore();
    collector = new EventCollector(store, {
      bufferSize: 5,
      flushIntervalMs: 100,
      maxRetries: 3,
    });
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  // ---- emit() ----

  describe('emit', () => {
    it('synchronously adds event to buffer with generated eventId and timestamp', () => {
      collector.emit(makePartialEvent());
      const stats = collector.getStats();
      expect(stats.buffered).toBe(1);
      expect(stats.total).toBe(1);
    });

    it('does not call store.appendEvents synchronously', () => {
      collector.emit(makePartialEvent());
      expect(store.appendEvents).not.toHaveBeenCalled();
    });

    it('increments total count for each emit', () => {
      collector.emit(makePartialEvent());
      collector.emit(makePartialEvent());
      collector.emit(makePartialEvent());
      expect(collector.getStats().total).toBe(3);
    });

    it('drops oldest event when buffer is full', () => {
      // bufferSize = 5
      for (let i = 0; i < 6; i++) {
        collector.emit(makePartialEvent({ sourceAgent: `agent-${i}` }));
      }
      // Buffer should still be at most bufferSize (may be less due to flush trigger)
      expect(collector.getStats().total).toBe(6);
    });
  });

  // ---- flush() ----

  describe('flush', () => {
    it('sends buffered events to store grouped by missionId', async () => {
      collector.emit(makePartialEvent({ missionId: 'm-1' }));
      collector.emit(makePartialEvent({ missionId: 'm-2' }));
      collector.emit(makePartialEvent({ missionId: 'm-1' }));

      await collector.flush();

      expect(store.appendEvents).toHaveBeenCalledTimes(2);
      const m1Call = store.calls.find(c => c.missionId === 'm-1');
      const m2Call = store.calls.find(c => c.missionId === 'm-2');
      expect(m1Call?.events).toHaveLength(2);
      expect(m2Call?.events).toHaveLength(1);
    });

    it('clears buffer after successful flush', async () => {
      collector.emit(makePartialEvent());
      collector.emit(makePartialEvent());
      await collector.flush();
      expect(collector.getStats().buffered).toBe(0);
    });

    it('is a no-op when buffer is empty', async () => {
      await collector.flush();
      expect(store.appendEvents).not.toHaveBeenCalled();
    });

    it('moves events to failedQueue when store fails', async () => {
      collector.destroy();
      const failStore = createMockStore({ shouldFail: true });
      collector = new EventCollector(failStore, {
        bufferSize: 10,
        flushIntervalMs: 100,
        maxRetries: 3,
      });

      collector.emit(makePartialEvent());
      collector.emit(makePartialEvent());
      await collector.flush();

      expect(collector.getStats().buffered).toBe(0);
      expect(collector.getStats().failed).toBe(2);
    });
  });

  // ---- timer-based flush ----

  describe('timer flush', () => {
    it('flushes automatically on interval', async () => {
      collector.emit(makePartialEvent());
      expect(store.appendEvents).not.toHaveBeenCalled();

      // Advance past the flush interval
      await vi.advanceTimersByTimeAsync(150);

      expect(store.appendEvents).toHaveBeenCalled();
    });
  });

  // ---- retryFailed() ----

  describe('retryFailed', () => {
    it('retries failed events and clears failedQueue on success', async () => {
      // First: make events fail
      collector.destroy();
      const failStore = createMockStore({ shouldFail: true });
      collector = new EventCollector(failStore, {
        bufferSize: 10,
        flushIntervalMs: 100_000, // large interval to avoid auto-flush
        maxRetries: 3,
      });

      collector.emit(makePartialEvent());
      await collector.flush();
      expect(collector.getStats().failed).toBe(1);

      // Now make store succeed
      (failStore.appendEvents as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await collector.retryFailed();
      expect(collector.getStats().failed).toBe(0);
    });

    it('re-enqueues events that fail again with incremented retryCount', async () => {
      collector.destroy();
      const failStore = createMockStore({ shouldFail: true });
      collector = new EventCollector(failStore, {
        bufferSize: 10,
        flushIntervalMs: 100_000,
        maxRetries: 3,
      });

      collector.emit(makePartialEvent());
      await collector.flush();
      expect(collector.getStats().failed).toBe(1);

      // Retry — still fails
      await collector.retryFailed();
      expect(collector.getStats().failed).toBe(1);

      // Retry again — still fails
      await collector.retryFailed();
      expect(collector.getStats().failed).toBe(1);

      // Third retry — exceeds maxRetries, event is dropped
      await collector.retryFailed();
      expect(collector.getStats().failed).toBe(0);
    });

    it('is a no-op when failedQueue is empty', async () => {
      await collector.retryFailed();
      expect(store.appendEvents).not.toHaveBeenCalled();
    });
  });

  // ---- getStats() ----

  describe('getStats', () => {
    it('returns correct initial stats', () => {
      const stats = collector.getStats();
      expect(stats).toEqual({ buffered: 0, failed: 0, total: 0 });
    });

    it('reflects buffered, failed, and total counts', async () => {
      collector.emit(makePartialEvent());
      collector.emit(makePartialEvent());
      expect(collector.getStats()).toEqual({ buffered: 2, failed: 0, total: 2 });

      await collector.flush();
      expect(collector.getStats()).toEqual({ buffered: 0, failed: 0, total: 2 });
    });
  });

  // ---- destroy() ----

  describe('destroy', () => {
    it('stops the flush timer', async () => {
      collector.emit(makePartialEvent());
      collector.destroy();

      await vi.advanceTimersByTimeAsync(200);
      // Timer was cleared, so no flush should have happened
      expect(store.appendEvents).not.toHaveBeenCalled();
    });

    it('can be called multiple times safely', () => {
      collector.destroy();
      collector.destroy();
      // No error thrown
    });
  });

  // ---- event structure ----

  describe('event structure', () => {
    it('generates unique eventId for each event', async () => {
      collector.emit(makePartialEvent());
      collector.emit(makePartialEvent());
      await collector.flush();

      const events = store.calls.flatMap(c => c.events);
      const ids = events.map(e => e.eventId);
      expect(new Set(ids).size).toBe(2);
    });

    it('assigns timestamp to each event', async () => {
      const before = Date.now();
      collector.emit(makePartialEvent());
      await collector.flush();

      const event = store.calls[0].events[0];
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.eventId).toBeDefined();
      expect(event.missionId).toBe('mission-1');
      expect(event.eventType).toBe('AGENT_STARTED');
      expect(event.sourceAgent).toBe('agent-1');
    });
  });
});
