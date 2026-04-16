/**
 * Property-Based Test: 互评串通检测
 *
 * **Feature: agent-reputation, Property 18: 互评串通检测**
 * **Validates: Requirements 7.3**
 *
 * For any Taskforce 中的 Agent 对，当互相给出的 collaborationRating 持续高于 collusionRatingMin
 * 且与其他成员评分偏差 > collusionDeviationMin 时，可疑评分在信誉计算中降权为 suspiciousWeight。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { AnomalyDetector } from "../core/reputation/anomaly-detector.js";
import type { CollabRatingPair } from "../core/reputation/anomaly-detector.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type { ReputationConfig } from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a unique agent id */
const agentIdArb = fc.integer({ min: 1, max: 10_000 }).map(n => `agent-${n}`);

/** Generate a CollabRatingPair with arbitrary ratings */
const collabRatingPairArb: fc.Arbitrary<CollabRatingPair> = fc.record({
  agentA: agentIdArb,
  agentB: agentIdArb,
  ratingAtoB: fc.integer({ min: 0, max: 100 }),
  ratingBtoA: fc.integer({ min: 0, max: 100 }),
  otherMembersAvgRating: fc.integer({ min: 0, max: 100 }),
});

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 18: 互评串通检测", () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const detector = new AnomalyDetector(config);

  it("correctly identifies suspicious pairs when both ratings > collusionRatingMin AND both deviations > collusionDeviationMin", () => {
    fc.assert(
      fc.property(
        fc.array(collabRatingPairArb, { minLength: 0, maxLength: 20 }),
        pairs => {
          const result = detector.checkCollabCollusion(pairs);

          // Recompute expected suspicious pairs
          const expectedSuspicious: Array<{ agentA: string; agentB: string }> =
            [];
          for (const pair of pairs) {
            const mutualHigh =
              pair.ratingAtoB > config.anomaly.collusionRatingMin &&
              pair.ratingBtoA > config.anomaly.collusionRatingMin;

            const devAtoB = Math.abs(
              pair.ratingAtoB - pair.otherMembersAvgRating
            );
            const devBtoA = Math.abs(
              pair.ratingBtoA - pair.otherMembersAvgRating
            );
            const highDeviation =
              devAtoB > config.anomaly.collusionDeviationMin &&
              devBtoA > config.anomaly.collusionDeviationMin;

            if (mutualHigh && highDeviation) {
              expectedSuspicious.push({
                agentA: pair.agentA,
                agentB: pair.agentB,
              });
            }
          }

          expect(result.suspiciousPairs).toEqual(expectedSuspicious);
          expect(result.isSuspicious).toBe(expectedSuspicious.length > 0);
          expect(result.weight).toBe(
            expectedSuspicious.length > 0
              ? config.anomaly.suspiciousWeight
              : 1.0
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns weight = suspiciousWeight when collusion is detected", () => {
    // Generate guaranteed collusion: both ratings above threshold, large deviation from others
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), pairCount => {
        const pairs: CollabRatingPair[] = Array.from(
          { length: pairCount },
          (_, i) => ({
            agentA: `agent-a-${i}`,
            agentB: `agent-b-${i}`,
            ratingAtoB: config.anomaly.collusionRatingMin + 5, // 95, above 90
            ratingBtoA: config.anomaly.collusionRatingMin + 3, // 93, above 90
            otherMembersAvgRating: 50, // deviation = 45 and 43, both > 20
          })
        );

        const result = detector.checkCollabCollusion(pairs);

        expect(result.isSuspicious).toBe(true);
        expect(result.suspiciousPairs.length).toBe(pairCount);
        expect(result.weight).toBe(config.anomaly.suspiciousWeight);
      }),
      { numRuns: 100 }
    );
  });

  it("does NOT flag collusion when mutual ratings are <= collusionRatingMin", () => {
    // Both ratings at or below threshold — never suspicious regardless of deviation
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            agentA: agentIdArb,
            agentB: agentIdArb,
            ratingAtoB: fc.integer({
              min: 0,
              max: config.anomaly.collusionRatingMin,
            }),
            ratingBtoA: fc.integer({
              min: 0,
              max: config.anomaly.collusionRatingMin,
            }),
            otherMembersAvgRating: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        pairs => {
          const result = detector.checkCollabCollusion(pairs);

          expect(result.isSuspicious).toBe(false);
          expect(result.suspiciousPairs).toEqual([]);
          expect(result.weight).toBe(1.0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("does NOT flag collusion when deviation <= collusionDeviationMin even with high mutual ratings", () => {
    // Both ratings high, but otherMembersAvgRating is close enough that deviation is small
    fc.assert(
      fc.property(
        fc.integer({ min: config.anomaly.collusionRatingMin + 1, max: 100 }),
        rating => {
          // Set otherMembersAvgRating so that deviation <= collusionDeviationMin
          const otherAvg = rating - config.anomaly.collusionDeviationMin; // deviation = exactly 20, not > 20

          const pairs: CollabRatingPair[] = [
            {
              agentA: "agent-x",
              agentB: "agent-y",
              ratingAtoB: rating,
              ratingBtoA: rating,
              otherMembersAvgRating: otherAvg,
            },
          ];

          const result = detector.checkCollabCollusion(pairs);

          expect(result.isSuspicious).toBe(false);
          expect(result.suspiciousPairs).toEqual([]);
          expect(result.weight).toBe(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("requires BOTH ratings to be above threshold — one below is not suspicious", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: config.anomaly.collusionRatingMin + 1, max: 100 }),
        fc.integer({ min: 0, max: config.anomaly.collusionRatingMin }),
        (highRating, lowRating) => {
          const pairs: CollabRatingPair[] = [
            {
              agentA: "agent-a",
              agentB: "agent-b",
              ratingAtoB: highRating,
              ratingBtoA: lowRating, // one side is low
              otherMembersAvgRating: 30, // large deviation
            },
          ];

          const result = detector.checkCollabCollusion(pairs);

          expect(result.isSuspicious).toBe(false);
          expect(result.weight).toBe(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("works correctly with configurable anomaly parameters", () => {
    fc.assert(
      fc.property(
        fc.record({
          collusionRatingMin: fc.integer({ min: 50, max: 95 }),
          collusionDeviationMin: fc.integer({ min: 5, max: 40 }),
          suspiciousWeight: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        }),
        fc.array(collabRatingPairArb, { minLength: 0, maxLength: 15 }),
        (anomalyParams, pairs) => {
          const customConfig: ReputationConfig = {
            ...config,
            anomaly: { ...config.anomaly, ...anomalyParams },
          };
          const customDetector = new AnomalyDetector(customConfig);
          const result = customDetector.checkCollabCollusion(pairs);

          // Recompute expected
          const expectedSuspicious: Array<{ agentA: string; agentB: string }> =
            [];
          for (const pair of pairs) {
            const mutualHigh =
              pair.ratingAtoB > anomalyParams.collusionRatingMin &&
              pair.ratingBtoA > anomalyParams.collusionRatingMin;

            const devAtoB = Math.abs(
              pair.ratingAtoB - pair.otherMembersAvgRating
            );
            const devBtoA = Math.abs(
              pair.ratingBtoA - pair.otherMembersAvgRating
            );
            const highDeviation =
              devAtoB > anomalyParams.collusionDeviationMin &&
              devBtoA > anomalyParams.collusionDeviationMin;

            if (mutualHigh && highDeviation) {
              expectedSuspicious.push({
                agentA: pair.agentA,
                agentB: pair.agentB,
              });
            }
          }

          expect(result.suspiciousPairs).toEqual(expectedSuspicious);
          expect(result.isSuspicious).toBe(expectedSuspicious.length > 0);
          expect(result.weight).toBe(
            expectedSuspicious.length > 0 ? anomalyParams.suspiciousWeight : 1.0
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns no suspicious pairs for empty input", () => {
    const result = detector.checkCollabCollusion([]);

    expect(result.isSuspicious).toBe(false);
    expect(result.suspiciousPairs).toEqual([]);
    expect(result.weight).toBe(1.0);
  });
});
