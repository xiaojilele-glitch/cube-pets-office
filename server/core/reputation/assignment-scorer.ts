/**
 * AssignmentScorer — 任务分配信誉因子
 *
 * 计算任务分配得分、角色信誉替代逻辑、阈值过滤和 Taskforce 角色要求过滤。
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4
 */

import type { ReputationConfig, ReputationProfile } from '../../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssignmentCandidate {
  agentId: string;
  fitnessScore: number;
  profile: ReputationProfile;
}

export interface AssignmentResult {
  agentId: string;
  fitnessScore: number;
  reputationFactor: number;
  assignmentScore: number;
}

export type TaskforceRole = 'lead' | 'worker' | 'reviewer';

// ---------------------------------------------------------------------------
// AssignmentScorer
// ---------------------------------------------------------------------------

export class AssignmentScorer {
  constructor(private config: ReputationConfig) {}

  /**
   * Compute assignment score:
   * assignmentScore = fitnessScore * fitnessWeight + reputationFactor * reputationWeight
   *
   * reputationFactor derivation:
   * - Default: overallScore / 1000
   * - With taskRole + role reputation (lowConfidence=false): roleRep.overallScore / 1000
   * - With taskRole + role reputation (lowConfidence=true):
   *   (roleRep.overallScore * roleWeight + overallScore * overallWeight) / 1000
   */
  computeAssignmentScore(
    fitnessScore: number,
    profile: ReputationProfile,
    taskRole?: string,
    config?: ReputationConfig,
  ): AssignmentResult {
    const cfg = config ?? this.config;
    let reputationFactor = profile.overallScore / 1000;

    if (taskRole) {
      const roleRep = profile.roleReputation[taskRole];
      if (roleRep) {
        if (!roleRep.lowConfidence) {
          reputationFactor = roleRep.overallScore / 1000;
        } else {
          reputationFactor =
            (roleRep.overallScore * cfg.lowConfidence.roleWeight +
              profile.overallScore * cfg.lowConfidence.overallWeight) /
            1000;
        }
      }
    }

    const assignmentScore =
      fitnessScore * cfg.scheduling.fitnessWeight +
      reputationFactor * cfg.scheduling.reputationWeight;

    return {
      agentId: profile.agentId,
      fitnessScore,
      reputationFactor,
      assignmentScore,
    };
  }

  /**
   * Filter candidates by minimum reputation threshold.
   */
  filterByReputationThreshold(
    candidates: AssignmentCandidate[],
    threshold: number,
  ): AssignmentCandidate[] {
    return candidates.filter((c) => c.profile.overallScore >= threshold);
  }

  /**
   * Filter candidates by Taskforce role requirements:
   * - lead: overallScore >= leadMinScore (600)
   * - worker: overallScore >= workerMinScore (300)
   * - reviewer: qualityScore >= reviewerMinQuality (500)
   */
  filterByTaskforceRequirements(
    candidates: AssignmentCandidate[],
    role: TaskforceRole,
  ): AssignmentCandidate[] {
    switch (role) {
      case 'lead':
        return candidates.filter(
          (c) => c.profile.overallScore >= this.config.scheduling.leadMinScore,
        );
      case 'worker':
        return candidates.filter(
          (c) => c.profile.overallScore >= this.config.scheduling.workerMinScore,
        );
      case 'reviewer':
        return candidates.filter(
          (c) => c.profile.dimensions.qualityScore >= this.config.scheduling.reviewerMinQuality,
        );
    }
  }
}
