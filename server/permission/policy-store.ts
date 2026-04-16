/**
 * PolicyStore — Agent 权限策略存储
 *
 * 管理 Agent 的权限策略（AgentPermissionPolicy），包括：
 * - CRUD 操作
 * - 有效权限解析（角色权限 + 自定义权限 - 拒绝权限）
 * - 策略版本控制与回滚
 */
import type db from "../db/index.js";
import type {
  AgentPermissionPolicy,
  Permission,
} from "../../shared/permission/contracts.js";
import type { RoleStore } from "./role-store.js";

type Database = typeof db;

export class PolicyStore {
  constructor(
    private db: Database,
    private roleStore: RoleStore
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────

  getPolicy(agentId: string): AgentPermissionPolicy | undefined {
    // Return the latest version (highest version number)
    const matches = this.db
      .getPermissionPolicies()
      .filter(p => p.agentId === agentId);
    if (matches.length === 0) return undefined;
    return matches.reduce((latest, p) =>
      p.version > latest.version ? p : latest
    );
  }

  createPolicy(
    policy: Omit<AgentPermissionPolicy, "version" | "createdAt" | "updatedAt">
  ): AgentPermissionPolicy {
    const policies = this.db.getPermissionPolicies();
    if (policies.find(p => p.agentId === policy.agentId)) {
      throw new Error(`Policy for agent "${policy.agentId}" already exists`);
    }
    const now = new Date().toISOString();
    const newPolicy: AgentPermissionPolicy = {
      ...policy,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    policies.push(newPolicy);
    this.db.setPermissionPolicies(policies);
    return newPolicy;
  }

  updatePolicy(
    agentId: string,
    updates: Partial<
      Pick<
        AgentPermissionPolicy,
        | "assignedRoles"
        | "customPermissions"
        | "deniedPermissions"
        | "expiresAt"
        | "templateId"
        | "organizationId"
      >
    >
  ): AgentPermissionPolicy {
    const current = this.getPolicy(agentId);
    if (!current) {
      throw new Error(`Policy for agent "${agentId}" not found`);
    }
    const now = new Date().toISOString();
    const updated: AgentPermissionPolicy = {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: now,
    };
    // Push new version (preserves history)
    const policies = this.db.getPermissionPolicies();
    policies.push(updated);
    this.db.setPermissionPolicies(policies);
    return updated;
  }

  deletePolicy(agentId: string): void {
    const policies = this.db.getPermissionPolicies();
    const filtered = policies.filter(p => p.agentId !== agentId);
    this.db.setPermissionPolicies(filtered);
  }

  deletePoliciesByOrganization(organizationId: string): void {
    const policies = this.db.getPermissionPolicies();
    const filtered = policies.filter(p => p.organizationId !== organizationId);
    this.db.setPermissionPolicies(filtered);
  }

  // ── Effective Permission Resolution ────────────────────────────────────

  /**
   * Resolve effective permissions for an agent.
   *
   * Priority (high → low):
   * 1. deniedPermissions — explicit deny, highest priority
   * 2. customPermissions — override role permissions
   * 3. role permissions  — merged from all assignedRoles
   *
   * A permission is removed from the effective set if a matching deny exists
   * (same resourceType + action). Custom permissions override role permissions
   * of the same resourceType + action.
   */
  resolveEffectivePermissions(agentId: string): Permission[] {
    const policy = this.getPolicy(agentId);
    if (!policy) {
      return [];
    }

    // 1. Collect role permissions (merge all assigned roles)
    const rolePermissions: Permission[] = [];
    for (const roleId of policy.assignedRoles) {
      const role = this.roleStore.getRole(roleId);
      if (role) {
        rolePermissions.push(...role.permissions);
      }
    }

    // 2. Build a set of custom permission keys for override detection
    const customKeys = new Set(
      policy.customPermissions.map(p => `${p.resourceType}:${p.action}`)
    );

    // 3. Start with role permissions that are NOT overridden by custom permissions
    const basePermissions = rolePermissions.filter(
      p => !customKeys.has(`${p.resourceType}:${p.action}`)
    );

    // 4. Merge: non-overridden role permissions + custom permissions
    const merged = [...basePermissions, ...policy.customPermissions];

    // 5. Filter out only "allow" permissions (deny permissions are not part of effective set)
    const allowPermissions = merged.filter(p => p.effect === "allow");

    // 6. Remove any permission that matches a denied permission (same resourceType + action)
    const deniedKeys = new Set(
      policy.deniedPermissions.map(p => `${p.resourceType}:${p.action}`)
    );

    return allowPermissions.filter(
      p => !deniedKeys.has(`${p.resourceType}:${p.action}`)
    );
  }

  // ── Version Control ────────────────────────────────────────────────────

  /**
   * Get the full history of a policy (all versions stored in the policies array).
   * The current implementation stores each version as a separate entry with the
   * same agentId but different version numbers.
   */
  getPolicyHistory(agentId: string): AgentPermissionPolicy[] {
    return this.db
      .getPermissionPolicies()
      .filter(p => p.agentId === agentId)
      .sort((a, b) => a.version - b.version);
  }

  /**
   * Rollback a policy to a specific version.
   * Creates a new version entry with the content from the target version.
   */
  rollbackPolicy(agentId: string, version: number): AgentPermissionPolicy {
    const history = this.getPolicyHistory(agentId);
    const target = history.find(p => p.version === version);
    if (!target) {
      throw new Error(`Version ${version} not found for agent "${agentId}"`);
    }

    const current = history[history.length - 1];
    if (!current) {
      throw new Error(`No policy found for agent "${agentId}"`);
    }

    // Create a new version with the content from the target version
    const now = new Date().toISOString();
    const rolledBack: AgentPermissionPolicy = {
      ...target,
      version: current.version + 1,
      updatedAt: now,
    };

    const policies = this.db.getPermissionPolicies();
    policies.push(rolledBack);
    this.db.setPermissionPolicies(policies);
    return rolledBack;
  }
}
