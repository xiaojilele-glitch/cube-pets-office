/**
 * RoleMatcher — 多维评分角色匹配引擎（全局单例）
 *
 * 根据任务上下文和 Agent 能力画像，为任务推荐最优的 Agent-角色组合。
 *
 * 评分公式：
 *   roleMatchScore =
 *     skillMatch(task.requiredSkills, role.requiredSkillIds) * 0.35
 *     + agentCompetency(agent.skillVector, role) * 0.30
 *     + rolePerformance(agent.rolePerformanceHistory[roleId]) * 0.25 * confidenceCoeff
 *     + (1 - agent.loadFactor) * 0.10
 *
 * 其中 confidenceCoeff = totalTasks < 10 ? 0.6 : 1.0
 *
 * @see Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import type {
  RoleTemplate,
  AgentRoleRecommendation,
  RolePerformanceRecord,
} from "../../shared/role-schema.js";
import type { Agent } from "./agent.js";
import { roleRegistry } from "./role-registry.js";
import { rolePerformanceTracker } from "./role-performance-tracker.js";

/** Keyword-to-role mapping for inference fallback */
const KEYWORD_ROLE_MAP: Record<string, string[]> = {
  coder: ["code", "implement", "develop", "program"],
  reviewer: ["review", "check", "audit"],
  architect: ["design", "architect", "plan"],
  qa: ["test", "qa", "quality"],
  "tech-writer": ["write", "document", "doc"],
  pm: ["manage", "coordinate", "lead"],
};

interface TaskContext {
  description: string;
  requiredSkills?: string[];
  requiredRole?: string;
}

class RoleMatcher {
  /**
   * Match candidate agents to roles for a given task.
   *
   * 1. If task.requiredRole is set, skip inference and only match within that role
   * 2. Otherwise, infer candidate roles from task description
   * 3. For each (agent, role) pair, compute roleMatchScore
   * 4. Return results sorted by score descending
   * 5. Log matching results for debug
   *
   * @see Requirements 3.1, 3.4, 3.5
   */
  async match(
    task: TaskContext,
    candidateAgents: Agent[]
  ): Promise<AgentRoleRecommendation[]> {
    if (candidateAgents.length === 0) {
      console.log(
        "[RoleMatcher] No candidate agents provided, returning empty list"
      );
      return [];
    }

    // Determine candidate roles
    let candidateRoles: Array<{ roleId: string; reason: string }>;

    if (task.requiredRole) {
      // Skip inference, use only the required role
      const template = roleRegistry.get(task.requiredRole);
      if (!template) {
        console.log(
          `[RoleMatcher] Required role "${task.requiredRole}" not found in registry`
        );
        return [];
      }
      candidateRoles = [
        { roleId: task.requiredRole, reason: "Explicitly required by task" },
      ];
    } else {
      candidateRoles = await this.inferCandidateRoles(task.description);
    }

    if (candidateRoles.length === 0) {
      console.log("[RoleMatcher] No candidate roles found");
      return [];
    }

    // Score all (agent, role) combinations
    const recommendations: AgentRoleRecommendation[] = [];

    for (const agent of candidateAgents) {
      for (const { roleId, reason } of candidateRoles) {
        const template = roleRegistry.resolve(roleId);
        const score = this.computeScore(task, agent, template);

        recommendations.push({
          agentId: agent.config.id,
          recommendedRoleId: roleId,
          roleMatchScore: Math.round(score * 1000) / 1000, // round to 3 decimals
          reason,
        });
      }
    }

    // Sort by score descending
    recommendations.sort((a, b) => b.roleMatchScore - a.roleMatchScore);

    // Log matching results for debug (Requirement 3.5)
    console.log(
      "[RoleMatcher] Match results:",
      JSON.stringify(
        recommendations.map(r => ({
          agentId: r.agentId,
          roleId: r.recommendedRoleId,
          score: r.roleMatchScore,
        })),
        null,
        2
      )
    );

    return recommendations;
  }

  /**
   * Compute the weighted role match score for an (agent, role) pair.
   *
   * Formula:
   *   skillMatch * 0.35
   *   + agentCompetency * 0.30
   *   + rolePerformance * 0.25 * confidenceCoeff
   *   + (1 - loadFactor) * 0.10
   *
   * @see Requirements 3.2, 4.4
   */
  computeScore(task: TaskContext, agent: Agent, role: RoleTemplate): number {
    const skillMatchVal = this.skillMatch(
      task.requiredSkills,
      role.requiredSkillIds
    );
    const competencyVal = this.agentCompetency(agent, role);
    const { score: perfVal, confidenceCoeff } = this.rolePerformance(
      agent,
      role.roleId
    );
    const loadFactor = this.getLoadFactor(agent);

    return (
      skillMatchVal * 0.35 +
      competencyVal * 0.3 +
      perfVal * 0.25 * confidenceCoeff +
      (1 - loadFactor) * 0.1
    );
  }

  /**
   * Infer candidate roles from task description using keyword matching.
   *
   * Maps keywords in the description to role IDs. If no keywords match,
   * returns all registered roles.
   *
   * @see Requirements 3.3
   */
  async inferCandidateRoles(
    taskDescription: string
  ): Promise<Array<{ roleId: string; reason: string }>> {
    const descLower = taskDescription.toLowerCase();
    const matchedRoles: Array<{ roleId: string; reason: string }> = [];

    for (const [roleId, keywords] of Object.entries(KEYWORD_ROLE_MAP)) {
      const matchedKeywords = keywords.filter(kw => descLower.includes(kw));
      if (matchedKeywords.length > 0) {
        // Only include if the role is actually registered
        if (roleRegistry.get(roleId)) {
          matchedRoles.push({
            roleId,
            reason: `Keyword match: ${matchedKeywords.join(", ")}`,
          });
        }
      }
    }

    if (matchedRoles.length > 0) {
      return matchedRoles;
    }

    // Fallback: return all registered roles
    const allRoles = roleRegistry.list();
    return allRoles.map(t => ({
      roleId: t.roleId,
      reason: "No keyword match, returning all registered roles",
    }));
  }

  // ── Private scoring helpers ──────────────────────────────────────

  /**
   * Jaccard similarity between task required skills and role required skills.
   * If task has no requiredSkills, default to 0.5.
   */
  private skillMatch(
    taskSkills: string[] | undefined,
    roleSkills: string[]
  ): number {
    if (!taskSkills || taskSkills.length === 0) {
      return 0.5;
    }

    const taskSet = new Set(taskSkills);
    const roleSet = new Set(roleSkills);

    const intersection = Array.from(taskSet).filter(s => roleSet.has(s)).length;
    const unionSet = new Set(Array.from(taskSet).concat(Array.from(roleSet)));
    const union = unionSet.size;

    if (union === 0) return 0.5;
    return intersection / union;
  }

  /**
   * Agent competency: overlap between agent's known skills and role's requiredSkillIds.
   * Uses the agent's currently loaded role skills as a proxy for the agent's skill vector.
   */
  private agentCompetency(agent: Agent, role: RoleTemplate): number {
    const roleState = agent.getRoleState();
    const agentSkills = roleState.loadedSkillIds;

    if (agentSkills.length === 0 || role.requiredSkillIds.length === 0) {
      return 0.5; // default when no skill data available
    }

    const agentSet = new Set(agentSkills);
    const matchCount = role.requiredSkillIds.filter(s =>
      agentSet.has(s)
    ).length;
    return matchCount / role.requiredSkillIds.length;
  }

  /**
   * Role performance: get from RolePerformanceTracker, normalize avgQualityScore to [0,1].
   * Returns both the score and the confidence coefficient.
   */
  private rolePerformance(
    agent: Agent,
    roleId: string
  ): { score: number; confidenceCoeff: number } {
    const perfData = rolePerformanceTracker.getPerformance(
      agent.config.id,
      roleId
    );

    if (!perfData || !(perfData as RolePerformanceRecord).totalTasks) {
      return { score: 0.5, confidenceCoeff: 0.6 };
    }

    const record = perfData as RolePerformanceRecord;
    const score = record.avgQualityScore / 100; // normalize to [0, 1]
    const confidenceCoeff = record.totalTasks < 10 ? 0.6 : 1.0;

    return { score, confidenceCoeff };
  }

  /**
   * Get agent load factor. Default to 0 (agents are available).
   * Can be extended later with real load tracking.
   */
  private getLoadFactor(_agent: Agent): number {
    return 0;
  }
}

export const roleMatcher = new RoleMatcher();

/** Export class for testing */
export { RoleMatcher, KEYWORD_ROLE_MAP };
export type { TaskContext };
