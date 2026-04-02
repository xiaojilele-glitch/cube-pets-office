import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ReplayAuditLogger } from '../replay/audit-logger.js';

const BASE_DIR = resolve('data/replay');

describe('ReplayAuditLogger', () => {
  let logger: ReplayAuditLogger;
  const missionId = 'test-audit-mission';

  beforeEach(async () => {
    if (existsSync(resolve(BASE_DIR, missionId))) {
      await rm(resolve(BASE_DIR, missionId), { recursive: true, force: true });
    }
    logger = new ReplayAuditLogger();
  });

  afterEach(async () => {
    if (existsSync(resolve(BASE_DIR, missionId))) {
      await rm(resolve(BASE_DIR, missionId), { recursive: true, force: true });
    }
  });

  describe('logAction', () => {
    it('creates audit.jsonl and returns a valid AuditEntry', async () => {
      const entry = await logger.logAction('user-1', missionId, 'play');
      expect(entry.id).toBeTruthy();
      expect(entry.userId).toBe('user-1');
      expect(entry.missionId).toBe(missionId);
      expect(entry.action).toBe('play');
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('appends multiple entries to the same file', async () => {
      await logger.logAction('user-1', missionId, 'play');
      await logger.logAction('user-1', missionId, 'pause');
      await logger.logAction('user-2', missionId, 'seek', { timestamp: 5000 });

      const entries = await logger.queryAuditLog({ missionId });
      expect(entries).toHaveLength(3);
    });

    it('stores optional details', async () => {
      const details = { snapshotId: 'snap-1', label: 'test' };
      await logger.logAction('user-1', missionId, 'snapshot', details);

      const entries = await logger.queryAuditLog({ missionId });
      expect(entries[0].details).toEqual(details);
    });
  });

  describe('queryAuditLog', () => {
    it('returns empty array for non-existent mission', async () => {
      const entries = await logger.queryAuditLog({ missionId: 'no-such-mission' });
      expect(entries).toEqual([]);
    });

    it('returns empty array when missionId is not provided', async () => {
      const entries = await logger.queryAuditLog({});
      expect(entries).toEqual([]);
    });

    it('filters by userId', async () => {
      await logger.logAction('user-1', missionId, 'play');
      await logger.logAction('user-2', missionId, 'pause');

      const entries = await logger.queryAuditLog({ missionId, userId: 'user-1' });
      expect(entries).toHaveLength(1);
      expect(entries[0].userId).toBe('user-1');
    });

    it('filters by time range', async () => {
      const e1 = await logger.logAction('user-1', missionId, 'play');
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await logger.logAction('user-1', missionId, 'pause');

      const entries = await logger.queryAuditLog({
        missionId,
        startTime: e1.timestamp,
        endTime: e1.timestamp,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('play');
    });
  });
});
