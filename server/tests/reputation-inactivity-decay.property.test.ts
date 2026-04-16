/**
 * Property-Based Test: 不活跃衰减规则
 *
 * **Feature: agent-reputation, Property 14: 不活跃衰减规则**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 *
 * For any 不活跃超过 inactivityDays 的 Agent，overallScore 应按 decayRate 衰减
 * 但不低于 decayFloor，且所有维度子分保持不变。当 Agent 恢复活跃后，衰减立即停止。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ReputationService } from "../core/reputation/reputation-service.js";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { TrustTierEvaluator } from "../core/reputation/trust-tier-evaluator.js";
import { AnomalyDetector } from "../core/reputation/anomaly-detector.js";
import { DecayScheduler } from "../core/reputation/decay-scheduler.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  ReputationConfig,
  ReputationSignal,
} from "../../shared/reputation.js";
import db from "../db/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

let counter = 0;
function uniqueAgentId(): string {
  return `pbt14-agent-${++counter}-${Date.now()}`;
}

function createService(
  config: ReputationConfig = DEFAULT_REPUTATION_CONFIG
): ReputationService {
  return new ReputationService(
    new ReputationCalculator(config),
    new TrustTierEvaluator(config),
    new AnomalyDetector(config),
    config
  );
}

function createScheduler(
  config: ReputationConfig = DEFAULT_REPUTATION_CONFIG
): DecayScheduler {
  return new DecayScheduler(
    config,
    new TrustTierEvaluator(config),
    new ReputationCalculator(config)
  );
}

/**
 * Set a profile's lastActiveAt to a specific number of days ago and persist.
 */
function setInactiveDaysAgo(agentId: string, daysAgo: number): void {
  const profile = db.getReputationProfile(agentId)!;
  profile.lastActiveAt = new Date(
    Date.now() - daysAgo * MS_PER_DAY
  ).toISOString();
  db.upsertReputationProfile(profile);
}

/**
 * Set a profile's overallScore directly and persist.
 */
function setOverallScore(agentId: string, score: number): void {
  const profile = db.getReputationProfile(agentId)!;
  profile.overallScore = score;
  db.upsertReputationProfile(profile);
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 14: 不活跃衰减规则", () => {
  // -------------------------------------------------------------------------
  // Req 6.1: Inactive agents decay by decayRate, floored at decayFloor
  // -------------------------------------------------------------------------

  it("overallScore decreases by decayRate for inactive agents, never below decayFloor", () => {
    const config = { ...DEFAULT_REPUTATION_CONFIG };
    const { decayRate, decayFloor, inactivityDays } = config.decay;

    fc.assert(
      fc.property(
        // Score above floor so decay has room to act
        fc.integer({ min: decayFloor + 1, max: 1000 }),
        // Days of inactivity beyond the threshold
        fc.integer({ min: inactivityDays, max: inactivityDays + 365 }),
        (initialScore, daysInactive) => {
          const service = createService(config);
          const scheduler = createScheduler(config);
          const agentId = uniqueAgentId();

          service.initializeProfile(agentId, false);
          setOverallScore(agentId, initialScore);
          setInactiveDaysAgo(agentId, daysInactive);

          const before = db.getReputationProfile(agentId)!;
          const scoreBefore = before.overallScore;

          scheduler.runDecayCycle();

          const after = db.getReputationProfile(agentId)!;
          const expected = Math.max(decayFloor, scoreBefore - decayRate);

          expect(after.overallScore).toBe(expected);
          expect(after.overallScore).toBeGreaterThanOrEqual(decayFloor);
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Req 6.1: Agents at or below decayFloor do not decay further
  // -------------------------------------------------------------------------

  it("agents already at or below decayFloor are not decayed further", () => {
    const config = { ...DEFAULT_REPUTATION_CONFIG };
    const { decayFloor, inactivityDays } = config.decay;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: decayFloor }),
        scoreAtOrBelowFloor => {
          const service = createService(config);
          const scheduler = createScheduler(config);
          const agentId = uniqueAgentId();

          service.initializeProfile(agentId, false);
          setOverallScore(agentId, scoreAtOrBelowFloor);
          setInactiveDaysAgo(agentId, inactivityDays + 30);

          scheduler.runDecayCycle();

          const after = db.getReputationProfile(agentId)!;
          expect(after.overallScore).toBe(scoreAtOrBelowFloor);
        }
      ),
      { numRuns: 50 }
    );
  });

  // -------------------------------------------------------------------------
  // Req 6.1: Active agents (within inactivityDays) are NOT decayed
  // -------------------------------------------------------------------------

  it("agents active within inactivityDays are not decayed", () => {
    const config = { ...DEFAULT_REPUTATION_CONFIG };
    const { inactivityDays } = config.decay;

    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 1000 }),
        // Active within the threshold (0 to inactivityDays - 1 days ago)
        fc.integer({ min: 0, max: inactivityDays - 1 }),
        (initialScore, daysAgo) => {
          const service = createService(config);
          const scheduler = createScheduler(config);
          const agentId = uniqueAgentId();

          service.initializeProfile(agentId, false);
          setOverallScore(agentId, initialScore);
          setInactiveDaysAgo(agentId, daysAgo);

          scheduler.runDecayCycle();

          const after = db.getReputationProfile(agentId)!;
          expect(after.overallScore).toBe(initialScore);
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Req 6.2: Dimension sub-scores remain unchanged after decay
  // -------------------------------------------------------------------------

  it("all dimension sub-scores remain unchanged after decay", () => {
    const config = { ...DEFAULT_REPUTATION_CONFIG };
    const { decayFloor, inactivityDays } = config.decay;

    fc.assert(
      fc.property(
        fc.integer({ min: decayFloor + 1, max: 1000 }),
        // Generate varied dimension scores
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (overallScore, quality, speed, efficiency, collab, reliability) => {
          const service = createService(config);
          const scheduler = createScheduler(config);
          const agentId = uniqueAgentId();

          service.initializeProfile(agentId, false);

          // Set custom dimension scores and overall score
          const profile = db.getReputationProfile(agentId)!;
          profile.overallScore = overallScore;
          profile.dimensions.qualityScore = quality;
          profile.dimensions.speedScore = speed;
          profile.dimensions.efficiencyScore = efficiency;
          profile.dimensions.collaborationScore = collab;
          profile.dimensions.reliabilityScore = reliability;
          profile.lastActiveAt = new Date(
            Date.now() - (inactivityDays + 10) * MS_PER_DAY
          ).toISOString();
          db.upsertReputationProfile(profile);

          scheduler.runDecayCycle();

          const after = db.getReputationProfile(agentId)!;

          // All dimension sub-scores must be unchanged
          expect(after.dimensions.qualityScore).toBe(quality);
          expect(after.dimensions.speedScore).toBe(speed);
          expect(after.dimensions.efficiencyScore).toBe(efficiency);
          expect(after.dimensions.collaborationScore).toBe(collab);
          expect(after.dimensions.reliabilityScore).toBe(reliability);
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Req 6.3: Decay stops immediately when agent becomes active again
  // -------------------------------------------------------------------------

  it("decay stops immediately after agent completes a new task", () => {
    const config = { ...DEFAULT_REPUTATION_CONFIG };
    const { decayFloor, decayRate, inactivityDays } = config.decay;

    fc.assert(
      fc.property(
        fc.integer({ min: decayFloor + decayRate + 1, max: 1000 }),
        initialScore => {
          const service = createService(config);
          const scheduler = createScheduler(config);
          const agentId = uniqueAgentId();

          service.initializeProfile(agentId, false);
          setOverallScore(agentId, initialScore);
          setInactiveDaysAgo(agentId, inactivityDays + 30);

          // First decay cycle — score should drop
          scheduler.runDecayCycle();
          const afterDecay = db.getReputationProfile(agentId)!;
          expect(afterDecay.overallScore).toBe(
            Math.max(decayFloor, initialScore - decayRate)
          );

          // Agent completes a task → becomes active (lastActiveAt updated to now)
          const signal: ReputationSignal = {
            agentId,
            taskId: `reactivate-${agentId}`,
            taskQualityScore: 50,
            actualDurationMs: 1000,
            estimatedDurationMs: 1000,
            tokenConsumed: 1000,
            tokenBudget: 1000,
            wasRolledBack: false,
            downstreamFailures: 0,
            taskComplexity: "medium",
            timestamp: new Date().toISOString(),
          };
          service.handleTaskCompleted(signal);

          const scoreAfterReactivation =
            db.getReputationProfile(agentId)!.overallScore;

          // Second decay cycle — should NOT decay because agent is now active
          scheduler.runDecayCycle();
          const afterSecondCycle = db.getReputationProfile(agentId)!;

          expect(afterSecondCycle.overallScore).toBe(scoreAfterReactivation);
        }
      ),
      { numRuns: 50 }
    );
  });
});
