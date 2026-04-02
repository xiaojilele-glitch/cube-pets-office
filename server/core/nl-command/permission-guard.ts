/**
 * 权限控制 (Permission Guard)
 *
 * 实现 NL Command Center 的角色-权限映射和实体级细粒度权限覆盖。
 * 权限覆盖存储在内存中（无持久化）。
 *
 * @see Requirements 17.1, 17.2, 17.3
 */

import type { Permission, PermissionConfig, UserRole } from '../../../shared/nl-command/contracts.js';

// ─── 默认角色-权限映射 ───

const ALL_PERMISSIONS: Permission[] = ['view', 'create', 'edit', 'approve', 'execute', 'cancel'];

const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  manager: ['view', 'create', 'edit', 'approve'],
  operator: ['view', 'create', 'edit', 'execute'],
  viewer: ['view'],
};

// ─── 覆盖键生成 ───

function overrideKey(userId: string, entityType?: string, entityId?: string): string {
  return `${userId}:${entityType ?? '*'}:${entityId ?? '*'}`;
}

/**
 * 实体级权限覆盖。
 * grant 中的权限会被额外授予，deny 中的权限会被撤销。
 */
export interface PermissionOverride {
  grant: Permission[];
  deny: Permission[];
}

export class PermissionGuard {
  /** userId:entityType:entityId → override */
  private overrides = new Map<string, PermissionOverride>();

  /**
   * 检查用户是否拥有指定权限。
   *
   * 解析顺序：
   * 1. 从角色默认权限开始
   * 2. 应用实体级覆盖（grant / deny）
   *
   * @see Requirement 17.2
   */
  checkPermission(
    userId: string,
    role: UserRole,
    permission: Permission,
    entityType?: string,
    entityId?: string,
  ): boolean {
    const effective = this.getPermissions(role, entityType, entityId, userId);
    return effective.includes(permission);
  }

  /**
   * 获取角色（含覆盖）的有效权限列表。
   *
   * @see Requirement 17.1, 17.3
   */
  getPermissions(
    role: UserRole,
    entityType?: string,
    entityId?: string,
    userId?: string,
  ): Permission[] {
    const base = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role] ?? []);

    if (userId) {
      this.applyOverrides(base, userId, entityType, entityId);
    }

    return [...base];
  }

  // ---------------------------------------------------------------------------
  // 覆盖管理
  // ---------------------------------------------------------------------------

  /**
   * 设置实体级权限覆盖。
   * @see Requirement 17.3
   */
  setOverride(
    userId: string,
    override: PermissionOverride,
    entityType?: string,
    entityId?: string,
  ): void {
    const key = overrideKey(userId, entityType, entityId);
    this.overrides.set(key, override);
  }

  /**
   * 移除实体级权限覆盖。
   */
  removeOverride(userId: string, entityType?: string, entityId?: string): void {
    const key = overrideKey(userId, entityType, entityId);
    this.overrides.delete(key);
  }

  /**
   * 获取当前所有覆盖配置（用于调试 / 审计）。
   */
  listOverrides(): Map<string, PermissionOverride> {
    return new Map(this.overrides);
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  /**
   * 按优先级从低到高依次应用覆盖：
   *   1. 全局覆盖  (userId:*:*)
   *   2. 实体类型覆盖 (userId:entityType:*)
   *   3. 精确实体覆盖 (userId:entityType:entityId)
   */
  private applyOverrides(
    permissions: Set<Permission>,
    userId: string,
    entityType?: string,
    entityId?: string,
  ): void {
    const keys: string[] = [overrideKey(userId)];

    if (entityType) {
      keys.push(overrideKey(userId, entityType));
    }
    if (entityType && entityId) {
      keys.push(overrideKey(userId, entityType, entityId));
    }

    for (const key of keys) {
      const ov = this.overrides.get(key);
      if (!ov) continue;
      for (const p of ov.grant) permissions.add(p);
      for (const p of ov.deny) permissions.delete(p);
    }
  }
}
