/**
 * Unit tests + Property-based tests for TokenService
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
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
import {
  TokenService,
  InvalidTokenError,
  TokenExpiredError,
  base64urlEncode,
  base64urlDecode,
} from "../permission/token-service.js";

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

type StubDb = ReturnType<typeof createInMemoryDb>;

/* ─── Helpers ─── */

const TEST_SECRET = "test-secret-key-for-unit-tests";

function setupStores() {
  const db = createInMemoryDb();
  const roleStore = new RoleStore(db as any);
  const policyStore = new PolicyStore(db as any, roleStore);
  const tokenService = new TokenService(policyStore, roleStore, TEST_SECRET);
  return { db, roleStore, policyStore, tokenService };
}

function seedAgentWithPermissions(
  roleStore: RoleStore,
  policyStore: PolicyStore,
  agentId: string,
  permissions: Permission[],
) {
  roleStore.createRole({
    roleId: `role-${agentId}`,
    roleName: `Role for ${agentId}`,
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

describe("TokenService", () => {
  let roleStore: RoleStore;
  let policyStore: PolicyStore;
  let tokenService: TokenService;

  beforeEach(() => {
    const s = setupStores();
    roleStore = s.roleStore;
    policyStore = s.policyStore;
    tokenService = s.tokenService;
  });

  // ── base64url helpers ──────────────────────────────────────────────────

  describe("base64url encoding/decoding", () => {
    it("round-trips arbitrary strings", () => {
      const input = '{"alg":"HS256","typ":"JWT"}';
      expect(base64urlDecode(base64urlEncode(input))).toBe(input);
    });

    it("produces URL-safe output (no +, /, =)", () => {
      const encoded = base64urlEncode("hello world!!! ===");
      expect(encoded).not.toMatch(/[+/=]/);
    });
  });

  // ── issueToken ─────────────────────────────────────────────────────────

  describe("issueToken", () => {
    it("returns a CapabilityToken with correct agentId", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      expect(cap.agentId).toBe("agent-1");
      expect(cap.token).toBeTruthy();
      expect(cap.issuedAt).toBeTruthy();
      expect(cap.expiresAt).toBeTruthy();
    });

    it("generates a 3-part JWT string", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1");
      const parts = cap.token.split(".");
      expect(parts).toHaveLength(3);
    });

    it("uses default TTL of 2 hours when no custom TTL provided", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1");
      const issued = new Date(cap.issuedAt).getTime();
      const expires = new Date(cap.expiresAt).getTime();
      // Allow 1 second tolerance for rounding
      expect(expires - issued).toBeGreaterThanOrEqual(7_199_000);
      expect(expires - issued).toBeLessThanOrEqual(7_201_000);
    });

    it("respects custom TTL", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const customTtl = 60_000; // 1 minute
      const cap = tokenService.issueToken("agent-1", customTtl);
      const issued = new Date(cap.issuedAt).getTime();
      const expires = new Date(cap.expiresAt).getTime();
      expect(expires - issued).toBeGreaterThanOrEqual(59_000);
      expect(expires - issued).toBeLessThanOrEqual(61_000);
    });

    it("includes permission matrix in the token payload", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: { pathPatterns: ["/data/**"] }, effect: "allow" },
        { resourceType: "network", action: "connect", constraints: {}, effect: "allow" },
      ]);
      const cap = tokenService.issueToken("agent-1");
      const payload = tokenService.verifyToken(cap.token);
      expect(payload.permissionMatrix.length).toBeGreaterThanOrEqual(1);
      const fsEntry = payload.permissionMatrix.find((e) => e.resourceType === "filesystem");
      expect(fsEntry).toBeDefined();
      expect(fsEntry!.actions).toContain("read");
    });

    it("returns empty permission matrix for agent with no effective permissions", () => {
      // Agent with no policy → resolveEffectivePermissions returns []
      policyStore.createPolicy({
        agentId: "empty-agent",
        assignedRoles: [],
        customPermissions: [],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });
      const cap = tokenService.issueToken("empty-agent");
      const payload = tokenService.verifyToken(cap.token);
      expect(payload.permissionMatrix).toEqual([]);
    });
  });

  // ── verifyToken ────────────────────────────────────────────────────────

  describe("verifyToken", () => {
    it("successfully verifies a valid token", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1");
      const payload = tokenService.verifyToken(cap.token);
      expect(payload.agentId).toBe("agent-1");
    });

    it("throws InvalidTokenError for malformed token (not 3 parts)", () => {
      expect(() => tokenService.verifyToken("not.a.valid.jwt.token")).toThrow(InvalidTokenError);
      expect(() => tokenService.verifyToken("onlyonepart")).toThrow(InvalidTokenError);
    });

    it("throws InvalidTokenError for tampered signature", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1");
      const tampered = cap.token.slice(0, -1) + (cap.token.endsWith("A") ? "B" : "A");
      expect(() => tokenService.verifyToken(tampered)).toThrow(InvalidTokenError);
    });

    it("throws InvalidTokenError for tampered payload", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1");
      const parts = cap.token.split(".");
      // Modify one character in the payload
      const modifiedPayload = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A");
      const tampered = `${parts[0]}.${modifiedPayload}.${parts[2]}`;
      expect(() => tokenService.verifyToken(tampered)).toThrow(InvalidTokenError);
    });

    it("throws TokenExpiredError for expired token", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      // Issue with 1ms TTL, then wait
      const cap = tokenService.issueToken("agent-1", 1);
      // The token exp = iat + 0 seconds (1ms rounds to 0s), so it's already expired
      expect(() => tokenService.verifyToken(cap.token)).toThrow(TokenExpiredError);
    });

    it("throws InvalidTokenError when verified with wrong secret", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", []);
      const cap = tokenService.issueToken("agent-1");

      // Create a new service with a different secret
      const otherService = new TokenService(policyStore, roleStore, "different-secret");
      expect(() => otherService.verifyToken(cap.token)).toThrow(InvalidTokenError);
    });
  });

  // ── refreshToken ───────────────────────────────────────────────────────

  describe("refreshToken", () => {
    it("returns a new token for the same agent", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const original = tokenService.issueToken("agent-1");
      const refreshed = tokenService.refreshToken("agent-1");
      expect(refreshed.agentId).toBe("agent-1");
      expect(refreshed.token).toBeTruthy();
      // Tokens may differ (different iat)
    });

    it("reflects updated permissions after policy change", () => {
      seedAgentWithPermissions(roleStore, policyStore, "agent-1", [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      ]);
      const original = tokenService.issueToken("agent-1");
      const originalPayload = tokenService.verifyToken(original.token);

      // Add a custom permission
      policyStore.updatePolicy("agent-1", {
        customPermissions: [
          { resourceType: "network", action: "connect", constraints: {}, effect: "allow" },
        ],
      });

      const refreshed = tokenService.refreshToken("agent-1");
      const refreshedPayload = tokenService.verifyToken(refreshed.token);

      // Refreshed token should have network permission
      const hasNetwork = refreshedPayload.permissionMatrix.some(
        (e) => e.resourceType === "network",
      );
      expect(hasNetwork).toBe(true);
    });
  });

  // ── buildPermissionMatrix ──────────────────────────────────────────────

  describe("buildPermissionMatrix", () => {
    it("groups permissions by resourceType+effect", () => {
      const perms: Permission[] = [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
        { resourceType: "filesystem", action: "write", constraints: {}, effect: "allow" },
        { resourceType: "network", action: "connect", constraints: {}, effect: "allow" },
      ];
      const matrix = tokenService.buildPermissionMatrix(perms);
      expect(matrix).toHaveLength(2); // filesystem:allow, network:allow
      const fsEntry = matrix.find((e) => e.resourceType === "filesystem")!;
      expect(fsEntry.actions).toContain("read");
      expect(fsEntry.actions).toContain("write");
    });

    it("keeps allow and deny entries separate for same resourceType", () => {
      const perms: Permission[] = [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
        { resourceType: "filesystem", action: "delete", constraints: {}, effect: "deny" },
      ];
      const matrix = tokenService.buildPermissionMatrix(perms);
      expect(matrix).toHaveLength(2);
    });

    it("merges array constraints (pathPatterns)", () => {
      const perms: Permission[] = [
        { resourceType: "filesystem", action: "read", constraints: { pathPatterns: ["/a/**"] }, effect: "allow" },
        { resourceType: "filesystem", action: "write", constraints: { pathPatterns: ["/b/**"] }, effect: "allow" },
      ];
      const matrix = tokenService.buildPermissionMatrix(perms);
      const fsEntry = matrix.find((e) => e.resourceType === "filesystem")!;
      expect(fsEntry.constraints.pathPatterns).toContain("/a/**");
      expect(fsEntry.constraints.pathPatterns).toContain("/b/**");
    });

    it("deduplicates merged array values", () => {
      const perms: Permission[] = [
        { resourceType: "filesystem", action: "read", constraints: { pathPatterns: ["/same/**"] }, effect: "allow" },
        { resourceType: "filesystem", action: "write", constraints: { pathPatterns: ["/same/**"] }, effect: "allow" },
      ];
      const matrix = tokenService.buildPermissionMatrix(perms);
      const fsEntry = matrix.find((e) => e.resourceType === "filesystem")!;
      expect(fsEntry.constraints.pathPatterns).toEqual(["/same/**"]);
    });

    it("returns empty array for empty permissions", () => {
      expect(tokenService.buildPermissionMatrix([])).toEqual([]);
    });

    it("does not duplicate actions", () => {
      const perms: Permission[] = [
        { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
        { resourceType: "filesystem", action: "read", constraints: { pathPatterns: ["/x/**"] }, effect: "allow" },
      ];
      const matrix = tokenService.buildPermissionMatrix(perms);
      const fsEntry = matrix.find((e) => e.resourceType === "filesystem")!;
      expect(fsEntry.actions.filter((a) => a === "read")).toHaveLength(1);
    });
  });

  // ── Property-Based Tests ───────────────────────────────────────────────

  /**
   * **Validates: Requirements 3.2**
   *
   * Property 2: JWT 令牌签名完整性
   *
   * For any token generated by issueToken, verifyToken should succeed.
   * Any single-byte modification to the token should cause verification to fail.
   */
  describe("Property 2: JWT 令牌签名完整性", () => {
    // Generator: random agentId
    const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/);

    // Generator: random Permission array
    const arbPermission: fc.Arbitrary<Permission> = fc.record({
      resourceType: fc.constantFrom(...RESOURCE_TYPES),
      action: fc.constantFrom(...ACTIONS),
      constraints: fc.constant({}),
      effect: fc.constant("allow" as const),
    });

    it("any token from issueToken passes verifyToken", () => {
      fc.assert(
        fc.property(
          arbAgentId,
          fc.array(arbPermission, { minLength: 0, maxLength: 5 }),
          (agentId, perms) => {
            const { roleStore: rs, policyStore: ps, tokenService: ts } = setupStores();
            seedAgentWithPermissions(rs, ps, agentId, perms);
            const cap = ts.issueToken(agentId);
            const payload = ts.verifyToken(cap.token);
            return payload.agentId === agentId;
          },
        ),
        { numRuns: 100 },
      );
    });

    it("any single-byte modification to the token causes verification failure", () => {
      fc.assert(
        fc.property(
          arbAgentId,
          fc.array(arbPermission, { minLength: 0, maxLength: 3 }),
          fc.nat(),
          (agentId, perms, positionSeed) => {
            const { roleStore: rs, policyStore: ps, tokenService: ts } = setupStores();
            seedAgentWithPermissions(rs, ps, agentId, perms);
            const cap = ts.issueToken(agentId);
            const token = cap.token;

            // Pick a random position to modify
            if (token.length === 0) return true;
            const pos = positionSeed % token.length;
            const originalChar = token[pos];

            // Skip dots (structural separators) — modifying them changes part count
            if (originalChar === ".") return true;

            // Flip one character
            const flippedChar = originalChar === "A" ? "B" : "A";
            const tampered = token.substring(0, pos) + flippedChar + token.substring(pos + 1);

            try {
              ts.verifyToken(tampered);
              return false; // Should have thrown
            } catch (e) {
              return (
                e instanceof InvalidTokenError || e instanceof TokenExpiredError
              );
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property 3: 令牌过期时间正确性
   *
   * For any token issued with a TTL, exp = iat + TTL (in seconds).
   * Expired tokens should fail verifyToken.
   */
  describe("Property 3: 令牌过期时间正确性", () => {
    // Generator: TTL between 1 second and 24 hours (in ms)
    const arbTtlMs = fc.integer({ min: 1000, max: 86_400_000 });

    it("token exp equals iat + TTL (in seconds)", () => {
      fc.assert(
        fc.property(arbTtlMs, (ttlMs) => {
          const { roleStore: rs, policyStore: ps, tokenService: ts } = setupStores();
          seedAgentWithPermissions(rs, ps, "agent-ttl", []);
          const cap = ts.issueToken("agent-ttl", ttlMs);
          const payload = ts.verifyToken(cap.token);

          const expectedTtlSec = Math.floor(ttlMs / 1000);
          const actualTtlSec = payload.exp - payload.iat;

          return actualTtlSec === expectedTtlSec;
        }),
        { numRuns: 100 },
      );
    });

    it("expired tokens fail verifyToken", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 500 }), // small TTL in ms that rounds to 0 seconds
          (ttlMs) => {
            const { roleStore: rs, policyStore: ps, tokenService: ts } = setupStores();
            seedAgentWithPermissions(rs, ps, "agent-exp", []);

            // Issue with very small TTL (rounds to 0 seconds → already expired)
            const cap = ts.issueToken("agent-exp", ttlMs);

            try {
              ts.verifyToken(cap.token);
              // If TTL rounds to > 0 seconds, the token might still be valid
              // That's fine — we only assert that 0-second tokens fail
              const ttlSec = Math.floor(ttlMs / 1000);
              return ttlSec > 0;
            } catch (e) {
              return e instanceof TokenExpiredError;
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
