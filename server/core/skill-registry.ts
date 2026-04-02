/**
 * SkillRegistry — 全局 Skill 仓库
 *
 * 负责 Skill 的注册、验证、版本管理、依赖解析、启用/禁用控制。
 * 数据持久化委托给 Database 实例。
 */

import db from "../db/index.js";
type Database = typeof db;
import type {
  SkillDefinition,
  SkillRecord,
  SkillBinding,
  SkillBindingConfig,
  SkillQueryFilter,
  ResolveOptions,
} from "../../shared/skill-contracts.js";
import { CircularDependencyError } from "../../shared/skill-contracts.js";
import type { WorkflowMcpBinding } from "../../shared/organization-schema.js";

import { resolveMcp as resolveMcpBindings } from "./dynamic-organization.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateSkillDefinition(def: SkillDefinition): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(def.id)) errors.push("id is required");
  if (!isNonEmptyString(def.name)) errors.push("name is required");
  if (!isNonEmptyString(def.category)) errors.push("category is required");
  if (!isNonEmptyString(def.summary)) errors.push("summary is required");
  if (!isNonEmptyString(def.prompt)) errors.push("prompt is required");
  if (!isNonEmptyString(def.version)) errors.push("version is required");

  if (!Array.isArray(def.tags)) errors.push("tags must be an array");
  if (!Array.isArray(def.requiredMcp)) errors.push("requiredMcp must be an array");

  // Prompt placeholder validation
  if (isNonEmptyString(def.prompt)) {
    if (!def.prompt.includes("{context}"))
      errors.push("prompt must contain {context} placeholder");
    if (!def.prompt.includes("{input}"))
      errors.push("prompt must contain {input} placeholder");
  }

  // Semver validation
  if (isNonEmptyString(def.version) && !SEMVER_RE.test(def.version)) {
    errors.push(`version "${def.version}" must follow semver format X.Y.Z`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  constructor(private readonly db: Database) {}

  /**
   * 注册新 Skill，验证 prompt 模板后持久化。
   * 同一 skillId 的不同 version 可并存。
   */
  registerSkill(definition: SkillDefinition): SkillRecord {
    const errors = validateSkillDefinition(definition);
    if (errors.length > 0) {
      throw new Error(`Skill validation failed: ${errors.join("; ")}`);
    }

    const now = new Date().toISOString();
    const record: SkillRecord = {
      ...definition,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    return this.db.upsertSkill(record);
  }

  /**
   * 将 skillId 列表解析为 SkillBinding[]，自动递归解析依赖。
   * - 过滤禁用的 Skill（除非 options.includeDisabled）
   * - 检测循环依赖并抛出 CircularDependencyError
   * - 未找到的 skillId 记录 warn 日志并跳过
   */
  resolveSkills(
    skillIds: string[],
    options?: ResolveOptions
  ): SkillBinding[] {
    const allSkills = this.db.getSkills();
    const resolved = new Map<string, SkillBinding>();

    const resolve = (
      skillId: string,
      visiting: Set<string>,
      path: string[]
    ): void => {
      // Already resolved — skip
      const key = this.resolveKey(skillId, options?.versionMap?.[skillId]);
      if (resolved.has(key)) return;

      // Cycle detection
      if (visiting.has(skillId)) {
        throw new CircularDependencyError([...path, skillId]);
      }

      // Find the skill record
      const record = this.findSkillRecord(
        allSkills,
        skillId,
        options?.versionMap?.[skillId]
      );

      if (!record) {
        console.warn(`[SkillRegistry] Skill "${skillId}" not found, skipping`);
        return;
      }

      // Filter disabled unless explicitly included
      if (!record.enabled && !options?.includeDisabled) {
        console.warn(
          `[SkillRegistry] Skill "${skillId}@${record.version}" is disabled, skipping`
        );
        return;
      }

      visiting.add(skillId);

      // Recursively resolve dependencies
      if (record.dependencies?.length) {
        for (const depId of record.dependencies) {
          resolve(depId, visiting, [...path, skillId]);
        }
      }

      visiting.delete(skillId);

      const binding: SkillBinding = {
        skillId: record.id,
        version: record.version,
        resolvedSkill: record,
        mcpBindings: [],
        enabled: record.enabled,
      };

      resolved.set(key, binding);
    };

    for (const skillId of skillIds) {
      resolve(skillId, new Set(), []);
    }

    return Array.from(resolved.values());
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveKey(skillId: string, version?: string): string {
    return version ? `${skillId}@${version}` : skillId;
  }

  private findSkillRecord(
    allSkills: SkillRecord[],
    skillId: string,
    version?: string
  ): SkillRecord | undefined {
    if (version) {
      return allSkills.find(s => s.id === skillId && s.version === version);
    }

    const candidates = allSkills
      .filter(s => s.id === skillId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (!candidates.length) return undefined;

    // Canary: check if the latest version has a canary config pointing to another version
    const latest = candidates[0];
    if (latest.canary?.enabled && latest.canary.targetVersion) {
      const canaryTarget = allSkills.find(
        s => s.id === skillId && s.version === latest.canary!.targetVersion
      );
      if (canaryTarget) {
        const pct = Math.max(0, Math.min(100, latest.canary.percentage));
        if (Math.random() * 100 < pct) {
          return canaryTarget;
        }
      }
    }

    return latest;
  }

  // ---------------------------------------------------------------------------
  // Enable / Disable
  // ---------------------------------------------------------------------------

  /** 启用指定版本的 Skill，记录审计日志 */
  enableSkill(
    skillId: string,
    version: string,
    operator: string,
    reason: string
  ): void {
    const record = this.db.getSkill(skillId, version);
    if (!record) {
      throw new Error(`Skill "${skillId}@${version}" not found`);
    }
    record.enabled = true;
    this.db.upsertSkill(record);
    this.db.createSkillAuditLog({
      skillId,
      version,
      action: "enable",
      operator,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /** 禁用指定版本的 Skill，记录审计日志 */
  disableSkill(
    skillId: string,
    version: string,
    operator: string,
    reason: string
  ): void {
    const record = this.db.getSkill(skillId, version);
    if (!record) {
      throw new Error(`Skill "${skillId}@${version}" not found`);
    }
    record.enabled = false;
    this.db.upsertSkill(record);
    this.db.createSkillAuditLog({
      skillId,
      version,
      action: "disable",
      operator,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Version management & query
  // ---------------------------------------------------------------------------

  /** 查询 Skill 的所有版本 */
  getSkillVersions(skillId: string): SkillRecord[] {
    return this.db.getSkills().filter(s => s.id === skillId);
  }

  /** 按 category 和 tags 查询 Skill */
  querySkills(filter: SkillQueryFilter): SkillRecord[] {
    let results = this.db.getSkills();
    if (filter.category) {
      results = results.filter(s => s.category === filter.category);
    }
    if (filter.tags?.length) {
      results = results.filter(s =>
        filter.tags!.some(tag => s.tags.includes(tag))
      );
    }
    if (filter.enabled !== undefined) {
      results = results.filter(s => s.enabled === filter.enabled);
    }
    return results;
  }

  /** 将 Skill 的 requiredMcp 解析为 McpBinding[]，缺失 MCP 记录 warn 并跳过 */
  resolveMcpForSkill(
    skill: SkillRecord,
    agentId: string,
    workflowId: string
  ): WorkflowMcpBinding[] {
    if (!skill.requiredMcp.length) return [];
    const bindings = resolveMcpBindings(skill.requiredMcp, agentId, workflowId);
    const resolvedIds = new Set(bindings.map(b => b.id));
    for (const mcpId of skill.requiredMcp) {
      if (!resolvedIds.has(mcpId)) {
        console.warn(
          `[SkillRegistry] MCP "${mcpId}" not found for skill "${skill.id}", skipping`
        );
      }
    }
    return bindings;
  }
}
