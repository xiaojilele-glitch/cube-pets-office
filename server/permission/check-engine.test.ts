/**
 * Unit tests + Property-based tests for PermissionCheckEngine
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5
 */

import { describe, expect, it, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  AgentRole,
  AgentPermissionPolicy,
  Permission,
  PermissionTemplate,
  ResourceType,
  Action,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES, ACTIONS } from "../../shared/permission/contracts.js";
import { RoleStore } from "./role-store.js";
import { PolicyStore } from "./policy-store.js";
import { TokenService, signJwt } from "./token-service.js";
import { PermissionCheckEngine, LRUCache } from "./check-engine.js";
import type { ResourceChecker } from "./checkers/filesystem-checker.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];
  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: AgentRole[]) => { roles = r; },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => { policies = p; },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => { templates = t; },
  };
}

/* ─── Always-allow checker stub ─── */
class AlwaysAllowChecker implements ResourceChecker {
  checkConstraints(): boolean { return true; }
}

/* ─── Setup helper ─── */
const SECRET = "test-check-engine-secret";

function setup() {
  const db = createInMemoryDb();
  const roleStore = new RoleStore(db as any);
  const policyStore = new PolicyStore(db as any, roleStore);
  const tokenService = new TokenService(policyStore, roleStore, SECRET);
  const checkers = new Map<ResourceType, ResourceChecker>();
  for (const rt of RESOURCE_TYPES) checkers.set(rt, new AlwaysAllowChecker());
  const engine = new PermissionCheckEngine(tokenService, undefined, checkers);
  return { db, roleStore, policyStore, tokenService, engine };
}

function seedAgent(
  roleStore: RoleStore,
  policyStore: PolicyStore,
  agentId: string,
  permissions: Permission[],
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

// ─── LRU Cache Tests ────────────────────────────────────────────────────────

describe("LRUCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LRUCache(100, 60000);
    cache.set("k1", { allowed: true });
    expect(cache.get("k1")).toEqual({ allowed: true });
  });

  it("returns undefined for missing keys", () => {
    const cache = new LRUCache(100, 60000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts oldest entry when at capacity", () => {
    const cache = new LRUCache(2, 60000);
    cache.set("a", { allowed: true });
    cache.set("b", { allowed: false });
    cache.set("c", { allowed: true }); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("expires entries after TTL", () => {
    const cache = new LRUCache(100, 1); // 1ms TTL
    cache.set("k1", { allowed: true });
    // Entry should expire almost immediately
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }
    expect(cache.get("k1")).toBeUndefined();
  });

  it("invalidates by prefix", () => {
    const cache = new LRUCache(100, 60000);
    cache.set("agent-1:fs:read:/a", { allowed: true });
    cache.set("agent-1:net:connect:b", { allowed: true });
    cache.set("agent-2:fs:read:/c", { allowed: true });
    cache.invalidateByPrefix("agent-1:");
    expect(cache.get("agent-1:fs:read:/a")).toBeUndefined();
    expect(cache.get("agent-1:net:connect:b")).toBeUndefined();
    expect(cache.get("agent-2:fs:read:/c")).toBeDefined();
  });
});

// ─── PermissionCheckEngine Tests ────────────────────────────────────────────

describe("PermissionCheckEngine", () => {
  describe("checkPermission", () => {
    it("allows access with valid token and matching allow rule", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      const result = engine.checkPermission("agent-1", "filesystem", "read", "/data/file.txt", cap.token);
      expect(result.allowed).toBe(true);
    });

    it("denies access when no allow rule matches", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      const result = engine.checkPermission("agent-1", "filesystem", "write", "/data/file.txt", cap.token);
      expect(result.allowed).toBe(false);
    });

    it("denies access when deny rule matches even if allow exists", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      // Create role with both allow and deny for same resource+action
      roleStore.createRole({
        roleId: "mixed",
        roleName: "Mixed",
        description: "",
        permissions: [
          { resourceType: "network", action: "connect", constraints: {}, effect: "allow" },
        ],
      });
      policyStore.createPolicy({
        agentId: "agent-deny",
        assignedRoles: ["mixed"],
        customPermissions: [],
        deniedPermissions: [
          { resourceType: "network", action: "connect", constraints: {}, effect: "deny" },
        ],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });
      // Note: deniedPermissions are filtered out by resolveEffectivePermissions,
      // but the token matrix includes deny entries from the policy
      // We need to test with a token that has both allow and deny in the matrix
      // Let's create a custom token scenario
      const cap = tokenService.issueToken("agent-deny");
      // Since resolveEffectivePermissions removes denied, the token won't have network:connect
      const result = engine.checkPermission("agent-deny", "network", "connect", "example.com:443", cap.token);
      expect(result.allowed).toBe(false);
    });

    it("denies with invalid token", () => {
      const { engine } = setup();
      const result = engine.checkPermission("agent-1", "filesystem", "read", "/file", "invalid.token.here");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Invalid token");
    });

    it("denies with expired token", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1", 1); // 1ms TTL → 0 seconds → expired
      const result = engine.checkPermission("agent-1", "filesystem", "read", "/file", cap.token);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("denies when token agentId does not match", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      const result = engine.checkPermission("agent-2", "filesystem", "read", "/file", cap.token);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("mismatch");
    });

    it("uses cache on repeated checks", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      engine.checkPermission("agent-1", "filesystem", "read", "/file", cap.token);
      expect(engine.getCacheSize()).toBe(1);
      // Second call should use cache
      const result = engine.checkPermission("agent-1", "filesystem", "read", "/file", cap.token);
      expect(result.allowed).toBe(true);
    });

    it("invalidateCache removes agent entries", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      engine.checkPermission("agent-1", "filesystem", "read", "/file", cap.token);
      expect(engine.getCacheSize()).toBe(1);
      engine.invalidateCache("agent-1");
      expect(engine.getCacheSize()).toBe(0);
    });
  });

  describe("checkPermissions (batch)", () => {
    it("returns results for multiple checks", () => {
      const { roleStore, policyStore, tokenService, engine } = setup();
      seedAgent(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      const results = engine.checkPermissions([
        { agentId: "agent-1", resourceType: "filesystem", action: "read", resource: "/a" },
        { agentId: "agent-1", resourceType: "filesystem", action: "write", resource: "/b" },
      ], cap.token);
      expect(results).toHaveLength(2);
      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(false);
    });
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * Property 4: 权限检查引擎 deny 优先
   *
   * For any permission matrix containing both allow and deny rules
   * matching the same resourceType and action, checkPermission returns denied.
   */
  describe("Property 4: deny 优先", () => {
    const arbResourceType = fc.constantFrom(...RESOURCE_TYPES);
    const arbAction = fc.constantFrom(...ACTIONS);

    it("deny always wins over allow for same resourceType+action", () => {
      fc.assert(
        fc.property(arbResourceType, arbAction, (resourceType, action) => {
          const { roleStore, policyStore, tokenService } = setup();

          // Create a role with the allow permission
          roleStore.createRole({
            roleId: "allow-role",
            roleName: "Allow",
            description: "",
            permissions: [
              { resourceType, action, constraints: {}, effect: "allow" },
            ],
          });

          // Create policy — but since resolveEffectivePermissions filters out denied,
          // we need to test at the engine level with a crafted token.
          // Instead, we'll directly build a token with both allow and deny in the matrix.
          policyStore.createPolicy({
            agentId: "test-agent",
            assignedRoles: ["allow-role"],
            customPermissions: [],
            deniedPermissions: [],
            effectiveAt: new Date().toISOString(),
            expiresAt: null,
          });

          // Issue token (will have allow entry)
          const cap = tokenService.issueToken("test-agent");

          // Verify the token, then manually craft a token with both allow and deny
          const payload = tokenService.verifyToken(cap.token);

          // Add a deny entry for the same resourceType+action
          payload.permissionMatrix.push({
            resourceType,
            actions: [action],
            constraints: {},
            effect: "deny",
          });

          // Re-sign the modified payload using the imported signJwt
          const craftedToken = signJwt(payload, SECRET);

          const checkers = new Map<ResourceType, ResourceChecker>();
          for (const rt of RESOURCE_TYPES) checkers.set(rt, new AlwaysAllowChecker());
          const engine = new PermissionCheckEngine(tokenService, undefined, checkers);

          const result = engine.checkPermission("test-agent", resourceType, action, "test-resource", craftedToken);
          return result.allowed === false;
        }),
        { numRuns: 100 },
      );
    });
  });
});
