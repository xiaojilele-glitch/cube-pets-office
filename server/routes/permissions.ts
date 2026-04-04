/**
 * Agent 权限模型 REST API 路由
 *
 * 角色管理、Agent 权限策略、令牌、动态权限、冲突与风险、审计、模板
 *
 * Requirements: 1–12
 */

import { Router } from "express";

import { PERMISSION_API } from "../../shared/permission/api.js";
import type { RoleStore } from "../permission/role-store.js";
import type { PolicyStore } from "../permission/policy-store.js";
import type { TokenService } from "../permission/token-service.js";
import type { DynamicPermissionManager } from "../permission/dynamic-manager.js";
import type { ConflictDetector } from "../permission/conflict-detector.js";
import type { AuditLogger } from "../permission/audit-logger.js";

// ---------------------------------------------------------------------------
// Route prefix — strip so we can mount at /api/permissions
// ---------------------------------------------------------------------------

const PREFIX = "/api/permissions";

function stripPrefix(routeDef: string): string {
  // routeDef looks like "GET    /api/permissions/roles/:roleId"
  const path = routeDef.replace(/^[A-Z]+\s+/, "");
  return path.startsWith(PREFIX) ? path.slice(PREFIX.length) || "/" : path;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface PermissionRouterDeps {
  roleStore: RoleStore;
  policyStore: PolicyStore;
  tokenService: TokenService;
  dynamicManager: DynamicPermissionManager;
  conflictDetector: ConflictDetector;
  auditLogger: AuditLogger;
}

export function createPermissionRouter(deps: PermissionRouterDeps): Router {
  const {
    roleStore,
    policyStore,
    tokenService,
    dynamicManager,
    conflictDetector,
    auditLogger,
  } = deps;
  const router = Router();

  // =====================================================================
  // 10.1 角色管理路由 (GET/POST/PUT /api/permissions/roles)
  // =====================================================================

  router.get(stripPrefix(PERMISSION_API.listRoles), (_req, res) => {
    try {
      const roles = roleStore.listRoles();
      res.json({ ok: true, roles });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.get(stripPrefix(PERMISSION_API.getRole), (req, res) => {
    try {
      const role = roleStore.getRole(req.params.roleId);
      if (!role) {
        return res.status(404).json({ ok: false, error: "Role not found" });
      }
      res.json({ ok: true, role });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.post(stripPrefix(PERMISSION_API.createRole), (req, res) => {
    try {
      const { roleId, roleName, description, permissions } = req.body ?? {};
      if (!roleId || !roleName) {
        return res.status(400).json({ ok: false, error: "roleId and roleName are required" });
      }
      const role = roleStore.createRole({
        roleId,
        roleName,
        description: description ?? "",
        permissions: permissions ?? [],
      });
      res.status(201).json({ ok: true, role });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.put(stripPrefix(PERMISSION_API.updateRole), (req, res) => {
    try {
      const role = roleStore.updateRole(req.params.roleId, req.body ?? {});
      res.json({ ok: true, role });
    } catch (err) {
      const msg = errorMessage(err);
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  // =====================================================================
  // 10.2 Agent 权限策略路由 (GET/POST/PUT /api/permissions/policies/:agentId)
  // =====================================================================

  router.get(stripPrefix(PERMISSION_API.getPolicy), (req, res) => {
    try {
      const policy = policyStore.getPolicy(req.params.agentId);
      if (!policy) {
        return res.status(404).json({ ok: false, error: "Policy not found" });
      }
      res.json({ ok: true, policy });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.post(stripPrefix(PERMISSION_API.assignPolicy), (req, res) => {
    try {
      const { agentId } = req.params;
      const {
        assignedRoles,
        customPermissions,
        deniedPermissions,
        effectiveAt,
        expiresAt,
        templateId,
        organizationId,
      } = req.body ?? {};
      if (!assignedRoles) {
        return res.status(400).json({ ok: false, error: "assignedRoles is required" });
      }
      const policy = policyStore.createPolicy({
        agentId,
        assignedRoles,
        customPermissions: customPermissions ?? [],
        deniedPermissions: deniedPermissions ?? [],
        effectiveAt: effectiveAt ?? new Date().toISOString(),
        expiresAt: expiresAt ?? null,
        templateId,
        organizationId,
      });
      res.status(201).json({ ok: true, policy });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.put(stripPrefix(PERMISSION_API.updatePolicy), (req, res) => {
    try {
      const policy = policyStore.updatePolicy(req.params.agentId, req.body ?? {});
      res.json({ ok: true, policy });
    } catch (err) {
      const msg = errorMessage(err);
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  // =====================================================================
  // 10.3 令牌路由 (POST tokens/:agentId, POST tokens/verify)
  // =====================================================================

  // IMPORTANT: verify must be registered before :agentId to avoid
  // Express matching "verify" as the agentId param.
  router.post(stripPrefix(PERMISSION_API.verifyToken), (req, res) => {
    try {
      const { token } = req.body ?? {};
      if (!token) {
        return res.status(400).json({ ok: false, error: "token is required" });
      }
      const payload = tokenService.verifyToken(token);
      res.json({ ok: true, payload });
    } catch (err) {
      res.status(401).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.post(stripPrefix(PERMISSION_API.issueToken), (req, res) => {
    try {
      const { agentId } = req.params;
      const { expiresInMs } = req.body ?? {};
      const token = tokenService.issueToken(agentId, expiresInMs);
      res.status(201).json({ ok: true, token });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 10.4 动态权限路由 (POST grant-temp, revoke, escalate)
  // =====================================================================

  router.post(stripPrefix(PERMISSION_API.grantTemp), (req, res) => {
    try {
      const { agentId, permission, durationMs } = req.body ?? {};
      if (!agentId || !permission || !durationMs) {
        return res.status(400).json({
          ok: false,
          error: "agentId, permission, and durationMs are required",
        });
      }
      dynamicManager.grantTemporaryPermission(agentId, permission, durationMs);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.post(stripPrefix(PERMISSION_API.revoke), (req, res) => {
    try {
      const { agentId, permission } = req.body ?? {};
      if (!agentId || !permission) {
        return res.status(400).json({
          ok: false,
          error: "agentId and permission are required",
        });
      }
      dynamicManager.revokePermission(agentId, permission);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.post(stripPrefix(PERMISSION_API.escalate), (req, res) => {
    try {
      const { agentId, reason, approverList } = req.body ?? {};
      if (!agentId || !reason || !approverList) {
        return res.status(400).json({
          ok: false,
          error: "agentId, reason, and approverList are required",
        });
      }
      const escalationId = dynamicManager.escalatePermission(agentId, reason, approverList);
      res.json({ ok: true, escalationId });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 10.5 冲突与风险路由 (GET conflicts/:agentId, risk/:agentId)
  // =====================================================================

  router.get(stripPrefix(PERMISSION_API.detectConflicts), (req, res) => {
    try {
      const conflicts = conflictDetector.detectConflicts(req.params.agentId);
      res.json({ ok: true, conflicts });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.get(stripPrefix(PERMISSION_API.assessRisk), (req, res) => {
    try {
      const risk = conflictDetector.assessRisk(req.params.agentId);
      res.json({ ok: true, risk });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 10.6 审计路由 (GET audit/:agentId, usage/:agentId, violations, export)
  // =====================================================================

  router.get(stripPrefix(PERMISSION_API.auditTrail), (req, res) => {
    try {
      const { agentId } = req.params;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const timeRange = from && to ? { from, to } : undefined;
      const trail = auditLogger.getAuditTrail(agentId, timeRange);
      res.json({ ok: true, trail });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.get(stripPrefix(PERMISSION_API.usageReport), (req, res) => {
    try {
      const { agentId } = req.params;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!from || !to) {
        return res.status(400).json({
          ok: false,
          error: "Query parameters 'from' and 'to' are required",
        });
      }
      const report = auditLogger.getUsageReport(agentId, { from, to });
      res.json({ ok: true, report });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.get(stripPrefix(PERMISSION_API.violations), (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const timeRange = from && to ? { from, to } : undefined;
      const violations = auditLogger.getViolations(timeRange);
      res.json({ ok: true, violations });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.get(stripPrefix(PERMISSION_API.exportReport), (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const timeRange = from && to ? { from, to } : undefined;
      const data = auditLogger.exportReport("json", timeRange);
      res.setHeader("Content-Type", "application/json");
      res.send(data);
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 10.7 模板路由 (GET/POST /api/permissions/templates)
  // =====================================================================

  router.get(stripPrefix(PERMISSION_API.listTemplates), (_req, res) => {
    try {
      const templates = roleStore.listTemplates();
      res.json({ ok: true, templates });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.get(stripPrefix(PERMISSION_API.getTemplate), (req, res) => {
    try {
      const template = roleStore.getTemplate(req.params.templateId);
      if (!template) {
        return res.status(404).json({ ok: false, error: "Template not found" });
      }
      res.json({ ok: true, template });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  router.post(stripPrefix(PERMISSION_API.createTemplate), (req, res) => {
    try {
      const { templateId, templateName, description, targetRole, permissions } = req.body ?? {};
      if (!templateId || !templateName || !targetRole) {
        return res.status(400).json({
          ok: false,
          error: "templateId, templateName, and targetRole are required",
        });
      }
      const template = roleStore.createTemplate({
        templateId,
        templateName,
        description: description ?? "",
        targetRole,
        permissions: permissions ?? [],
      });
      res.status(201).json({ ok: true, template });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}
