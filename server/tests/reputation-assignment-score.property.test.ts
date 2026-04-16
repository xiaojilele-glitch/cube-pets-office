/**
 * Property-Based Test: 任务分配得分公式
 *
 * **Feature: agent-reputation, Property 8: 任务分配得分公式**
 * **Validates: Requirements 4.1**
 *
 * For any fitnessScore 和 reputationFactor（= overallScore / 1000），
 * assignmentScore 应等于 fitnessScore * fitnessWeight + reputationFactor * reputationWeight。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { AssignmentScorer } from "../core/reputation/assignment-scorer.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  ReputationConfig,
  ReputationProfile,
} from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ReputationProfile with the given overallScore */
function makeProfile(
  overallScore: number,
  agentId = "agent-test"
): ReputationProfile {
  return {
    agentId,
    overallScore,
    dimensions: {
      qualityScore: 500,
      speedScore: 500,
      efficiencyScore: 500,
      collaborationScore: 500,
      reliabilityScore: 500,
    },
    grade: "B" as const,
    trustTier: "standard" as const,
    isExternal: false,
    totalTasks: 20,
    consecutiveHighQuality: 0,
    roleReputation: {},
    lastActiveAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for fitnessScore (0-1 range, typical normalized score) */
const fitnessScoreArb = fc.double({ min: 0, max: 1, noNaN: true });

/** Arbitrary for overallScore (integer 0-1000) */
const overallScoreArb = fc.integer({ min: 0, max: 1000 });

/** Arbitrary for scheduling weights that sum to 1.0 */
const schedulingWeightsArb = fc
  .double({ min: 0.01, max: 0.99, noNaN: true })
  .map(reputationWeight => ({
    reputationWeight,
    fitnessWeight: 1 - reputationWeight,
  }));

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 8: 任务分配得分公式", () => {
  const scorer = new AssignmentScorer(DEFAULT_REPUTATION_CONFIG);

  it("assignmentScore equals fitnessScore * fitnessWeight + reputationFactor * reputationWeight with default config", () => {
    fc.assert(
      fc.property(
        fitnessScoreArb,
        overallScoreArb,
        (fitnessScore, overallScore) => {
          const profile = makeProfile(overallScore);
          const result = scorer.computeAssignmentScore(fitnessScore, profile);

          const reputationFactor = overallScore / 1000;
          const expected =
            fitnessScore * DEFAULT_REPUTATION_CONFIG.scheduling.fitnessWeight +
            reputationFactor *
              DEFAULT_REPUTATION_CONFIG.scheduling.reputationWeight;

          expect(result.assignmentScore).toBeCloseTo(expected, 10);
          expect(result.reputationFactor).toBeCloseTo(reputationFactor, 10);
          expect(result.fitnessScore).toBe(fitnessScore);
          expect(result.agentId).toBe(profile.agentId);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("assignmentScore equals fitnessScore * fitnessWeight + reputationFactor * reputationWeight with arbitrary weights", () => {
    fc.assert(
      fc.property(
        fitnessScoreArb,
        overallScoreArb,
        schedulingWeightsArb,
        (fitnessScore, overallScore, weights) => {
          const customConfig: ReputationConfig = {
            ...DEFAULT_REPUTATION_CONFIG,
            scheduling: {
              ...DEFAULT_REPUTATION_CONFIG.scheduling,
              reputationWeight: weights.reputationWeight,
              fitnessWeight: weights.fitnessWeight,
            },
          };
          const profile = makeProfile(overallScore);
          const result = scorer.computeAssignmentScore(
            fitnessScore,
            profile,
            undefined,
            customConfig
          );

          const reputationFactor = overallScore / 1000;
          const expected =
            fitnessScore * weights.fitnessWeight +
            reputationFactor * weights.reputationWeight;

          expect(result.assignmentScore).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("assignmentScore is 0 when both fitnessScore and overallScore are 0", () => {
    const profile = makeProfile(0);
    const result = scorer.computeAssignmentScore(0, profile);
    expect(result.assignmentScore).toBe(0);
    expect(result.reputationFactor).toBe(0);
  });

  it("assignmentScore equals sum of weights when fitnessScore is 1 and overallScore is 1000", () => {
    const profile = makeProfile(1000);
    const result = scorer.computeAssignmentScore(1, profile);
    const expected =
      1 * DEFAULT_REPUTATION_CONFIG.scheduling.fitnessWeight +
      1 * DEFAULT_REPUTATION_CONFIG.scheduling.reputationWeight;
    expect(result.assignmentScore).toBeCloseTo(expected, 10);
  });

  it("reputationFactor is always overallScore / 1000 when no taskRole is provided", () => {
    fc.assert(
      fc.property(overallScoreArb, overallScore => {
        const profile = makeProfile(overallScore);
        const result = scorer.computeAssignmentScore(0.5, profile);
        expect(result.reputationFactor).toBeCloseTo(overallScore / 1000, 10);
      }),
      { numRuns: 200 }
    );
  });
});
