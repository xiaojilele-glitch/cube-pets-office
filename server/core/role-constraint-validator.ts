/**
 * RoleConstraintValidator — 角色切换约束校验器（全局单例）
 *
 * 按优先级校验角色切换请求：
 * 1. AGENT_BUSY — Agent 有未完成任务
 * 2. COOLDOWN_ACTIVE — 在冷却期内
 * 3. ROLE_SWITCH_DENIED — 目标角色在 incompatibleRoles 中或不在 compatibleRoles 中
 * 4. AUTHORITY_APPROVAL_REQUIRED — 从低权限切换到高权限角色
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import type { RoleConstraintError } from "../../shared/role-schema.js";
import { roleRegistry, type RoleRegistry } from "./role-registry.js";

/** Minimal agent interface needed by the validator */
export interface ValidatableAgent {
  config: { id: string };
}

/** Context for constraint validation */
export interface RoleConstraintContext {
  currentRoleId: string | null;
  hasIncompleteTasks: boolean;
  triggerSource: string;
  lastRoleSwitchAt: string | null;
  roleSwitchCooldownMs: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;

/** Authority level ordering for comparison */
const AUTHORITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

class RoleConstraintValidator {
  private registry: RoleRegistry;

  constructor(registry?: RoleRegistry) {
    this.registry = registry ?? (roleRegistry as RoleRegistry);
  }

  /**
   * Validate a role switch request. Returns the first failing constraint
   * as a RoleConstraintError, or null if all checks pass.
   */
  validate(
    agent: ValidatableAgent,
    targetRoleId: string,
    context: RoleConstraintContext
  ): RoleConstraintError | null {
    const agentId = agent.config.id;
    const cooldownMs = context.roleSwitchCooldownMs ?? DEFAULT_COOLDOWN_MS;

    // 1. AGENT_BUSY — Agent has incomplete tasks
    if (context.hasIncompleteTasks) {
      const error: RoleConstraintError = {
        code: "AGENT_BUSY",
        agentId,
        requestedRoleId: targetRoleId,
        denialReason: `Agent ${agentId} has incomplete tasks and cannot switch roles`,
        timestamp: new Date().toISOString(),
      };
      console.warn("[RoleConstraintValidator]", error.code, error.denialReason);
      return error;
    }

    // 2. COOLDOWN_ACTIVE — Within cooldown period after last switch
    if (context.lastRoleSwitchAt) {
      const lastSwitch = new Date(context.lastRoleSwitchAt).getTime();
      const elapsed = Date.now() - lastSwitch;
      if (elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        const error: RoleConstraintError = {
          code: "COOLDOWN_ACTIVE",
          agentId,
          requestedRoleId: targetRoleId,
          denialReason: `Agent ${agentId} is within cooldown period (${remainingMs}ms remaining)`,
          timestamp: new Date().toISOString(),
        };
        console.warn(
          "[RoleConstraintValidator]",
          error.code,
          error.denialReason
        );
        return error;
      }
    }

    // 3. ROLE_SWITCH_DENIED — incompatibleRoles / compatibleRoles check
    if (context.currentRoleId) {
      const currentTemplate = this.registry.get(context.currentRoleId);
      if (currentTemplate) {
        // Check incompatibleRoles blacklist
        if (
          currentTemplate.incompatibleRoles &&
          currentTemplate.incompatibleRoles.includes(targetRoleId)
        ) {
          const error: RoleConstraintError = {
            code: "ROLE_SWITCH_DENIED",
            agentId,
            requestedRoleId: targetRoleId,
            denialReason: `Role ${targetRoleId} is in the incompatibleRoles list of current role ${context.currentRoleId}`,
            timestamp: new Date().toISOString(),
          };
          console.warn(
            "[RoleConstraintValidator]",
            error.code,
            error.denialReason
          );
          return error;
        }

        // Check compatibleRoles whitelist (only if defined)
        if (
          currentTemplate.compatibleRoles &&
          !currentTemplate.compatibleRoles.includes(targetRoleId)
        ) {
          const error: RoleConstraintError = {
            code: "ROLE_SWITCH_DENIED",
            agentId,
            requestedRoleId: targetRoleId,
            denialReason: `Role ${targetRoleId} is not in the compatibleRoles list of current role ${context.currentRoleId}`,
            timestamp: new Date().toISOString(),
          };
          console.warn(
            "[RoleConstraintValidator]",
            error.code,
            error.denialReason
          );
          return error;
        }
      }
    }

    // 4. AUTHORITY_APPROVAL_REQUIRED — low → high authority switch
    if (context.currentRoleId) {
      const currentTemplate = this.registry.get(context.currentRoleId);
      const targetTemplate = this.registry.get(targetRoleId);

      if (currentTemplate && targetTemplate) {
        const currentRank = AUTHORITY_RANK[currentTemplate.authorityLevel] ?? 0;
        const targetRank = AUTHORITY_RANK[targetTemplate.authorityLevel] ?? 0;

        if (targetRank > currentRank) {
          const error: RoleConstraintError = {
            code: "AUTHORITY_APPROVAL_REQUIRED",
            agentId,
            requestedRoleId: targetRoleId,
            denialReason: `Switching from ${currentTemplate.authorityLevel} authority (${context.currentRoleId}) to ${targetTemplate.authorityLevel} authority (${targetRoleId}) requires orchestrator approval`,
            timestamp: new Date().toISOString(),
          };
          console.warn(
            "[RoleConstraintValidator]",
            error.code,
            error.denialReason
          );
          return error;
        }
      }
    }

    // All checks passed
    return null;
  }
}

export const roleConstraintValidator = new RoleConstraintValidator();

export { RoleConstraintValidator };
