/**
 * Unit tests + Property-based tests for PolicyStore
 *
 * Validates: Requirements 2.1, 2.3, 2.4, 10.5
 */

import { describe, expect, it, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  AgentPermissionPolicy,
  AgentRole,
  Permission,
  PermissionTemplate,
  ResourceType,
  Action,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES, ACTIONS } from "../../shared/permission/contracts.js";
import { PolicyStore } from "../permission/policy-store.js";
import { RoleStore } from "../permission/role-store.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];

  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: AgentRole[]) => {
      roles = r;
    },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => {
      policies = p;
    },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => {
      templates = t;
    },
    _reset: () => {
      roles = [];
      policies = [];
      templates = [];
    },
  };
}

type StubDb = ReturnType<typeof createInMemoryDb>;

/* ─── Helper: create a minimal policy input ─── */

function minimalPolicy(
  agentId: string,
  overrides: Partial<
    Omit<AgentPermissionPolicy, "version" | "createdAt" | "updatedAt">
  > = {}
): Omit<AgentPermissionPolicy, "version" | "createdAt" | "updatedAt"> {
  return {
    agentId,
    assignedRoles: [],
    customPermissions: [],
    deniedPermissions: [],
    effectiveAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  };
}

describe("PolicyStore", () => {
  let db: StubDb;
  let roleStore: RoleStore;
  let store: PolicyStore;

  beforeEach(() => {
    db = createInMemoryDb();
    roleStore = new RoleStore(db as any);
    store = new PolicyStore(db as any, roleStore);
  });

  // ── CRUD ───────────────────────────────────────────────────────────────

  describe("createPolicy", () => {
    it("creates a policy with version 1 and timestamps", () => {
      const policy = store.createPolicy(minimalPolicy("agent-1"));
      expect(policy.agentId).toBe("agent-1");
      expect(policy.version).toBe(1);
      expect(policy.createdAt).toBeTruthy();
      expect(policy.updatedAt).toBe(policy.createdAt);
      expect(db.getPermissionPolicies()).toHaveLength(1);
    });

    it("throws when creating a duplicate agentId policy", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      expect(() => store.createPolicy(minimalPolicy("agent-1"))).toThrow(
        'Policy for agent "agent-1" already exists'
      );
    });

    it("preserves custom permissions and denied permissions", () => {
      const custom: Permission = {
        resourceType: "filesystem",
        action: "write",
        constraints: { pathPatterns: ["/custom/**"] },
        effect: "allow",
      };
      const denied: Permission = {
        resourceType: "network",
        action: "connect",
        constraints: {},
        effect: "deny",
      };
      const policy = store.createPolicy(
        minimalPolicy("agent-2", {
          customPermissions: [custom],
          deniedPermissions: [denied],
        })
      );
      expect(policy.customPermissions).toHaveLength(1);
      expect(policy.deniedPermissions).toHaveLength(1);
    });
  });

  describe("getPolicy", () => {
    it("returns undefined for non-existent agent", () => {
      expect(store.getPolicy("nope")).toBeUndefined();
    });

    it("returns the policy by agentId", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      const found = store.getPolicy("agent-1");
      expect(found).toBeDefined();
      expect(found!.agentId).toBe("agent-1");
    });

    it("returns the latest version when multiple versions exist", () => {
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["reader"] })
      );
      store.updatePolicy("agent-1", { assignedRoles: ["writer"] });
      const latest = store.getPolicy("agent-1");
      expect(latest!.version).toBe(2);
      expect(latest!.assignedRoles).toEqual(["writer"]);
    });
  });

  describe("updatePolicy", () => {
    it("increments version and preserves history", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      const updated = store.updatePolicy("agent-1", {
        assignedRoles: ["admin"],
      });
      expect(updated.version).toBe(2);
      expect(updated.assignedRoles).toEqual(["admin"]);
      // History preserved: 2 entries in DB
      expect(db.getPermissionPolicies()).toHaveLength(2);
    });

    it("throws for non-existent agent", () => {
      expect(() => store.updatePolicy("nope", { assignedRoles: [] })).toThrow(
        'Policy for agent "nope" not found'
      );
    });

    it("preserves unchanged fields", () => {
      store.createPolicy(
        minimalPolicy("agent-1", {
          assignedRoles: ["reader"],
          customPermissions: [
            {
              resourceType: "filesystem",
              action: "read",
              constraints: {},
              effect: "allow",
            },
          ],
        })
      );
      const updated = store.updatePolicy("agent-1", {
        assignedRoles: ["writer"],
      });
      expect(updated.customPermissions).toHaveLength(1);
    });
  });

  describe("deletePolicy", () => {
    it("removes all versions of a policy", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      store.updatePolicy("agent-1", { assignedRoles: ["admin"] });
      expect(db.getPermissionPolicies()).toHaveLength(2);
      store.deletePolicy("agent-1");
      expect(db.getPermissionPolicies()).toHaveLength(0);
    });

    it("does not affect other agents' policies", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      store.createPolicy(minimalPolicy("agent-2"));
      store.deletePolicy("agent-1");
      expect(db.getPermissionPolicies()).toHaveLength(1);
      expect(store.getPolicy("agent-2")).toBeDefined();
    });
  });

  describe("deletePoliciesByOrganization", () => {
    it("removes all policies for an organization", () => {
      store.createPolicy(minimalPolicy("a1", { organizationId: "org-1" }));
      store.createPolicy(minimalPolicy("a2", { organizationId: "org-1" }));
      store.createPolicy(minimalPolicy("a3", { organizationId: "org-2" }));
      store.deletePoliciesByOrganization("org-1");
      expect(db.getPermissionPolicies()).toHaveLength(1);
      expect(store.getPolicy("a3")).toBeDefined();
    });
  });

  // ── resolveEffectivePermissions ────────────────────────────────────────

  describe("resolveEffectivePermissions", () => {
    it("returns empty array for non-existent agent", () => {
      expect(store.resolveEffectivePermissions("nope")).toEqual([]);
    });

    it("returns role permissions when no custom or denied permissions", () => {
      roleStore.createRole({
        roleId: "reader",
        roleName: "Reader",
        description: "",
        permissions: [
          {
            resourceType: "filesystem",
            action: "read",
            constraints: {},
            effect: "allow",
          },
        ],
      });
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["reader"] })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toHaveLength(1);
      expect(effective[0].resourceType).toBe("filesystem");
      expect(effective[0].action).toBe("read");
    });

    it("merges permissions from multiple roles", () => {
      roleStore.createRole({
        roleId: "reader",
        roleName: "Reader",
        description: "",
        permissions: [
          {
            resourceType: "filesystem",
            action: "read",
            constraints: {},
            effect: "allow",
          },
        ],
      });
      roleStore.createRole({
        roleId: "net",
        roleName: "Net",
        description: "",
        permissions: [
          {
            resourceType: "network",
            action: "connect",
            constraints: {},
            effect: "allow",
          },
        ],
      });
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["reader", "net"] })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toHaveLength(2);
    });

    it("custom permissions override role permissions of same resourceType+action", () => {
      roleStore.createRole({
        roleId: "reader",
        roleName: "Reader",
        description: "",
        permissions: [
          {
            resourceType: "filesystem",
            action: "read",
            constraints: { pathPatterns: ["/default/**"] },
            effect: "allow",
          },
        ],
      });
      const customPerm: Permission = {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/custom/**"] },
        effect: "allow",
      };
      store.createPolicy(
        minimalPolicy("agent-1", {
          assignedRoles: ["reader"],
          customPermissions: [customPerm],
        })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toHaveLength(1);
      expect(effective[0].constraints.pathPatterns).toEqual(["/custom/**"]);
    });

    it("denied permissions remove matching allow permissions", () => {
      roleStore.createRole({
        roleId: "admin",
        roleName: "Admin",
        description: "",
        permissions: [
          {
            resourceType: "filesystem",
            action: "read",
            constraints: {},
            effect: "allow",
          },
          {
            resourceType: "network",
            action: "connect",
            constraints: {},
            effect: "allow",
          },
        ],
      });
      store.createPolicy(
        minimalPolicy("agent-1", {
          assignedRoles: ["admin"],
          deniedPermissions: [
            {
              resourceType: "network",
              action: "connect",
              constraints: {},
              effect: "deny",
            },
          ],
        })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toHaveLength(1);
      expect(effective[0].resourceType).toBe("filesystem");
    });

    it("denied permissions take priority over custom permissions", () => {
      const customPerm: Permission = {
        resourceType: "network",
        action: "connect",
        constraints: { domainPatterns: ["*.example.com"] },
        effect: "allow",
      };
      store.createPolicy(
        minimalPolicy("agent-1", {
          customPermissions: [customPerm],
          deniedPermissions: [
            {
              resourceType: "network",
              action: "connect",
              constraints: {},
              effect: "deny",
            },
          ],
        })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toHaveLength(0);
    });

    it("skips non-existent roles gracefully", () => {
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["nonexistent"] })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toEqual([]);
    });

    it("filters out deny-effect permissions from role and custom", () => {
      roleStore.createRole({
        roleId: "mixed",
        roleName: "Mixed",
        description: "",
        permissions: [
          {
            resourceType: "filesystem",
            action: "read",
            constraints: {},
            effect: "allow",
          },
          {
            resourceType: "network",
            action: "connect",
            constraints: {},
            effect: "deny",
          },
        ],
      });
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["mixed"] })
      );
      const effective = store.resolveEffectivePermissions("agent-1");
      expect(effective).toHaveLength(1);
      expect(effective[0].effect).toBe("allow");
    });
  });

  // ── Version Control ────────────────────────────────────────────────────

  describe("getPolicyHistory", () => {
    it("returns empty array for non-existent agent", () => {
      expect(store.getPolicyHistory("nope")).toEqual([]);
    });

    it("returns all versions sorted by version number", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      store.updatePolicy("agent-1", { assignedRoles: ["reader"] });
      store.updatePolicy("agent-1", { assignedRoles: ["writer"] });
      const history = store.getPolicyHistory("agent-1");
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(1);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(3);
    });
  });

  describe("rollbackPolicy", () => {
    it("creates a new version with content from target version", () => {
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["reader"] })
      );
      store.updatePolicy("agent-1", { assignedRoles: ["admin"] });
      const rolledBack = store.rollbackPolicy("agent-1", 1);
      expect(rolledBack.version).toBe(3);
      expect(rolledBack.assignedRoles).toEqual(["reader"]);
    });

    it("throws for non-existent version", () => {
      store.createPolicy(minimalPolicy("agent-1"));
      expect(() => store.rollbackPolicy("agent-1", 99)).toThrow(
        'Version 99 not found for agent "agent-1"'
      );
    });

    it("throws for non-existent agent", () => {
      expect(() => store.rollbackPolicy("nope", 1)).toThrow(
        'Version 1 not found for agent "nope"'
      );
    });

    it("preserves full history after rollback", () => {
      store.createPolicy(
        minimalPolicy("agent-1", { assignedRoles: ["reader"] })
      );
      store.updatePolicy("agent-1", { assignedRoles: ["admin"] });
      store.rollbackPolicy("agent-1", 1);
      const history = store.getPolicyHistory("agent-1");
      expect(history).toHaveLength(3);
      expect(history[2].assignedRoles).toEqual(["reader"]);
    });
  });

  // ── Property-Based Tests ───────────────────────────────────────────────

  /**
   * **Validates: Requirements 2.3**
   *
   * Property 1: 权限解析优先级正确性
   *
   * For any AgentPermissionPolicy config (assignedRoles, customPermissions,
   * deniedPermissions), resolveEffectivePermissions should satisfy:
   * - deniedPermissions do NOT appear in effective permissions
   * - customPermissions override role permissions of the same resourceType+action
   */
  describe("Property 1: 权限解析优先级正确性", () => {
    // ── Generators ─────────────────────────────────────────────────────

    const arbResourceType: fc.Arbitrary<ResourceType> = fc.constantFrom(
      ...RESOURCE_TYPES
    );

    const arbAction: fc.Arbitrary<Action> = fc.constantFrom(...ACTIONS);

    const arbPermission: fc.Arbitrary<Permission> = fc.record({
      resourceType: arbResourceType,
      action: arbAction,
      constraints: fc.constant({}),
      effect: fc.constant("allow" as const),
    });

    const arbDenyPermission: fc.Arbitrary<Permission> = fc.record({
      resourceType: arbResourceType,
      action: arbAction,
      constraints: fc.constant({}),
      effect: fc.constant("deny" as const),
    });

    it("denied permissions never appear in effective permissions", () => {
      fc.assert(
        fc.property(
          fc.array(arbPermission, { minLength: 0, maxLength: 5 }),
          fc.array(arbDenyPermission, { minLength: 1, maxLength: 5 }),
          (customPerms, deniedPerms) => {
            // Fresh DB for each run
            const localDb = createInMemoryDb();
            const localRoleStore = new RoleStore(localDb as any);
            const localStore = new PolicyStore(localDb as any, localRoleStore);

            // Create a role with some allow permissions
            localRoleStore.createRole({
              roleId: "test-role",
              roleName: "Test",
              description: "",
              permissions: [
                {
                  resourceType: "filesystem",
                  action: "read",
                  constraints: {},
                  effect: "allow",
                },
                {
                  resourceType: "network",
                  action: "connect",
                  constraints: {},
                  effect: "allow",
                },
                {
                  resourceType: "api",
                  action: "call",
                  constraints: {},
                  effect: "allow",
                },
                {
                  resourceType: "database",
                  action: "select",
                  constraints: {},
                  effect: "allow",
                },
                {
                  resourceType: "mcp_tool",
                  action: "call",
                  constraints: {},
                  effect: "allow",
                },
              ],
            });

            localStore.createPolicy({
              agentId: "test-agent",
              assignedRoles: ["test-role"],
              customPermissions: customPerms,
              deniedPermissions: deniedPerms,
              effectiveAt: new Date().toISOString(),
              expiresAt: null,
            });

            const effective =
              localStore.resolveEffectivePermissions("test-agent");
            const deniedKeys = new Set(
              deniedPerms.map(p => `${p.resourceType}:${p.action}`)
            );

            // No effective permission should match a denied key
            for (const perm of effective) {
              const key = `${perm.resourceType}:${perm.action}`;
              if (deniedKeys.has(key)) {
                return false;
              }
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("custom permissions override role permissions of same resourceType+action", () => {
      fc.assert(
        fc.property(arbResourceType, arbAction, (resourceType, action) => {
          const localDb = createInMemoryDb();
          const localRoleStore = new RoleStore(localDb as any);
          const localStore = new PolicyStore(localDb as any, localRoleStore);

          // Role has a permission with "role-marker" path pattern
          localRoleStore.createRole({
            roleId: "base-role",
            roleName: "Base",
            description: "",
            permissions: [
              {
                resourceType,
                action,
                constraints: { pathPatterns: ["/role-default/**"] },
                effect: "allow",
              },
            ],
          });

          // Custom permission overrides with "custom-marker" path pattern
          const customPerm: Permission = {
            resourceType,
            action,
            constraints: { pathPatterns: ["/custom-override/**"] },
            effect: "allow",
          };

          localStore.createPolicy({
            agentId: "test-agent",
            assignedRoles: ["base-role"],
            customPermissions: [customPerm],
            deniedPermissions: [],
            effectiveAt: new Date().toISOString(),
            expiresAt: null,
          });

          const effective =
            localStore.resolveEffectivePermissions("test-agent");

          // Find the permission matching our resourceType+action
          const matching = effective.filter(
            p => p.resourceType === resourceType && p.action === action
          );

          // Should have exactly 1 (the custom one, not the role one)
          if (matching.length !== 1) return false;
          // The constraints should be from the custom permission
          if (
            !matching[0].constraints.pathPatterns ||
            matching[0].constraints.pathPatterns[0] !== "/custom-override/**"
          ) {
            return false;
          }
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
