/**
 * Unit tests + Property-based tests for DynamicPermissionManager
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import type {
  AgentRole,
  AgentPermissionPolicy,
  Permission,
  PermissionTemplate,
  PermissionEscalation,
  ResourceType,
  Action,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES, ACTIONS } from "../../shared/permission/contracts.js";
import { RoleStore } from "./role-store.js";
import { PolicyStore } from "./policy-store.js";
import { TokenService } from "./token-service.js";
import { PermissionCheckEngine } from "./check-engine.js";
import type { AuditLogger } from "./check-engine.js";
import { DynamicPermissionManager } from "./dynamic-manager.js";
import type { DynamicManagerDb } from "./dynamic-manager.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];
  let escalations: PermissionEscalation[] = [];
  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: AgentRole[]) => { roles = r; },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => { policies = p; },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => { templates = t; },
    getPermissionEscalations: () => escalations,
    setPermissionEscalations: (e: PermissionEscalation[]) => { escalations = e; },
  };
}

/* ─── Helpers ─── */

const SECRET = "test-dynamic-manager-secret";

function makePermission(
  resourceType: ResourceType = "filesystem",
  action: Action = "read",
  effect: "allow" | "deny" = "allow",
): Permission {
  return { resourceType, action, constraints: {}, effect };
}

function setup() {
  const db = createInMemoryDb();
  const roleStore = new RoleStore(db as any);
  const policyStore = new PolicyStore(db as any, roleStore);
  const tokenService = new TokenService(policyStore, roleStore, SECRET);
  const engine = new PermissionCheckEngine(tokenService);
  const manager = new DynamicPermissionManager(
    policyStore,
    tokenService,
    db as DynamicManagerDb,
  );
  manager.setCheckEngine(engine);
  return { db, roleStore, policyStore, tokenService, engine, manager };
}

/** Create a role + policy for an agent with given permissions */
function seedAgent(
  roleStore: RoleStore,
  policyStore: PolicyStore,
  agentId: string,
  permissions: Permission[] = [],
) {
  roleStore.createRole({
    roleId: `role-${agentId}`,
    roleName: `Role ${agentId}`,
    description: "",
    permissions,
  });
  policyStore.createPolicy({
    agentId,
    assignedRoles: [`role-${agentId}`],
    customPermissions: [],
    deniedPermissions: [],
    effectiveAt: new Date().toISOString(),
    expiresAt: null,
  });
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe("DynamicPermissionManager", () => {
  describe("grantTemporaryPermission", () => {
    it("adds permission to customPermissions and tracks expiry", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-1");

      const perm = makePermission("filesystem", "write");
      manager.grantTemporaryPermission("agent-1", perm, 60_000);

      // Permission should appear in effective permissions
      const effective = policyStore.resolveEffectivePermissions("agent-1");
      const found = effective.find(
        (p) => p.resourceType === "filesystem" && p.action === "write",
      );
      expect(found).toBeDefined();

      // Temp tracking should exist
      const tempMap = manager.getTempPermissions("agent-1");
      expect(tempMap).toBeDefined();
      expect(tempMap!.size).toBe(1);
    });

    it("throws if agent has no policy", () => {
      const { manager } = setup();
      const perm = makePermission();
      expect(() =>
        manager.grantTemporaryPermission("nonexistent", perm, 1000),
      ).toThrow("No policy found");
    });

    it("does not duplicate permission if granted twice", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-2");

      const perm = makePermission("network", "connect");
      manager.grantTemporaryPermission("agent-2", perm, 60_000);
      manager.grantTemporaryPermission("agent-2", perm, 120_000);

      const policy = policyStore.getPolicy("agent-2")!;
      const matching = policy.customPermissions.filter(
        (p) => p.resourceType === "network" && p.action === "connect",
      );
      expect(matching.length).toBe(1);
    });
  });

  describe("revokePermission", () => {
    it("removes from customPermissions and adds to deniedPermissions", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-3");

      const perm = makePermission("filesystem", "write");
      manager.grantTemporaryPermission("agent-3", perm, 60_000);
      manager.revokePermission("agent-3", perm);

      const policy = policyStore.getPolicy("agent-3")!;
      // Should not be in customPermissions
      const inCustom = policy.customPermissions.find(
        (p) => p.resourceType === "filesystem" && p.action === "write",
      );
      expect(inCustom).toBeUndefined();

      // Should be in deniedPermissions
      const inDenied = policy.deniedPermissions.find(
        (p) => p.resourceType === "filesystem" && p.action === "write",
      );
      expect(inDenied).toBeDefined();

      // Should not appear in effective permissions
      const effective = policyStore.resolveEffectivePermissions("agent-3");
      const found = effective.find(
        (p) => p.resourceType === "filesystem" && p.action === "write",
      );
      expect(found).toBeUndefined();
    });

    it("throws if agent has no policy", () => {
      const { manager } = setup();
      expect(() =>
        manager.revokePermission("nonexistent", makePermission()),
      ).toThrow("No policy found");
    });

    it("removes temp tracking when revoking", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-4");

      const perm = makePermission("api", "call");
      manager.grantTemporaryPermission("agent-4", perm, 60_000);
      expect(manager.getTempPermissions("agent-4")?.size).toBe(1);

      manager.revokePermission("agent-4", perm);
      expect(manager.getTempPermissions("agent-4")?.size).toBe(0);
    });
  });

  describe("escalatePermission", () => {
    it("creates a pending escalation record in the database", () => {
      const { db, roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-5");

      const escalationId = manager.escalatePermission(
        "agent-5",
        "Need write access for deployment",
        ["admin-1", "admin-2"],
      );

      expect(escalationId).toBeTruthy();
      const escalations = db.getPermissionEscalations();
      expect(escalations.length).toBe(1);
      expect(escalations[0].id).toBe(escalationId);
      expect(escalations[0].agentId).toBe("agent-5");
      expect(escalations[0].status).toBe("pending");
      expect(escalations[0].approverList).toEqual(["admin-1", "admin-2"]);
      expect(escalations[0].reason).toBe("Need write access for deployment");
    });

    it("returns unique IDs for multiple escalations", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-6");

      const id1 = manager.escalatePermission("agent-6", "reason1", ["a"]);
      const id2 = manager.escalatePermission("agent-6", "reason2", ["b"]);
      expect(id1).not.toBe(id2);
    });
  });

  describe("cleanupExpiredPermissions", () => {
    it("removes expired temporary permissions", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-7");

      const perm = makePermission("filesystem", "execute");
      // Grant with 0ms duration — already expired
      manager.grantTemporaryPermission("agent-7", perm, 0);

      // Cleanup should remove it
      manager.cleanupExpiredPermissions();

      const effective = policyStore.resolveEffectivePermissions("agent-7");
      const found = effective.find(
        (p) => p.resourceType === "filesystem" && p.action === "execute",
      );
      expect(found).toBeUndefined();
    });

    it("keeps non-expired temporary permissions", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-8");

      const perm = makePermission("database", "select");
      manager.grantTemporaryPermission("agent-8", perm, 999_999_999);

      manager.cleanupExpiredPermissions();

      const effective = policyStore.resolveEffectivePermissions("agent-8");
      const found = effective.find(
        (p) => p.resourceType === "database" && p.action === "select",
      );
      expect(found).toBeDefined();
    });

    it("handles multiple agents with mixed expiry", () => {
      const { roleStore, policyStore, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-9a");
      seedAgent(roleStore, policyStore, "agent-9b");

      // agent-9a: expired
      manager.grantTemporaryPermission(
        "agent-9a",
        makePermission("filesystem", "write"),
        0,
      );
      // agent-9b: not expired
      manager.grantTemporaryPermission(
        "agent-9b",
        makePermission("network", "connect"),
        999_999_999,
      );

      manager.cleanupExpiredPermissions();

      const eff9a = policyStore.resolveEffectivePermissions("agent-9a");
      expect(
        eff9a.find((p) => p.resourceType === "filesystem" && p.action === "write"),
      ).toBeUndefined();

      const eff9b = policyStore.resolveEffectivePermissions("agent-9b");
      expect(
        eff9b.find((p) => p.resourceType === "network" && p.action === "connect"),
      ).toBeDefined();
    });
  });

  describe("token refresh after changes", () => {
    it("refreshes token after granting permission", () => {
      const { roleStore, policyStore, tokenService, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-10");

      const refreshSpy = vi.spyOn(tokenService, "refreshToken");
      manager.grantTemporaryPermission(
        "agent-10",
        makePermission("filesystem", "read"),
        60_000,
      );
      expect(refreshSpy).toHaveBeenCalledWith("agent-10");
    });

    it("refreshes token after revoking permission", () => {
      const { roleStore, policyStore, tokenService, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-11");

      const perm = makePermission("filesystem", "write");
      manager.grantTemporaryPermission("agent-11", perm, 60_000);

      const refreshSpy = vi.spyOn(tokenService, "refreshToken");
      manager.revokePermission("agent-11", perm);
      expect(refreshSpy).toHaveBeenCalledWith("agent-11");
    });

    it("invalidates check engine cache after changes", () => {
      const { roleStore, policyStore, engine, manager } = setup();
      seedAgent(roleStore, policyStore, "agent-12");

      const cacheSpy = vi.spyOn(engine, "invalidateCache");
      manager.grantTemporaryPermission(
        "agent-12",
        makePermission("api", "call"),
        60_000,
      );
      expect(cacheSpy).toHaveBeenCalledWith("agent-12");
    });
  });

  describe("audit logging", () => {
    it("logs grant operations when auditLogger is provided", () => {
      const db = createInMemoryDb();
      const roleStore = new RoleStore(db as any);
      const policyStore = new PolicyStore(db as any, roleStore);
      const tokenService = new TokenService(policyStore, roleStore, SECRET);
      const auditLog: any[] = [];
      const auditLogger: AuditLogger = {
        log: (entry) => auditLog.push(entry),
      };
      const manager = new DynamicPermissionManager(
        policyStore,
        tokenService,
        db as DynamicManagerDb,
        auditLogger,
      );

      seedAgent(roleStore, policyStore, "agent-13");
      manager.grantTemporaryPermission(
        "agent-13",
        makePermission("filesystem", "write"),
        60_000,
      );

      expect(auditLog.length).toBe(1);
      expect(auditLog[0].operation).toBe("grant");
      expect(auditLog[0].agentId).toBe("agent-13");
    });
  });
});


// ─── Property-Based Tests ───────────────────────────────────────────────────

describe("Property 10: 临时权限自动过期", () => {
  /**
   * **Validates: Requirements 9.1**
   *
   * For any permission granted with duration D, after cleanup at time > D,
   * resolveEffectivePermissions should NOT contain that permission.
   */
  it("temporary permissions are removed after expiry and cleanup", () => {
    fc.assert(
      fc.property(
        // Random resource type
        fc.constantFrom(...RESOURCE_TYPES),
        // Random action
        fc.constantFrom(...ACTIONS),
        // Duration: 1ms to 10s (keep small so we can simulate expiry)
        fc.integer({ min: 1, max: 10_000 }),
        (resourceType, action, durationMs) => {
          const db = createInMemoryDb();
          const roleStore = new RoleStore(db as any);
          const policyStore = new PolicyStore(db as any, roleStore);
          const tokenService = new TokenService(policyStore, roleStore, SECRET);
          const manager = new DynamicPermissionManager(
            policyStore,
            tokenService,
            db as DynamicManagerDb,
          );

          const agentId = "pbt-agent";
          const perm: Permission = {
            resourceType,
            action,
            constraints: {},
            effect: "allow",
          };

          // Create a base policy with no permissions
          policyStore.createPolicy({
            agentId,
            assignedRoles: [],
            customPermissions: [],
            deniedPermissions: [],
            effectiveAt: new Date().toISOString(),
            expiresAt: null,
          });

          // Grant temporary permission
          manager.grantTemporaryPermission(agentId, perm, durationMs);

          // Verify it's in effective permissions before expiry
          const beforeCleanup = policyStore.resolveEffectivePermissions(agentId);
          const foundBefore = beforeCleanup.some(
            (p) => p.resourceType === resourceType && p.action === action,
          );
          if (!foundBefore) return false; // Should be present before cleanup

          // Simulate time passing: manipulate the temp tracking to be expired
          const tempMap = manager.getTempPermissions(agentId);
          if (!tempMap) return false;
          // Set all entries to expired (past time)
          tempMap.forEach((_expiresAt, key) => {
            tempMap.set(key, Date.now() - 1);
          });

          // Run cleanup
          manager.cleanupExpiredPermissions();

          // After cleanup, the permission should NOT be in effective permissions
          const afterCleanup = policyStore.resolveEffectivePermissions(agentId);
          const foundAfter = afterCleanup.some(
            (p) => p.resourceType === resourceType && p.action === action,
          );

          return !foundAfter;
        },
      ),
      { numRuns: 100 },
    );
  });
});
