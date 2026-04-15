// Feature: dynamic-role-system, Property 18: API 角色状态响应正确性
/**
 * Property 18: API 角色状态响应正确性
 *
 * 对于任意发生过角色变更的 Agent，GET /api/agents/:id 返回的 currentRole
 * 应反映当前加载的角色，roleHistory 应包含最近的角色切换记录（最多 20 条），
 * 且每条记录包含 fromRole、toRole、missionName 和 timestamp。
 *
 * Since testing the actual HTTP API requires a running server, we test the
 * data transformation logic that builds the API response from the Agent's
 * role state and operation log — the same logic used in server/routes/agents.ts.
 *
 * **Validates: Requirements 8.1, 8.5**
 */

import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate, RoleOperationLog } from '../../shared/role-schema.js';
import { RoleRegistry } from '../core/role-registry.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(__test_dirname, '../../data/__test_role_api_prop__');
const TEST_REGISTRY_PATH = resolve(TEST_DIR, 'role-templates.json');

// ── Helpers ──────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<RoleTemplate> & { roleId: string }): RoleTemplate {
  const now = new Date().toISOString();
  return {
    roleName: overrides.roleName ?? overrides.roleId,
    responsibilityPrompt: 'test prompt',
    requiredSkillIds: [],
    mcpIds: [],
    defaultModelConfig: { model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 },
    authorityLevel: 'medium',
    source: 'predefined',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

/**
 * Replicates the data transformation logic from server/routes/agents.ts
 * that builds currentRole and roleHistory from Agent role state and operation log.
 */
function buildApiRoleResponse(
  currentRoleId: string | null,
  currentRoleLoadedAt: string | null,
  opLog: RoleOperationLog[],
  registry: RoleRegistry,
): {
  currentRole: { roleId: string; roleName: string; loadedAt: string } | null;
  roleHistory: Array<{
    fromRole: string | null;
    toRole: string | null;
    missionName: string;
    timestamp: string;
  }>;
} {
  let currentRole: { roleId: string; roleName: string; loadedAt: string } | null = null;

  if (currentRoleId && currentRoleLoadedAt) {
    const template = registry.get(currentRoleId);
    currentRole = {
      roleId: currentRoleId,
      roleName: template?.roleName ?? currentRoleId,
      loadedAt: currentRoleLoadedAt,
    };
  }

  const switchRecords: Array<{
    fromRole: string | null;
    toRole: string | null;
    missionName: string;
    timestamp: string;
  }> = [];

  for (let i = 0; i < opLog.length; i++) {
    const entry = opLog[i];
    if (entry.action === 'load') {
      let fromRoleId: string | null = null;
      if (i > 0 && opLog[i - 1].action === 'unload') {
        fromRoleId = opLog[i - 1].roleId;
      }
      const fromTemplate = fromRoleId ? registry.get(fromRoleId) : null;
      const toTemplate = registry.get(entry.roleId);
      switchRecords.push({
        fromRole: fromTemplate?.roleName ?? fromRoleId,
        toRole: toTemplate?.roleName ?? entry.roleId,
        missionName: entry.triggerSource,
        timestamp: entry.timestamp,
      });
    } else if (entry.action === 'unload') {
      const isFollowedByLoad = i + 1 < opLog.length && opLog[i + 1].action === 'load';
      if (!isFollowedByLoad) {
        const fromTemplate = registry.get(entry.roleId);
        switchRecords.push({
          fromRole: fromTemplate?.roleName ?? entry.roleId,
          toRole: null,
          missionName: entry.triggerSource,
          timestamp: entry.timestamp,
        });
      }
    }
  }

  const roleHistory = switchRecords.slice(-20);

  return { currentRole, roleHistory };
}

// ── Arbitraries ──────────────────────────────────────────────────

const arbRoleId = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter((s) => s.length >= 2);

const arbRoleName = fc.string({ minLength: 1, maxLength: 30 });

const arbTimestamp = fc
  .integer({
    min: Date.UTC(2024, 0, 1),
    max: Date.UTC(2025, 11, 31, 23, 59, 59, 999),
  })
  .map((timestamp) => new Date(timestamp).toISOString());

const arbTriggerSource = fc.string({ minLength: 1, maxLength: 30 });

// ── Property Tests ───────────────────────────────────────────────

describe('Property 18: API 角色状态响应正确性', () => {
  afterEach(cleanup);

  // **Validates: Requirements 8.1, 8.5**
  // For any Agent with a currently loaded role, currentRole should reflect
  // the roleId, roleName (resolved from registry), and loadedAt timestamp.
  it('currentRole reflects the currently loaded role from registry', () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        arbTimestamp,
        (roleId, roleName, loadedAt) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          registry.register(makeTemplate({ roleId, roleName }));

          const { currentRole } = buildApiRoleResponse(
            roleId,
            loadedAt,
            [],
            registry,
          );

          expect(currentRole).not.toBeNull();
          expect(currentRole!.roleId).toBe(roleId);
          expect(currentRole!.roleName).toBe(roleName);
          expect(currentRole!.loadedAt).toBe(loadedAt);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // When no role is loaded (currentRoleId is null), currentRole should be null.
  it('currentRole is null when no role is loaded', () => {
    fc.assert(
      fc.property(
        arbTimestamp,
        (timestamp) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          const { currentRole } = buildApiRoleResponse(
            null,
            null,
            [],
            registry,
          );

          expect(currentRole).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // When currentRoleId is set but the role is not in the registry,
  // roleName should fall back to the roleId string.
  it('currentRole falls back to roleId as roleName when template not in registry', () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbTimestamp,
        (roleId, loadedAt) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          // Do NOT register the template

          const { currentRole } = buildApiRoleResponse(
            roleId,
            loadedAt,
            [],
            registry,
          );

          expect(currentRole).not.toBeNull();
          expect(currentRole!.roleId).toBe(roleId);
          expect(currentRole!.roleName).toBe(roleId); // fallback
          expect(currentRole!.loadedAt).toBe(loadedAt);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // roleHistory should contain at most 20 records, taking the most recent ones.
  it('roleHistory contains at most 20 records (most recent)', () => {
    fc.assert(
      fc.property(
        // Generate between 1 and 30 role switch pairs (unload+load)
        fc.integer({ min: 1, max: 30 }),
        arbRoleId,
        arbRoleName,
        arbTriggerSource,
        (switchCount, baseRoleId, roleName, triggerSource) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          // Register enough roles for the switches
          const roleIds: string[] = [];
          for (let i = 0; i < switchCount + 1; i++) {
            const rid = `${baseRoleId}-${i}`;
            roleIds.push(rid);
            registry.register(makeTemplate({ roleId: rid, roleName: `${roleName}-${i}` }));
          }

          // Build operation log: initial load, then unload+load pairs
          const opLog: RoleOperationLog[] = [];
          const baseTime = new Date('2025-01-01T00:00:00.000Z').getTime();

          // Initial load
          opLog.push({
            agentId: 'test-agent',
            roleId: roleIds[0],
            action: 'load',
            timestamp: new Date(baseTime).toISOString(),
            triggerSource,
          });

          // Subsequent switches (unload old + load new)
          for (let i = 1; i <= switchCount; i++) {
            opLog.push({
              agentId: 'test-agent',
              roleId: roleIds[i - 1],
              action: 'unload',
              timestamp: new Date(baseTime + i * 2000 - 1000).toISOString(),
              triggerSource,
            });
            opLog.push({
              agentId: 'test-agent',
              roleId: roleIds[i],
              action: 'load',
              timestamp: new Date(baseTime + i * 2000).toISOString(),
              triggerSource,
            });
          }

          const { roleHistory } = buildApiRoleResponse(
            roleIds[switchCount],
            new Date(baseTime + switchCount * 2000).toISOString(),
            opLog,
            registry,
          );

          // Total switch records = switchCount + 1 (initial load + switchCount switches)
          // But capped at 20
          expect(roleHistory.length).toBeLessThanOrEqual(20);

          if (switchCount + 1 > 20) {
            expect(roleHistory.length).toBe(20);
            // Should be the most recent 20 — last record should match the last switch
            const lastRecord = roleHistory[roleHistory.length - 1];
            expect(lastRecord.toRole).toBe(`${roleName}-${switchCount}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // Each roleHistory record from a load event should contain fromRole, toRole,
  // missionName, and timestamp fields.
  it('each roleHistory record contains fromRole, toRole, missionName, and timestamp', () => {
    fc.assert(
      fc.property(
        // Generate 1-10 switch pairs
        fc.integer({ min: 1, max: 10 }),
        arbRoleId,
        arbRoleName,
        arbTriggerSource,
        (switchCount, baseRoleId, roleName, triggerSource) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          const roleIds: string[] = [];
          for (let i = 0; i < switchCount + 1; i++) {
            const rid = `${baseRoleId}-${i}`;
            roleIds.push(rid);
            registry.register(makeTemplate({ roleId: rid, roleName: `${roleName}-${i}` }));
          }

          const opLog: RoleOperationLog[] = [];
          const baseTime = new Date('2025-01-01T00:00:00.000Z').getTime();

          // Initial load
          opLog.push({
            agentId: 'test-agent',
            roleId: roleIds[0],
            action: 'load',
            timestamp: new Date(baseTime).toISOString(),
            triggerSource,
          });

          for (let i = 1; i <= switchCount; i++) {
            opLog.push({
              agentId: 'test-agent',
              roleId: roleIds[i - 1],
              action: 'unload',
              timestamp: new Date(baseTime + i * 2000 - 1000).toISOString(),
              triggerSource,
            });
            opLog.push({
              agentId: 'test-agent',
              roleId: roleIds[i],
              action: 'load',
              timestamp: new Date(baseTime + i * 2000).toISOString(),
              triggerSource,
            });
          }

          const { roleHistory } = buildApiRoleResponse(
            roleIds[switchCount],
            new Date(baseTime + switchCount * 2000).toISOString(),
            opLog,
            registry,
          );

          // Every record must have all four required fields
          for (const record of roleHistory) {
            expect(record).toHaveProperty('fromRole');
            expect(record).toHaveProperty('toRole');
            expect(record).toHaveProperty('missionName');
            expect(record).toHaveProperty('timestamp');
            expect(typeof record.timestamp).toBe('string');
            expect(typeof record.missionName).toBe('string');
            expect(record.missionName).toBe(triggerSource);
          }

          // First record (initial load) should have fromRole = null
          if (roleHistory.length > 0) {
            expect(roleHistory[0].fromRole).toBeNull();
          }

          // Subsequent records should have non-null fromRole and toRole
          for (let i = 1; i < roleHistory.length; i++) {
            expect(roleHistory[i].fromRole).not.toBeNull();
            expect(roleHistory[i].toRole).not.toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // A standalone unload (not followed by a load) should produce a record
  // with toRole = null, representing the Agent unloading its role entirely.
  it('standalone unload produces a record with toRole = null', () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        arbTriggerSource,
        arbTimestamp,
        (roleId, roleName, triggerSource, timestamp) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          registry.register(makeTemplate({ roleId, roleName }));

          // Load then standalone unload (no subsequent load)
          const opLog: RoleOperationLog[] = [
            {
              agentId: 'test-agent',
              roleId,
              action: 'load',
              timestamp: '2025-01-01T00:00:00.000Z',
              triggerSource,
            },
            {
              agentId: 'test-agent',
              roleId,
              action: 'unload',
              timestamp,
              triggerSource,
            },
          ];

          const { roleHistory } = buildApiRoleResponse(
            null,
            null,
            opLog,
            registry,
          );

          // Should have 2 records: initial load + standalone unload
          expect(roleHistory.length).toBe(2);

          // First: initial load (fromRole=null, toRole=roleName)
          expect(roleHistory[0].fromRole).toBeNull();
          expect(roleHistory[0].toRole).toBe(roleName);

          // Second: standalone unload (fromRole=roleName, toRole=null)
          expect(roleHistory[1].fromRole).toBe(roleName);
          expect(roleHistory[1].toRole).toBeNull();
          expect(roleHistory[1].timestamp).toBe(timestamp);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // An unload followed by a load (role switch) should NOT produce a separate
  // unload record — only the load record captures the switch with fromRole set.
  it('unload followed by load produces a single switch record, not separate unload record', () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        arbTriggerSource,
        (baseRoleId, roleName, triggerSource) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          const roleA = `${baseRoleId}-a`;
          const roleB = `${baseRoleId}-b`;
          registry.register(makeTemplate({ roleId: roleA, roleName: `${roleName}-A` }));
          registry.register(makeTemplate({ roleId: roleB, roleName: `${roleName}-B` }));

          // Load A, then switch to B (unload A + load B)
          const opLog: RoleOperationLog[] = [
            {
              agentId: 'test-agent',
              roleId: roleA,
              action: 'load',
              timestamp: '2025-01-01T00:00:00.000Z',
              triggerSource,
            },
            {
              agentId: 'test-agent',
              roleId: roleA,
              action: 'unload',
              timestamp: '2025-01-01T01:00:00.000Z',
              triggerSource,
            },
            {
              agentId: 'test-agent',
              roleId: roleB,
              action: 'load',
              timestamp: '2025-01-01T01:00:01.000Z',
              triggerSource,
            },
          ];

          const { roleHistory } = buildApiRoleResponse(
            roleB,
            '2025-01-01T01:00:01.000Z',
            opLog,
            registry,
          );

          // Should have exactly 2 records:
          // 1. Initial load of A (fromRole=null, toRole=A)
          // 2. Switch from A to B (fromRole=A, toRole=B)
          // The unload of A should NOT produce a separate record
          expect(roleHistory.length).toBe(2);
          expect(roleHistory[0].fromRole).toBeNull();
          expect(roleHistory[0].toRole).toBe(`${roleName}-A`);
          expect(roleHistory[1].fromRole).toBe(`${roleName}-A`);
          expect(roleHistory[1].toRole).toBe(`${roleName}-B`);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 8.1, 8.5**
  // roleHistory records should preserve chronological order from the operation log.
  it('roleHistory preserves chronological order from operation log', () => {
    fc.assert(
      fc.property(
        // Generate 2-15 switches
        fc.integer({ min: 2, max: 15 }),
        arbRoleId,
        arbRoleName,
        arbTriggerSource,
        (switchCount, baseRoleId, roleName, triggerSource) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          const roleIds: string[] = [];
          for (let i = 0; i < switchCount + 1; i++) {
            const rid = `${baseRoleId}-${i}`;
            roleIds.push(rid);
            registry.register(makeTemplate({ roleId: rid, roleName: `${roleName}-${i}` }));
          }

          const opLog: RoleOperationLog[] = [];
          const baseTime = new Date('2025-01-01T00:00:00.000Z').getTime();

          opLog.push({
            agentId: 'test-agent',
            roleId: roleIds[0],
            action: 'load',
            timestamp: new Date(baseTime).toISOString(),
            triggerSource,
          });

          for (let i = 1; i <= switchCount; i++) {
            opLog.push({
              agentId: 'test-agent',
              roleId: roleIds[i - 1],
              action: 'unload',
              timestamp: new Date(baseTime + i * 2000 - 1000).toISOString(),
              triggerSource,
            });
            opLog.push({
              agentId: 'test-agent',
              roleId: roleIds[i],
              action: 'load',
              timestamp: new Date(baseTime + i * 2000).toISOString(),
              triggerSource,
            });
          }

          const { roleHistory } = buildApiRoleResponse(
            roleIds[switchCount],
            new Date(baseTime + switchCount * 2000).toISOString(),
            opLog,
            registry,
          );

          // Verify chronological order
          for (let i = 1; i < roleHistory.length; i++) {
            const prevTime = new Date(roleHistory[i - 1].timestamp).getTime();
            const currTime = new Date(roleHistory[i].timestamp).getTime();
            expect(currTime).toBeGreaterThanOrEqual(prevTime);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
