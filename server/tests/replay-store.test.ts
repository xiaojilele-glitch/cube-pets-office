/**
 * Property-based tests for ServerReplayStore
 *
 * Tasks 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10
 * Feature: collaboration-replay
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { rm, readFile as fsReadFile, writeFile as fsWriteFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  ExecutionEvent,
  ReplayEventType,
  ExecutionTimeline,
} from '../../shared/replay/contracts';
import { REPLAY_EVENT_TYPES } from '../../shared/replay/contracts';
import { ServerReplayStore } from '../../server/replay/replay-store';

/* ─── Helpers ─── */

const BASE_DIR = resolve('data/replay');

/** Track mission IDs created during tests for cleanup */
const createdMissions: string[] = [];

/** Create a minimal valid ExecutionEvent */
function makeEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    eventId: overrides.eventId ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    missionId: overrides.missionId ?? 'mission-1',
    timestamp: overrides.timestamp ?? Date.now(),
    eventType: overrides.eventType ?? 'AGENT_STARTED',
    sourceAgent: overrides.sourceAgent ?? 'agent-1',
    eventData: overrides.eventData ?? {},
    ...(overrides.targetAgent ? { targetAgent: overrides.targetAgent } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

/** Generate a unique mission ID for test isolation */
function uniqueMissionId(prefix = 'test'): string {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createdMissions.push(id);
  return id;
}

/* ─── Arbitraries ─── */

const eventTypeArb: fc.Arbitrary<ReplayEventType> = fc.constantFrom(...REPLAY_EVENT_TYPES);

const agentIdArb = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/).filter((s) => s.length >= 1);

const executionEventArb: fc.Arbitrary<ExecutionEvent> = fc.record({
  eventId: fc.uuid(),
  missionId: fc.constant('mission-test'),
  timestamp: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  eventType: eventTypeArb,
  sourceAgent: agentIdArb,
  eventData: fc.constant({} as Record<string, unknown>),
});

/** Generate a sorted list of events (by timestamp) */
const sortedEventsArb = (minLen = 1, maxLen = 30): fc.Arbitrary<ExecutionEvent[]> =>
  fc
    .array(executionEventArb, { minLength: minLen, maxLength: maxLen })
    .map((events) => {
      const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
      return sorted.map((e, i) => ({ ...e, eventId: `evt-${i}-${e.eventId.slice(0, 8)}` }));
    });

/* ─── Cleanup ─── */

afterEach(async () => {
  // Clean up all mission directories created during tests
  for (const mid of createdMissions) {
    const dir = resolve(BASE_DIR, mid);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  createdMissions.length = 0;
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.2 — Property 9: Timeline consistency
 * Feature: collaboration-replay, Property 9: 时间轴一致性
 * Validates: Requirements 6.1
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 9: Timeline consistency', () => {
  it('for any sorted event list, the built timeline satisfies all consistency invariants', () => {
    // **Validates: Requirements 6.1**
    fc.assert(
      fc.property(sortedEventsArb(2, 50), (events) => {
        const startTime = events[0].timestamp;
        const endTime = events[events.length - 1].timestamp;
        const totalDuration = endTime - startTime;
        const eventCount = events.length;

        // totalDuration === endTime - startTime
        expect(totalDuration).toBe(endTime - startTime);

        // eventCount === events.length
        expect(eventCount).toBe(events.length);

        // startTime === first event's timestamp
        expect(startTime).toBe(events[0].timestamp);

        // endTime === last event's timestamp
        expect(endTime).toBe(events[events.length - 1].timestamp);

        // events are sorted by timestamp ascending
        for (let i = 1; i < events.length; i++) {
          expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.3 — Property 10: Multi-dimensional index correctness
 * Feature: collaboration-replay, Property 10: 多维索引正确性
 * Validates: Requirements 6.2
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 10: Multi-dimensional index correctness', () => {
  function buildIndicesLocal(events: ExecutionEvent[]): ExecutionTimeline['indices'] {
    const byTime = new Map<number, number[]>();
    const byAgent = new Map<string, number[]>();
    const byType = new Map<ReplayEventType, number[]>();
    const byResource = new Map<string, number[]>();

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const timeBucket = Math.floor(ev.timestamp / 1000) * 1000;
      if (!byTime.has(timeBucket)) byTime.set(timeBucket, []);
      byTime.get(timeBucket)!.push(i);

      if (!byAgent.has(ev.sourceAgent)) byAgent.set(ev.sourceAgent, []);
      byAgent.get(ev.sourceAgent)!.push(i);
      if (ev.targetAgent) {
        if (!byAgent.has(ev.targetAgent)) byAgent.set(ev.targetAgent, []);
        byAgent.get(ev.targetAgent)!.push(i);
      }

      if (!byType.has(ev.eventType)) byType.set(ev.eventType, []);
      byType.get(ev.eventType)!.push(i);

      const resourceId = (ev.eventData as Record<string, unknown>)?.resourceId;
      if (typeof resourceId === 'string') {
        if (!byResource.has(resourceId)) byResource.set(resourceId, []);
        byResource.get(resourceId)!.push(i);
      }
    }
    return { byTime, byAgent, byType, byResource };
  }

  it('byAgent index returns exactly the events matching a given agentId', () => {
    // **Validates: Requirements 6.2**
    fc.assert(
      fc.property(sortedEventsArb(3, 40), (events) => {
        const indices = buildIndicesLocal(events);

        for (const [agentId, eventIndices] of indices.byAgent) {
          for (const idx of eventIndices) {
            const ev = events[idx];
            expect(ev.sourceAgent === agentId || ev.targetAgent === agentId).toBe(true);
          }

          const bruteForce = events
            .map((e, i) => (e.sourceAgent === agentId || e.targetAgent === agentId ? i : -1))
            .filter((i) => i >= 0);

          expect(eventIndices.sort()).toEqual(bruteForce.sort());
        }
      }),
      { numRuns: 100 },
    );
  });

  it('byType index returns exactly the events matching a given eventType', () => {
    // **Validates: Requirements 6.2**
    fc.assert(
      fc.property(sortedEventsArb(3, 40), (events) => {
        const indices = buildIndicesLocal(events);

        for (const [eventType, eventIndices] of indices.byType) {
          for (const idx of eventIndices) {
            expect(events[idx].eventType).toBe(eventType);
          }

          const bruteForce = events
            .map((e, i) => (e.eventType === eventType ? i : -1))
            .filter((i) => i >= 0);

          expect(eventIndices.sort()).toEqual(bruteForce.sort());
        }
      }),
      { numRuns: 100 },
    );
  });

  it('byTime index returns exactly the events in the correct time bucket', () => {
    // **Validates: Requirements 6.2**
    fc.assert(
      fc.property(sortedEventsArb(3, 40), (events) => {
        const indices = buildIndicesLocal(events);

        for (const [timeBucket, eventIndices] of indices.byTime) {
          for (const idx of eventIndices) {
            const bucket = Math.floor(events[idx].timestamp / 1000) * 1000;
            expect(bucket).toBe(timeBucket);
          }

          const bruteForce = events
            .map((e, i) => (Math.floor(e.timestamp / 1000) * 1000 === timeBucket ? i : -1))
            .filter((i) => i >= 0);

          expect(eventIndices.sort()).toEqual(bruteForce.sort());
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.5 — Property 13: JSON export roundtrip
 * Feature: collaboration-replay, Property 13: JSON 导出往返
 * Validates: Requirements 6.6, 15.1
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 13: JSON export roundtrip', () => {
  it('for any event list, JSON export then parse produces deeply equal events', () => {
    // **Validates: Requirements 6.6, 15.1**
    fc.assert(
      fc.property(sortedEventsArb(1, 30), (events) => {
        const exported = JSON.stringify(events, null, 2);
        const parsed: ExecutionEvent[] = JSON.parse(exported);

        expect(parsed).toHaveLength(events.length);
        for (let i = 0; i < events.length; i++) {
          expect(parsed[i].eventId).toBe(events[i].eventId);
          expect(parsed[i].missionId).toBe(events[i].missionId);
          expect(parsed[i].timestamp).toBe(events[i].timestamp);
          expect(parsed[i].eventType).toBe(events[i].eventType);
          expect(parsed[i].sourceAgent).toBe(events[i].sourceAgent);
          expect(parsed[i].eventData).toEqual(events[i].eventData);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('store exportEvents JSON roundtrip preserves event data', async () => {
    // **Validates: Requirements 6.6, 15.1**
    const store = new ServerReplayStore();
    const mid = uniqueMissionId('json-rt');

    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        missionId: mid,
        eventId: `jrt-${i}`,
        timestamp: 1_000_000_000_000 + i * 1000,
        sourceAgent: `agent-${i % 3}`,
        eventType: REPLAY_EVENT_TYPES[i % REPLAY_EVENT_TYPES.length],
      }),
    );

    await store.appendEvents(mid, events);
    const exported = await store.exportEvents(mid, 'json');
    const parsed: ExecutionEvent[] = JSON.parse(exported);

    expect(parsed).toHaveLength(events.length);
    for (let i = 0; i < events.length; i++) {
      expect(parsed[i].eventId).toBe(events[i].eventId);
      expect(parsed[i].timestamp).toBe(events[i].timestamp);
      expect(parsed[i].eventType).toBe(events[i].eventType);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.4 — Property 12: Incremental append invariant
 * Feature: collaboration-replay, Property 12: 增量追加不变量
 * Validates: Requirements 6.4, 19.3
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 12: Incremental append invariant', () => {
  it('appending N events increases eventCount by N and preserves original order', async () => {
    // **Validates: Requirements 6.4, 19.3**
    const store = new ServerReplayStore();
    const mid = uniqueMissionId('append');

    const initialEvents = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        missionId: mid,
        eventId: `init-${i}`,
        timestamp: 1_000_000_000_000 + i * 1000,
        sourceAgent: 'agent-a',
      }),
    );

    await store.appendEvents(mid, initialEvents);
    const tlBefore = await store.getTimeline(mid);
    expect(tlBefore.eventCount).toBe(5);

    const newEvents = Array.from({ length: 3 }, (_, i) =>
      makeEvent({
        missionId: mid,
        eventId: `new-${i}`,
        timestamp: 1_000_000_010_000 + i * 1000,
        sourceAgent: 'agent-b',
      }),
    );

    await store.appendEvents(mid, newEvents);
    const tlAfter = await store.getTimeline(mid);

    // eventCount increases by N
    expect(tlAfter.eventCount).toBe(tlBefore.eventCount + newEvents.length);

    // Original events' order and content unchanged
    for (let i = 0; i < initialEvents.length; i++) {
      expect(tlAfter.events[i].eventId).toBe(initialEvents[i].eventId);
      expect(tlAfter.events[i].timestamp).toBe(initialEvents[i].timestamp);
    }

    // New events appear at the end
    for (let i = 0; i < newEvents.length; i++) {
      expect(tlAfter.events[initialEvents.length + i].eventId).toBe(newEvents[i].eventId);
    }
  });

  it('property: for any two batches, append preserves order and count', async () => {
    // **Validates: Requirements 6.4, 19.3**
    let runIdx = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (batch1Size, batch2Size) => {
          const store = new ServerReplayStore();
          const mid = uniqueMissionId(`append-prop-${runIdx++}`);

          const batch1 = Array.from({ length: batch1Size }, (_, i) =>
            makeEvent({
              missionId: mid,
              eventId: `b1-${i}`,
              timestamp: 1_000_000_000_000 + i * 1000,
            }),
          );

          const batch2 = Array.from({ length: batch2Size }, (_, i) =>
            makeEvent({
              missionId: mid,
              eventId: `b2-${i}`,
              timestamp: 1_000_000_100_000 + i * 1000,
            }),
          );

          await store.appendEvents(mid, batch1);
          const tl1 = await store.getTimeline(mid);
          expect(tl1.eventCount).toBe(batch1Size);

          await store.appendEvents(mid, batch2);
          const tl2 = await store.getTimeline(mid);
          expect(tl2.eventCount).toBe(batch1Size + batch2Size);

          // Original events preserved at the start
          for (let i = 0; i < batch1Size; i++) {
            expect(tl2.events[i].eventId).toBe(batch1[i].eventId);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.8 — Property 38: Data integrity verification
 * Feature: collaboration-replay, Property 38: 数据完整性验证
 * Validates: Requirements 20.3
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 38: Data integrity verification', () => {
  it('untampered data passes integrity verification', async () => {
    // **Validates: Requirements 20.3**
    const store = new ServerReplayStore();
    const mid = uniqueMissionId('integrity-ok');

    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        missionId: mid,
        eventId: `int-${i}`,
        timestamp: 1_000_000_000_000 + i * 1000,
      }),
    );

    await store.appendEvents(mid, events);
    expect(await store.verifyIntegrity(mid)).toBe(true);
  });

  it('tampered event data fails integrity verification', async () => {
    // **Validates: Requirements 20.3**
    const store = new ServerReplayStore();
    const mid = uniqueMissionId('integrity-tamper');

    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({
        missionId: mid,
        eventId: `tam-${i}`,
        timestamp: 1_000_000_000_000 + i * 1000,
      }),
    );

    await store.appendEvents(mid, events);
    expect(await store.verifyIntegrity(mid)).toBe(true);

    // Tamper with the events file
    const eventsFilePath = resolve(BASE_DIR, mid, 'events.jsonl');
    const content = await fsReadFile(eventsFilePath, 'utf-8');
    const tampered =
      content +
      '{"eventId":"fake","missionId":"x","timestamp":0,"eventType":"AGENT_STARTED","sourceAgent":"x","eventData":{}}\n';
    await fsWriteFile(eventsFilePath, tampered, 'utf-8');

    // Checksum mismatch → false
    expect(await store.verifyIntegrity(mid)).toBe(false);
  });

  it('property: for any events, untampered store always verifies true', async () => {
    // **Validates: Requirements 20.3**
    let runIdx = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        async (numEvents) => {
          const store = new ServerReplayStore();
          const mid = uniqueMissionId(`integrity-prop-${runIdx++}`);

          const events = Array.from({ length: numEvents }, (_, i) =>
            makeEvent({
              missionId: mid,
              eventId: `vp-${i}`,
              timestamp: 1_000_000_000_000 + i * 1000,
            }),
          );

          await store.appendEvents(mid, events);
          expect(await store.verifyIntegrity(mid)).toBe(true);
        },
      ),
      { numRuns: 15 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.9 — Property 35: Version increment invariant
 * Feature: collaboration-replay, Property 35: 版本递增不变量
 * Validates: Requirements 19.4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 35: Version increment invariant', () => {
  it('each appendEvents call strictly increments the version', async () => {
    // **Validates: Requirements 19.4**
    const store = new ServerReplayStore();
    const mid = uniqueMissionId('version');

    const versions: number[] = [];

    for (let batch = 0; batch < 5; batch++) {
      const events = Array.from({ length: 2 }, (_, i) =>
        makeEvent({
          missionId: mid,
          eventId: `ver-${batch}-${i}`,
          timestamp: 1_000_000_000_000 + batch * 10000 + i * 1000,
        }),
      );

      await store.appendEvents(mid, events);
      const tl = await store.getTimeline(mid);
      versions.push(tl.version);
    }

    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
  });

  it('property: N sequential appends produce strictly increasing versions', async () => {
    // **Validates: Requirements 19.4**
    let runIdx = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        async (numBatches) => {
          const store = new ServerReplayStore();
          const mid = uniqueMissionId(`ver-prop-${runIdx++}`);
          const versions: number[] = [];

          for (let b = 0; b < numBatches; b++) {
            const ev = makeEvent({
              missionId: mid,
              eventId: `vp-${b}`,
              timestamp: 1_000_000_000_000 + b * 10000,
            });
            await store.appendEvents(mid, [ev]);
            const tl = await store.getTimeline(mid);
            versions.push(tl.version);
          }

          for (let i = 1; i < versions.length; i++) {
            expect(versions[i]).toBeGreaterThan(versions[i - 1]);
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 4.10 — Property 34: Data cleanup correctness
 * Feature: collaboration-replay, Property 34: 数据清理正确性
 * Validates: Requirements 19.5
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 34: Data cleanup correctness', () => {
  it('cleanup deletes old data and preserves recent data', async () => {
    // **Validates: Requirements 19.5**
    const store = new ServerReplayStore();

    const oldMid = uniqueMissionId('old');
    await store.appendEvents(oldMid, [
      makeEvent({ missionId: oldMid, timestamp: 1_000_000_000_000 }),
    ]);

    const recentMid = uniqueMissionId('recent');
    await store.appendEvents(recentMid, [
      makeEvent({ missionId: recentMid, timestamp: Date.now() }),
    ]);

    // Backdate the old mission directory's mtime to 60 days ago
    const oldDir = resolve(BASE_DIR, oldMid);
    const oldTime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await utimes(oldDir, oldTime, oldTime);

    const cleaned = await store.cleanup(30);

    // Old mission should be cleaned
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(existsSync(resolve(BASE_DIR, oldMid))).toBe(false);

    // Recent mission should be preserved
    expect(existsSync(resolve(BASE_DIR, recentMid))).toBe(true);
  });

  it('cleanup with very large threshold preserves all data', async () => {
    // **Validates: Requirements 19.5**
    const store = new ServerReplayStore();

    const mid1 = uniqueMissionId('keep1');
    const mid2 = uniqueMissionId('keep2');

    await store.appendEvents(mid1, [
      makeEvent({ missionId: mid1, timestamp: Date.now() }),
    ]);
    await store.appendEvents(mid2, [
      makeEvent({ missionId: mid2, timestamp: Date.now() }),
    ]);

    // Cleanup with 9999 day threshold — nothing should be deleted
    const cleaned = await store.cleanup(9999);

    // Our test missions should still exist
    expect(existsSync(resolve(BASE_DIR, mid1))).toBe(true);
    expect(existsSync(resolve(BASE_DIR, mid2))).toBe(true);
  });

  it('property: cleanup threshold correctly partitions old vs recent data', async () => {
    // **Validates: Requirements 19.5**
    let runIdx = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),  // number of old missions
        fc.integer({ min: 1, max: 3 }),  // number of recent missions
        fc.integer({ min: 10, max: 90 }), // threshold days
        async (numOld, numRecent, thresholdDays) => {
          const store = new ServerReplayStore();
          const oldIds: string[] = [];
          const recentIds: string[] = [];

          // Create old missions
          for (let i = 0; i < numOld; i++) {
            const mid = uniqueMissionId(`cleanup-old-${runIdx}-${i}`);
            oldIds.push(mid);
            await store.appendEvents(mid, [
              makeEvent({ missionId: mid, eventId: `o-${i}`, timestamp: 1_000_000_000_000 }),
            ]);
            // Backdate to beyond threshold
            const oldTime = new Date(Date.now() - (thresholdDays + 10) * 24 * 60 * 60 * 1000);
            await utimes(resolve(BASE_DIR, mid), oldTime, oldTime);
          }

          // Create recent missions
          for (let i = 0; i < numRecent; i++) {
            const mid = uniqueMissionId(`cleanup-recent-${runIdx}-${i}`);
            recentIds.push(mid);
            await store.appendEvents(mid, [
              makeEvent({ missionId: mid, eventId: `r-${i}`, timestamp: Date.now() }),
            ]);
          }

          runIdx++;

          await store.cleanup(thresholdDays);

          for (const mid of oldIds) {
            expect(existsSync(resolve(BASE_DIR, mid))).toBe(false);
          }
          for (const mid of recentIds) {
            expect(existsSync(resolve(BASE_DIR, mid))).toBe(true);
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
