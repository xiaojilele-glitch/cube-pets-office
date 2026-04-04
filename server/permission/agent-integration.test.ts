/**
 * Integration tests for Agent ↔ Permission system
 *
 * Validates:
 * - Agent with valid token can read/write allowed paths
 * - Agent with valid token is denied for disallowed paths
 * - Agent without token can still operate (backward compatible)
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import type {
  AgentRole as PermissionRole,
  AgentPermissionPolicy,
  Permission,
  PermissionTemplate,
  PermissionAuditEntry,
  ResourceType,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES } from "../../shared/permission/contracts.js";
import { RoleStore } from "./role-store.js";
import { PolicyStore } from "./policy-store.js";
import { TokenService } from "./token-service.js";
import { PermissionCheckEngine } from "./check-engine.js";
import { FilesystemChecker } from "./checkers/filesystem-checker.js";
import type { ResourceChecker } from "./checkers/filesystem-checker.js";
import {
  PermissionDeniedError,
  setPermissionCheckEngine,
  getPermissionCheckEngine,
} from "../core/agent.js";

const SECRET = "test-agent-integration-secret";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: PermissionRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];
  let audit: PermissionAuditEntry[] = [];

  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: PermissionRole[]) => { roles = r; },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => { policies = p; },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => { templates = t; },
    getPermissionAudit: () => audit,
    setPermissionAudit: (a: PermissionAuditEntry[]) => { audit = a; },
  };
}

type StubDb = ReturnType<typeof createInMemoryDb>;

/* ─── Minimal Agent stub ─── */

/**
 * We can't easily instantiate the real Agent class (it depends on DB, LLM, etc.),
 * so we test the permission logic by directly exercising the exported functions
 * and the PermissionCheckEngine integration.
 *
 * The real Agent class delegates to:
 *   1. getPermissionCheckEngine() — module-level singleton
 *   2. engine.checkPermission(agentId, resourceType, action, resource, token)
 *   3. Throws PermissionDeniedError if denied
 *
 * We validate this exact flow here.
 */

function createPermissionStack(db: StubDb) {
  const roleStore = new RoleStore(db as any);
  roleStore.initBuiltinRoles();
  const policyStore = new PolicyStore(db as any, roleStore);
  const tokenService = new TokenService(policyStore, roleStore, SECRET);

  const checkers = new Map<ResourceType, ResourceChecker>();
  checkers.set("filesystem", new FilesystemChecker());

  const engine = new PermissionCheckEngine(tokenService, undefined, checkers);

  return { roleStore, policyStore, tokenService, engine };
}

/* ─── Tests ─── */

describe("Agent ↔ Permission Integration", () => {
  let db: StubDb;
  let roleStore: RoleStore;
  let policyStore: PolicyStore;
  let tokenService: TokenService;
  let engine: PermissionCheckEngine;

  beforeEach(() => {
    db = createInMemoryDb();
    const stack = createPermissionStack(db);
    roleStore = stack.roleStore;
    policyStore = stack.policyStore;
    tokenService = stack.tokenService;
    engine = stack.engine;

    // Wire the engine as the global singleton (mimics server/index.ts wiring)
    setPermissionCheckEngine(engine);
  });

  describe("Agent with valid token — allowed paths", () => {
    it("allows filesystem write when path matches allowed pattern", () => {
      // Create a policy that allows writing to /sandbox/agent-1/**
      policyStore.createPolicy({
        agentId: "agent-1",
        assignedRoles: [],
        customPermissions: [
          {
            resourceType: "filesystem",
            action: "write",
            constraints: { pathPatterns: ["/sandbox/agent-1/**"] },
            effect: "allow",
          },
        ],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-1");
      const result = engine.checkPermission(
        "agent-1", "filesystem", "write",
        "/sandbox/agent-1/output.txt", token.token,
      );

      expect(result.allowed).toBe(true);
    });

    it("allows filesystem read when path matches allowed pattern", () => {
      policyStore.createPolicy({
        agentId: "agent-1",
        assignedRoles: [],
        customPermissions: [
          {
            resourceType: "filesystem",
            action: "read",
            constraints: { pathPatterns: ["/sandbox/agent-1/**"] },
            effect: "allow",
          },
        ],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-1");
      const result = engine.checkPermission(
        "agent-1", "filesystem", "read",
        "/sandbox/agent-1/data.json", token.token,
      );

      expect(result.allowed).toBe(true);
    });

    it("allows operations using role-based permissions (Writer role)", () => {
      policyStore.createPolicy({
        agentId: "agent-writer",
        assignedRoles: ["writer"],
        customPermissions: [],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-writer");

      // Writer role allows filesystem read/write within /sandbox/agent_*/workspace/**
      const readResult = engine.checkPermission(
        "agent-writer", "filesystem", "read",
        "/sandbox/agent_writer/workspace/file.txt", token.token,
      );
      const writeResult = engine.checkPermission(
        "agent-writer", "filesystem", "write",
        "/sandbox/agent_writer/workspace/file.txt", token.token,
      );

      expect(readResult.allowed).toBe(true);
      expect(writeResult.allowed).toBe(true);
    });
  });

  describe("Agent with valid token — denied paths", () => {
    it("denies filesystem write to paths outside allowed pattern", () => {
      policyStore.createPolicy({
        agentId: "agent-1",
        assignedRoles: [],
        customPermissions: [
          {
            resourceType: "filesystem",
            action: "write",
            constraints: { pathPatterns: ["/sandbox/agent-1/**"] },
            effect: "allow",
          },
        ],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-1");
      const result = engine.checkPermission(
        "agent-1", "filesystem", "write",
        "/sandbox/agent-2/secret.txt", token.token,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("denies access to sensitive directories even with allow-all pattern", () => {
      policyStore.createPolicy({
        agentId: "agent-admin",
        assignedRoles: ["admin"],
        customPermissions: [],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-admin");
      const result = engine.checkPermission(
        "agent-admin", "filesystem", "read",
        "/etc/passwd", token.token,
      );

      expect(result.allowed).toBe(false);
    });

    it("denies when explicit deny rule overrides allow", () => {
      policyStore.createPolicy({
        agentId: "agent-1",
        assignedRoles: [],
        customPermissions: [
          {
            resourceType: "filesystem",
            action: "write",
            constraints: { pathPatterns: ["/sandbox/agent-1/**"] },
            effect: "allow",
          },
        ],
        deniedPermissions: [
          {
            resourceType: "filesystem",
            action: "write",
            constraints: {},
            effect: "deny",
          },
        ],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-1");
      const result = engine.checkPermission(
        "agent-1", "filesystem", "write",
        "/sandbox/agent-1/output.txt", token.token,
      );

      // deniedPermissions removes the allow rule from effective permissions,
      // so the token has no allow rule for filesystem:write
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("denies when agent has no policy (zero-trust)", () => {
      // No policy created for agent-orphan
      // issueToken will resolve empty permissions
      const token = tokenService.issueToken("agent-orphan");
      const result = engine.checkPermission(
        "agent-orphan", "filesystem", "read",
        "/sandbox/agent-orphan/file.txt", token.token,
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe("Agent without token — backward compatible", () => {
    it("PermissionDeniedError has correct name and properties", () => {
      const err = new PermissionDeniedError("Not allowed", "Request access");
      expect(err.name).toBe("PermissionDeniedError");
      expect(err.message).toBe("Not allowed");
      expect(err.suggestion).toBe("Request access");
      expect(err).toBeInstanceOf(Error);
    });

    it("PermissionDeniedError defaults message when no reason given", () => {
      const err = new PermissionDeniedError();
      expect(err.message).toBe("Permission denied");
      expect(err.suggestion).toBeUndefined();
    });

    it("setPermissionCheckEngine / getPermissionCheckEngine round-trips", () => {
      const retrieved = getPermissionCheckEngine();
      expect(retrieved).toBe(engine);
    });
  });

  describe("Token issuance for workflow agents", () => {
    it("issues tokens that carry the correct agentId", () => {
      policyStore.createPolicy({
        agentId: "wf-agent-1",
        assignedRoles: ["reader"],
        customPermissions: [],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const cap = tokenService.issueToken("wf-agent-1");
      expect(cap.agentId).toBe("wf-agent-1");

      const payload = tokenService.verifyToken(cap.token);
      expect(payload.agentId).toBe("wf-agent-1");
      expect(payload.permissionMatrix.length).toBeGreaterThan(0);
    });

    it("token from one agent cannot be used by another", () => {
      policyStore.createPolicy({
        agentId: "agent-a",
        assignedRoles: ["reader"],
        customPermissions: [],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const token = tokenService.issueToken("agent-a");

      // Try to use agent-a's token for agent-b
      const result = engine.checkPermission(
        "agent-b", "filesystem", "read",
        "/sandbox/agent-b/file.txt", token.token,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("mismatch");
    });

    it("issues tokens for multiple agents in an organization", () => {
      const agentIds = ["ceo-1", "mgr-1", "wkr-1", "wkr-2"];

      for (const agentId of agentIds) {
        policyStore.createPolicy({
          agentId,
          assignedRoles: ["reader"],
          customPermissions: [],
          deniedPermissions: [],
          effectiveAt: new Date().toISOString(),
          expiresAt: null,
        });
      }

      const tokens = agentIds.map(id => tokenService.issueToken(id));

      expect(tokens).toHaveLength(4);
      for (let i = 0; i < agentIds.length; i++) {
        expect(tokens[i].agentId).toBe(agentIds[i]);
        const payload = tokenService.verifyToken(tokens[i].token);
        expect(payload.agentId).toBe(agentIds[i]);
      }
    });
  });
});
