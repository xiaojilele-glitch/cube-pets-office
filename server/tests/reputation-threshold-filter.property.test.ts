/**
 * Property-Based Test: 信誉阈值过滤
 *
 * **Feature: agent-reputation, Property 10: 信誉阈值过滤**
 * **Validates: Requirements 4.3, 4.4**
 *
 * For any 候选 Agent 集合，竞争模式下 overallScore < minReputationThreshold 的 Agent 被排除；
 * Taskforce 组建中 Lead 要求 overallScore >= 600、Worker 要求 overallScore >= 300、
 * Reviewer 要求 qualityScore >= 500。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { AssignmentScorer } from "../core/reputation/assignment-scorer.js";
import type { AssignmentCandidate } from "../core/reputation/assignment-scorer.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type { ReputationProfile } from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(
  overallScore: number,
  qualityScore = 500,
  agentId = "agent-test"
): ReputationProfile {
  return {
    agentId,
    overallScore,
    dimensions: {
      qualityScore,
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

function makeCandidate(
  overallScore: number,
  qualityScore = 500,
  agentId = "agent"
): AssignmentCandidate {
  return {
    agentId,
    fitnessScore: 0.5,
    profile: makeProfile(overallScore, qualityScore, agentId),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const overallScoreArb = fc.integer({ min: 0, max: 1000 });
const qualityScoreArb = fc.integer({ min: 0, max: 1000 });
const thresholdArb = fc.integer({ min: 0, max: 1000 });

/** Arbitrary for a list of candidates with varying scores */
const candidateListArb = fc
  .array(
    fc.record({
      overallScore: overallScoreArb,
      qualityScore: qualityScoreArb,
    }),
    { minLength: 0, maxLength: 20 }
  )
  .map(items =>
    items.map((item, i) =>
      makeCandidate(item.overallScore, item.qualityScore, `agent-${i}`)
    )
  );

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 10: 信誉阈值过滤", () => {
  const scorer = new AssignmentScorer(DEFAULT_REPUTATION_CONFIG);
  const cfg = DEFAULT_REPUTATION_CONFIG;

  // -------------------------------------------------------------------------
  // Competition threshold filtering (Req 4.3)
  // -------------------------------------------------------------------------

  it("filterByReputationThreshold excludes all candidates with overallScore < threshold", () => {
    fc.assert(
      fc.property(candidateListArb, thresholdArb, (candidates, threshold) => {
        const result = scorer.filterByReputationThreshold(
          candidates,
          threshold
        );

        // Every surviving candidate must have overallScore >= threshold
        for (const c of result) {
          expect(c.profile.overallScore).toBeGreaterThanOrEqual(threshold);
        }

        // Every excluded candidate must have overallScore < threshold
        const resultIds = new Set(result.map(c => c.agentId));
        for (const c of candidates) {
          if (!resultIds.has(c.agentId)) {
            expect(c.profile.overallScore).toBeLessThan(threshold);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("filterByReputationThreshold preserves all candidates with overallScore >= threshold", () => {
    fc.assert(
      fc.property(candidateListArb, thresholdArb, (candidates, threshold) => {
        const result = scorer.filterByReputationThreshold(
          candidates,
          threshold
        );
        const expectedCount = candidates.filter(
          c => c.profile.overallScore >= threshold
        ).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 200 }
    );
  });

  it("filterByReputationThreshold with default competitionMinThreshold (300)", () => {
    fc.assert(
      fc.property(candidateListArb, candidates => {
        const result = scorer.filterByReputationThreshold(
          candidates,
          cfg.scheduling.competitionMinThreshold
        );
        for (const c of result) {
          expect(c.profile.overallScore).toBeGreaterThanOrEqual(300);
        }
        // All candidates with score >= 300 are kept
        const expected = candidates.filter(c => c.profile.overallScore >= 300);
        expect(result.length).toBe(expected.length);
      }),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Taskforce role filtering (Req 4.4)
  // -------------------------------------------------------------------------

  it("filterByTaskforceRequirements for lead: requires overallScore >= 600", () => {
    fc.assert(
      fc.property(candidateListArb, candidates => {
        const result = scorer.filterByTaskforceRequirements(candidates, "lead");

        for (const c of result) {
          expect(c.profile.overallScore).toBeGreaterThanOrEqual(
            cfg.scheduling.leadMinScore
          );
        }

        const expectedCount = candidates.filter(
          c => c.profile.overallScore >= cfg.scheduling.leadMinScore
        ).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 200 }
    );
  });

  it("filterByTaskforceRequirements for worker: requires overallScore >= 300", () => {
    fc.assert(
      fc.property(candidateListArb, candidates => {
        const result = scorer.filterByTaskforceRequirements(
          candidates,
          "worker"
        );

        for (const c of result) {
          expect(c.profile.overallScore).toBeGreaterThanOrEqual(
            cfg.scheduling.workerMinScore
          );
        }

        const expectedCount = candidates.filter(
          c => c.profile.overallScore >= cfg.scheduling.workerMinScore
        ).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 200 }
    );
  });

  it("filterByTaskforceRequirements for reviewer: requires qualityScore >= 500", () => {
    fc.assert(
      fc.property(candidateListArb, candidates => {
        const result = scorer.filterByTaskforceRequirements(
          candidates,
          "reviewer"
        );

        for (const c of result) {
          expect(c.profile.dimensions.qualityScore).toBeGreaterThanOrEqual(
            cfg.scheduling.reviewerMinQuality
          );
        }

        const expectedCount = candidates.filter(
          c =>
            c.profile.dimensions.qualityScore >=
            cfg.scheduling.reviewerMinQuality
        ).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 200 }
    );
  });

  it("filterByTaskforceRequirements never returns candidates that fail the role requirement", () => {
    fc.assert(
      fc.property(
        candidateListArb,
        fc.constantFrom(
          "lead" as const,
          "worker" as const,
          "reviewer" as const
        ),
        (candidates, role) => {
          const result = scorer.filterByTaskforceRequirements(candidates, role);
          const resultIds = new Set(result.map(c => c.agentId));

          for (const c of candidates) {
            if (!resultIds.has(c.agentId)) {
              // Excluded candidate must fail the role requirement
              switch (role) {
                case "lead":
                  expect(c.profile.overallScore).toBeLessThan(
                    cfg.scheduling.leadMinScore
                  );
                  break;
                case "worker":
                  expect(c.profile.overallScore).toBeLessThan(
                    cfg.scheduling.workerMinScore
                  );
                  break;
                case "reviewer":
                  expect(c.profile.dimensions.qualityScore).toBeLessThan(
                    cfg.scheduling.reviewerMinQuality
                  );
                  break;
              }
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Subset property: filtered result is always a subset of input
  // -------------------------------------------------------------------------

  it("filtered results are always a subset of the original candidates", () => {
    fc.assert(
      fc.property(
        candidateListArb,
        thresholdArb,
        fc.constantFrom(
          "lead" as const,
          "worker" as const,
          "reviewer" as const
        ),
        (candidates, threshold, role) => {
          const thresholdResult = scorer.filterByReputationThreshold(
            candidates,
            threshold
          );
          const roleResult = scorer.filterByTaskforceRequirements(
            candidates,
            role
          );

          const originalIds = new Set(candidates.map(c => c.agentId));

          for (const c of thresholdResult) {
            expect(originalIds.has(c.agentId)).toBe(true);
          }
          for (const c of roleResult) {
            expect(originalIds.has(c.agentId)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
