/**
 * SkillContext — 上下文隔离工厂
 *
 * 为每个 Skill 创建独立的执行上下文，确保 Skill 之间状态互不影响。
 */

import type { SkillContext, SideEffect } from "../../shared/skill-contracts.js";

/**
 * 创建独立的 SkillContext 实例。
 * 每个 Skill 拥有自己的 input/output/state/sideEffects，互不共享。
 */
export function createSkillContext(skillId: string): SkillContext {
  return {
    skillId,
    input: {},
    output: {},
    state: {},
    sideEffects: [],
  };
}

/**
 * 记录副作用到 SkillContext。
 */
export function recordSideEffect(
  ctx: SkillContext,
  effect: Omit<SideEffect, "timestamp">
): void {
  ctx.sideEffects.push({
    ...effect,
    timestamp: new Date().toISOString(),
  });
}
