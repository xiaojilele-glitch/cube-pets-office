/**
 * Skill Seed — 将 SKILL_LIBRARY 中的硬编码 Skill 注册到 SkillRegistry
 *
 * 在服务启动时调用，确保种子 Skill 存在于数据库中。
 * 已存在的 Skill 不会被覆盖（upsert 语义）。
 */

import { skillRegistry } from "./dynamic-organization.js";
import db from "../db/index.js";
import type { SkillDefinition } from "../../shared/skill-contracts.js";

/** 8 个种子 Skill，从 SKILL_LIBRARY 迁移而来 */
const SEED_SKILLS: SkillDefinition[] = [
  {
    id: "directive-decomposition",
    name: "Directive Decomposition",
    category: "planning",
    summary: "Break vague requests into concrete deliverables, risks, and ownership.",
    prompt: "Given the context: {context}\n\nTranslate the incoming request into explicit goals, constraints, assumptions, and review checkpoints before acting.\n\nInput: {input}",
    requiredMcp: [],
    version: "1.0.0",
    tags: ["planning", "decomposition"],
  },
  {
    id: "plan-synthesis",
    name: "Plan Synthesis",
    category: "planning",
    summary: "Convert a direction into execution-ready sub-tasks with clear handoffs.",
    prompt: "Given the context: {context}\n\nWrite plans as scoped work packets with owners, expected output, and dependency notes.\n\nInput: {input}",
    requiredMcp: [],
    version: "1.0.0",
    tags: ["planning", "synthesis"],
  },
  {
    id: "system-design",
    name: "System Design",
    category: "code",
    summary: "Design service, API, data, and integration changes with tradeoffs.",
    prompt: "Given the context: {context}\n\nFavor durable architecture, call out constraints, and explain why each technical path is chosen.\n\nInput: {input}",
    requiredMcp: [],
    version: "1.0.0",
    tags: ["code", "architecture"],
  },
  {
    id: "execution-playbook",
    name: "Execution Playbook",
    category: "code",
    summary: "Produce implementation steps that another engineer can follow directly.",
    prompt: "Given the context: {context}\n\nReturn implementation guidance as ordered steps, acceptance signals, and edge cases to watch.\n\nInput: {input}",
    requiredMcp: [],
    version: "1.0.0",
    tags: ["code", "execution"],
  },
  {
    id: "evidence-review",
    name: "Evidence Review",
    category: "analysis",
    summary: "Ground claims in observable workflow artifacts and task outputs.",
    prompt: "Given the context: {context}\n\nPrefer evidence, examples, and concrete references over generic claims or filler language.\n\nInput: {input}",
    requiredMcp: ["workflow-memory"],
    version: "1.0.0",
    tags: ["analysis", "review"],
  },
  {
    id: "quality-audit",
    name: "Quality Audit",
    category: "analysis",
    summary: "Check depth, correctness, coverage, and actionability across outputs.",
    prompt: "Given the context: {context}\n\nAudit for weak logic, missing detail, untested assumptions, and unclear next actions.\n\nInput: {input}",
    requiredMcp: [],
    version: "1.0.0",
    tags: ["analysis", "quality"],
  },
  {
    id: "user-outcome-thinking",
    name: "User Outcome Thinking",
    category: "analysis",
    summary: "Evaluate work through user value, clarity, and operational impact.",
    prompt: "Given the context: {context}\n\nExplain how each recommendation changes outcomes for users, operators, or maintainers.\n\nInput: {input}",
    requiredMcp: [],
    version: "1.0.0",
    tags: ["analysis", "user-focus"],
  },
  {
    id: "tooling-integration",
    name: "Tooling Integration",
    category: "code",
    summary: "Reason about skills, tools, MCP connectors, and interface boundaries.",
    prompt: "Given the context: {context}\n\nWhen tools are involved, specify the connector purpose, required inputs, and fallback path when a tool is unavailable.\n\nInput: {input}",
    requiredMcp: ["tool-registry"],
    version: "1.0.0",
    tags: ["code", "tooling", "mcp"],
  },
];

/**
 * 注册种子 Skill 到数据库。
 * 已存在的 Skill（同 id + version）会被 upsert 更新。
 */
export function seedSkills(): void {
  let seeded = 0;
  for (const def of SEED_SKILLS) {
    const existing = db.getSkill(def.id, def.version);
    if (!existing) {
      skillRegistry.registerSkill(def);
      seeded++;
    }
  }
  if (seeded > 0) {
    console.log(`[SkillSeed] Registered ${seeded} seed skills`);
  }
}
