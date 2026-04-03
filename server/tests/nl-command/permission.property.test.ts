// Feature: nl-command-center, Property 16: permission enforcement correctness
// **Validates: Requirements 17.1, 17.2, 17.3**

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import type { Permission, UserRole } from '../../../shared/nl-command/contracts.js';
import { PermissionGuard } from '../../core/nl-command/permission-guard.js';
import type { PermissionOverride } from '../../core/nl-command/permission-guard.js';

const ALL_PERMISSIONS: Permission[] = ['view', 'create', 'edit', 'approve', 'execute', 'cancel'];

const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  manager: ['view', 'create', 'edit', 'approve'],
  operator: ['view', 'create', 'edit', 'execute'],
  viewer: ['view'],
};

// --- Generators ---

const roleArb: fc.Arbitrary<UserRole> = fc.constantFrom('admin', 'manager', 'operator', 'viewer');
const permissionArb: fc.Arbitrary<Permission> = fc.constantFrom('view', 'create', 'edit', 'approve', 'execute', 'cancel');
const userIdArb = fc.constantFrom('user-a', 'user-b', 'user-c', 'user-d');
const entityTypeArb = fc.constantFrom('command', 'mission', 'task', 'plan');
const entityIdArb = fc.constantFrom('ent-1', 'ent-2', 'ent-3', 'ent-4');

const permissionOverrideArb: fc.Arbitrary<PermissionOverride> = fc
  .subarray([...ALL_PERMISSIONS], { minLength: 0 })
  .chain((grant) => {
    const remaining = ALL_PERMISSIONS.filter((p) => !grant.includes(p));
    return fc.subarray(remaining, { minLength: 0 }).map((deny) => ({ grant, deny }));
  });

// --- Tests ---

describe('Property 16: permission enforcement correctness', () => {
  let guard: PermissionGuard;

  beforeEach(() => {
    guard = new PermissionGuard();
  });

  it('checkPermission SHALL return true iff the role permission set includes the required permission', () => {
    fc.assert(
      fc.property(userIdArb, roleArb, permissionArb, (userId, role, permission) => {
        const expected = DEFAULT_ROLE_PERMISSIONS[role].includes(permission);
        expect(guard.checkPermission(userId, role, permission)).toBe(expected);
      }),
      { numRuns: 20 },
    );
  });

  it('entity-level grant override SHALL add permission even if role lacks it', () => {
    fc.assert(
      fc.property(userIdArb, roleArb, permissionArb, entityTypeArb, entityIdArb,
        (userId, role, permission, entityType, entityId) => {
          guard.setOverride(userId, { grant: [permission], deny: [] }, entityType, entityId);
          expect(guard.checkPermission(userId, role, permission, entityType, entityId)).toBe(true);
        }),
      { numRuns: 20 },
    );
  });

  it('entity-level deny override SHALL remove permission even if role has it', () => {
    fc.assert(
      fc.property(userIdArb, roleArb, permissionArb, entityTypeArb, entityIdArb,
        (userId, role, permission, entityType, entityId) => {
          guard.setOverride(userId, { grant: [], deny: [permission] }, entityType, entityId);
          expect(guard.checkPermission(userId, role, permission, entityType, entityId)).toBe(false);
        }),
      { numRuns: 20 },
    );
  });

  it('fine-grained entity-level permissions SHALL override role-level permissions', () => {
    fc.assert(
      fc.property(userIdArb, roleArb, permissionOverrideArb, entityTypeArb, entityIdArb,
        (userId, role, override, entityType, entityId) => {
          guard.setOverride(userId, override, entityType, entityId);
          const basePerms = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
          for (const p of override.grant) basePerms.add(p);
          for (const p of override.deny) basePerms.delete(p);
          for (const perm of ALL_PERMISSIONS) {
            expect(guard.checkPermission(userId, role, perm, entityType, entityId)).toBe(basePerms.has(perm));
          }
        }),
      { numRuns: 20 },
    );
  });

  it('more specific overrides SHALL take precedence over less specific ones', () => {
    fc.assert(
      fc.property(userIdArb, roleArb, permissionOverrideArb, permissionOverrideArb, permissionOverrideArb, entityTypeArb, entityIdArb,
        (userId, role, globalOv, typeOv, entityOv, entityType, entityId) => {
          guard.setOverride(userId, globalOv);
          guard.setOverride(userId, typeOv, entityType);
          guard.setOverride(userId, entityOv, entityType, entityId);
          const effective = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
          for (const p of globalOv.grant) effective.add(p);
          for (const p of globalOv.deny) effective.delete(p);
          for (const p of typeOv.grant) effective.add(p);
          for (const p of typeOv.deny) effective.delete(p);
          for (const p of entityOv.grant) effective.add(p);
          for (const p of entityOv.deny) effective.delete(p);
          for (const perm of ALL_PERMISSIONS) {
            expect(guard.checkPermission(userId, role, perm, entityType, entityId)).toBe(effective.has(perm));
          }
        }),
      { numRuns: 20 },
    );
  });

  it('overrides for one user SHALL NOT affect another user', () => {
    fc.assert(
      fc.property(fc.constantFrom('user-a', 'user-b'), fc.constantFrom('user-c', 'user-d'), roleArb, permissionArb,
        (targetUser, otherUser, role, permission) => {
          guard.setOverride(targetUser, { grant: [permission], deny: [] });
          const expected = DEFAULT_ROLE_PERMISSIONS[role].includes(permission);
          expect(guard.checkPermission(otherUser, role, permission)).toBe(expected);
        }),
      { numRuns: 20 },
    );
  });
});
