/**
 * Property-Based Test: 信誉分整数范围不变量
 *
 * **Feature: agent-reputation, Property 1: 信誉分整数范围不变量**
 * **Validates: Requirements 1.1, 1.6**
 *
 * For any ReputationProfile, overallScore and all five dimension sub-scores
 * (qualityScore, speedScore, efficiencyScore, collaborationScore, reliabilityScore)
 * are integers in [0, 1000].
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type {
  DimensionScores,
  ReputationSignal,
  ReputationConfig,
} from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp helper matching the one in reputation-service.ts */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Check that a score is an integer in [0, 1000] */
function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= 1000;
}

/** Assert all scores in a DimensionScores are valid */
function assertValidDimensions(dims: DimensionScores): void {
  expect(isValidScore(dims.qualityScore)).toBe(true);
  expect(isValidScore(dims.speedScore)).toBe(true);
  expect(isValidScore(dims.efficiencyScore)).toBe(true);
  expect(isValidScore(dims.collaborationScore)).toBe(true);
  expect(isValidScore(dims.reliabilityScore)).toBe(true);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a valid dimension score (integer 0-1000) */
const scoreArb = fc.integer({ min: 0, max: 1000 });

/** Arbitrary for DimensionScores */
const dimensionScoresArb: fc.Arbitrary<DimensionScores> = fc.record({
  qualityScore: scoreArb,
  speedScore: scoreArb,
  efficiencyScore: scoreArb,
  collaborationScore: scoreArb,
  reliabilityScore: scoreArb,
});

/** Arbitrary for a valid ReputationSignal */
const signalArb: fc.Arbitrary<ReputationSignal> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 20 }),
  taskId: fc.string({ minLength: 1, maxLength: 20 }),
  roleId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
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

/** Arbitrary for streak count */
const streakCountArb = fc.integer({ min: 0, max: 50 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 1: 信誉分整数范围不变量', () => {
  const calc = new ReputationCalculator(DEFAULT_REPUTATION_CONFIG);

  it('computeOverallScore always returns an integer in [0, 1000] for any valid dimensions', () => {
    fc.assert(
      fc.property(dimensionScoresArb, (dims) => {
        const overall = calc.computeOverallScore(dims);
        expect(isValidScore(overall)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('dimension scores remain in [0, 1000] after applying clamped deltas to any valid starting scores', () => {
    fc.assert(
      fc.property(
        dimensionScoresArb,
        signalArb,
        streakCountArb,
        (currentDims, signal, streakCount) => {
          // Compute raw deltas
          const rawDeltas = calc.computeDimensionDeltas(currentDims, signal, streakCount);

          // Clamp deltas (as the service does)
          const clamped = calc.clampDeltas(rawDeltas, DEFAULT_REPUTATION_CONFIG.maxDeltaPerUpdate);

          // Apply deltas with Math.round + clamp to [0, 1000] (matching service logic)
          const newDims: DimensionScores = {
            qualityScore: clamp(Math.round(currentDims.qualityScore + clamped.qualityDelta), 0, 1000),
            speedScore: clamp(Math.round(currentDims.speedScore + clamped.speedDelta), 0, 1000),
            efficiencyScore: clamp(Math.round(currentDims.efficiencyScore + clamped.efficiencyDelta), 0, 1000),
            collaborationScore: clamp(Math.round(currentDims.collaborationScore + clamped.collaborationDelta), 0, 1000),
            reliabilityScore: clamp(Math.round(currentDims.reliabilityScore + clamped.reliabilityDelta), 0, 1000),
          };

          // All new dimension scores must be valid integers in [0, 1000]
          assertValidDimensions(newDims);

          // Overall score computed from new dimensions must also be valid
          const newOverall = calc.computeOverallScore(newDims);
          expect(isValidScore(newOverall)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('initial profile scores (internal=500, external=400) are valid integers in [0, 1000]', () => {
    fc.assert(
      fc.property(fc.boolean(), (isExternal) => {
        const initScore = isExternal
          ? DEFAULT_REPUTATION_CONFIG.externalInitialScore
          : DEFAULT_REPUTATION_CONFIG.internalInitialScore;

        expect(isValidScore(initScore)).toBe(true);

        // All dimensions initialized to the same score
        const dims: DimensionScores = {
          qualityScore: initScore,
          speedScore: initScore,
          efficiencyScore: initScore,
          collaborationScore: initScore,
          reliabilityScore: initScore,
        };
        assertValidDimensions(dims);

        const overall = calc.computeOverallScore(dims);
        expect(isValidScore(overall)).toBe(true);
      }),
      { numRuns: 10 },
    );
  });

  it('scores remain valid after multiple sequential updates from any starting state', () => {
    fc.assert(
      fc.property(
        dimensionScoresArb,
        fc.array(signalArb, { minLength: 1, maxLength: 10 }),
        (startDims, signals) => {
          let dims = { ...startDims };
          let streakCount = 0;

          for (const signal of signals) {
            const rawDeltas = calc.computeDimensionDeltas(dims, signal, streakCount);
            const clamped = calc.clampDeltas(rawDeltas, DEFAULT_REPUTATION_CONFIG.maxDeltaPerUpdate);

            dims = {
              qualityScore: clamp(Math.round(dims.qualityScore + clamped.qualityDelta), 0, 1000),
              speedScore: clamp(Math.round(dims.speedScore + clamped.speedDelta), 0, 1000),
              efficiencyScore: clamp(Math.round(dims.efficiencyScore + clamped.efficiencyDelta), 0, 1000),
              collaborationScore: clamp(Math.round(dims.collaborationScore + clamped.collaborationDelta), 0, 1000),
              reliabilityScore: clamp(Math.round(dims.reliabilityScore + clamped.reliabilityDelta), 0, 1000),
            };

            // After each update, all scores must remain valid
            assertValidDimensions(dims);

            const overall = calc.computeOverallScore(dims);
            expect(isValidScore(overall)).toBe(true);

            // Track streak for next iteration
            if (signal.taskQualityScore >= DEFAULT_REPUTATION_CONFIG.streak.qualityMin) {
              streakCount++;
            } else {
              streakCount = 0;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
