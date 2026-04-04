/**
 * DynamicPermissionManager — 动态权限调整
 *
 * 支持在工作流执行过程中动态调整 Agent 权限：
 * - grantTemporaryPermission: 临时授予权限（自动过期）
 * - revokePermission: 立即撤销权限
 * - escalatePermission: 请求权限提升（需审批）
 * - cleanupExpiredPermissions: 清理过期的临时权限
 *
 * 权限变更后自动刷新令牌并使缓存失效。
 */

import { randomUUID } from "node:crypto";
import type {
  Permission,
  PermissionEscalation,
} from "../../shared/permission/contracts.js";
import type { PolicyStore } from "./policy-store.js";
import type { TokenService } from "./token-service.js";
import type { AuditLogger, PermissionCheckEngine } from "./check-engine.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

export interface TempPermissionRecord {
  permission: Permission;
  expiresAt: number; // epoch ms
}

function permissionKey(p: Permission): string {
  return `${p.resourceType}:${p.action}:${p.effect}`;
}

// ─── Database interface (subset used by this module) ────────────────────────

export interface DynamicManagerDb {
  getPermissionEscalations(): PermissionEscalation[];
  setPermissionEscalations(escalations: PermissionEscalation[]): void;
}

// ─── DynamicPermissionManager ───────────────────────────────────────────────

export class DynamicPermissionManager {
  /**
   * In-memory map: agentId → Map<permissionKey, expiresAt (epoch ms)>
   * Tracks which customPermissions are temporary.
   */
  private tempPermissions = new Map<string, Map<string, number>>();

  private engine?: PermissionCheckEngine;

  constructor(
    private policyStore: PolicyStore,
    private tokenService: TokenService,
    private db: DynamicManagerDb,
    private auditLogger?: AuditLogger,
  ) {}

  /** Optionally attach the check engine for cache invalidation */
  setCheckEngine(engine: PermissionCheckEngine): void {
    this.engine = engine;
  }

  // ── grantTemporaryPermission ─────────────────────────────────────────

  /**
   * Grant a temporary permission to an agent.
   * Adds the permission to the policy's customPermissions and tracks its
   * expiry time. After durationMs the permission can be cleaned up by
   * calling cleanupExpiredPermissions().
   */
  grantTemporaryPermission(
    agentId: string,
    permission: Permission,
    durationMs: number,
  ): void {
    const policy = this.policyStore.getPolicy(agentId);
    if (!policy) {
      throw new Error(`No policy found for agent "${agentId}"`);
    }

    const key = permissionKey(permission);
    const expiresAt = Date.now() + durationMs;

    // Track expiry
    let agentMap = this.tempPermissions.get(agentId);
    if (!agentMap) {
      agentMap = new Map();
      this.tempPermissions.set(agentId, agentMap);
    }
    agentMap.set(key, expiresAt);

    // Add to customPermissions (avoid duplicates)
    const existing = policy.customPermissions.find(
      (p) => permissionKey(p) === key,
    );
    if (!existing) {
      this.policyStore.updatePolicy(agentId, {
        customPermissions: [...policy.customPermissions, permission],
      });
    }

    // Refresh token & invalidate cache
    this.refreshAfterChange(agentId);

    // Audit
    this.audit(agentId, "grant", permission);
  }

  // ── revokePermission ─────────────────────────────────────────────────

  /**
   * Immediately revoke a permission from an agent.
   * Removes from customPermissions and adds to deniedPermissions.
   */
  revokePermission(agentId: string, permission: Permission): void {
    const policy = this.policyStore.getPolicy(agentId);
    if (!policy) {
      throw new Error(`No policy found for agent "${agentId}"`);
    }

    const key = permissionKey(permission);

    // Remove from temp tracking
    const agentMap = this.tempPermissions.get(agentId);
    if (agentMap) {
      agentMap.delete(key);
    }

    // Remove from customPermissions
    const filteredCustom = policy.customPermissions.filter(
      (p) => permissionKey(p) !== key,
    );

    // Add to deniedPermissions (avoid duplicates)
    const alreadyDenied = policy.deniedPermissions.some(
      (p) => permissionKey(p) === key,
    );
    const newDenied = alreadyDenied
      ? policy.deniedPermissions
      : [...policy.deniedPermissions, { ...permission, effect: "deny" as const }];

    this.policyStore.updatePolicy(agentId, {
      customPermissions: filteredCustom,
      deniedPermissions: newDenied,
    });

    // Refresh token & invalidate cache
    this.refreshAfterChange(agentId);

    // Audit
    this.audit(agentId, "revoke", permission);
  }

  // ── escalatePermission ───────────────────────────────────────────────

  /**
   * Request a permission escalation. Creates a pending PermissionEscalation
   * record in the database. Returns the escalation ID.
   */
  escalatePermission(
    agentId: string,
    reason: string,
    approverList: string[],
  ): string {
    const escalationId = randomUUID();
    const escalation: PermissionEscalation = {
      id: escalationId,
      agentId,
      reason,
      requestedPermissions: [],
      approverList,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const escalations = this.db.getPermissionEscalations();
    escalations.push(escalation);
    this.db.setPermissionEscalations(escalations);

    // Audit
    this.auditLogger?.log({
      agentId,
      operation: "escalate",
      resourceType: "filesystem",
      action: "read",
      resource: "",
      result: "allowed",
      reason,
      metadata: { escalationId, approverList },
    });

    return escalationId;
  }

  // ── cleanupExpiredPermissions ─────────────────────────────────────────

  /**
   * Iterate all tracked temporary permissions and remove any that have expired.
   * For each agent with expired permissions, updates the policy and refreshes
   * the token.
   */
  cleanupExpiredPermissions(): void {
    const now = Date.now();
    const agentIds = Array.from(this.tempPermissions.keys());

    for (const agentId of agentIds) {
      const agentMap = this.tempPermissions.get(agentId)!;
      const expiredKeys: string[] = [];

      agentMap.forEach((expiresAt, key) => {
        if (expiresAt <= now) {
          expiredKeys.push(key);
        }
      });

      if (expiredKeys.length === 0) continue;

      // Remove expired keys from tracking
      for (const key of expiredKeys) {
        agentMap.delete(key);
      }

      // Clean up empty agent maps
      if (agentMap.size === 0) {
        this.tempPermissions.delete(agentId);
      }

      // Remove expired permissions from the policy's customPermissions
      const policy = this.policyStore.getPolicy(agentId);
      if (!policy) continue;

      const expiredKeySet = new Set(expiredKeys);
      const filteredCustom = policy.customPermissions.filter(
        (p) => !expiredKeySet.has(permissionKey(p)),
      );

      // Only update if something actually changed
      if (filteredCustom.length !== policy.customPermissions.length) {
        this.policyStore.updatePolicy(agentId, {
          customPermissions: filteredCustom,
        });

        // Refresh token & invalidate cache
        this.refreshAfterChange(agentId);
      }
    }
  }

  // ── Accessors (for testing) ──────────────────────────────────────────

  /** Get all tracked temporary permissions for an agent */
  getTempPermissions(agentId: string): Map<string, number> | undefined {
    return this.tempPermissions.get(agentId);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * After any permission change: refresh the agent's token and
   * invalidate the check engine cache.
   */
  private refreshAfterChange(agentId: string): void {
    try {
      this.tokenService.refreshToken(agentId);
    } catch {
      // Token refresh failure should not block the permission change
    }
    if (this.engine) {
      this.engine.invalidateCache(agentId);
    }
  }

  private audit(agentId: string, operation: string, permission: Permission): void {
    if (!this.auditLogger) return;
    try {
      this.auditLogger.log({
        agentId,
        operation,
        resourceType: permission.resourceType,
        action: permission.action,
        resource: "",
        result: "allowed",
        reason: `${operation} permission: ${permission.resourceType}:${permission.action}`,
        metadata: { effect: permission.effect },
      });
    } catch {
      // Audit failures must not block permission changes
    }
  }
}
