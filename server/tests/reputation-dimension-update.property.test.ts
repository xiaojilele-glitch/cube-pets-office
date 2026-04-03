/**
 * Property-Based Test: 维度更新公式正确性
 *
 * **Feature: agent-reputation, Property 3: 维度更新公式正确性**
 * **Validates: Requirements 2.2**
 *
 * For any 当前维度分数和合法的 ReputationSignal:
 * - qualityScore 更新应遵循 EMA(current, taskQualityScore * 10, alpha)
 * - speedScore 更新应遵循 EMA(current, ratioToScore(actualDurationMs / estimatedDurationMs), alpha)
 * - efficiencyScore 更新应遵循 EMA(current, ratioToScore(tokenConsumed / tokenBudget), alpha)
 * - collaborationScore 更新应遵循 EMA(current, collaborationRating * 10, collaborationAlpha) when present
 * - reliabilityScore 更新应遵循惩罚/恢复规则
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { DimensionScores, ReputationSignal } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Reference implementations (independent of ReputationCalculator)
// ---------------------------------------------------------------------------

function refEma(current: number, newValue: number, alpha: number): number {
  return current * (1 - alpha) + newValue * alpha;
}

function refRatioToScore(ratio: number): number {
  if (ratio <= 1.0) return 1000;
  if (ratio >= 2.0) return 0;
  return Math.round(1000 * (1 - (ratio - 1.0)));
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const scoreArb = fc.integer({ min: 0, max: 1000 });

const dimensionScoresArb: fc.Arbitrary<DimensionScores> = fc.record({
  qualityScore: scoreArb,
  speedScore: scoreArb,
  efficiencyScore: scoreArb,
  collaborationScore: scoreArb,
  reliabilityScore: scoreArb,
});

const signalArb: fc.Arbitrary<ReputationSignal> = fc.record({
  agentId: fc.constant('agent-test'),
  taskId: fc.constant('task-1'),
  roleId: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  taskQualityScore: fc.integer({ min: 0, max: 100 }),
  actualDurationMs: fc.integer({ min: 1, max: 100_000 }),
  estimatedDurationMs: fc.integer({ min: 1, max: 100_000 }),
  tokenConsumed: fc.integer({ min: 0, max: 100_000 }),
  tokenBudget: fc.integer({ min: 1, max: 100_000 }),
  wasRolledBack: fc.boolean(),
  downstreamFailures: fc.integer({ min: 0, max: 10 }),
  collaborationRating: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  taskComplexity: fc.option(
    fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
    { nil: undefined },
  ),
  timestamp: fc.constant(new Date().toISOString()),
});

const streakCountArb = fc.integer({ min: 0, max: 50 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 3: 维度更新公式正确性', () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const calc = new ReputationCalculator(config);

  it('qualityDelta follows EMA(current.qualityScore, taskQualityScore * 10, effectiveAlpha)', () => {
    fc.assert(
      fc.property(dimensionScoresArb, signalArb, streakCountArb, (dims, signal, streak) => {
        const deltas = calc.computeDimensionDeltas(dims, signal, streak);

        let effectiveAlpha = config.ema.qualityAlpha;
        if (streak >= config.streak.threshold) {
          effectiveAlpha = effectiveAlpha * config.streak.alphaMultiplier;
        }

        const expectedNew = refEma(dims.qualityScore, signal.taskQualityScore * 10, effectiveAlpha);
        const expectedDelta = expectedNew - dims.qualityScore;

        expect(deltas.qualityDelta).toBeCloseTo(expectedDelta, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('speedDelta follows EMA(current.speedScore, ratioToScore(actual/estimated), effectiveAlpha)', () => {
    fc.assert(
      fc.property(dimensionScoresArb, signalArb, streakCountArb, (dims, signal, streak) => {
        const deltas = calc.computeDimensionDeltas(dims, signal, streak);

        let effectiveAlpha = config.ema.qualityAlpha;
        if (streak >= config.streak.threshold) {
          effectiveAlpha = effectiveAlpha * config.streak.alphaMultiplier;
        }

        const speedRatio = signal.actualDurationMs / signal.estimatedDurationMs;
        const speedTarget = refRatioToScore(speedRatio);
        const expectedNew = refEma(dims.speedScore, speedTarget, effectiveAlpha);
        const expectedDelta = expectedNew - dims.speedScore;

        expect(deltas.speedDelta).toBeCloseTo(expectedDelta, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('efficiencyDelta follows EMA(current.efficiencyScore, ratioToScore(tokenConsumed/tokenBudget), effectiveAlpha)', () => {
    fc.assert(
      fc.property(dimensionScoresArb, signalArb, streakCountArb, (dims, signal, streak) => {
        const deltas = calc.computeDimensionDeltas(dims, signal, streak);

        let effectiveAlpha = config.ema.qualityAlpha;
        if (streak >= config.streak.threshold) {
          effectiveAlpha = effectiveAlpha * config.streak.alphaMultiplier;
        }

        const effRatio = signal.tokenConsumed / signal.tokenBudget;
        const effTarget = refRatioToScore(effRatio);
        const expectedNew = refEma(dims.efficiencyScore, effTarget, effectiveAlpha);
        const expectedDelta = expectedNew - dims.efficiencyScore;

        expect(deltas.efficiencyDelta).toBeCloseTo(expectedDelta, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('collaborationDelta follows EMA with collaborationAlpha when collaborationRating is present', () => {
    // Generate signals that always have a collaborationRating
    const signalWithCollab = fc.record({
      agentId: fc.constant('agent-test'),
      taskId: fc.constant('task-1'),
      roleId: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
      taskQualityScore: fc.integer({ min: 0, max: 100 }),
      actualDurationMs: fc.integer({ min: 1, max: 100_000 }),
      estimatedDurationMs: fc.integer({ min: 1, max: 100_000 }),
      tokenConsumed: fc.integer({ min: 0, max: 100_000 }),
      tokenBudget: fc.integer({ min: 1, max: 100_000 }),
      wasRolledBack: fc.boolean(),
      downstreamFailures: fc.integer({ min: 0, max: 10 }),
      collaborationRating: fc.integer({ min: 0, max: 100 }),
      taskComplexity: fc.option(
        fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
        { nil: undefined },
      ),
      timestamp: fc.constant(new Date().toISOString()),
    });

    fc.assert(
      fc.property(dimensionScoresArb, signalWithCollab, (dims, signal) => {
        const deltas = calc.computeDimensionDeltas(dims, signal, 0);

        const expectedNew = refEma(
          dims.collaborationScore,
          signal.collaborationRating! * 10,
          config.ema.collaborationAlpha,
        );
        const expectedDelta = expectedNew - dims.collaborationScore;

        expect(deltas.collaborationDelta).toBeCloseTo(expectedDelta, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('collaborationDelta is 0 when collaborationRating is absent', () => {
    // Generate signals without collaborationRating
    const signalNoCollab = fc.record({
      agentId: fc.constant('agent-test'),
      taskId: fc.constant('task-1'),
      roleId: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
      taskQualityScore: fc.integer({ min: 0, max: 100 }),
      actualDurationMs: fc.integer({ min: 1, max: 100_000 }),
      estimatedDurationMs: fc.integer({ min: 1, max: 100_000 }),
      tokenConsumed: fc.integer({ min: 0, max: 100_000 }),
      tokenBudget: fc.integer({ min: 1, max: 100_000 }),
      wasRolledBack: fc.boolean(),
      downstreamFailures: fc.integer({ min: 0, max: 10 }),
      taskComplexity: fc.option(
        fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
        { nil: undefined },
      ),
      timestamp: fc.constant(new Date().toISOString()),
    }) as fc.Arbitrary<ReputationSignal>;

    fc.assert(
      fc.property(dimensionScoresArb, signalNoCollab, streakCountArb, (dims, signal, streak) => {
        const deltas = calc.computeDimensionDeltas(dims, signal, streak);
        expect(deltas.collaborationDelta).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('reliabilityDelta applies rollback penalty, downstream failure penalty, and success recovery correctly', () => {
    fc.assert(
      fc.property(dimensionScoresArb, signalArb, streakCountArb, (dims, signal, streak) => {
        const deltas = calc.computeDimensionDeltas(dims, signal, streak);

        let expectedReliabilityDelta = 0;

        // Rollback penalty
        if (signal.wasRolledBack) {
          expectedReliabilityDelta -= config.reliability.rollbackPenalty;
        }

        // Downstream failure penalty
        expectedReliabilityDelta -= signal.downstreamFailures * config.reliability.downstreamFailurePenalty;

        // Success recovery (only when NOT rolled back)
        if (!signal.wasRolledBack) {
          expectedReliabilityDelta += config.reliability.successRecovery;
        }

        expect(deltas.reliabilityDelta).toBe(expectedReliabilityDelta);
      }),
      { numRuns: 200 },
    );
  });

  it('ratioToScore maps ratio <= 1.0 to 1000, >= 2.0 to 0, and linearly interpolates between', () => {
    // Test boundary and interpolation via the calculator's ratioToScore
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true, noDefaultInfinity: true }),
        (ratio) => {
          const actual = calc.ratioToScore(ratio);
          const expected = refRatioToScore(ratio);
          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('ema formula matches reference: current * (1 - alpha) + newValue * alpha', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
        (current, newValue, alpha) => {
          const actual = calc.ema(current, newValue, alpha);
          const expected = refEma(current, newValue, alpha);
          expect(actual).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 200 },
    );
  });
});
