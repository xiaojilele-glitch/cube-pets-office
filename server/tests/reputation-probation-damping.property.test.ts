/**
 * Property-Based Test: Probation 阶段正向更新阻尼
 *
 * **Feature: agent-reputation, Property 19: Probation 阶段正向更新阻尼**
 * **Validates: Requirements 7.4**
 *
 * For any 处于 probation 阶段的外部 Agent，正向信誉更新应乘以 probationDamping 系数（默认 0.7）。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { AnomalyDetector } from "../core/reputation/anomaly-detector.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  ReputationProfile,
  ReputationConfig,
  TrustTier,
  ReputationGrade,
} from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const trustTierArb = fc.constantFrom<TrustTier>(
  "trusted",
  "standard",
  "probation"
);
const gradeArb = fc.constantFrom<ReputationGrade>("S", "A", "B", "C", "D");

const dimensionScoresArb = fc.record({
  qualityScore: fc.integer({ min: 0, max: 1000 }),
  speedScore: fc.integer({ min: 0, max: 1000 }),
  efficiencyScore: fc.integer({ min: 0, max: 1000 }),
  collaborationScore: fc.integer({ min: 0, max: 1000 }),
  reliabilityScore: fc.integer({ min: 0, max: 1000 }),
});

/** Generate a ReputationProfile with controllable isExternal and trustTier */
function profileArb(
  isExternal: boolean,
  trustTier: TrustTier
): fc.Arbitrary<ReputationProfile> {
  return fc.record({
    agentId: fc.string({ minLength: 1, maxLength: 20 }),
    overallScore: fc.integer({ min: 0, max: 1000 }),
    dimensions: dimensionScoresArb,
    grade: gradeArb,
    trustTier: fc.constant(trustTier),
    isExternal: fc.constant(isExternal),
    totalTasks: fc.integer({ min: 0, max: 1000 }),
    consecutiveHighQuality: fc.integer({ min: 0, max: 100 }),
    roleReputation: fc.constant({}),
    lastActiveAt: fc.constant(new Date().toISOString()),
    createdAt: fc.constant(new Date().toISOString()),
    updatedAt: fc.constant(new Date().toISOString()),
  });
}

/** Generate an arbitrary ReputationProfile with random isExternal and trustTier */
const anyProfileArb: fc.Arbitrary<ReputationProfile> = fc
  .tuple(fc.boolean(), trustTierArb)
  .chain(([isExternal, trustTier]) => profileArb(isExternal, trustTier));

/** Configurable probationDamping value (0 < damping <= 1) */
const dampingArb = fc.double({ min: 0.01, max: 1.0, noNaN: true });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 19: Probation 阶段正向更新阻尼", () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const detector = new AnomalyDetector(config);

  it("returns probationDamping for external agents in probation", () => {
    fc.assert(
      fc.property(profileArb(true, "probation"), profile => {
        const damping = detector.getProbationDamping(profile);
        expect(damping).toBe(config.anomaly.probationDamping);
        expect(damping).toBe(0.7);
      }),
      { numRuns: 200 }
    );
  });

  it("returns 1.0 for internal agents regardless of trustTier", () => {
    fc.assert(
      fc.property(
        trustTierArb.chain(tier => profileArb(false, tier)),
        profile => {
          const damping = detector.getProbationDamping(profile);
          expect(damping).toBe(1.0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns 1.0 for external agents NOT in probation", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom<TrustTier>("trusted", "standard")
          .chain(tier => profileArb(true, tier)),
        profile => {
          const damping = detector.getProbationDamping(profile);
          expect(damping).toBe(1.0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("damping is strictly less than 1.0 only for external+probation", () => {
    fc.assert(
      fc.property(anyProfileArb, profile => {
        const damping = detector.getProbationDamping(profile);

        if (profile.isExternal && profile.trustTier === "probation") {
          expect(damping).toBeLessThan(1.0);
          expect(damping).toBeGreaterThan(0);
        } else {
          expect(damping).toBe(1.0);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("respects configurable probationDamping values", () => {
    fc.assert(
      fc.property(
        dampingArb,
        profileArb(true, "probation"),
        (dampingValue, profile) => {
          const customConfig: ReputationConfig = {
            ...config,
            anomaly: { ...config.anomaly, probationDamping: dampingValue },
          };
          const customDetector = new AnomalyDetector(customConfig);
          const result = customDetector.getProbationDamping(profile);
          expect(result).toBe(dampingValue);
        }
      ),
      { numRuns: 200 }
    );
  });
});
