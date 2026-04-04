/**
 * REST API 路由测试 — server/routes/permissions.ts
 *
 * 使用 withServer 模式（与 knowledge-routes.test.ts 一致），
 * 通过真实 Express + fetch 验证每组路由的请求/响应。
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect } from "vitest";

import type {
  AgentRole,
  AgentPermissionPolicy,
  PermissionTemplate,
  PermissionAuditEntry,
  PermissionEscalation,
} from "../../shared/permission/contracts.js";
import { RoleStore } from "./role-store.js";
import { PolicyStore } from "./policy-store.js";
import { TokenService } from "./token-service.js";
import { DynamicPermissionManager } from "./dynamic-manager.js";
import { ConflictDetector } from "./conflict-detector.js";
import { AuditLogger } from "./audit-logger.js";
import { createPermissionRouter } from "../routes/permissions.js";

// ---------------------------------------------------------------------------
// In-memory DB stub
// ---------------------------------------------------------------------------

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];
  let audit: PermissionAuditEntry[] = [];
  let escalations: PermissionEscalation[] = [];
  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: AgentRole[]) => { roles = r; },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => { policies = p; },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => { templates = t; },
    getPermissionAudit: () => audit,
    addPermissionAudit: (e: PermissionAuditEntry) => { audit.push(e); },
    getPermissionEscalations: () => escalations,
    setPermissionEscalations: (e: PermissionEscalation[]) => { escalations = e; },
  };
}

const SECRET = "test-route-secret";

function createDeps() {
  const db = createInMemoryDb();
  const roleStore = new RoleStore(db as any);
  roleStore.initBuiltinRoles();
  const policyStore = new PolicyStore(db as any, roleStore);
  const tokenService = new TokenService(policyStore, roleStore, SECRET);
  const auditLogger = new AuditLogger(db);
  const dynamicManager = new DynamicPermissionManager(policyStore, tokenService, db, auditLogger);
  const conflictDetector = new ConflictDetector(policyStore, roleStore);
  return { db, roleStore, policyStore, tokenService, auditLogger, dynamicManager, conflictDetector };
}

// ---------------------------------------------------------------------------
// withServer helper
// ---------------------------------------------------------------------------

async function withServer(
  handler: (baseUrl: string, deps: ReturnType<typeof createDeps>) => Promise<void>,
): Promise<void> {
  const deps = createDeps();
  const app = express();
  app.use(express.json());
  app.use("/api/permissions", createPermissionRouter(deps));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl, deps);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function put(body: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}


// ===========================================================================
// 10.1 角色管理路由
// ===========================================================================

describe("Role routes", () => {
  it("GET /roles returns builtin roles", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.roles.length).toBeGreaterThanOrEqual(5);
    });
  });

  it("GET /roles/:roleId returns a specific role", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles/reader`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.role.roleId).toBe("reader");
    });
  });

  it("GET /roles/:roleId returns 404 for unknown role", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles/NonExistent`);
      expect(res.status).toBe(404);
    });
  });

  it("POST /roles creates a new role", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles`, json({
        roleId: "CustomRole",
        roleName: "Custom Role",
        description: "A custom role",
        permissions: [],
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.role.roleId).toBe("CustomRole");
    });
  });

  it("POST /roles returns 400 when roleId is missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles`, json({
        roleName: "No ID",
      }));
      expect(res.status).toBe(400);
    });
  });

  it("PUT /roles/:roleId updates a role", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles/reader`, put({
        description: "Updated description",
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.role.description).toBe("Updated description");
    });
  });

  it("PUT /roles/:roleId returns 404 for unknown role", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/roles/Ghost`, put({
        description: "nope",
      }));
      expect(res.status).toBe(404);
    });
  });
});

// ===========================================================================
// 10.2 Agent 权限策略路由
// ===========================================================================

describe("Policy routes", () => {
  it("POST then GET policy for an agent", async () => {
    await withServer(async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/api/permissions/policies/agent-1`, json({
        assignedRoles: ["Reader"],
        customPermissions: [],
        deniedPermissions: [],
      }));
      expect(createRes.status).toBe(201);

      const getRes = await fetch(`${baseUrl}/api/permissions/policies/agent-1`);
      expect(getRes.status).toBe(200);
      const body = await getRes.json();
      expect(body.ok).toBe(true);
      expect(body.policy.agentId).toBe("agent-1");
    });
  });

  it("GET policy returns 404 for unknown agent", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/policies/unknown`);
      expect(res.status).toBe(404);
    });
  });

  it("POST policy returns 400 when assignedRoles is missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/policies/agent-1`, json({}));
      expect(res.status).toBe(400);
    });
  });

  it("PUT policy updates an existing policy", async () => {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/api/permissions/policies/agent-2`, json({
        assignedRoles: ["Reader"],
      }));
      const updateRes = await fetch(`${baseUrl}/api/permissions/policies/agent-2`, put({
        assignedRoles: ["Writer"],
      }));
      expect(updateRes.status).toBe(200);
      const body = await updateRes.json();
      expect(body.policy.assignedRoles).toContain("Writer");
    });
  });
});

// ===========================================================================
// 10.3 令牌路由
// ===========================================================================

describe("Token routes", () => {
  it("POST issue + POST verify round-trip", async () => {
    await withServer(async (baseUrl) => {
      // Create a policy first so token can be issued
      await fetch(`${baseUrl}/api/permissions/policies/agent-t`, json({
        assignedRoles: ["Reader"],
      }));

      const issueRes = await fetch(`${baseUrl}/api/permissions/tokens/agent-t`, json({}));
      expect(issueRes.status).toBe(201);
      const issueBody = await issueRes.json();
      expect(issueBody.ok).toBe(true);
      const tokenStr = issueBody.token.token;

      const verifyRes = await fetch(`${baseUrl}/api/permissions/tokens/verify`, json({ token: tokenStr }));
      expect(verifyRes.status).toBe(200);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.ok).toBe(true);
      expect(verifyBody.payload.agentId).toBe("agent-t");
    });
  });

  it("POST verify returns 401 for invalid token", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/tokens/verify`, json({ token: "bad.token.here" }));
      expect(res.status).toBe(401);
    });
  });

  it("POST verify returns 400 when token is missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/tokens/verify`, json({}));
      expect(res.status).toBe(400);
    });
  });
});


// ===========================================================================
// 10.4 动态权限路由
// ===========================================================================

describe("Dynamic permission routes", () => {
  it("POST grant-temp succeeds for existing agent", async () => {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/api/permissions/policies/agent-d`, json({
        assignedRoles: ["Reader"],
      }));

      const res = await fetch(`${baseUrl}/api/permissions/grant-temp`, json({
        agentId: "agent-d",
        permission: { resourceType: "filesystem", action: "write", constraints: {}, effect: "allow" },
        durationMs: 60000,
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  it("POST grant-temp returns 400 when fields are missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/grant-temp`, json({ agentId: "x" }));
      expect(res.status).toBe(400);
    });
  });

  it("POST revoke succeeds for existing agent", async () => {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/api/permissions/policies/agent-r`, json({
        assignedRoles: ["Reader"],
      }));

      const res = await fetch(`${baseUrl}/api/permissions/revoke`, json({
        agentId: "agent-r",
        permission: { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  it("POST escalate returns escalation ID", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/escalate`, json({
        agentId: "agent-e",
        reason: "Need write access",
        approverList: ["admin-1"],
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.escalationId).toBeTruthy();
    });
  });
});

// ===========================================================================
// 10.5 冲突与风险路由
// ===========================================================================

describe("Conflict & risk routes", () => {
  it("GET conflicts/:agentId returns conflicts array", async () => {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/api/permissions/policies/agent-c`, json({
        assignedRoles: ["Reader"],
      }));

      const res = await fetch(`${baseUrl}/api/permissions/conflicts/agent-c`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.conflicts)).toBe(true);
    });
  });

  it("GET risk/:agentId returns risk assessment", async () => {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/api/permissions/policies/agent-c`, json({
        assignedRoles: ["Reader"],
      }));

      const res = await fetch(`${baseUrl}/api/permissions/risk/agent-c`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.risk.agentId).toBe("agent-c");
      expect(body.risk.riskLevel).toBeTruthy();
    });
  });
});

// ===========================================================================
// 10.6 审计路由
// ===========================================================================

describe("Audit routes", () => {
  it("GET audit/:agentId returns trail", async () => {
    await withServer(async (baseUrl, deps) => {
      deps.auditLogger.log({
        agentId: "agent-a",
        operation: "check",
        resourceType: "filesystem",
        action: "read",
        resource: "/data/test.txt",
        result: "allowed",
      });

      const res = await fetch(`${baseUrl}/api/permissions/audit/agent-a`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.trail.length).toBe(1);
    });
  });

  it("GET usage/:agentId requires from and to", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/usage/agent-a`);
      expect(res.status).toBe(400);
    });
  });

  it("GET usage/:agentId returns report with time range", async () => {
    await withServer(async (baseUrl, deps) => {
      deps.auditLogger.log({
        agentId: "agent-u",
        operation: "check",
        resourceType: "filesystem",
        action: "read",
        resource: "/data/test.txt",
        result: "allowed",
      });

      const from = "2000-01-01T00:00:00Z";
      const to = "2099-12-31T23:59:59Z";
      const res = await fetch(`${baseUrl}/api/permissions/usage/agent-u?from=${from}&to=${to}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.report.totalChecks).toBe(1);
    });
  });

  it("GET violations returns denied entries", async () => {
    await withServer(async (baseUrl, deps) => {
      deps.auditLogger.log({
        agentId: "agent-v",
        operation: "check",
        resourceType: "network",
        action: "connect",
        resource: "evil.com",
        result: "denied",
      });

      const res = await fetch(`${baseUrl}/api/permissions/violations`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.violations.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("GET export returns JSON string", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/export`);
      expect(res.status).toBe(200);
      const text = await res.text();
      const parsed = JSON.parse(text);
      expect(parsed.format).toBe("json");
    });
  });
});

// ===========================================================================
// 10.7 模板路由
// ===========================================================================

describe("Template routes", () => {
  it("GET /templates returns builtin templates", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/templates`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.templates)).toBe(true);
    });
  });

  it("POST /templates creates a new template", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/templates`, json({
        templateId: "custom-tpl",
        templateName: "Custom Template",
        targetRole: "CustomWorker",
        permissions: [],
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.template.templateId).toBe("custom-tpl");
    });
  });

  it("POST /templates returns 400 when required fields are missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/templates`, json({
        templateName: "No ID",
      }));
      expect(res.status).toBe(400);
    });
  });

  it("GET /templates/:templateId returns 404 for unknown template", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/permissions/templates/nonexistent`);
      expect(res.status).toBe(404);
    });
  });
});
