import type {
  AssessmentDecision,
  AssessmentResult,
  AssessmentWeights,
  AutonomyConfig,
} from '../../shared/autonomy-types.js';
import type { CapabilityProfileManager } from './capability-profile-manager.js';

// ─── Local Types ─────────────────────────────────────────────

/** Task request passed from the workflow engine to an agent for assessment. */
export interface TaskRequest {
  taskId: string;
  requiredSkills: string[];
  requiredSkillWeights: Map<string, number>;
}

// ─── SelfAssessment ──────────────────────────────────────────

/**
 * Agent self-assessment engine.
 *
 * Performs coarse filtering, weighted cosine skill matching,
 * fitness scoring, decision making, and referral generation.
 */
export class SelfAssessment {
  constructor(
    private readonly profileManager: CapabilityProfileManager,
    private readonly config: AutonomyConfig,
  ) {}

  /**
   * Full self-assessment pipeline for a given agent and task.
   */
  assess(agentId: string, taskRequest: TaskRequest): AssessmentResult {
    const start = Date.now();

    const profile = this.profileManager.getProfile(agentId);
    if (!profile) {
      return this.buildResult(
        agentId, taskRequest.taskId, 0, 'REJECT_AND_REFER',
        'profile missing', [], start,
      );
    }

    // 1. Coarse filter
    if (!this.coarseFilter(profile.specializationTags, taskRequest.requiredSkills)) {
      return this.buildResult(
        agentId, taskRequest.taskId, 0, 'REJECT_AND_REFER',
        'coarse filter failed: no skill overlap',
        this.generateReferralList(taskRequest, agentId),
        start,
      );
    }

    // 2. Compute skill match (weighted cosine similarity)
    const skillMatch = this.computeSkillMatch(
      profile.skillVector,
      taskRequest.requiredSkillWeights,
    );

    // 3. Compute resource adequacy
    const resourceAdequacy = this.computeResourceAdequacy(
      profile.resourceQuota.remainingTokenBudget,
    );

    // 4. Compute fitness score
    const fitnessScore = this.computeFitnessScore(
      skillMatch,
      profile.loadFactor,
      profile.confidenceScore,
      resourceAdequacy,
      this.config.assessmentWeights,
    );

    // 5. Make decision
    const decision = this.makeDecision(fitnessScore);

    // 6. Generate referral list if REJECT_AND_REFER
    const referralList = decision === 'REJECT_AND_REFER'
      ? this.generateReferralList(taskRequest, agentId)
      : [];

    const reason = this.buildReason(decision, fitnessScore, skillMatch);

    return this.buildResult(
      agentId, taskRequest.taskId, fitnessScore, decision,
      reason, referralList, start,
    );
  }

  /**
   * Coarse filter: return true if the intersection of agentTags and
   * requiredSkills is non-empty. Return false if either array is empty
   * or there is no overlap.
   */
  coarseFilter(agentTags: string[], requiredSkills: string[]): boolean {
    if (agentTags.length === 0 || requiredSkills.length === 0) return false;
    const tagSet = new Set(agentTags);
    return requiredSkills.some((skill) => tagSet.has(skill));
  }

  /**
   * Weighted cosine similarity between agent skill vector and task
   * required skill weights.
   *
   * Formula: Σ(agent[i] * task[i]) / (||agent|| * ||task||)
   * Returns 0.0 if either vector has zero magnitude.
   * Result clamped to [0.0, 1.0].
   */
  computeSkillMatch(
    agentSkills: Map<string, number>,
    requiredSkills: Map<string, number>,
  ): number {
    // Collect the union of all skill keys
    const allKeys = new Set([...agentSkills.keys(), ...requiredSkills.keys()]);

    let dotProduct = 0;
    let agentMag = 0;
    let taskMag = 0;

    for (const key of allKeys) {
      const a = agentSkills.get(key) ?? 0;
      const t = requiredSkills.get(key) ?? 0;
      dotProduct += a * t;
      agentMag += a * a;
      taskMag += t * t;
    }

    const denominator = Math.sqrt(agentMag) * Math.sqrt(taskMag);
    if (denominator === 0) return 0;

    return clamp(dotProduct / denominator, 0, 1);
  }

  /**
   * Compute fitness score as a weighted sum.
   *
   * fitness = w1*skillMatch + w2*(1-loadFactor) + w3*confidenceScore + w4*resourceAdequacy
   * Result clamped to [0.0, 1.0].
   */
  computeFitnessScore(
    skillMatch: number,
    loadFactor: number,
    confidenceScore: number,
    resourceAdequacy: number,
    weights: AssessmentWeights,
  ): number {
    const raw =
      weights.w1_skillMatch * skillMatch +
      weights.w2_loadFactor * (1 - loadFactor) +
      weights.w3_confidence * confidenceScore +
      weights.w4_resource * resourceAdequacy;

    return clamp(raw, 0, 1);
  }

  /**
   * Decision based on fitness score thresholds:
   * - >= 0.8 → ACCEPT
   * - >= 0.6 and < 0.8 → ACCEPT_WITH_CAVEAT
   * - >= 0.4 and < 0.6 → REQUEST_ASSIST
   * - < 0.4 → REJECT_AND_REFER
   */
  makeDecision(fitnessScore: number): AssessmentDecision {
    if (fitnessScore >= 0.8) return 'ACCEPT';
    if (fitnessScore >= 0.6) return 'ACCEPT_WITH_CAVEAT';
    if (fitnessScore >= 0.4) return 'REQUEST_ASSIST';
    return 'REJECT_AND_REFER';
  }

  /**
   * Generate a referral list of up to `maxCount` agent IDs sorted by
   * fitness score descending, excluding the given agent.
   */
  generateReferralList(
    taskRequest: TaskRequest,
    excludeAgentId: string,
    maxCount: number = 3,
  ): string[] {
    const allProfiles = this.profileManager.getAllProfiles();

    const scored: Array<{ agentId: string; fitness: number }> = [];

    for (const profile of allProfiles) {
      if (profile.agentId === excludeAgentId) continue;

      const skillMatch = this.computeSkillMatch(
        profile.skillVector,
        taskRequest.requiredSkillWeights,
      );
      const resourceAdequacy = this.computeResourceAdequacy(
        profile.resourceQuota.remainingTokenBudget,
      );
      const fitness = this.computeFitnessScore(
        skillMatch,
        profile.loadFactor,
        profile.confidenceScore,
        resourceAdequacy,
        this.config.assessmentWeights,
      );

      scored.push({ agentId: profile.agentId, fitness });
    }

    scored.sort((a, b) => b.fitness - a.fitness);
    return scored.slice(0, maxCount).map((s) => s.agentId);
  }

  /**
   * Resource adequacy as a simple ratio clamped to [0, 1].
   * Baseline: 50 000 tokens considered "fully adequate".
   */
  computeResourceAdequacy(remainingTokenBudget: number): number {
    return clamp(remainingTokenBudget / 50_000, 0, 1);
  }

  // ─── Private helpers ────────────────────────────────────────

  private buildResult(
    agentId: string,
    taskId: string,
    fitnessScore: number,
    decision: AssessmentDecision,
    reason: string,
    referralList: string[],
    startMs: number,
  ): AssessmentResult {
    return {
      agentId,
      taskId,
      fitnessScore,
      decision,
      reason,
      referralList,
      assessedAt: Date.now(),
      durationMs: Date.now() - startMs,
    };
  }

  private buildReason(
    decision: AssessmentDecision,
    fitnessScore: number,
    skillMatch: number,
  ): string {
    const score = fitnessScore.toFixed(3);
    const match = skillMatch.toFixed(3);
    switch (decision) {
      case 'ACCEPT':
        return `Fully capable (fitness=${score}, skillMatch=${match})`;
      case 'ACCEPT_WITH_CAVEAT':
        return `Capable with review recommended (fitness=${score}, skillMatch=${match})`;
      case 'REQUEST_ASSIST':
        return `Partial capability, assistance needed (fitness=${score}, skillMatch=${match})`;
      case 'REJECT_AND_REFER':
        return `Insufficient capability (fitness=${score}, skillMatch=${match})`;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
