import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

import type { ExecutionEvent, EventQuery } from '../../shared/replay/contracts.js';
import { ServerReplayStore } from '../replay/replay-store.js';

/* ─── Helpers ─── */

const BASE_DIR = resolve('data/replay');

function makeEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    missionId: 'test-mission',
    timestamp: Date.now(),
    eventType: 'MESSAGE_SENT',
    sourceAgent: 'agent-a',
    eventData: {},
    ...overrides,
  };
}

function makeEvents(count: number, missionId = 'test-mission'): ExecutionEvent[] {
  const base = Date.now();
  return Array.from({ length: count }, (_, i) =>
    makeEvent({
      eventId: `evt-${i}`,
      missionId,
      timestamp: base + i * 100,
      sourceAgent: i % 2 === 0 ? 'agent-a' : 'agent-b',
      eventType: i % 3 === 0 ? 'DECISION_MADE' : 'MESSAGE_SENT',
    }),
  );
}

/* ─── Tests ─── */

describe('ServerReplayStore', () => {
  let store: ServerReplayStore;

  beforeEach(async () => {
    // Clean up test data before each test
    if (existsSync(BASE_DIR)) {
      await rm(BASE_DIR, { recursive: true, force: true });
    }
    store = new ServerReplayStore();
  });

  afterEach(async () => {
    if (existsSync(BASE_DIR)) {
      await rm(BASE_DIR, { recursive: true, force: true });
    }
  });

  /* ── appendEvents ── */

  describe('appendEvents', () => {
    it('creates mission directory and events.jsonl', async () => {
      const events = makeEvents(3);
      await store.appendEvents('test-mission', events);

      expect(existsSync(join(BASE_DIR, 'test-mission', 'events.jsonl'))).toBe(true);
      expect(existsSync(join(BASE_DIR, 'test-mission', 'timeline.json'))).toBe(true);
    });

    it('appends events incrementally without overwriting', async () => {
      const batch1 = makeEvents(2);
      const batch2 = makeEvents(3, 'test-mission');

      await store.appendEvents('test-mission', batch1);
      await store.appendEvents('test-mission', batch2);

      const timeline = await store.getTimeline('test-mission');
      expect(timeline.eventCount).toBe(5);
    });

    it('increments version on each append', async () => {
      await store.appendEvents('test-mission', makeEvents(1));
      const tl1 = await store.getTimeline('test-mission');
      expect(tl1.version).toBe(1);

      await store.appendEvents('test-mission', makeEvents(1));
      const tl2 = await store.getTimeline('test-mission');
      expect(tl2.version).toBe(2);
    });

    it('does nothing for empty events array', async () => {
      await store.appendEvents('test-mission', []);
      expect(existsSync(join(BASE_DIR, 'test-mission'))).toBe(false);
    });

    it('computes checksum after append', async () => {
      await store.appendEvents('test-mission', makeEvents(3));
      const timeline = await store.getTimeline('test-mission');
      expect(timeline.checksum).toBeTruthy();
      expect(typeof timeline.checksum).toBe('string');
      expect(timeline.checksum.length).toBe(64); // SHA-256 hex
    });
  });


  /* ── getTimeline ── */

  describe('getTimeline', () => {
    it('returns timeline with correct metadata', async () => {
      const events = makeEvents(5);
      await store.appendEvents('test-mission', events);

      const timeline = await store.getTimeline('test-mission');
      expect(timeline.missionId).toBe('test-mission');
      expect(timeline.eventCount).toBe(5);
      expect(timeline.events).toHaveLength(5);
      expect(timeline.totalDuration).toBe(timeline.endTime - timeline.startTime);
    });

    it('returns events sorted by timestamp', async () => {
      const events = makeEvents(5);
      await store.appendEvents('test-mission', events);

      const timeline = await store.getTimeline('test-mission');
      for (let i = 1; i < timeline.events.length; i++) {
        expect(timeline.events[i].timestamp).toBeGreaterThanOrEqual(
          timeline.events[i - 1].timestamp,
        );
      }
    });

    it('builds Map-based indices', async () => {
      const events = makeEvents(6);
      await store.appendEvents('test-mission', events);

      const timeline = await store.getTimeline('test-mission');
      expect(timeline.indices.byAgent).toBeInstanceOf(Map);
      expect(timeline.indices.byType).toBeInstanceOf(Map);
      expect(timeline.indices.byTime).toBeInstanceOf(Map);
      expect(timeline.indices.byResource).toBeInstanceOf(Map);

      // byAgent should have agent-a and agent-b
      expect(timeline.indices.byAgent.has('agent-a')).toBe(true);
      expect(timeline.indices.byAgent.has('agent-b')).toBe(true);
    });

    it('returns empty timeline for non-existent mission', async () => {
      const timeline = await store.getTimeline('nonexistent');
      expect(timeline.eventCount).toBe(0);
      expect(timeline.events).toHaveLength(0);
    });
  });

  /* ── queryEvents ── */

  describe('queryEvents', () => {
    it('returns all events when no filters applied', async () => {
      await store.appendEvents('test-mission', makeEvents(5));

      const result = await store.queryEvents({ missionId: 'test-mission' });
      expect(result).toHaveLength(5);
    });

    it('filters by timeRange', async () => {
      const base = Date.now();
      const events = [
        makeEvent({ timestamp: base }),
        makeEvent({ timestamp: base + 1000 }),
        makeEvent({ timestamp: base + 2000 }),
        makeEvent({ timestamp: base + 3000 }),
      ];
      await store.appendEvents('test-mission', events);

      const result = await store.queryEvents({
        missionId: 'test-mission',
        timeRange: { start: base + 500, end: base + 2500 },
      });
      expect(result).toHaveLength(2);
    });

    it('filters by agentIds', async () => {
      const events = [
        makeEvent({ sourceAgent: 'agent-a' }),
        makeEvent({ sourceAgent: 'agent-b' }),
        makeEvent({ sourceAgent: 'agent-c', targetAgent: 'agent-a' }),
      ];
      await store.appendEvents('test-mission', events);

      const result = await store.queryEvents({
        missionId: 'test-mission',
        agentIds: ['agent-a'],
      });
      // agent-a as source (1st) + agent-a as target (3rd)
      expect(result).toHaveLength(2);
    });

    it('filters by eventTypes', async () => {
      const events = [
        makeEvent({ eventType: 'MESSAGE_SENT' }),
        makeEvent({ eventType: 'DECISION_MADE' }),
        makeEvent({ eventType: 'MESSAGE_SENT' }),
        makeEvent({ eventType: 'CODE_EXECUTED' }),
      ];
      await store.appendEvents('test-mission', events);

      const result = await store.queryEvents({
        missionId: 'test-mission',
        eventTypes: ['MESSAGE_SENT'],
      });
      expect(result).toHaveLength(2);
    });

    it('filters by resourceIds', async () => {
      const events = [
        makeEvent({ eventData: { resourceId: 'res-1' } }),
        makeEvent({ eventData: { resourceId: 'res-2' } }),
        makeEvent({ eventData: {} }),
      ];
      await store.appendEvents('test-mission', events);

      const result = await store.queryEvents({
        missionId: 'test-mission',
        resourceIds: ['res-1'],
      });
      expect(result).toHaveLength(1);
    });

    it('supports limit and offset', async () => {
      await store.appendEvents('test-mission', makeEvents(10));

      const result = await store.queryEvents({
        missionId: 'test-mission',
        limit: 3,
        offset: 2,
      });
      expect(result).toHaveLength(3);
    });

    it('returns empty array for non-existent mission', async () => {
      const result = await store.queryEvents({ missionId: 'nonexistent' });
      expect(result).toHaveLength(0);
    });
  });

  /* ── exportEvents ── */

  describe('exportEvents', () => {
    it('exports as JSON array string', async () => {
      await store.appendEvents('test-mission', makeEvents(3));

      const json = await store.exportEvents('test-mission', 'json');
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    });

    it('exports as CSV with headers', async () => {
      await store.appendEvents('test-mission', makeEvents(2));

      const csv = await store.exportEvents('test-mission', 'csv');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('eventId,missionId,timestamp,eventType,sourceAgent,targetAgent');
      expect(lines).toHaveLength(3); // header + 2 data rows
    });
  });


  /* ── verifyIntegrity ── */

  describe('verifyIntegrity', () => {
    it('returns true for untampered data', async () => {
      await store.appendEvents('test-mission', makeEvents(5));
      const result = await store.verifyIntegrity('test-mission');
      expect(result).toBe(true);
    });

    it('returns false when events.jsonl is tampered', async () => {
      await store.appendEvents('test-mission', makeEvents(5));

      // Tamper with events file
      const evPath = join(BASE_DIR, 'test-mission', 'events.jsonl');
      await writeFile(evPath, 'tampered data\n', 'utf-8');

      const result = await store.verifyIntegrity('test-mission');
      expect(result).toBe(false);
    });

    it('returns false for non-existent mission', async () => {
      const result = await store.verifyIntegrity('nonexistent');
      expect(result).toBe(false);
    });
  });

  /* ── compact ── */

  describe('compact', () => {
    it('compresses events with gzip', async () => {
      await store.appendEvents('test-mission', makeEvents(5));

      const evPath = join(BASE_DIR, 'test-mission', 'events.jsonl');
      const sizeBefore = (await readFile(evPath, 'utf-8')).length;

      await store.compact('test-mission');

      // After compact, file should contain gz: prefixed lines
      const content = await readFile(evPath, 'utf-8');
      const lines = content.trim().split('\n');
      for (const line of lines) {
        expect(line.startsWith('gz:')).toBe(true);
      }

      // Events should still be readable
      const timeline = await store.getTimeline('test-mission');
      expect(timeline.eventCount).toBe(5);
    });

    it('updates checksum and version after compact', async () => {
      await store.appendEvents('test-mission', makeEvents(5));
      const tlBefore = await store.getTimeline('test-mission');

      await store.compact('test-mission');
      const tlAfter = await store.getTimeline('test-mission');

      expect(tlAfter.version).toBe(tlBefore.version + 1);
      // Checksum changes because file content changed
      expect(tlAfter.checksum).not.toBe(tlBefore.checksum);
    });
  });

  /* ── cleanup ── */

  describe('cleanup', () => {
    it('deletes mission directories older than threshold', async () => {
      // Create a mission directory manually with old mtime
      const oldDir = join(BASE_DIR, 'old-mission');
      await mkdir(oldDir, { recursive: true });
      await writeFile(join(oldDir, 'events.jsonl'), '{}', 'utf-8');

      // Create a recent mission
      await store.appendEvents('recent-mission', makeEvents(1));

      // The old directory was just created so its mtime is now.
      // We can't easily fake mtime, so we test the logic by using 0 days threshold
      // which should delete everything.
      const cleaned = await store.cleanup(0);
      expect(cleaned).toBeGreaterThanOrEqual(2);
    });

    it('returns 0 when no data directory exists', async () => {
      if (existsSync(BASE_DIR)) {
        await rm(BASE_DIR, { recursive: true, force: true });
      }
      const cleaned = await store.cleanup(30);
      expect(cleaned).toBe(0);
    });
  });

  /* ── index building ── */

  describe('index building', () => {
    it('builds byResource index from eventData.resourceId', async () => {
      const events = [
        makeEvent({
          eventType: 'RESOURCE_ACCESSED',
          eventData: { resourceId: 'file-1', resourceType: 'FILE', accessType: 'READ' },
        }),
        makeEvent({
          eventType: 'RESOURCE_ACCESSED',
          eventData: { resourceId: 'file-1', resourceType: 'FILE', accessType: 'WRITE' },
        }),
        makeEvent({
          eventType: 'MESSAGE_SENT',
          eventData: { senderId: 'a', receiverId: 'b' },
        }),
      ];
      await store.appendEvents('test-mission', events);

      const timeline = await store.getTimeline('test-mission');
      expect(timeline.indices.byResource.has('file-1')).toBe(true);
      expect(timeline.indices.byResource.get('file-1')!).toHaveLength(2);
    });

    it('builds byType index correctly', async () => {
      const events = [
        makeEvent({ eventType: 'MESSAGE_SENT' }),
        makeEvent({ eventType: 'MESSAGE_SENT' }),
        makeEvent({ eventType: 'DECISION_MADE' }),
      ];
      await store.appendEvents('test-mission', events);

      const timeline = await store.getTimeline('test-mission');
      expect(timeline.indices.byType.get('MESSAGE_SENT')!).toHaveLength(2);
      expect(timeline.indices.byType.get('DECISION_MADE')!).toHaveLength(1);
    });
  });
});
