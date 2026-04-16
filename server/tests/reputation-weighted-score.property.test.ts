/**
 * Property-Based Test: 加权综合分公式
 *
 * **Feature: agent-reputation, Property 2: 加权综合分公式**
 * **Validates: Requirements 1.2**
 *
 * For any 五个维度子分和一组权重配置，overallScore 应等于
 * `Math.round(quality * w.quality + speed * w.speed + efficiency * w.efficiency
 *   + collaboration * w.collaboration + reliability * w.reliability)`，
 * 且结果被 clamp 到 [0, 1000]。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  DimensionScores,
  ReputationConfig,
} from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reference implementation of the weighted overall score formula */
function referenceOverallScore(
  dims: DimensionScores,
  w: ReputationConfig["weights"]
): number {
  const raw =
    dims.qualityScore * w.quality +
    dims.speedScore * w.speed +
    dims.efficiencyScore * w.efficiency +
    dims.collaborationScore * w.collaboration +
    dims.reliabilityScore * w.reliability;
  return Math.max(0, Math.min(1000, Math.round(raw)));
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

/**
 * Arbitrary for a set of positive weights that sum to 1.0.
 * Generates 5 random positive floats and normalizes them.
 */
const weightsArb: fc.Arbitrary<ReputationConfig["weights"]> = fc
  .tuple(
    fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
    fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
    fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
    fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
    fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true })
  )
  .map(([q, sp, e, c, r]) => {
    const sum = q + sp + e + c + r;
    return {
      quality: q / sum,
      speed: sp / sum,
      efficiency: e / sum,
      collaboration: c / sum,
      reliability: r / sum,
    };
  });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 2: 加权综合分公式", () => {
  const calc = new ReputationCalculator(DEFAULT_REPUTATION_CONFIG);

  it("computeOverallScore matches the weighted formula with default weights for any dimensions", () => {
    fc.assert(
      fc.property(dimensionScoresArb, dims => {
        const actual = calc.computeOverallScore(dims);
        const expected = referenceOverallScore(
          dims,
          DEFAULT_REPUTATION_CONFIG.weights
        );
        expect(actual).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it("computeOverallScore matches the weighted formula with arbitrary weights for any dimensions", () => {
    fc.assert(
      fc.property(dimensionScoresArb, weightsArb, (dims, weights) => {
        const actual = calc.computeOverallScore(dims, weights);
        const expected = referenceOverallScore(dims, weights);
        expect(actual).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it("result is always clamped to [0, 1000]", () => {
    fc.assert(
      fc.property(dimensionScoresArb, weightsArb, (dims, weights) => {
        const result = calc.computeOverallScore(dims, weights);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1000);
        expect(Number.isInteger(result)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("all dimensions at 0 yields overallScore 0 regardless of weights", () => {
    fc.assert(
      fc.property(weightsArb, weights => {
        const zeroDims: DimensionScores = {
          qualityScore: 0,
          speedScore: 0,
          efficiencyScore: 0,
          collaborationScore: 0,
          reliabilityScore: 0,
        };
        expect(calc.computeOverallScore(zeroDims, weights)).toBe(0);
      }),
      { numRuns: 50 }
    );
  });

  it("all dimensions at 1000 yields overallScore 1000 when weights sum to 1", () => {
    fc.assert(
      fc.property(weightsArb, weights => {
        const maxDims: DimensionScores = {
          qualityScore: 1000,
          speedScore: 1000,
          efficiencyScore: 1000,
          collaborationScore: 1000,
          reliabilityScore: 1000,
        };
        expect(calc.computeOverallScore(maxDims, weights)).toBe(1000);
      }),
      { numRuns: 50 }
    );
  });
});
