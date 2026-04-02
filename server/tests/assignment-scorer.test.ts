import { describe, expect, it } from 'vitest';
import { AssignmentScorer } from '../core/reputation/assignment-scorer.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationProfile } from '../../shared/reputation.js';
import type { AssignmentCandidate } from '../core/reputation/assignment-scorer.js';

const scorer = new AssignmentScorer(DEFAULT_REPUTATION_CONFIG);

function makeProfile(overrides: Partial<ReputationProfile> = {}): ReputationProfile {
  return {
    agentId: 'agent-1',
    overallScore: 500,
    dimensions: {
      qualityScore: 500,
      speedScore: 500,
      efficiencyScore: 500,
      collaborationScore: 500,
      reliabilityScore: 500,
    },
    grade: 'B',
    trustTier: 'standard',
    isExternal: false,
    totalTasks: 10,
    consecutiveHighQuality: 0,
    roleReputation: {},
    lastActiveAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCandidate(agentId: string, overallScore: number, qualityScore?: number): AssignmentCandidate {
  return {
    agentId,
    fitnessScore: 0.8,
    profile: makeProfile({
      agentId,
      overallScore,
      dimensions: {
        qualityScore: qualityScore ?? overallScore,
        speedScore: overallScore,
        efficiencyScore: overallScore,
        collaborationScore: overallScore,
        reliabilityScore: overallScore,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// computeAssignmentScore
// ---------------------------------------------------------------------------
describe('AssignmentScorer.computeAssignmentScore', () => {
  it('computes score using default weights (fitness=0.6, reputation=0.4)', () => {
    const profile = makeProfile({ overallScore: 500 });
    const result = scorer.computeAssignmentScore(0.8, profile);
    // reputationFactor = 500/1000 = 0.5
    // assignmentScore = 0.8 * 0.6 + 0.5 * 0.4 = 0.48 + 0.2 = 0.68
    expect(result.assignmentScore).toBeCloseTo(0.68, 5);
    expect(result.reputationFactor).toBeCloseTo(0.5, 5);
    expect(result.fitnessScore).toBe(0.8);
  });

  it('uses role reputation when taskRole provided and lowConfidence=false', () => {
    const profile = makeProfile({
      overallScore: 500,
      roleReputation: {
        coder: {
          roleId: 'coder',
          overallScore: 800,
          dimensions: { qualityScore: 800, speedScore: 800, efficiencyScore: 800, collaborationScore: 800, reliabilityScore: 800 },
          totalTasksInRole: 15,
          lowConfidence: false,
        },
      },
    });
    const result = scorer.computeAssignmentScore(0.8, profile, 'coder');
    // reputationFactor = 800/1000 = 0.8
    expect(result.reputationFactor).toBeCloseTo(0.8, 5);
  });

  it('uses weighted average when taskRole provided and lowConfidence=true', () => {
    const profile = makeProfile({
      overallScore: 500,
      roleReputation: {
        coder: {
          roleId: 'coder',
          overallScore: 800,
          dimensions: { qualityScore: 800, speedScore: 800, efficiencyScore: 800, collaborationScore: 800, reliabilityScore: 800 },
          totalTasksInRole: 5,
          lowConfidence: true,
        },
      },
    });
    const result = scorer.computeAssignmentScore(0.8, profile, 'coder');
    // reputationFactor = (800 * 0.4 + 500 * 0.6) / 1000 = (320 + 300) / 1000 = 0.62
    expect(result.reputationFactor).toBeCloseTo(0.62, 5);
  });

  it('falls back to overall score when role not found', () => {
    const profile = makeProfile({ overallScore: 700 });
    const result = scorer.computeAssignmentScore(0.8, profile, 'unknown-role');
    expect(result.reputationFactor).toBeCloseTo(0.7, 5);
  });

  it('returns correct agentId', () => {
    const profile = makeProfile({ agentId: 'test-agent' });
    const result = scorer.computeAssignmentScore(0.5, profile);
    expect(result.agentId).toBe('test-agent');
  });
});

// ---------------------------------------------------------------------------
// filterByReputationThreshold
// ---------------------------------------------------------------------------
describe('AssignmentScorer.filterByReputationThreshold', () => {
  it('filters out candidates below threshold', () => {
    const candidates = [
      makeCandidate('a1', 600),
      makeCandidate('a2', 200),
      makeCandidate('a3', 300),
    ];
    const result = scorer.filterByReputationThreshold(candidates, 300);
    expect(result.map(c => c.agentId)).toEqual(['a1', 'a3']);
  });

  it('keeps candidates at exactly the threshold', () => {
    const candidates = [makeCandidate('a1', 300)];
    const result = scorer.filterByReputationThreshold(candidates, 300);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when all below threshold', () => {
    const candidates = [makeCandidate('a1', 100), makeCandidate('a2', 200)];
    const result = scorer.filterByReputationThreshold(candidates, 300);
    expect(result).toHaveLength(0);
  });

  it('returns all when all above threshold', () => {
    const candidates = [makeCandidate('a1', 500), makeCandidate('a2', 600)];
    const result = scorer.filterByReputationThreshold(candidates, 300);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// filterByTaskforceRequirements
// ---------------------------------------------------------------------------
describe('AssignmentScorer.filterByTaskforceRequirements', () => {
  it('filters lead candidates by overallScore >= 600', () => {
    const candidates = [
      makeCandidate('a1', 700),
      makeCandidate('a2', 500),
      makeCandidate('a3', 600),
    ];
    const result = scorer.filterByTaskforceRequirements(candidates, 'lead');
    expect(result.map(c => c.agentId)).toEqual(['a1', 'a3']);
  });

  it('filters worker candidates by overallScore >= 300', () => {
    const candidates = [
      makeCandidate('a1', 200),
      makeCandidate('a2', 300),
      makeCandidate('a3', 500),
    ];
    const result = scorer.filterByTaskforceRequirements(candidates, 'worker');
    expect(result.map(c => c.agentId)).toEqual(['a2', 'a3']);
  });

  it('filters reviewer candidates by qualityScore >= 500', () => {
    const candidates = [
      makeCandidate('a1', 700, 600), // qualityScore=600 ✓
      makeCandidate('a2', 700, 400), // qualityScore=400 ✗
      makeCandidate('a3', 300, 500), // qualityScore=500 ✓
    ];
    const result = scorer.filterByTaskforceRequirements(candidates, 'reviewer');
    expect(result.map(c => c.agentId)).toEqual(['a1', 'a3']);
  });

  it('returns empty when no candidates meet requirements', () => {
    const candidates = [makeCandidate('a1', 100)];
    const result = scorer.filterByTaskforceRequirements(candidates, 'lead');
    expect(result).toHaveLength(0);
  });
});
