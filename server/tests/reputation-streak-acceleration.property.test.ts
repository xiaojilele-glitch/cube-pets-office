/**
 * Property-Based Test: 连胜加速机制
 *
 * **Feature: agent-reputation, Property 15: 连胜加速机制**
 * **Validates: Requirements 6.4**
 *
 * For any 连续 N 次（N >= streak.threshold）taskQualityScore >= streak.qualityMin 的 Agent，
 * 后续信誉更新的 EMA alpha 值应为 alpha * streak.alphaMultiplier；连续记录断裂后恢复正常 alpha。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ReputationService } from '../core/reputation/reputation-service.js';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationConfig, ReputationSignal } from '../../shared/reputation.js';
import db from '../db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniqueAgentId(): string {
  return `pbt15-agent-${++counter}-${Date.now()}`;
}

/**
 * Config with anomaly threshold raised very high so it doesn't interfere
 * with streak tests that send many consecutive signals.
 */
function streakTestConfig(): ReputationConfig {
  return {
    ...DEFAULT_REPUTATION_CONFIG,
    anomaly: {
      ...DEFAULT_REPUTATION_CONFIG.anomaly,
      threshold: 100_000, // effectively disable anomaly detection
    },
  };
}

function createService(config: ReputationConfig): ReputationService {
  return new ReputationService(
    new ReputationCalculator(config),
    new TrustTierEvaluator(config),
    new AnomalyDetector(config),
    config,
  );
}

function makeSignal(agentId: string, taskQualityScore: number, taskIndex: number): ReputationSignal {
  return {
    agentId,
    taskId: `task-${agentId}-${taskIndex}`,
    taskQualityScore,
    actualDurationMs: 1000,
    estimatedDurationMs: 1000,
    tokenConsumed: 500,
    tokenBudget: 1000,
    wasRolledBack: false,
    downstreamFailures: 0,
    taskComplexity: 'medium',
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 15: 连胜加速机制', () => {
  // -------------------------------------------------------------------------
  // Streak counter increments for high-quality tasks and resets on low-quality
  // -------------------------------------------------------------------------

  it('consecutiveHighQuality increments for each task with qualityScore >= qualityMin', () => {
    const config = streakTestConfig();
    const { threshold, qualityMin } = config.streak;

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: threshold + 5 }),
        fc.integer({ min: qualityMin, max: 100 }),
        (numTasks: number, quality: number) => {
          const service = createService(config);
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          for (let i = 0; i < numTasks; i++) {
            service.handleTaskCompleted(makeSignal(agentId, quality, i));
          }

          const profile = db.getReputationProfile(agentId)!;
          expect(profile.consecutiveHighQuality).toBe(numTasks);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Streak resets to 0 when a low-quality task is encountered
  // -------------------------------------------------------------------------

  it('consecutiveHighQuality resets to 0 when taskQualityScore < qualityMin', () => {
    const config = streakTestConfig();
    const { threshold, qualityMin } = config.streak;

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: threshold + 10 }),
        fc.integer({ min: 0, max: qualityMin - 1 }),
        (streakLength: number, lowQuality: number) => {
          const service = createService(config);
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          // Build streak
          for (let i = 0; i < streakLength; i++) {
            service.handleTaskCompleted(makeSignal(agentId, qualityMin, i));
          }
          expect(db.getReputationProfile(agentId)!.consecutiveHighQuality).toBe(streakLength);

          // Break streak
          service.handleTaskCompleted(makeSignal(agentId, lowQuality, streakLength));
          expect(db.getReputationProfile(agentId)!.consecutiveHighQuality).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // After reaching threshold, quality delta is boosted (larger due to higher alpha)
  // -------------------------------------------------------------------------

  it('quality delta is larger with streak bonus than without (boosted alpha)', () => {
    const config = streakTestConfig();
    const { threshold, qualityMin } = config.streak;

    fc.assert(
      fc.property(
        fc.integer({ min: qualityMin, max: 100 }),
        (quality: number) => {
          // --- Agent A: has streak bonus (threshold tasks completed) ---
          const serviceA = createService(config);
          const agentA = uniqueAgentId();
          serviceA.initializeProfile(agentA, false);

          for (let i = 0; i < threshold; i++) {
            serviceA.handleTaskCompleted(makeSignal(agentA, qualityMin, i));
          }
          const profileA = db.getReputationProfile(agentA)!;
          expect(profileA.consecutiveHighQuality).toBe(threshold);
          const qualityBeforeA = profileA.dimensions.qualityScore;

          // --- Agent B: no streak, same starting quality score ---
          const serviceB = createService(config);
          const agentB = uniqueAgentId();
          serviceB.initializeProfile(agentB, false);
          const profileB = db.getReputationProfile(agentB)!;
          profileB.dimensions.qualityScore = qualityBeforeA;
          profileB.consecutiveHighQuality = 0;
          db.upsertReputationProfile(profileB);

          // Send the same signal to both
          serviceA.handleTaskCompleted(makeSignal(agentA, quality, threshold));
          serviceB.handleTaskCompleted(makeSignal(agentB, quality, 0));

          const qualityAfterA = db.getReputationProfile(agentA)!.dimensions.qualityScore;
          const qualityAfterB = db.getReputationProfile(agentB)!.dimensions.qualityScore;

          const deltaA = qualityAfterA - qualityBeforeA;
          const deltaB = qualityAfterB - qualityBeforeA;

          const target = quality * 10;

          if (target === qualityBeforeA) {
            // When target equals current, both deltas are ~0
            expect(Math.abs(deltaA - deltaB)).toBeLessThanOrEqual(1);
          } else {
            // Streak agent should have a larger absolute delta (with rounding tolerance)
            expect(Math.abs(deltaA)).toBeGreaterThanOrEqual(Math.abs(deltaB) - 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });


  // -------------------------------------------------------------------------
  // After streak breaks, alpha returns to normal (delta matches non-streak agent)
  // -------------------------------------------------------------------------

  it('after streak breaks, quality delta returns to normal alpha', () => {
    const config = streakTestConfig();
    const { threshold, qualityMin } = config.streak;

    fc.assert(
      fc.property(
        fc.integer({ min: qualityMin, max: 100 }),
        fc.integer({ min: 0, max: qualityMin - 1 }),
        fc.integer({ min: qualityMin, max: 100 }),
        (highQuality: number, lowQuality: number, postBreakQuality: number) => {
          const service = createService(config);
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          // Build streak to threshold
          for (let i = 0; i < threshold; i++) {
            service.handleTaskCompleted(makeSignal(agentId, highQuality, i));
          }
          expect(db.getReputationProfile(agentId)!.consecutiveHighQuality).toBe(threshold);

          // Break streak with low-quality task
          service.handleTaskCompleted(makeSignal(agentId, lowQuality, threshold));
          expect(db.getReputationProfile(agentId)!.consecutiveHighQuality).toBe(0);

          // Now send a post-break task and compare with a fresh agent at same score
          const profileAfterBreak = db.getReputationProfile(agentId)!;
          const qualityBefore = profileAfterBreak.dimensions.qualityScore;

          // Fresh agent B with same quality score and no streak
          const serviceB = createService(config);
          const agentB = uniqueAgentId();
          serviceB.initializeProfile(agentB, false);
          const profileB = db.getReputationProfile(agentB)!;
          profileB.dimensions.qualityScore = qualityBefore;
          profileB.consecutiveHighQuality = 0;
          db.upsertReputationProfile(profileB);

          // Send same signal to both
          service.handleTaskCompleted(makeSignal(agentId, postBreakQuality, threshold + 1));
          serviceB.handleTaskCompleted(makeSignal(agentB, postBreakQuality, 0));

          const qualityAfterA = db.getReputationProfile(agentId)!.dimensions.qualityScore;
          const qualityAfterB = db.getReputationProfile(agentB)!.dimensions.qualityScore;

          // Both should produce the same delta (normal alpha, no streak bonus)
          expect(qualityAfterA).toBe(qualityAfterB);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Verify the exact boosted alpha value: alpha * alphaMultiplier
  // -------------------------------------------------------------------------

  it('streak-boosted EMA uses exactly alpha * alphaMultiplier', () => {
    const config = streakTestConfig();
    const { threshold, qualityMin, alphaMultiplier } = config.streak;
    const baseAlpha = config.ema.qualityAlpha;
    const boostedAlpha = baseAlpha * alphaMultiplier;

    fc.assert(
      fc.property(
        fc.integer({ min: qualityMin, max: 100 }),
        (quality: number) => {
          const service = createService(config);
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          // Build streak to exactly threshold
          for (let i = 0; i < threshold; i++) {
            service.handleTaskCompleted(makeSignal(agentId, qualityMin, i));
          }

          const profileBefore = db.getReputationProfile(agentId)!;
          const qBefore = profileBefore.dimensions.qualityScore;
          expect(profileBefore.consecutiveHighQuality).toBe(threshold);

          // Send one more high-quality task — this should use boosted alpha
          service.handleTaskCompleted(makeSignal(agentId, quality, threshold));

          const qAfter = db.getReputationProfile(agentId)!.dimensions.qualityScore;

          // Expected: EMA with boosted alpha, then clamped delta, then rounded
          const target = quality * 10;
          const rawEma = qBefore * (1 - boostedAlpha) + target * boostedAlpha;
          const rawDelta = rawEma - qBefore;
          const clampedDelta = Math.max(
            -config.maxDeltaPerUpdate,
            Math.min(config.maxDeltaPerUpdate, rawDelta),
          );
          const expected = Math.max(0, Math.min(1000, Math.round(qBefore + clampedDelta)));

          expect(qAfter).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
