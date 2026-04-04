/**
 * ConflictDetector — 冲突检测与风险评估
 *
 * 检测 Agent 权限配置中的冲突和风险：
 * - allow_deny_overlap: 同一 resourceType+action 同时存在 allow 和 deny
 * - excessive_scope: 通配符 * 覆盖所有资源
 * - dangerous_combination: 危险权限组合（如 filesystem write + network connect）
 *
 * 风险评分矩阵按四个维度评估：权限范围、网络访问、数据库操作、MCP 工具
 */
import type {
  Permission,
  PermissionConflict,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
} from "../../shared/permission/contracts.js";
import type { PolicyStore } from "./policy-store.js";
import type { RoleStore } from "./role-store.js";

export class ConflictDetector {
  constructor(
    private policyStore: PolicyStore,
    private roleStore: RoleStore,
  ) {}

  // ── Conflict Detection ─────────────────────────────────────────────────

  /**
   * Detect permission conflicts for an agent.
   * Examines the raw policy (roles + custom + denied) for:
   * 1. allow_deny_overlap — same resourceType+action has both allow and deny
   * 2. excessive_scope — wildcard * patterns covering all resources
   * 3. dangerous_combination — risky permission pairs (e.g. fs write + net connect)
   */
  detectConflicts(agentId: string): PermissionConflict[] {
    const allPermissions = this.getAllPermissions(agentId);
    if (allPermissions.length === 0) return [];

    const conflicts: PermissionConflict[] = [];

    conflicts.push(...this.detectAllowDenyOverlap(agentId, allPermissions));
    conflicts.push(...this.detectExcessiveScope(agentId, allPermissions));
    conflicts.push(...this.detectDangerousCombination(agentId, allPermissions));

    return conflicts;
  }

  // ── Risk Assessment ────────────────────────────────────────────────────

  /**
   * Assess the risk level of an agent's permission configuration.
   * Evaluates four dimensions from the risk scoring matrix:
   * - Filesystem scope
   * - Network access
   * - Database operations
   * - MCP tool access
   */
  assessRisk(agentId: string): RiskAssessment {
    const allPermissions = this.getAllPermissions(agentId);
    const allowPermissions = allPermissions.filter((p) => p.effect === "allow");

    const factors: RiskFactor[] = [];

    factors.push(...this.assessFilesystemRisk(allowPermissions));
    factors.push(...this.assessNetworkRisk(allowPermissions));
    factors.push(...this.assessDatabaseRisk(allowPermissions));
    factors.push(...this.assessMcpRisk(allowPermissions));

    // Overall risk = highest severity among all factors
    const riskLevel = this.computeOverallRisk(factors);

    return {
      agentId,
      riskLevel,
      factors,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private: Gather all permissions ────────────────────────────────────

  /**
   * Collect ALL permissions from the agent's policy (role perms + custom + denied).
   * Unlike resolveEffectivePermissions, this returns the raw unmerged set
   * so we can detect conflicts between allow and deny.
   */
  private getAllPermissions(agentId: string): Permission[] {
    const policy = this.policyStore.getPolicy(agentId);
    if (!policy) return [];

    // Gather role permissions
    const rolePermissions: Permission[] = [];
    for (const roleId of policy.assignedRoles) {
      const role = this.roleStore.getRole(roleId);
      if (role) {
        rolePermissions.push(...role.permissions);
      }
    }

    return [
      ...rolePermissions,
      ...policy.customPermissions,
      ...policy.deniedPermissions,
    ];
  }

  // ── Private: allow_deny_overlap ────────────────────────────────────────

  private detectAllowDenyOverlap(
    agentId: string,
    permissions: Permission[],
  ): PermissionConflict[] {
    const conflicts: PermissionConflict[] = [];

    const allowSet = permissions.filter((p) => p.effect === "allow");
    const denySet = permissions.filter((p) => p.effect === "deny");

    for (const allow of allowSet) {
      for (const deny of denySet) {
        if (
          allow.resourceType === deny.resourceType &&
          allow.action === deny.action
        ) {
          // Avoid duplicate conflict entries for the same pair
          const alreadyReported = conflicts.some(
            (c) =>
              c.conflictType === "allow_deny_overlap" &&
              c.permissions.some(
                (p) =>
                  p.resourceType === allow.resourceType &&
                  p.action === allow.action &&
                  p.effect === "allow",
              ),
          );
          if (!alreadyReported) {
            conflicts.push({
              agentId,
              conflictType: "allow_deny_overlap",
              permissions: [allow, deny],
              description: `Conflicting rules for ${allow.resourceType}:${allow.action} — both allow and deny exist`,
              suggestion: `Remove one of the conflicting rules or clarify intent with more specific constraints`,
            });
          }
        }
      }
    }

    return conflicts;
  }

  // ── Private: excessive_scope ───────────────────────────────────────────

  private detectExcessiveScope(
    agentId: string,
    permissions: Permission[],
  ): PermissionConflict[] {
    const conflicts: PermissionConflict[] = [];
    const allowPerms = permissions.filter((p) => p.effect === "allow");

    for (const perm of allowPerms) {
      if (this.hasWildcardScope(perm)) {
        conflicts.push({
          agentId,
          conflictType: "excessive_scope",
          permissions: [perm],
          description: `Permission ${perm.resourceType}:${perm.action} uses wildcard (*) pattern covering all resources`,
          suggestion: `Restrict the scope to specific paths, domains, or tables instead of using wildcards`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Check if a permission has wildcard patterns that cover all resources.
   */
  private hasWildcardScope(perm: Permission): boolean {
    const c = perm.constraints;

    // Filesystem: pathPatterns contains "*" or "**" or "/**"
    if (perm.resourceType === "filesystem" && c.pathPatterns) {
      if (c.pathPatterns.some((p) => p === "*" || p === "**" || p === "/**" || p === "/*")) {
        return true;
      }
    }

    // Network: domainPatterns contains "*"
    if (perm.resourceType === "network" && c.domainPatterns) {
      if (c.domainPatterns.some((d) => d === "*")) {
        return true;
      }
    }

    // API: endpoints contains "*"
    if (perm.resourceType === "api" && c.endpoints) {
      if (c.endpoints.some((e) => e === "*" || e === "/*")) {
        return true;
      }
    }

    // Database: tables contains "*"
    if (perm.resourceType === "database" && c.tables) {
      if (c.tables.some((t) => t === "*")) {
        return true;
      }
    }

    // MCP: no constraints at all means unrestricted
    // (but we only flag explicit wildcards for consistency)

    return false;
  }

  // ── Private: dangerous_combination ─────────────────────────────────────

  private detectDangerousCombination(
    agentId: string,
    permissions: Permission[],
  ): PermissionConflict[] {
    const conflicts: PermissionConflict[] = [];
    const allowPerms = permissions.filter((p) => p.effect === "allow");

    // Check: filesystem write + network connect = data exfiltration risk
    const fsWrite = allowPerms.find(
      (p) => p.resourceType === "filesystem" && p.action === "write",
    );
    const netConnect = allowPerms.find(
      (p) => p.resourceType === "network" && p.action === "connect",
    );

    if (fsWrite && netConnect) {
      conflicts.push({
        agentId,
        conflictType: "dangerous_combination",
        permissions: [fsWrite, netConnect],
        description: `Filesystem write + network connect = potential data exfiltration risk`,
        suggestion: `Consider restricting network access or filesystem write scope to reduce exfiltration risk`,
      });
    }

    // Check: database delete + filesystem write = data destruction + cover-up risk
    const dbDelete = allowPerms.find(
      (p) => p.resourceType === "database" && p.action === "delete",
    );
    const fsWriteForDb = allowPerms.find(
      (p) => p.resourceType === "filesystem" && p.action === "write",
    );

    if (dbDelete && fsWriteForDb) {
      conflicts.push({
        agentId,
        conflictType: "dangerous_combination",
        permissions: [dbDelete, fsWriteForDb],
        description: `Database delete + filesystem write = potential data destruction and cover-up risk`,
        suggestion: `Restrict database delete access or add approval workflow for destructive operations`,
      });
    }

    // Check: filesystem execute + network connect = remote code execution risk
    const fsExec = allowPerms.find(
      (p) => p.resourceType === "filesystem" && p.action === "execute",
    );
    const netConnectForExec = allowPerms.find(
      (p) => p.resourceType === "network" && p.action === "connect",
    );

    if (fsExec && netConnectForExec) {
      conflicts.push({
        agentId,
        conflictType: "dangerous_combination",
        permissions: [fsExec, netConnectForExec],
        description: `Filesystem execute + network connect = potential remote code execution risk`,
        suggestion: `Restrict executable paths or limit network access to trusted domains only`,
      });
    }

    return conflicts;
  }

  // ── Private: Risk Assessment Dimensions ────────────────────────────────

  private assessFilesystemRisk(permissions: Permission[]): RiskFactor[] {
    const fsPerms = permissions.filter((p) => p.resourceType === "filesystem");
    if (fsPerms.length === 0) return [];

    const factors: RiskFactor[] = [];

    // Check scope breadth
    const hasSystemDir = fsPerms.some((p) =>
      p.constraints.pathPatterns?.some((pp) =>
        /^\/(etc|sys|proc|root)/.test(pp) || /~\/\.ssh/.test(pp),
      ),
    );
    const hasFullWildcard = fsPerms.some((p) =>
      p.constraints.pathPatterns?.some(
        (pp) => pp === "*" || pp === "**" || pp === "/**" || pp === "/*",
      ),
    );
    const hasMultiDir = fsPerms.some(
      (p) => (p.constraints.pathPatterns?.length ?? 0) > 3,
    );

    if (hasSystemDir) {
      factors.push({
        category: "filesystem_scope",
        description: "Access to system-sensitive directories (/etc, /sys, /proc, ~/.ssh)",
        severity: "critical",
      });
    } else if (hasFullWildcard) {
      factors.push({
        category: "filesystem_scope",
        description: "Wildcard access to entire filesystem",
        severity: "high",
      });
    } else if (hasMultiDir) {
      factors.push({
        category: "filesystem_scope",
        description: "Access to multiple directories",
        severity: "medium",
      });
    } else {
      factors.push({
        category: "filesystem_scope",
        description: "Access limited to specific directory",
        severity: "low",
      });
    }

    return factors;
  }

  private assessNetworkRisk(permissions: Permission[]): RiskFactor[] {
    const netPerms = permissions.filter((p) => p.resourceType === "network");
    if (netPerms.length === 0) return [];

    const factors: RiskFactor[] = [];

    const hasPrivateIp = netPerms.some((p) =>
      p.constraints.cidrRanges?.some(
        (r) =>
          r.startsWith("10.") ||
          r.startsWith("172.16.") ||
          r.startsWith("192.168."),
      ),
    );
    const hasFullDomain = netPerms.some((p) =>
      p.constraints.domainPatterns?.some((d) => d === "*"),
    );
    const hasWhitelist = netPerms.some(
      (p) =>
        (p.constraints.domainPatterns?.length ?? 0) > 0 &&
        !p.constraints.domainPatterns?.some((d) => d === "*"),
    );

    if (hasPrivateIp) {
      factors.push({
        category: "network_access",
        description: "Access to private IP ranges (potential internal network exposure)",
        severity: "critical",
      });
    } else if (hasFullDomain) {
      factors.push({
        category: "network_access",
        description: "Unrestricted domain access (wildcard *)",
        severity: "high",
      });
    } else if (hasWhitelist) {
      factors.push({
        category: "network_access",
        description: "Network access restricted to domain whitelist",
        severity: "medium",
      });
    } else {
      factors.push({
        category: "network_access",
        description: "Network access with no domain constraints",
        severity: "medium",
      });
    }

    return factors;
  }

  private assessDatabaseRisk(permissions: Permission[]): RiskFactor[] {
    const dbPerms = permissions.filter((p) => p.resourceType === "database");
    if (dbPerms.length === 0) return [];

    const factors: RiskFactor[] = [];

    const hasDelete = dbPerms.some((p) => p.action === "delete");
    const hasInsertUpdate = dbPerms.some(
      (p) => p.action === "insert" || p.action === "update",
    );
    const hasDangerousOps = dbPerms.some((p) =>
      p.constraints.forbiddenOperations === undefined ||
      p.constraints.forbiddenOperations?.length === 0,
    );
    const hasSelectOnly = dbPerms.every((p) => p.action === "select");

    if (hasDelete && hasDangerousOps) {
      factors.push({
        category: "database_operations",
        description: "Database delete access without forbidden operation restrictions",
        severity: "high",
      });
    } else if (hasDelete) {
      factors.push({
        category: "database_operations",
        description: "Database delete access",
        severity: "high",
      });
    } else if (hasInsertUpdate) {
      factors.push({
        category: "database_operations",
        description: "Database insert/update access",
        severity: "medium",
      });
    } else if (hasSelectOnly) {
      factors.push({
        category: "database_operations",
        description: "Read-only database access (select)",
        severity: "low",
      });
    }

    return factors;
  }

  private assessMcpRisk(permissions: Permission[]): RiskFactor[] {
    const mcpPerms = permissions.filter((p) => p.resourceType === "mcp_tool");
    if (mcpPerms.length === 0) return [];

    const factors: RiskFactor[] = [];

    const hasExecute = mcpPerms.some((p) => p.action === "execute");
    const hasWrite = mcpPerms.some((p) => p.action === "write");
    const hasReadOnly = mcpPerms.every((p) => p.action === "read" || p.action === "call");
    const hasAllTools = mcpPerms.some(
      (p) => !p.constraints.endpoints || p.constraints.endpoints.length === 0,
    );

    if (hasAllTools && (hasExecute || hasWrite)) {
      factors.push({
        category: "mcp_tools",
        description: "Unrestricted MCP tool access with execute/write permissions",
        severity: "critical",
      });
    } else if (hasExecute) {
      factors.push({
        category: "mcp_tools",
        description: "MCP tool execute access",
        severity: "high",
      });
    } else if (hasWrite) {
      factors.push({
        category: "mcp_tools",
        description: "MCP tool write access",
        severity: "medium",
      });
    } else if (hasReadOnly) {
      factors.push({
        category: "mcp_tools",
        description: "Read-only MCP tool access",
        severity: "low",
      });
    }

    return factors;
  }

  // ── Private: Compute overall risk ──────────────────────────────────────

  private computeOverallRisk(factors: RiskFactor[]): RiskLevel {
    if (factors.length === 0) return "low";

    const severityOrder: Record<RiskLevel, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };

    let maxSeverity: RiskLevel = "low";
    for (const factor of factors) {
      if (severityOrder[factor.severity] > severityOrder[maxSeverity]) {
        maxSeverity = factor.severity;
      }
    }

    return maxSeverity;
  }
}
