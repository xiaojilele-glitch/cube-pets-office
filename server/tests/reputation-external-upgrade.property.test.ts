/**
 * Property-Based Test: 外部 Agent 信任层级升级
 *
 * **Feature: agent-reputation, Property 12: 外部 Agent 信任层级升级**
 * **Validates: Requirements 5.3**
 *
 * For any external Agent's ReputationProfile:
 * - totalTasks >= 50 && overallScore >= 700 → trusted
 * - totalTasks >= 20 && overallScore >= 500 → standard
 * - otherwise → probation
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationProfile, TrustTier } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const evaluator = new TrustTierEvaluator(DEFAULT_REPUTATION_CONFIG);

/** Build a minimal external ReputationProfile with given totalTasks and overallScore */
function makeExternalProfile(totalTasks: number, overallScore: number): ReputationProfile {
  return {
    agentId: 'ext-agent-test',
    overallScore,
    dimensions: {
      qualityScore: 400,
      speedScore: 400,
      efficiencyScore: 400,
      collaborationScore: 400,
      reliabilityScore: 400,
    },
    grade: 'C',
    trustTier: 'probation',
    isExternal: true,
    totalTasks,
    consecutiveHighQuality: 0,
    roleReputation: {},
    lastActiveAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Reference implementation of expected tier for external Agent */
function expectedExternalTier(totalTasks: number, overallScore: number): TrustTier {
  if (totalTasks >= 50 && overallScore >= 700) return 'trusted';
  if (totalTasks >= 20 && overallScore >= 500) return 'standard';
  return 'probation';
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const totalTasksArb = fc.integer({ min: 0, max: 200 });
const overallScoreArb = fc.integer({ min: 0, max: 1000 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 12: 外部 Agent 信任层级升级', () => {
  it('evaluateExternalUpgrade returns correct tier for any totalTasks and overallScore', () => {
    fc.assert(
      fc.property(totalTasksArb, overallScoreArb, (totalTasks, overallScore) => {
        const profile = makeExternalProfile(totalTasks, overallScore);
        const tier = evaluator.evaluateExternalUpgrade(profile);
        expect(tier).toBe(expectedExternalTier(totalTasks, overallScore));
      }),
      { numRuns: 200 },
    );
  });

  it('trusted requires both totalTasks >= 50 AND overallScore >= 700', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 200 }),
        fc.integer({ min: 700, max: 1000 }),
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('trusted');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('standard requires totalTasks >= 20 AND overallScore >= 500 (when not meeting trusted thresholds)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 49 }),
        fc.integer({ min: 500, max: 1000 }),
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('standard');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('probation when totalTasks < 20 regardless of score', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 19 }),
        overallScoreArb,
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('probation');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('probation when overallScore < 500 regardless of totalTasks', () => {
    fc.assert(
      fc.property(
        totalTasksArb,
        fc.integer({ min: 0, max: 499 }),
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('probation');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('boundary: totalTasks=20, overallScore=500 → standard', () => {
    fc.assert(
      fc.property(
        fc.constant(20),
        fc.constant(500),
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('standard');
        },
      ),
      { numRuns: 1 },
    );
  });

  it('boundary: totalTasks=50, overallScore=700 → trusted', () => {
    fc.assert(
      fc.property(
        fc.constant(50),
        fc.constant(700),
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('trusted');
        },
      ),
      { numRuns: 1 },
    );
  });

  it('high tasks but score between 500-699 → standard (not trusted)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 200 }),
        fc.integer({ min: 500, max: 699 }),
        (totalTasks, overallScore) => {
          const profile = makeExternalProfile(totalTasks, overallScore);
          const tier = evaluator.evaluateExternalUpgrade(profile);
          expect(tier).toBe('standard');
        },
      ),
      { numRuns: 200 },
    );
  });
});
