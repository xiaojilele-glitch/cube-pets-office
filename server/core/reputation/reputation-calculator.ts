/**
 * ReputationCalculator — 信誉计算引擎
 *
 * 负责各维度子分的变动计算、综合分加权计算、变动幅度限制等核心数学逻辑。
 * 纯函数式设计，不涉及 I/O 或副作用。
 *
 * @see Requirements 1.2, 2.2, 2.4
 */

import type {
  DimensionScores,
  DimensionDeltas,
  ReputationConfig,
  ReputationSignal,
} from '../../../shared/reputation.js';

export class ReputationCalculator {
  constructor(private config: ReputationConfig) {}

  /**
   * Exponential Moving Average
   * result = current * (1 - alpha) + newValue * alpha
   */
  ema(current: number, newValue: number, alpha: number): number {
    return current * (1 - alpha) + newValue * alpha;
  }

  /**
   * Ratio to score: linear mapping
   * ratio <= 1.0 → 1000
   * ratio >= 2.0 → 0
   * between: linear interpolation
   */
  ratioToScore(ratio: number): number {
    if (ratio <= 1.0) return 1000;
    if (ratio >= 2.0) return 0;
    return Math.round(1000 * (1 - (ratio - 1.0)));
  }

  /**
   * Compute dimension deltas based on signal and current scores.
   * Each delta = newComputedValue - current value for that dimension.
   */
  computeDimensionDeltas(
    current: DimensionScores,
    signal: ReputationSignal,
    streakCount: number,
  ): DimensionDeltas {
    const { ema: emaConfig, reliability, streak } = this.config;

    // Determine effective quality alpha (streak bonus applies)
    let qualityAlpha = emaConfig.qualityAlpha;
    if (streakCount >= streak.threshold) {
      qualityAlpha = qualityAlpha * streak.alphaMultiplier;
    }

    // qualityScore: EMA(current, taskQualityScore * 10, qualityAlpha)
    const newQuality = this.ema(current.qualityScore, signal.taskQualityScore * 10, qualityAlpha);
    const qualityDelta = newQuality - current.qualityScore;

    // speedScore: EMA(current, ratioToScore(actual/estimated), qualityAlpha)
    const speedRatio = signal.actualDurationMs / signal.estimatedDurationMs;
    const speedTarget = this.ratioToScore(speedRatio);
    const newSpeed = this.ema(current.speedScore, speedTarget, qualityAlpha);
    const speedDelta = newSpeed - current.speedScore;

    // efficiencyScore: EMA(current, ratioToScore(tokenConsumed/tokenBudget), qualityAlpha)
    const efficiencyRatio = signal.tokenConsumed / signal.tokenBudget;
    const efficiencyTarget = this.ratioToScore(efficiencyRatio);
    const newEfficiency = this.ema(current.efficiencyScore, efficiencyTarget, qualityAlpha);
    const efficiencyDelta = newEfficiency - current.efficiencyScore;

    // collaborationScore: if collaborationRating exists, EMA with collaborationAlpha; else 0
    let collaborationDelta = 0;
    if (signal.collaborationRating != null) {
      const newCollab = this.ema(
        current.collaborationScore,
        signal.collaborationRating * 10,
        emaConfig.collaborationAlpha,
      );
      collaborationDelta = newCollab - current.collaborationScore;
    }

    // reliabilityScore: penalty/recovery logic
    let reliabilityDelta = 0;
    if (signal.wasRolledBack) {
      reliabilityDelta -= reliability.rollbackPenalty;
    }
    reliabilityDelta -= signal.downstreamFailures * reliability.downstreamFailurePenalty;
    if (!signal.wasRolledBack) {
      reliabilityDelta += reliability.successRecovery;
    }

    return {
      qualityDelta,
      speedDelta,
      efficiencyDelta,
      collaborationDelta,
      reliabilityDelta,
    };
  }

  /**
   * Clamp each delta to [-maxDelta, maxDelta]
   */
  clampDeltas(deltas: DimensionDeltas, maxDelta: number): DimensionDeltas {
    const clamp = (v: number) => Math.max(-maxDelta, Math.min(maxDelta, v));
    return {
      qualityDelta: clamp(deltas.qualityDelta),
      speedDelta: clamp(deltas.speedDelta),
      efficiencyDelta: clamp(deltas.efficiencyDelta),
      collaborationDelta: clamp(deltas.collaborationDelta),
      reliabilityDelta: clamp(deltas.reliabilityDelta),
    };
  }

  /**
   * Weighted overall score:
   * Math.round(quality * w.quality + speed * w.speed + efficiency * w.efficiency
   *   + collaboration * w.collaboration + reliability * w.reliability)
   * Clamped to [0, 1000]
   */
  computeOverallScore(
    dimensions: DimensionScores,
    weights?: ReputationConfig['weights'],
  ): number {
    const w = weights ?? this.config.weights;
    const raw =
      dimensions.qualityScore * w.quality +
      dimensions.speedScore * w.speed +
      dimensions.efficiencyScore * w.efficiency +
      dimensions.collaborationScore * w.collaboration +
      dimensions.reliabilityScore * w.reliability;
    return Math.max(0, Math.min(1000, Math.round(raw)));
  }
}
