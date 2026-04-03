/**
 * Property-Based Test: 信誉等级与信任层级映射一致性
 *
 * **Feature: agent-reputation, Property 11: 信誉等级与信任层级映射一致性**
 * **Validates: Requirements 5.1, 5.2**
 *
 * For any overallScore, computeGrade should return a deterministic grade (S/A/B/C/D),
 * and computeTrustTier should return a trust tier consistent with the grade:
 * S/A → trusted, B → standard, C/D → probation.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationGrade, TrustTier } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_GRADES: ReputationGrade[] = ['S', 'A', 'B', 'C', 'D'];
const VALID_TIERS: TrustTier[] = ['trusted', 'standard', 'probation'];

/** Expected grade for a given score based on default config boundaries */
function expectedGrade(score: number): ReputationGrade {
  if (score >= 900) return 'S';
  if (score >= 700) return 'A';
  if (score >= 500) return 'B';
  if (score >= 300) return 'C';
  return 'D';
}

/** Expected trust tier for a given grade per Requirement 5.2 */
function expectedTier(grade: ReputationGrade): TrustTier {
  if (grade === 'S' || grade === 'A') return 'trusted';
  if (grade === 'B') return 'standard';
  return 'probation';
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for valid overallScore in [0, 1000] */
const scoreArb = fc.integer({ min: 0, max: 1000 });

/** Arbitrary for any of the five grades */
const gradeArb = fc.constantFrom<ReputationGrade>('S', 'A', 'B', 'C', 'D');

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 11: 信誉等级与信任层级映射一致性', () => {
  const evaluator = new TrustTierEvaluator(DEFAULT_REPUTATION_CONFIG);

  it('computeGrade returns a valid grade (S/A/B/C/D) for any score in [0, 1000]', () => {
    fc.assert(
      fc.property(scoreArb, (score: number) => {
        const grade = evaluator.computeGrade(score);
        expect(VALID_GRADES).toContain(grade);
      }),
      { numRuns: 200 },
    );
  });

  it('computeGrade maps scores to the correct grade per Requirement 5.1 boundaries', () => {
    fc.assert(
      fc.property(scoreArb, (score: number) => {
        const grade = evaluator.computeGrade(score);
        expect(grade).toBe(expectedGrade(score));
      }),
      { numRuns: 200 },
    );
  });

  it('computeTrustTier returns a valid tier for any grade', () => {
    fc.assert(
      fc.property(gradeArb, (grade: ReputationGrade) => {
        const tier = evaluator.computeTrustTier(grade);
        expect(VALID_TIERS).toContain(tier);
      }),
      { numRuns: 50 },
    );
  });

  it('computeTrustTier maps grades to correct tiers per Requirement 5.2 (S/A→trusted, B→standard, C/D→probation)', () => {
    fc.assert(
      fc.property(gradeArb, (grade: ReputationGrade) => {
        const tier = evaluator.computeTrustTier(grade);
        expect(tier).toBe(expectedTier(grade));
      }),
      { numRuns: 50 },
    );
  });

  it('grade and trust tier are consistent end-to-end: score → grade → tier', () => {
    fc.assert(
      fc.property(scoreArb, (score: number) => {
        const grade = evaluator.computeGrade(score);
        const tier = evaluator.computeTrustTier(grade);

        // Grade must match expected for the score
        expect(grade).toBe(expectedGrade(score));
        // Tier must match expected for the grade
        expect(tier).toBe(expectedTier(grade));
      }),
      { numRuns: 200 },
    );
  });

  it('computeGrade is deterministic: same score always yields same grade', () => {
    fc.assert(
      fc.property(scoreArb, (score: number) => {
        const grade1 = evaluator.computeGrade(score);
        const grade2 = evaluator.computeGrade(score);
        expect(grade1).toBe(grade2);
      }),
      { numRuns: 200 },
    );
  });

  it('grade boundaries are respected: scores at exact boundary values map correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 299, 300, 499, 500, 699, 700, 899, 900, 1000),
        (score: number) => {
          const grade = evaluator.computeGrade(score);
          const tier = evaluator.computeTrustTier(grade);

          expect(grade).toBe(expectedGrade(score));
          expect(tier).toBe(expectedTier(grade));
        },
      ),
      { numRuns: 50 },
    );
  });
});
