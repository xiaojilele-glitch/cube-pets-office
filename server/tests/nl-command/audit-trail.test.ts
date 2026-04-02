import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AuditEntry, AuditQueryFilter } from '../../../shared/nl-command/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_nl_audit__/nl-audit.json');

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    entryId: overrides.entryId ?? `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operationType: overrides.operationType ?? 'command_created',
    operator: overrides.operator ?? 'user-1',
    content: overrides.content ?? 'Created a command',
    timestamp: overrides.timestamp ?? Date.now(),
    result: overrides.result ?? 'success',
    entityId: overrides.entityId,
    entityType: overrides.entityType,
    metadata: overrides.metadata,
  };
}

describe('AuditTrail', () => {
  let trail: AuditTrail;

  beforeEach(() => {
    // Clean up test file before each test
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    trail = new AuditTrail(TEST_AUDIT_PATH);
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('record()', () => {
    it('should record an audit entry and persist it', async () => {
      const entry = makeEntry({ entryId: 'e1' });
      await trail.record(entry);

      const results = await trail.query({});
      expect(results).toHaveLength(1);
      expect(results[0].entryId).toBe('e1');
    });

    it('should persist entries across instances', async () => {
      await trail.record(makeEntry({ entryId: 'e1' }));
      await trail.record(makeEntry({ entryId: 'e2' }));

      // Create a new instance that loads from the same file
      const trail2 = new AuditTrail(TEST_AUDIT_PATH);
      const results = await trail2.query({});
      expect(results).toHaveLength(2);
    });
  });

  describe('query()', () => {
    it('should return all entries when no filter is applied', async () => {
      await trail.record(makeEntry({ entryId: 'e1' }));
      await trail.record(makeEntry({ entryId: 'e2' }));
      await trail.record(makeEntry({ entryId: 'e3' }));

      const results = await trail.query({});
      expect(results).toHaveLength(3);
    });

    it('should return results sorted by timestamp descending', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 3000 }));
      await trail.record(makeEntry({ entryId: 'e3', timestamp: 2000 }));

      const results = await trail.query({});
      expect(results.map((e) => e.entryId)).toEqual(['e2', 'e3', 'e1']);
    });

    it('should filter by startTime', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 2000 }));
      await trail.record(makeEntry({ entryId: 'e3', timestamp: 3000 }));

      const results = await trail.query({ startTime: 2000 });
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.entryId)).toEqual(['e3', 'e2']);
    });

    it('should filter by endTime', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 2000 }));
      await trail.record(makeEntry({ entryId: 'e3', timestamp: 3000 }));

      const results = await trail.query({ endTime: 2000 });
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.entryId)).toEqual(['e2', 'e1']);
    });

    it('should filter by time range', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 2000 }));
      await trail.record(makeEntry({ entryId: 'e3', timestamp: 3000 }));

      const results = await trail.query({ startTime: 1500, endTime: 2500 });
      expect(results).toHaveLength(1);
      expect(results[0].entryId).toBe('e2');
    });

    it('should filter by operator', async () => {
      await trail.record(makeEntry({ entryId: 'e1', operator: 'alice' }));
      await trail.record(makeEntry({ entryId: 'e2', operator: 'bob' }));
      await trail.record(makeEntry({ entryId: 'e3', operator: 'alice' }));

      const results = await trail.query({ operator: 'alice' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.operator === 'alice')).toBe(true);
    });

    it('should filter by operationType', async () => {
      await trail.record(makeEntry({ entryId: 'e1', operationType: 'command_created' }));
      await trail.record(makeEntry({ entryId: 'e2', operationType: 'plan_generated' }));
      await trail.record(makeEntry({ entryId: 'e3', operationType: 'command_created' }));

      const results = await trail.query({ operationType: 'command_created' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.operationType === 'command_created')).toBe(true);
    });

    it('should filter by entityId', async () => {
      await trail.record(makeEntry({ entryId: 'e1', entityId: 'cmd-1' }));
      await trail.record(makeEntry({ entryId: 'e2', entityId: 'cmd-2' }));
      await trail.record(makeEntry({ entryId: 'e3', entityId: 'cmd-1' }));

      const results = await trail.query({ entityId: 'cmd-1' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.entityId === 'cmd-1')).toBe(true);
    });

    it('should combine multiple filters', async () => {
      await trail.record(makeEntry({ entryId: 'e1', operator: 'alice', operationType: 'command_created', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', operator: 'alice', operationType: 'plan_generated', timestamp: 2000 }));
      await trail.record(makeEntry({ entryId: 'e3', operator: 'bob', operationType: 'command_created', timestamp: 3000 }));

      const results = await trail.query({ operator: 'alice', operationType: 'command_created' });
      expect(results).toHaveLength(1);
      expect(results[0].entryId).toBe('e1');
    });

    it('should support limit', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 2000 }));
      await trail.record(makeEntry({ entryId: 'e3', timestamp: 3000 }));

      const results = await trail.query({ limit: 2 });
      expect(results).toHaveLength(2);
      // Should be the 2 most recent (descending order)
      expect(results.map((e) => e.entryId)).toEqual(['e3', 'e2']);
    });

    it('should support offset', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 2000 }));
      await trail.record(makeEntry({ entryId: 'e3', timestamp: 3000 }));

      const results = await trail.query({ offset: 1, limit: 2 });
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.entryId)).toEqual(['e2', 'e1']);
    });

    it('should return empty array when no entries match', async () => {
      await trail.record(makeEntry({ operator: 'alice' }));
      const results = await trail.query({ operator: 'nonexistent' });
      expect(results).toHaveLength(0);
    });
  });

  describe('export()', () => {
    it('should export filtered entries as valid JSON', async () => {
      await trail.record(makeEntry({ entryId: 'e1', timestamp: 1000 }));
      await trail.record(makeEntry({ entryId: 'e2', timestamp: 2000 }));

      const json = await trail.export({}, 'json');
      const parsed = JSON.parse(json) as AuditEntry[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0].entryId).toBe('e2'); // descending order
    });

    it('should export with filters applied', async () => {
      await trail.record(makeEntry({ entryId: 'e1', operator: 'alice' }));
      await trail.record(makeEntry({ entryId: 'e2', operator: 'bob' }));

      const json = await trail.export({ operator: 'alice' }, 'json');
      const parsed = JSON.parse(json) as AuditEntry[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].operator).toBe('alice');
    });

    it('should produce JSON that round-trips correctly', async () => {
      const entry = makeEntry({
        entryId: 'e1',
        operationType: 'approval_submitted',
        operator: 'admin',
        content: 'Approved plan P-1',
        timestamp: 1234567890,
        result: 'success',
        entityId: 'plan-1',
        entityType: 'plan',
        metadata: { reason: 'looks good' },
      });
      await trail.record(entry);

      const json = await trail.export({}, 'json');
      const parsed = JSON.parse(json) as AuditEntry[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual(entry);
    });
  });
});
