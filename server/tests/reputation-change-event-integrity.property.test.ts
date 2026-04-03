/**
 * Property-Based Test: 信誉变更事件完整性
 *
 * **Feature: agent-reputation, Property 5: 信誉变更事件完整性**
 * **Validates: Requirements 2.5, 6.5**
 *
 * For any 信誉更新操作（包括任务完成、衰减、连胜加速、手动调整），
 * 系统应生成一条 ReputationChangeEvent，包含正确的 agentId、
 * dimensionDeltas、oldOverallScore、newOverallScore 和 reason。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ReputationService } from '../core/reputation/reputation-service.js';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DecayScheduler } from '../core/reputation/decay-scheduler.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationSignal, DimensionScores, ReputationConfig } from '../../shared/reputation.js';
import db from '../db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniqueAgentId(): string {
  return `pbt5-agent-${++counter}-${Date.now()}`;
}

function createService(config: ReputationConfig = DEFAULT_REPUTATION_CONFIG): ReputationService {
  return new ReputationService(
    new ReputationCalculator(config),
    new TrustTierEvaluator(config),
    new AnomalyDetector(config),
    config,
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate signals that won't trigger anomaly detection.
 * Use moderate values so cumulative deltas stay under the 200 threshold.
 */
const safeSignalArb = (agentId: string): fc.Arbitrary<ReputationSignal> =>
  fc.record({
    agentId: fc.constant(agentId),
    taskId: fc.string({ minLength: 1, maxLength: 12 }).map(s => `task-${s}`),
    roleId: fc.option(fc.constantFrom('coder', 'reviewer', 'lead'), { nil: undefined }),
    taskQualityScore: fc.integer({ min: 40, max: 60 }),
    actualDurationMs: fc.integer({ min: 800, max: 1200 }),
    estimatedDurationMs: fc.constant(1000),
    tokenConsumed: fc.integer({ min: 800, max: 1200 }),
    tokenBudget: fc.constant(1000),
    wasRolledBack: fc.constant(false),
    downstreamFailures: fc.constant(0),
    collaborationRating: fc.option(fc.integer({ min: 40, max: 60 }), { nil: undefined }),
    taskComplexity: fc.constantFrom('medium' as const, 'high' as const),
    timestamp: fc.constant(new Date().toISOString()),
  });

const dimensionKeyArb: fc.Arbitrary<keyof DimensionScores> = fc.constantFrom(
  'qualityScore', 'speedScore', 'efficiencyScore', 'collaborationScore', 'reliabilityScore',
);

const adjustDeltaArb = fc.integer({ min: -100, max: 100 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 5: 信誉变更事件完整性', () => {
  it('handleTaskCompleted generates a ReputationChangeEvent with correct fields', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        safeSignalArb('placeholder'),
        (seed, signalTemplate) => {
          const service = createService();
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          const profileBefore = service.getReputation(agentId)!;
          const oldOverall = profileBefore.overallScore;

          const signal: ReputationSignal = { ...signalTemplate, agentId };
          const eventsBefore = db.getReputationEvents(agentId);
          const countBefore = eventsBefore.length;

          service.handleTaskCompleted(signal);

          const eventsAfter = db.getReputationEvents(agentId);
          // At least one new event should be created
          expect(eventsAfter.length).toBeGreaterThan(countBefore);

          // Find the newest event (events are returned newest-first based on the DB impl)
          const latest = eventsAfter[0];

          // Verify all required fields
          expect(latest.agentId).toBe(agentId);
          expect(latest.taskId).toBe(signal.taskId);
          expect(latest.reason).toBe('task_completed');
          expect(latest.oldOverallScore).toBe(oldOverall);
          expect(typeof latest.newOverallScore).toBe('number');
          expect(latest.newOverallScore).toBeGreaterThanOrEqual(0);
          expect(latest.newOverallScore).toBeLessThanOrEqual(1000);

          // dimensionDeltas must be present with all five fields
          expect(latest.dimensionDeltas).toBeDefined();
          expect(typeof latest.dimensionDeltas.qualityDelta).toBe('number');
          expect(typeof latest.dimensionDeltas.speedDelta).toBe('number');
          expect(typeof latest.dimensionDeltas.efficiencyDelta).toBe('number');
          expect(typeof latest.dimensionDeltas.collaborationDelta).toBe('number');
          expect(typeof latest.dimensionDeltas.reliabilityDelta).toBe('number');

          // newOverallScore should match the profile's current score
          const profileAfter = service.getReputation(agentId)!;
          expect(latest.newOverallScore).toBe(profileAfter.overallScore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('adjustReputation generates a ReputationChangeEvent with reason admin_adjust', () => {
    fc.assert(
      fc.property(dimensionKeyArb, adjustDeltaArb, (dimension, delta) => {
        const service = createService();
        const agentId = uniqueAgentId();
        service.initializeProfile(agentId, false);

        const oldOverall = service.getReputation(agentId)!.overallScore;
        const countBefore = db.getReputationEvents(agentId).length;

        service.adjustReputation(agentId, dimension, delta, 'pbt-test');

        const eventsAfter = db.getReputationEvents(agentId);
        expect(eventsAfter.length).toBeGreaterThan(countBefore);

        const latest = eventsAfter[0];
        expect(latest.agentId).toBe(agentId);
        expect(latest.taskId).toBeNull();
        expect(latest.reason).toBe('admin_adjust');
        expect(latest.oldOverallScore).toBe(oldOverall);
        expect(latest.newOverallScore).toBe(service.getReputation(agentId)!.overallScore);

        // dimensionDeltas should have the adjusted dimension's delta
        expect(latest.dimensionDeltas).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('resetReputation generates a ReputationChangeEvent with reason admin_reset', () => {
    fc.assert(
      fc.property(fc.boolean(), (isExternal) => {
        const service = createService();
        const agentId = uniqueAgentId();
        service.initializeProfile(agentId, isExternal);

        // Modify the profile first so reset has an effect
        service.adjustReputation(agentId, 'qualityScore', 50, 'setup');
        const oldOverall = service.getReputation(agentId)!.overallScore;
        const countBefore = db.getReputationEvents(agentId).length;

        service.resetReputation(agentId);

        const eventsAfter = db.getReputationEvents(agentId);
        expect(eventsAfter.length).toBeGreaterThan(countBefore);

        const latest = eventsAfter[0];
        expect(latest.agentId).toBe(agentId);
        expect(latest.taskId).toBeNull();
        expect(latest.reason).toBe('admin_reset');
        expect(latest.oldOverallScore).toBe(oldOverall);

        const expectedScore = isExternal
          ? DEFAULT_REPUTATION_CONFIG.externalInitialScore
          : DEFAULT_REPUTATION_CONFIG.internalInitialScore;
        expect(latest.newOverallScore).toBe(expectedScore);

        // All dimension deltas should be 0 for reset
        expect(latest.dimensionDeltas.qualityDelta).toBe(0);
        expect(latest.dimensionDeltas.speedDelta).toBe(0);
        expect(latest.dimensionDeltas.efficiencyDelta).toBe(0);
        expect(latest.dimensionDeltas.collaborationDelta).toBe(0);
        expect(latest.dimensionDeltas.reliabilityDelta).toBe(0);
      }),
      { numRuns: 50 },
    );
  });

  it('inactivity decay generates a ReputationChangeEvent with reason inactivity_decay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 800 }),
        (initialScore) => {
          const config = { ...DEFAULT_REPUTATION_CONFIG };
          const calculator = new ReputationCalculator(config);
          const evaluator = new TrustTierEvaluator(config);
          const service = createService(config);
          const scheduler = new DecayScheduler(config, evaluator, calculator);

          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          // Set the profile to a custom score and make it inactive
          service.adjustReputation(agentId, 'qualityScore', initialScore - 500, 'setup');
          const profile = db.getReputationProfile(agentId)!;
          // Set lastActiveAt to 30 days ago (well past the 14-day threshold)
          profile.lastActiveAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          db.upsertReputationProfile(profile);

          const oldOverall = profile.overallScore;
          const countBefore = db.getReputationEvents(agentId).length;

          // Only run decay if score is above floor
          if (oldOverall <= config.decay.decayFloor) return;

          scheduler.runDecayCycle();

          const eventsAfter = db.getReputationEvents(agentId);
          expect(eventsAfter.length).toBeGreaterThan(countBefore);

          // Find the decay event
          const decayEvent = eventsAfter.find(e => e.reason === 'inactivity_decay' && e.agentId === agentId);
          expect(decayEvent).toBeDefined();
          expect(decayEvent!.agentId).toBe(agentId);
          expect(decayEvent!.taskId).toBeNull();
          expect(decayEvent!.reason).toBe('inactivity_decay');
          expect(decayEvent!.oldOverallScore).toBe(oldOverall);
          expect(decayEvent!.newOverallScore).toBe(
            Math.max(config.decay.decayFloor, oldOverall - config.decay.decayRate),
          );

          // Decay only affects overallScore, dimension deltas should be 0
          expect(decayEvent!.dimensionDeltas.qualityDelta).toBe(0);
          expect(decayEvent!.dimensionDeltas.speedDelta).toBe(0);
          expect(decayEvent!.dimensionDeltas.efficiencyDelta).toBe(0);
          expect(decayEvent!.dimensionDeltas.collaborationDelta).toBe(0);
          expect(decayEvent!.dimensionDeltas.reliabilityDelta).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
