/**
 * SkillActivator — Skill 激活与 Prompt 注入
 *
 * 在 Agent 执行时根据任务上下文筛选、排序、截断 Skill，
 * 并将 Skill prompt 注入到 Agent 系统提示中。
 */

import type {
  SkillBinding,
  ActivatedSkill,
} from "../../shared/skill-contracts.js";

const DEFAULT_MAX_SKILLS = 5;

export class SkillActivator {
  /**
   * 根据任务上下文筛选并激活 Skill。
   * - 过滤 enabled=true 的 SkillBinding
   * - 按 priority 降序排序（高优先级在前）
   * - 截断到 maxSkills 上限
   * - 替换 prompt 中的 {context} 占位符
   */
  activateSkills(
    skills: SkillBinding[],
    taskContext: string,
    maxSkills: number = DEFAULT_MAX_SKILLS
  ): ActivatedSkill[] {
    const enabled = skills.filter(s => s.enabled);

    const sorted = enabled.sort(
      (a, b) => (b.config?.priority ?? 0) - (a.config?.priority ?? 0)
    );

    const truncated = sorted.slice(0, maxSkills);

    return truncated.map(binding => ({
      skillId: binding.skillId,
      version: binding.version,
      name: binding.resolvedSkill.name,
      resolvedPrompt: binding.resolvedSkill.prompt.replace(
        /\{context\}/g,
        () => taskContext
      ),
      priority: binding.config?.priority ?? 0,
      mcpBindings: binding.mcpBindings,
    }));
  }

  /**
   * 将激活的 Skill prompt 按优先级拼接为系统提示片段。
   * 已按优先级排序（activateSkills 保证顺序）。
   */
  buildSkillPromptSection(activatedSkills: ActivatedSkill[]): string {
    if (!activatedSkills.length) return "";

    const sections = activatedSkills.map(
      skill =>
        `## Skill: ${skill.name} (v${skill.version})\n${skill.resolvedPrompt}`
    );

    return `\n# Active Skills\n\n${sections.join("\n\n")}\n`;
  }
}
