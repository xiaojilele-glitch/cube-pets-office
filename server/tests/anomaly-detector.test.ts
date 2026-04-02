import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationChangeEvent, ReputationProfile } from '../../shared/reputation.js';
import type { TaskSummary, CollabRatingPair } from '../core/reputation/anomaly-detector.js';

let detector: AnomalyDetector;

beforeEach(() => {
  detector = new AnomalyDetector(DEFAULT_REPUTATION_CONFIG);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<ReputationChangeEvent> = {},
): ReputationChangeEvent {
  return {
    id: 1,
    agentId: 'agent-1',
    taskId: 'task-1',
    dimensionDeltas: {
      qualityDelta: 0,
      speedDelta: 0,
      efficiencyDelta: 0,
      collaborationDelta: 0,
      reliabilityDelta: 0,
    },
    oldOverallScore: 500,
    newOverallScore: 500,
    reason: 'task_completed',
    timestamp: new Date('2025-06-01T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<ReputationProfile> = {},
): ReputationProfile {
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

// ---------------------------------------------------------------------------
// checkAnomalyThreshold
// ---------------------------------------------------------------------------
describe('AnomalyDetector.checkAnomalyThreshold', () => {
  it('returns no anomaly when total delta is below threshold', () => {
    const events = [
      makeEvent({ oldOverallScore: 500, newOverallScore: 550 }),
      makeEvent({ oldOverallScore: 550, newOverallScore: 600 }),
    ];
    const result = detector.checkAnomalyThreshold('agent-1', events);
    expect(result.isAnomaly).toBe(false);
    expect(result.totalDelta).toBe(100);
  });

  it('returns anomaly when total delta exceeds threshold (200)', () => {
    const events = [
      makeEvent({ oldOverallScore: 500, newOverallScore: 600 }),
      makeEvent({ oldOverallScore: 600, newOverallScore: 700 }),
      makeEvent({ oldOverallScore: 700, newOverallScore: 810 }),
    ];
    const result = detector.checkAnomalyThreshold('agent-1', events);
    expect(result.isAnomaly).toBe(true);
    expect(result.totalDelta).toBe(310);
  });

  it('sums absolute values of both positive and negative changes', () => {
    const events = [
      makeEvent({ oldOverallScore: 500, newOverallScore: 600 }), // +100
      makeEvent({ oldOverallScore: 600, newOverallScore: 480 }), // +120
    ];
    const result = detector.checkAnomalyThreshold('agent-1', events);
    expect(result.isAnomaly).toBe(true);
    expect(result.totalDelta).toBe(220);
  });

  it('ignores events older than 24 hours', () => {
    const oldTimestamp = new Date('2025-05-30T10:00:00Z').toISOString();
    const events = [
      makeEvent({ oldOverallScore: 0, newOverallScore: 1000, timestamp: oldTimestamp }),
    ];
    const result = detector.checkAnomalyThreshold('agent-1', events);
    expect(result.isAnomaly).toBe(false);
    expect(result.totalDelta).toBe(0);
  });

  it('ignores events from other agents', () => {
    const events = [
      makeEvent({ agentId: 'agent-2', oldOverallScore: 0, newOverallScore: 1000 }),
    ];
    const result = detector.checkAnomalyThreshold('agent-1', events);
    expect(result.isAnomaly).toBe(false);
    expect(result.totalDelta).toBe(0);
  });

  it('returns totalDelta 0 for empty events', () => {
    const result = detector.checkAnomalyThreshold('agent-1', []);
    expect(result.isAnomaly).toBe(false);
    expect(result.totalDelta).toBe(0);
  });

  it('does not flag anomaly when delta equals threshold exactly', () => {
    // threshold is 200, exactly 200 should NOT be anomaly (> not >=)
    const events = [
      makeEvent({ oldOverallScore: 500, newOverallScore: 700 }),
    ];
    const result = detector.checkAnomalyThreshold('agent-1', events);
    expect(result.isAnomaly).toBe(false);
    expect(result.totalDelta).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// checkGrindingPattern
// ---------------------------------------------------------------------------
describe('AnomalyDetector.checkGrindingPattern', () => {
  function makeTask(complexity: 'low' | 'medium' | 'high', hoursAgo: number): TaskSummary {
    const completedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    return { taskId: `task-${Math.random()}`, complexity, completedAt };
  }

  it('detects grinding when low ratio > 80% and count > 30', () => {
    // 28 low + 3 medium = 31 total, ratio = 28/31 ≈ 0.903
    const tasks: TaskSummary[] = [
      ...Array.from({ length: 28 }, () => makeTask('low', 1)),
      ...Array.from({ length: 3 }, () => makeTask('medium', 1)),
    ];
    const result = detector.checkGrindingPattern('agent-1', tasks);
    expect(result.isGrinding).toBe(true);
    expect(result.lowComplexityRatio).toBeCloseTo(28 / 31, 5);
    expect(result.weight).toBe(0.3);
  });

  it('does not flag grinding when count <= 30', () => {
    const tasks: TaskSummary[] = Array.from({ length: 30 }, () => makeTask('low', 1));
    const result = detector.checkGrindingPattern('agent-1', tasks);
    // 30 is not > 30
    expect(result.isGrinding).toBe(false);
    expect(result.weight).toBe(1.0);
  });

  it('does not flag grinding when low ratio <= 80%', () => {
    // 24 low + 7 medium = 31 total, ratio = 24/31 ≈ 0.774
    const tasks: TaskSummary[] = [
      ...Array.from({ length: 24 }, () => makeTask('low', 1)),
      ...Array.from({ length: 7 }, () => makeTask('medium', 1)),
    ];
    const result = detector.checkGrindingPattern('agent-1', tasks);
    expect(result.isGrinding).toBe(false);
    expect(result.weight).toBe(1.0);
  });

  it('ignores tasks older than 24 hours', () => {
    const tasks: TaskSummary[] = Array.from({ length: 50 }, () => makeTask('low', 25));
    const result = detector.checkGrindingPattern('agent-1', tasks);
    expect(result.isGrinding).toBe(false);
    expect(result.lowComplexityRatio).toBe(0);
  });

  it('returns ratio 0 for empty tasks', () => {
    const result = detector.checkGrindingPattern('agent-1', []);
    expect(result.isGrinding).toBe(false);
    expect(result.lowComplexityRatio).toBe(0);
    expect(result.weight).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// checkCollabCollusion
// ---------------------------------------------------------------------------
describe('AnomalyDetector.checkCollabCollusion', () => {
  it('detects collusion when mutual ratings > 90 and deviation > 20', () => {
    const ratings: CollabRatingPair[] = [
      {
        agentA: 'a1',
        agentB: 'a2',
        ratingAtoB: 95,
        ratingBtoA: 92,
        otherMembersAvgRating: 60,
      },
    ];
    const result = detector.checkCollabCollusion(ratings);
    expect(result.isSuspicious).toBe(true);
    expect(result.suspiciousPairs).toHaveLength(1);
    expect(result.suspiciousPairs[0]).toEqual({ agentA: 'a1', agentB: 'a2' });
    expect(result.weight).toBe(0.5);
  });

  it('does not flag when one rating is <= 90', () => {
    const ratings: CollabRatingPair[] = [
      {
        agentA: 'a1',
        agentB: 'a2',
        ratingAtoB: 95,
        ratingBtoA: 85, // <= 90
        otherMembersAvgRating: 60,
      },
    ];
    const result = detector.checkCollabCollusion(ratings);
    expect(result.isSuspicious).toBe(false);
    expect(result.suspiciousPairs).toHaveLength(0);
    expect(result.weight).toBe(1.0);
  });

  it('does not flag when deviation is <= 20', () => {
    const ratings: CollabRatingPair[] = [
      {
        agentA: 'a1',
        agentB: 'a2',
        ratingAtoB: 95,
        ratingBtoA: 95,
        otherMembersAvgRating: 80, // deviation = 15, not > 20
      },
    ];
    const result = detector.checkCollabCollusion(ratings);
    expect(result.isSuspicious).toBe(false);
    expect(result.weight).toBe(1.0);
  });

  it('detects multiple suspicious pairs', () => {
    const ratings: CollabRatingPair[] = [
      {
        agentA: 'a1',
        agentB: 'a2',
        ratingAtoB: 95,
        ratingBtoA: 95,
        otherMembersAvgRating: 50,
      },
      {
        agentA: 'a3',
        agentB: 'a4',
        ratingAtoB: 92,
        ratingBtoA: 91,
        otherMembersAvgRating: 60,
      },
    ];
    const result = detector.checkCollabCollusion(ratings);
    expect(result.isSuspicious).toBe(true);
    expect(result.suspiciousPairs).toHaveLength(2);
  });

  it('returns not suspicious for empty ratings', () => {
    const result = detector.checkCollabCollusion([]);
    expect(result.isSuspicious).toBe(false);
    expect(result.suspiciousPairs).toHaveLength(0);
    expect(result.weight).toBe(1.0);
  });

  it('does not flag when ratings are exactly at threshold (90)', () => {
    const ratings: CollabRatingPair[] = [
      {
        agentA: 'a1',
        agentB: 'a2',
        ratingAtoB: 90, // not > 90
        ratingBtoA: 90,
        otherMembersAvgRating: 60,
      },
    ];
    const result = detector.checkCollabCollusion(ratings);
    expect(result.isSuspicious).toBe(false);
  });

  it('does not flag when deviation is exactly at threshold (20)', () => {
    const ratings: CollabRatingPair[] = [
      {
        agentA: 'a1',
        agentB: 'a2',
        ratingAtoB: 95,
        ratingBtoA: 95,
        otherMembersAvgRating: 75, // deviation = 20, not > 20
      },
    ];
    const result = detector.checkCollabCollusion(ratings);
    expect(result.isSuspicious).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getProbationDamping
// ---------------------------------------------------------------------------
describe('AnomalyDetector.getProbationDamping', () => {
  it('returns probationDamping (0.7) for external agent on probation', () => {
    const profile = makeProfile({ isExternal: true, trustTier: 'probation' });
    expect(detector.getProbationDamping(profile)).toBe(0.7);
  });

  it('returns 1.0 for internal agent on probation', () => {
    const profile = makeProfile({ isExternal: false, trustTier: 'probation' });
    expect(detector.getProbationDamping(profile)).toBe(1.0);
  });

  it('returns 1.0 for external agent on standard', () => {
    const profile = makeProfile({ isExternal: true, trustTier: 'standard' });
    expect(detector.getProbationDamping(profile)).toBe(1.0);
  });

  it('returns 1.0 for external agent on trusted', () => {
    const profile = makeProfile({ isExternal: true, trustTier: 'trusted' });
    expect(detector.getProbationDamping(profile)).toBe(1.0);
  });

  it('returns 1.0 for internal agent on trusted', () => {
    const profile = makeProfile({ isExternal: false, trustTier: 'trusted' });
    expect(detector.getProbationDamping(profile)).toBe(1.0);
  });
});
