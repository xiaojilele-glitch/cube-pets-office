/**
 * Property-Based Test: 角色信誉替代与低置信度回退
 *
 * **Feature: agent-reputation, Property 9: 角色信誉替代与低置信度回退**
 * **Validates: Requirements 4.2**
 *
 * For any 带有角色要求的任务分配，当角色信誉 lowConfidence 为 false 时使用角色信誉分；
 * 当 lowConfidence 为 true 时使用 roleReputation * 0.4 + overallReputation * 0.6 的加权平均。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { AssignmentScorer } from '../core/reputation/assignment-scorer.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationProfile, RoleReputationRecord } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ReputationProfile with optional role reputation entries */
function makeProfile(
  overallScore: number,
  roleReputation: Record<string, RoleReputationRecord> = {},
  agentId = 'agent-test',
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
    grade: 'B' as const,
    trustTier: 'standard' as const,
    isExternal: false,
    totalTasks: 20,
    consecutiveHighQuality: 0,
    roleReputation,
    lastActiveAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Build a RoleReputationRecord */
function makeRoleRep(
  roleId: string,
  overallScore: number,
  lowConfidence: boolean,
  totalTasksInRole?: number,
): RoleReputationRecord {
  return {
    roleId,
    overallScore,
    dimensions: {
      qualityScore: 500,
      speedScore: 500,
      efficiencyScore: 500,
      collaborationScore: 500,
      reliabilityScore: 500,
    },
    totalTasksInRole: totalTasksInRole ?? (lowConfidence ? 5 : 20),
    lowConfidence,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const fitnessScoreArb = fc.double({ min: 0, max: 1, noNaN: true });
const overallScoreArb = fc.integer({ min: 0, max: 1000 });
const roleScoreArb = fc.integer({ min: 0, max: 1000 });
const roleNameArb = fc.constantFrom('coder', 'reviewer', 'planner', 'tester', 'lead');

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 9: 角色信誉替代与低置信度回退', () => {
  const scorer = new AssignmentScorer(DEFAULT_REPUTATION_CONFIG);
  const cfg = DEFAULT_REPUTATION_CONFIG;

  it('uses roleReputation.overallScore when lowConfidence is false', () => {
    fc.assert(
      fc.property(
        fitnessScoreArb,
        overallScoreArb,
        roleScoreArb,
        roleNameArb,
        (fitnessScore, overallScore, roleScore, roleName) => {
          const roleRep = makeRoleRep(roleName, roleScore, false);
          const profile = makeProfile(overallScore, { [roleName]: roleRep });

          const result = scorer.computeAssignmentScore(fitnessScore, profile, roleName);

          const expectedReputationFactor = roleScore / 1000;
          const expectedAssignment =
            fitnessScore * cfg.scheduling.fitnessWeight +
            expectedReputationFactor * cfg.scheduling.reputationWeight;

          expect(result.reputationFactor).toBeCloseTo(expectedReputationFactor, 10);
          expect(result.assignmentScore).toBeCloseTo(expectedAssignment, 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('uses weighted average of role and overall reputation when lowConfidence is true', () => {
    fc.assert(
      fc.property(
        fitnessScoreArb,
        overallScoreArb,
        roleScoreArb,
        roleNameArb,
        (fitnessScore, overallScore, roleScore, roleName) => {
          const roleRep = makeRoleRep(roleName, roleScore, true);
          const profile = makeProfile(overallScore, { [roleName]: roleRep });

          const result = scorer.computeAssignmentScore(fitnessScore, profile, roleName);

          const expectedReputationFactor =
            (roleScore * cfg.lowConfidence.roleWeight +
              overallScore * cfg.lowConfidence.overallWeight) /
            1000;
          const expectedAssignment =
            fitnessScore * cfg.scheduling.fitnessWeight +
            expectedReputationFactor * cfg.scheduling.reputationWeight;

          expect(result.reputationFactor).toBeCloseTo(expectedReputationFactor, 10);
          expect(result.assignmentScore).toBeCloseTo(expectedAssignment, 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('falls back to overall score when taskRole is provided but no role reputation exists', () => {
    fc.assert(
      fc.property(
        fitnessScoreArb,
        overallScoreArb,
        roleNameArb,
        (fitnessScore, overallScore, roleName) => {
          // Profile with empty roleReputation
          const profile = makeProfile(overallScore);

          const result = scorer.computeAssignmentScore(fitnessScore, profile, roleName);

          const expectedReputationFactor = overallScore / 1000;
          expect(result.reputationFactor).toBeCloseTo(expectedReputationFactor, 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('lowConfidence=false role score differs from overall score in assignment result', () => {
    fc.assert(
      fc.property(
        overallScoreArb,
        roleScoreArb,
        roleNameArb,
        (overallScore, roleScore, roleName) => {
          // Skip when scores happen to be equal — no difference to observe
          fc.pre(overallScore !== roleScore);

          const roleRep = makeRoleRep(roleName, roleScore, false);
          const profile = makeProfile(overallScore, { [roleName]: roleRep });

          const withRole = scorer.computeAssignmentScore(0.5, profile, roleName);
          const withoutRole = scorer.computeAssignmentScore(0.5, profile);

          // With role should use roleScore, without should use overallScore
          expect(withRole.reputationFactor).toBeCloseTo(roleScore / 1000, 10);
          expect(withoutRole.reputationFactor).toBeCloseTo(overallScore / 1000, 10);
          expect(withRole.reputationFactor).not.toBeCloseTo(withoutRole.reputationFactor, 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('lowConfidence weighted average is between role and overall scores', () => {
    fc.assert(
      fc.property(
        overallScoreArb,
        roleScoreArb,
        roleNameArb,
        (overallScore, roleScore, roleName) => {
          const roleRep = makeRoleRep(roleName, roleScore, true);
          const profile = makeProfile(overallScore, { [roleName]: roleRep });

          const result = scorer.computeAssignmentScore(0.5, profile, roleName);

          const roleFactor = roleScore / 1000;
          const overallFactor = overallScore / 1000;
          const lower = Math.min(roleFactor, overallFactor);
          const upper = Math.max(roleFactor, overallFactor);

          // Weighted average must lie within [min, max] of the two inputs
          expect(result.reputationFactor).toBeGreaterThanOrEqual(lower - 1e-10);
          expect(result.reputationFactor).toBeLessThanOrEqual(upper + 1e-10);
        },
      ),
      { numRuns: 200 },
    );
  });
});
