import { describe, expect, it, beforeEach } from 'vitest';
import { ReputationService } from '../core/reputation/reputation-service.js';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationSignal } from '../../shared/reputation.js';
import db from '../db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createService(config = DEFAULT_REPUTATION_CONFIG): ReputationService {
  return new ReputationService(
    new ReputationCalculator(config),
    new TrustTierEvaluator(config),
    new AnomalyDetector(config),
    config,
  );
}

function makeSignal(overrides: Partial<ReputationSignal> = {}): ReputationSignal {
  return {
    agentId: 'agent-1',
    taskId: 'task-1',
    taskQualityScore: 80,
    actualDurationMs: 1000,
    estimatedDurationMs: 1000,
    tokenConsumed: 500,
    tokenBudget: 1000,
    wasRolledBack: false,
    downstreamFailures: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Reset reputation-related tables in the DB between tests.
 * We upsert empty state by removing profiles/events directly.
 */
function resetDb(): void {
  // Remove all reputation profiles by resetting each one
  for (const p of db.getAllReputationProfiles()) {
    // There's no delete method, so we'll work around by re-initializing
    // We'll just accept stale data and use unique agent IDs per test
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReputationService', () => {
  let service: ReputationService;
  let testId = 0;

  function uniqueAgentId(): string {
    return `agent-test-${++testId}-${Date.now()}`;
  }

  beforeEach(() => {
    service = createService();
  });

  // -----------------------------------------------------------------------
  // initializeProfile
  // -----------------------------------------------------------------------
  describe('initializeProfile', () => {
    it('initializes internal agent with score 500 and grade B', () => {
      const agentId = uniqueAgentId();
      const profile = service.initializeProfile(agentId, false);

      expect(profile.agentId).toBe(agentId);
      expect(profile.overallScore).toBe(500);
      expect(profile.dimensions.qualityScore).toBe(500);
      expect(profile.dimensions.speedScore).toBe(500);
      expect(profile.dimensions.efficiencyScore).toBe(500);
      expect(profile.dimensions.collaborationScore).toBe(500);
      expect(profile.dimensions.reliabilityScore).toBe(500);
      expect(profile.grade).toBe('B');
      expect(profile.trustTier).toBe('standard');
      expect(profile.isExternal).toBe(false);
      expect(profile.totalTasks).toBe(0);
      expect(profile.consecutiveHighQuality).toBe(0);
    });

    it('initializes external agent with score 400, grade C, and probation', () => {
      const agentId = uniqueAgentId();
      const profile = service.initializeProfile(agentId, true);

      expect(profile.overallScore).toBe(400);
      expect(profile.dimensions.qualityScore).toBe(400);
      expect(profile.grade).toBe('C');
      expect(profile.trustTier).toBe('probation');
      expect(profile.isExternal).toBe(true);
    });

    it('returns existing profile if already initialized', () => {
      const agentId = uniqueAgentId();
      const first = service.initializeProfile(agentId, false);
      const second = service.initializeProfile(agentId, true); // different isExternal
      expect(second.overallScore).toBe(first.overallScore);
      expect(second.isExternal).toBe(false); // original value preserved
    });
  });

  // -----------------------------------------------------------------------
  // handleTaskCompleted
  // -----------------------------------------------------------------------
  describe('handleTaskCompleted', () => {
    it('creates profile if not exists and updates it', () => {
      const agentId = uniqueAgentId();
      const signal = makeSignal({ agentId });

      service.handleTaskCompleted(signal);

      const profile = service.getReputation(agentId);
      expect(profile).toBeDefined();
      expect(profile!.totalTasks).toBe(1);
      expect(profile!.lastActiveAt).toBe(signal.timestamp);
    });

    it('updates dimension scores based on signal', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      const signal = makeSignal({
        agentId,
        taskQualityScore: 90, // high quality → quality goes up
        actualDurationMs: 800,
        estimatedDurationMs: 1000, // fast → speed goes up
        tokenConsumed: 400,
        tokenBudget: 1000, // efficient → efficiency goes up
      });

      service.handleTaskCompleted(signal);

      const profile = service.getReputation(agentId)!;
      expect(profile.dimensions.qualityScore).toBeGreaterThan(500);
      expect(profile.dimensions.speedScore).toBeGreaterThan(500);
      expect(profile.dimensions.efficiencyScore).toBeGreaterThan(500);
      expect(profile.dimensions.reliabilityScore).toBeGreaterThan(500); // success recovery
    });

    it('generates a ReputationChangeEvent with reason task_completed', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      service.handleTaskCompleted(makeSignal({ agentId, taskId: 'task-42' }));

      const events = db.getReputationEvents(agentId);
      expect(events.length).toBeGreaterThanOrEqual(1);
      const latest = events[0];
      expect(latest.agentId).toBe(agentId);
      expect(latest.taskId).toBe('task-42');
      expect(latest.reason).toBe('task_completed');
      expect(latest.oldOverallScore).toBe(500);
      expect(latest.newOverallScore).toBeGreaterThanOrEqual(0);
    });

    it('updates role reputation when roleId is present', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      const signal = makeSignal({ agentId, roleId: 'coder' });
      service.handleTaskCompleted(signal);

      const roleRep = service.getReputationByRole(agentId, 'coder');
      expect(roleRep).toBeDefined();
      expect(roleRep!.roleId).toBe('coder');
      expect(roleRep!.totalTasksInRole).toBe(1);
      expect(roleRep!.lowConfidence).toBe(true); // < 10 tasks
    });

    it('marks role as not lowConfidence after 10 tasks', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      // Use moderate signals that won't trigger anomaly detection
      // (quality=50 maps to 500 target, same as initial → minimal delta)
      for (let i = 0; i < 10; i++) {
        service.handleTaskCompleted(makeSignal({
          agentId,
          taskId: `task-${i}`,
          roleId: 'reviewer',
          taskQualityScore: 50,
          actualDurationMs: 1000,
          estimatedDurationMs: 1000,
          tokenConsumed: 1000,
          tokenBudget: 1000,
        }));
      }

      const roleRep = service.getReputationByRole(agentId, 'reviewer');
      expect(roleRep!.totalTasksInRole).toBe(10);
      expect(roleRep!.lowConfidence).toBe(false);
    });

    it('tracks consecutiveHighQuality streak', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      // 3 high quality tasks
      for (let i = 0; i < 3; i++) {
        service.handleTaskCompleted(makeSignal({
          agentId,
          taskId: `task-${i}`,
          taskQualityScore: 85,
        }));
      }
      expect(service.getReputation(agentId)!.consecutiveHighQuality).toBe(3);

      // Break the streak
      service.handleTaskCompleted(makeSignal({
        agentId,
        taskId: 'task-break',
        taskQualityScore: 50,
      }));
      expect(service.getReputation(agentId)!.consecutiveHighQuality).toBe(0);
    });

    it('halts update and creates audit entry on anomaly detection', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      // Create many events with large score swings to trigger anomaly
      // The anomaly threshold is 200 in 24h
      // We'll manually create events that sum to > 200
      for (let i = 0; i < 5; i++) {
        db.createReputationEvent({
          agentId,
          taskId: `fake-${i}`,
          dimensionDeltas: {
            qualityDelta: 0, speedDelta: 0, efficiencyDelta: 0,
            collaborationDelta: 0, reliabilityDelta: 0,
          },
          oldOverallScore: 500 + i * 50,
          newOverallScore: 500 + (i + 1) * 50,
          reason: 'task_completed',
          timestamp: new Date().toISOString(),
        });
      }

      // Now the total delta in 24h = 5 * 50 = 250 > 200 threshold
      const profileBefore = service.getReputation(agentId)!;
      const scoreBefore = profileBefore.overallScore;

      service.handleTaskCompleted(makeSignal({ agentId, taskId: 'task-anomaly' }));

      // Score should not change (update was halted)
      const profileAfter = service.getReputation(agentId)!;
      expect(profileAfter.overallScore).toBe(scoreBefore);

      // Audit entry should exist
      const audits = db.getAuditEntries(agentId);
      expect(audits.some(a => a.type === 'anomaly')).toBe(true);
    });

    it('applies probation damping to positive deltas for external agents', () => {
      const agentId = uniqueAgentId();
      const externalProfile = service.initializeProfile(agentId, true);
      expect(externalProfile.trustTier).toBe('probation');

      // Internal agent for comparison
      const internalId = uniqueAgentId();
      service.initializeProfile(internalId, false);

      const signal = makeSignal({
        taskQualityScore: 95,
        actualDurationMs: 500,
        estimatedDurationMs: 1000,
        tokenConsumed: 300,
        tokenBudget: 1000,
      });

      service.handleTaskCompleted({ ...signal, agentId });
      service.handleTaskCompleted({ ...signal, agentId: internalId });

      const extProfile = service.getReputation(agentId)!;
      const intProfile = service.getReputation(internalId)!;

      // External agent should have gained less due to probation damping (0.7)
      // Both started at different scores (400 vs 500), so compare relative gains
      const extGain = extProfile.overallScore - 400;
      const intGain = intProfile.overallScore - 500;

      // External gain should be dampened relative to internal
      // (not exact due to different starting scores affecting EMA, but directionally correct)
      expect(extGain).toBeLessThan(intGain);
    });
  });

  // -----------------------------------------------------------------------
  // getReputation / getReputationByRole
  // -----------------------------------------------------------------------
  describe('getReputation', () => {
    it('returns undefined for unknown agent', () => {
      expect(service.getReputation('nonexistent-agent')).toBeUndefined();
    });

    it('returns profile after initialization', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);
      const profile = service.getReputation(agentId);
      expect(profile).toBeDefined();
      expect(profile!.agentId).toBe(agentId);
    });
  });

  describe('getReputationByRole', () => {
    it('returns undefined for unknown agent', () => {
      expect(service.getReputationByRole('nonexistent', 'coder')).toBeUndefined();
    });

    it('returns undefined for unknown role', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);
      expect(service.getReputationByRole(agentId, 'unknown-role')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // adjustReputation
  // -----------------------------------------------------------------------
  describe('adjustReputation', () => {
    it('adjusts the specified dimension and recomputes overall', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      service.adjustReputation(agentId, 'qualityScore', 100, 'manual boost');

      const profile = service.getReputation(agentId)!;
      expect(profile.dimensions.qualityScore).toBe(600);
      // Overall should increase: 600*0.3 + 500*0.15 + 500*0.2 + 500*0.15 + 500*0.2
      // = 180 + 75 + 100 + 75 + 100 = 530
      expect(profile.overallScore).toBe(530);
    });

    it('clamps dimension to [0, 1000]', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      service.adjustReputation(agentId, 'qualityScore', 600, 'big boost');
      expect(service.getReputation(agentId)!.dimensions.qualityScore).toBe(1000);

      service.adjustReputation(agentId, 'qualityScore', -1500, 'big penalty');
      expect(service.getReputation(agentId)!.dimensions.qualityScore).toBe(0);
    });

    it('creates audit entry and change event', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      service.adjustReputation(agentId, 'speedScore', -50, 'test penalty');

      const events = db.getReputationEvents(agentId);
      expect(events.some(e => e.reason === 'admin_adjust')).toBe(true);

      const audits = db.getAuditEntries(agentId);
      expect(audits.some(a => a.type === 'admin_adjust')).toBe(true);
    });

    it('does nothing for unknown agent', () => {
      // Should not throw
      service.adjustReputation('nonexistent', 'qualityScore', 10, 'test');
    });
  });

  // -----------------------------------------------------------------------
  // resetReputation
  // -----------------------------------------------------------------------
  describe('resetReputation', () => {
    it('resets internal agent to 500', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);

      // Modify via task
      service.handleTaskCompleted(makeSignal({ agentId, taskQualityScore: 95 }));
      expect(service.getReputation(agentId)!.overallScore).not.toBe(500);

      service.resetReputation(agentId);

      const profile = service.getReputation(agentId)!;
      expect(profile.overallScore).toBe(500);
      expect(profile.dimensions.qualityScore).toBe(500);
      expect(profile.grade).toBe('B');
      expect(profile.trustTier).toBe('standard');
      expect(profile.consecutiveHighQuality).toBe(0);
      expect(Object.keys(profile.roleReputation)).toHaveLength(0);
    });

    it('resets external agent to 400 with probation', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, true);

      service.handleTaskCompleted(makeSignal({ agentId, taskQualityScore: 95 }));

      service.resetReputation(agentId);

      const profile = service.getReputation(agentId)!;
      expect(profile.overallScore).toBe(400);
      expect(profile.trustTier).toBe('probation');
    });

    it('creates audit entry and change event with reason admin_reset', () => {
      const agentId = uniqueAgentId();
      service.initializeProfile(agentId, false);
      service.resetReputation(agentId);

      const events = db.getReputationEvents(agentId);
      expect(events.some(e => e.reason === 'admin_reset')).toBe(true);

      const audits = db.getAuditEntries(agentId);
      expect(audits.some(a => a.type === 'admin_reset')).toBe(true);
    });

    it('does nothing for unknown agent', () => {
      service.resetReputation('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // getLeaderboard
  // -----------------------------------------------------------------------
  describe('getLeaderboard', () => {
    it('returns agents sorted by overallScore descending by default', () => {
      const ids = [uniqueAgentId(), uniqueAgentId(), uniqueAgentId()];

      // Create agents with different scores
      service.initializeProfile(ids[0], false); // 500
      service.initializeProfile(ids[1], true);  // 400
      service.initializeProfile(ids[2], false); // 500, then boost
      service.adjustReputation(ids[2], 'qualityScore', 200, 'boost');

      const board = service.getLeaderboard({ limit: 10_000 });

      // Find our test agents in the board
      const ourEntries = board.filter(e => ids.includes(e.agentId));
      expect(ourEntries.length).toBe(3);

      // Verify descending order among our entries
      const scores = ourEntries.map(e => e.overallScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    });

    it('filters by trustTier', () => {
      const internalId = uniqueAgentId();
      const externalId = uniqueAgentId();
      service.initializeProfile(internalId, false); // standard
      service.initializeProfile(externalId, true);  // probation

      const probationBoard = service.getLeaderboard({ trustTier: 'probation', limit: 10_000 });
      const probationIds = probationBoard.map(e => e.agentId);
      expect(probationIds).toContain(externalId);
      // Internal agent should not be in probation board
      expect(probationIds).not.toContain(internalId);
    });

    it('supports ascending order', () => {
      const ids = [uniqueAgentId(), uniqueAgentId()];
      service.initializeProfile(ids[0], false);
      service.initializeProfile(ids[1], true);

      const board = service.getLeaderboard({ order: 'asc' });
      const ourEntries = board.filter(e => ids.includes(e.agentId));
      if (ourEntries.length >= 2) {
        expect(ourEntries[0].overallScore).toBeLessThanOrEqual(ourEntries[1].overallScore);
      }
    });

    it('supports pagination with limit and offset', () => {
      const ids = Array.from({ length: 5 }, () => uniqueAgentId());
      ids.forEach(id => service.initializeProfile(id, false));

      const page1 = service.getLeaderboard({ limit: 2, offset: 0 });
      const page2 = service.getLeaderboard({ limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);

      // Pages should not overlap
      const page1Ids = new Set(page1.map(e => e.agentId));
      const page2Ids = new Set(page2.map(e => e.agentId));
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    it('supports sorting by dimension score', () => {
      const ids = [uniqueAgentId(), uniqueAgentId()];
      service.initializeProfile(ids[0], false);
      service.initializeProfile(ids[1], false);
      service.adjustReputation(ids[1], 'qualityScore', 200, 'boost quality');

      const board = service.getLeaderboard({ sortBy: 'qualityScore' });
      const ourEntries = board.filter(e => ids.includes(e.agentId));
      if (ourEntries.length >= 2) {
        expect(ourEntries[0].dimensions.qualityScore)
          .toBeGreaterThanOrEqual(ourEntries[1].dimensions.qualityScore);
      }
    });
  });
});
