/**
 * Property-based tests for ReplayAuditLogger and access control
 *
 * Tasks 11.4, 11.5, 11.6
 * Feature: collaboration-replay
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AuditEntry } from '../../shared/replay/contracts';
import { ReplayAuditLogger } from '../../server/replay/audit-logger';
import {
  registerMissionOwner,
  replayAccessControl,
} from '../../server/replay/access-control';

/* ─── Helpers ─── */

const BASE_DIR = resolve('data/replay');
const createdMissions: string[] = [];

function uniqueMissionId(prefix = 'audit'): string {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createdMissions.push(id);
  return id;
}

afterEach(async () => {
  for (const mid of createdMissions) {
    const dir = resolve(BASE_DIR, mid);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  createdMissions.length = 0;
});

/* ─── Arbitraries ─── */

const actionArb = fc.constantFrom(
  'play' as const, 'pause' as const, 'seek' as const,
  'export' as const, 'snapshot' as const, 'view' as const,
);
const userIdArb = fc.constantFrom('user-alice', 'user-bob', 'user-charlie');

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 11.4 — Property 36: Audit log completeness
 * Feature: collaboration-replay, Property 36: 审计日志完整性
 * Validates: Requirements 20.1
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 36: Audit log completeness', () => {
  it('every logged action appears in the audit log with matching fields', async () => {
    // **Validates: Requirements 20.1**
    let runIdx = 0;
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        actionArb,
        async (userId, action) => {
          const logger = new ReplayAuditLogger();
          const mid = uniqueMissionId(`completeness-${runIdx++}`);

          const entry = await logger.logAction(userId, mid, action);

          expect(entry.userId).toBe(userId);
          expect(entry.missionId).toBe(mid);
          expect(entry.action).toBe(action);
          expect(typeof entry.id).toBe('string');
          expect(typeof entry.timestamp).toBe('number');

          // Query back and verify
          const results = await logger.queryAuditLog({ missionId: mid });
          const found = results.find((e) => e.id === entry.id);
          expect(found).toBeDefined();
          expect(found!.action).toBe(action);
          expect(found!.userId).toBe(userId);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('multiple actions are all recorded', async () => {
    const logger = new ReplayAuditLogger();
    const mid = uniqueMissionId('multi-action');

    const actions: AuditEntry['action'][] = ['play', 'pause', 'seek', 'export'];
    for (const action of actions) {
      await logger.logAction('user-alice', mid, action);
    }

    const results = await logger.queryAuditLog({ missionId: mid });
    expect(results.length).toBe(actions.length);

    const loggedActions = results.map((e) => e.action).sort();
    expect(loggedActions).toEqual([...actions].sort());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 11.5 — Property 37: Audit log query roundtrip
 * Feature: collaboration-replay, Property 37: 审计日志查询往返
 * Validates: Requirements 20.2
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 37: Audit log query roundtrip', () => {
  it('entries can be retrieved by userId filter', async () => {
    // **Validates: Requirements 20.2**
    let runIdx = 0;
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.array(actionArb, { minLength: 1, maxLength: 5 }),
        async (userId, actions) => {
          const logger = new ReplayAuditLogger();
          const mid = uniqueMissionId(`query-user-${runIdx++}`);

          // Log actions from target user
          for (const action of actions) {
            await logger.logAction(userId, mid, action);
          }
          // Log an action from a different user
          const otherUser = userId === 'user-alice' ? 'user-bob' : 'user-alice';
          await logger.logAction(otherUser, mid, 'view');

          // Query by userId
          const results = await logger.queryAuditLog({ missionId: mid, userId });
          expect(results.length).toBe(actions.length);
          for (const entry of results) {
            expect(entry.userId).toBe(userId);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('entries can be retrieved by time range', async () => {
    // **Validates: Requirements 20.2**
    const logger = new ReplayAuditLogger();
    const mid = uniqueMissionId('query-time');

    const entry1 = await logger.logAction('user-alice', mid, 'play');
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const entry2 = await logger.logAction('user-alice', mid, 'pause');

    // Query with time range that includes only the second entry
    const results = await logger.queryAuditLog({
      missionId: mid,
      startTime: entry2.timestamp,
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(entry2.id);
  });

  it('query with no missionId returns empty', async () => {
    const logger = new ReplayAuditLogger();
    const results = await logger.queryAuditLog({});
    expect(results).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 11.6 — Property 39: Role-based access control
 * Feature: collaboration-replay, Property 39: 基于角色的访问控制
 * Validates: Requirements 20.4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 39: Role-based access control', () => {
  function mockReqResNext(headers: Record<string, string>, params: Record<string, string> = {}) {
    const req = { headers, params } as any;
    let statusCode = 0;
    let body: any = null;
    let nextCalled = false;
    const res = {
      status(code: number) { statusCode = code; return res; },
      json(data: any) { body = data; return res; },
    } as any;
    const next = () => { nextCalled = true; };
    return { req, res, next, getStatus: () => statusCode, getBody: () => body, wasNextCalled: () => nextCalled };
  }

  it('admin role can access any mission', () => {
    // **Validates: Requirements 20.4**
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (userId, missionId) => {
          // Register a different owner
          registerMissionOwner(missionId, 'someone-else');

          const { req, res, next, wasNextCalled } = mockReqResNext(
            { 'x-user-id': userId, 'x-user-role': 'admin' },
            { missionId },
          );

          replayAccessControl(req, res, next);
          expect(wasNextCalled()).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('regular user can access own mission', () => {
    // **Validates: Requirements 20.4**
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (userId) => {
          const missionId = `own-mission-${userId}`;
          registerMissionOwner(missionId, userId);

          const { req, res, next, wasNextCalled } = mockReqResNext(
            { 'x-user-id': userId, 'x-user-role': 'user' },
            { missionId },
          );

          replayAccessControl(req, res, next);
          expect(wasNextCalled()).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('regular user is denied access to other users mission', () => {
    // **Validates: Requirements 20.4**
    const missionId = 'acl-test-mission';
    registerMissionOwner(missionId, 'owner-user');

    const { req, res, next, wasNextCalled, getStatus } = mockReqResNext(
      { 'x-user-id': 'intruder', 'x-user-role': 'user' },
      { missionId },
    );

    replayAccessControl(req, res, next);
    expect(wasNextCalled()).toBe(false);
    expect(getStatus()).toBe(403);
  });

  it('missing x-user-id returns 401', () => {
    // **Validates: Requirements 20.4**
    const { req, res, next, wasNextCalled, getStatus } = mockReqResNext(
      {},
      { missionId: 'any-mission' },
    );

    replayAccessControl(req, res, next);
    expect(wasNextCalled()).toBe(false);
    expect(getStatus()).toBe(401);
  });
});
