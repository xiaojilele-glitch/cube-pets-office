/**
 * TrustTierEvaluator — 信任层级评估器
 *
 * 负责信誉等级映射、信任层级计算、外部 Agent 升级判定和等级变更事件生成。
 * 纯函数式设计，不涉及 I/O 或副作用。
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4
 */

import type {
  ReputationConfig,
  ReputationGrade,
  ReputationProfile,
  TrustTier,
} from '../../../shared/reputation.js';

/** Grade ordering from highest to lowest for comparison */
const GRADE_ORDER: Record<ReputationGrade, number> = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
  D: 0,
};

export class TrustTierEvaluator {
  constructor(private config: ReputationConfig) {}

  /**
   * Map overallScore to grade using config.grades boundaries.
   * S(900-1000), A(700-899), B(500-699), C(300-499), D(0-299)
   */
  computeGrade(overallScore: number): ReputationGrade {
    const { grades } = this.config;
    if (overallScore >= grades.S.min) return 'S';
    if (overallScore >= grades.A.min) return 'A';
    if (overallScore >= grades.B.min) return 'B';
    if (overallScore >= grades.C.min) return 'C';
    return 'D';
  }

  /**
   * Map grade to trust tier:
   * S/A → trusted, B → standard, C/D → probation
   */
  computeTrustTier(grade: ReputationGrade): TrustTier {
    switch (grade) {
      case 'S':
      case 'A':
        return 'trusted';
      case 'B':
        return 'standard';
      case 'C':
      case 'D':
        return 'probation';
    }
  }

  /**
   * Evaluate external Agent trust tier upgrade:
   * - totalTasks >= trustedTaskCount && overallScore >= trustedMinScore → trusted
   * - totalTasks >= standardTaskCount && overallScore >= standardMinScore → standard
   * - otherwise → probation
   */
  evaluateExternalUpgrade(profile: ReputationProfile): TrustTier {
    const { externalUpgrade } = this.config;
    if (
      profile.totalTasks >= externalUpgrade.trustedTaskCount &&
      profile.overallScore >= externalUpgrade.trustedMinScore
    ) {
      return 'trusted';
    }
    if (
      profile.totalTasks >= externalUpgrade.standardTaskCount &&
      profile.overallScore >= externalUpgrade.standardMinScore
    ) {
      return 'standard';
    }
    return 'probation';
  }

  /**
   * Generate events for grade changes:
   * - If grade dropped, generate REPUTATION_DOWNGRADE event
   * - If new grade is D, also generate AGENT_REPUTATION_CRITICAL alert
   * Returns array of event objects with type and detail.
   */
  evaluateGradeChange(
    oldGrade: ReputationGrade,
    newGrade: ReputationGrade,
    agentId: string,
    taskId: string | number,
  ): Array<{ type: string; detail: string }> {
    const events: Array<{ type: string; detail: string }> = [];

    if (GRADE_ORDER[newGrade] < GRADE_ORDER[oldGrade]) {
      events.push({
        type: 'REPUTATION_DOWNGRADE',
        detail: `Agent ${agentId} downgraded from ${oldGrade} to ${newGrade} after task ${taskId}`,
      });

      if (newGrade === 'D') {
        events.push({
          type: 'AGENT_REPUTATION_CRITICAL',
          detail: `Agent ${agentId} reached critical grade D after task ${taskId}`,
        });
      }
    }

    return events;
  }
}
