/**
 * AnomalyDetector — 异常检测与防刷机制
 *
 * 检测信誉分异常波动、刷分模式、互评串通，
 * 以及 probation 阶段的正向更新阻尼。
 *
 * @see Requirements 7.1, 7.2, 7.3, 7.4
 */

import type { ReputationConfig, ReputationChangeEvent, ReputationProfile } from '../../../shared/reputation.js';

// ---------------------------------------------------------------------------
// 辅助接口
// ---------------------------------------------------------------------------

/** 任务摘要，用于刷分检测 */
export interface TaskSummary {
  taskId: string | number;
  complexity: 'low' | 'medium' | 'high';
  completedAt: string; // ISO timestamp
}

/** 互评评分对，用于串通检测 */
export interface CollabRatingPair {
  agentA: string;
  agentB: string;
  /** A 给 B 的评分 0-100 */
  ratingAtoB: number;
  /** B 给 A 的评分 0-100 */
  ratingBtoA: number;
  /** 其他成员给出的平均评分 */
  otherMembersAvgRating: number;
}

/** 异常波动检测结果 */
export interface AnomalyResult {
  isAnomaly: boolean;
  totalDelta: number;
}

/** 刷分模式检测结果 */
export interface GrindingResult {
  isGrinding: boolean;
  lowComplexityRatio: number;
  /** 1.0 if not grinding, lowComplexityWeight if grinding */
  weight: number;
}

/** 互评串通检测结果 */
export interface CollusionResult {
  isSuspicious: boolean;
  suspiciousPairs: Array<{ agentA: string; agentB: string }>;
  /** 1.0 if not suspicious, suspiciousWeight if suspicious */
  weight: number;
}

// ---------------------------------------------------------------------------
// AnomalyDetector
// ---------------------------------------------------------------------------

export class AnomalyDetector {
  constructor(private config: ReputationConfig) {}

  /**
   * 检测 24 小时内信誉异常波动。
   *
   * 对 recentEvents 中 24 小时内属于该 agentId 的事件，
   * 累加 |newOverallScore - oldOverallScore| 的绝对值。
   * 若总变动超过 anomaly.threshold，标记为异常。
   *
   * @see Requirement 7.1
   */
  checkAnomalyThreshold(agentId: string, recentEvents: ReputationChangeEvent[]): AnomalyResult {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    let totalDelta = 0;

    for (const event of recentEvents) {
      if (event.agentId !== agentId) continue;

      const eventTime = new Date(event.timestamp).getTime();
      if (now - eventTime > twentyFourHoursMs) continue;

      totalDelta += Math.abs(event.newOverallScore - event.oldOverallScore);
    }

    return {
      isAnomaly: totalDelta > this.config.anomaly.threshold,
      totalDelta,
    };
  }

  /**
   * 检测刷分模式。
   *
   * 在 24 小时内的 recentTasks 中，若 low 复杂度任务占比 > grindingTaskRatio
   * 且总任务数 > grindingTaskCount，则判定为刷分，返回 lowComplexityWeight。
   *
   * @see Requirement 7.2
   */
  checkGrindingPattern(agentId: string, recentTasks: TaskSummary[]): GrindingResult {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    // Filter tasks within 24 hours
    const tasksIn24h = recentTasks.filter((task) => {
      const taskTime = new Date(task.completedAt).getTime();
      return now - taskTime <= twentyFourHoursMs;
    });

    const totalCount = tasksIn24h.length;
    const lowCount = tasksIn24h.filter((t) => t.complexity === 'low').length;
    const lowComplexityRatio = totalCount > 0 ? lowCount / totalCount : 0;

    const isGrinding =
      lowComplexityRatio > this.config.anomaly.grindingTaskRatio &&
      totalCount > this.config.anomaly.grindingTaskCount;

    return {
      isGrinding,
      lowComplexityRatio,
      weight: isGrinding ? this.config.anomaly.lowComplexityWeight : 1.0,
    };
  }

  /**
   * 检测互评串通。
   *
   * 对每对 Agent，若双方互评均 > collusionRatingMin
   * 且双方评分与其他成员平均评分的偏差均 > collusionDeviationMin，
   * 则标记为可疑。
   *
   * @see Requirement 7.3
   */
  checkCollabCollusion(taskforceRatings: CollabRatingPair[]): CollusionResult {
    const suspiciousPairs: Array<{ agentA: string; agentB: string }> = [];

    for (const pair of taskforceRatings) {
      const mutualHighRating =
        pair.ratingAtoB > this.config.anomaly.collusionRatingMin &&
        pair.ratingBtoA > this.config.anomaly.collusionRatingMin;

      const deviationAtoB = Math.abs(pair.ratingAtoB - pair.otherMembersAvgRating);
      const deviationBtoA = Math.abs(pair.ratingBtoA - pair.otherMembersAvgRating);

      const highDeviation =
        deviationAtoB > this.config.anomaly.collusionDeviationMin &&
        deviationBtoA > this.config.anomaly.collusionDeviationMin;

      if (mutualHighRating && highDeviation) {
        suspiciousPairs.push({ agentA: pair.agentA, agentB: pair.agentB });
      }
    }

    const isSuspicious = suspiciousPairs.length > 0;

    return {
      isSuspicious,
      suspiciousPairs,
      weight: isSuspicious ? this.config.anomaly.suspiciousWeight : 1.0,
    };
  }

  /**
   * 计算 probation 阶段的阻尼系数。
   *
   * 若 profile 为外部 Agent 且 trustTier 为 probation，
   * 返回 probationDamping（默认 0.7）；否则返回 1.0。
   *
   * @see Requirement 7.4
   */
  getProbationDamping(profile: ReputationProfile): number {
    if (profile.isExternal && profile.trustTier === 'probation') {
      return this.config.anomaly.probationDamping;
    }
    return 1.0;
  }
}
