/**
 * Property-Based Test: 角色信誉与整体信誉并行更新
 *
 * **Feature: agent-reputation, Property 6: 角色信誉与整体信誉并行更新**
 * **Validates: Requirements 3.2**
 *
 * For any 带有 roleId 的任务完成事件，系统应同时更新对应的
 * RoleReputationRecord 和整体 ReputationProfile，且两者的维度变动值一致。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ReputationService } from "../core/reputation/reputation-service.js";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { TrustTierEvaluator } from "../core/reputation/trust-tier-evaluator.js";
import { AnomalyDetector } from "../core/reputation/anomaly-detector.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  ReputationSignal,
  ReputationConfig,
} from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniqueAgentId(): string {
  return `pbt6-agent-${++counter}-${Date.now()}`;
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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const roleIdArb = fc.constantFrom(
  "coder",
  "reviewer",
  "lead",
  "tester",
  "architect"
);

/**
 * Generate signals WITH a roleId that won't trigger anomaly detection.
 * Use moderate values so cumulative deltas stay under the 200 threshold.
 */
const signalWithRoleArb = (agentId: string): fc.Arbitrary<ReputationSignal> =>
  fc.record({
    agentId: fc.constant(agentId),
    taskId: fc.string({ minLength: 1, maxLength: 12 }).map(s => `task-${s}`),
    roleId: roleIdArb,
    taskQualityScore: fc.integer({ min: 40, max: 60 }),
    actualDurationMs: fc.integer({ min: 800, max: 1200 }),
    estimatedDurationMs: fc.constant(1000),
    tokenConsumed: fc.integer({ min: 800, max: 1200 }),
    tokenBudget: fc.constant(1000),
    wasRolledBack: fc.constant(false),
    downstreamFailures: fc.constant(0),
    collaborationRating: fc.option(fc.integer({ min: 40, max: 60 }), {
      nil: undefined,
    }),
    taskComplexity: fc.constantFrom("medium" as const, "high" as const),
    timestamp: fc.constant(new Date().toISOString()),
  });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 6: 角色信誉与整体信誉并行更新", () => {
  it("handleTaskCompleted with roleId updates both overall profile and role record", () => {
    fc.assert(
      fc.property(signalWithRoleArb("placeholder"), signalTemplate => {
        const service = createService();
        const agentId = uniqueAgentId();
        service.initializeProfile(agentId, false);

        const signal: ReputationSignal = { ...signalTemplate, agentId };

        // Before: no role reputation should exist
        const roleBefore = service.getReputationByRole(agentId, signal.roleId!);
        expect(roleBefore).toBeUndefined();

        // Snapshot before-state (deep copy to avoid mutation via shared reference)
        const initScore = DEFAULT_REPUTATION_CONFIG.internalInitialScore;
        const dimsBefore = { ...service.getReputation(agentId)!.dimensions };

        service.handleTaskCompleted(signal);

        // After: both overall and role should be updated
        const profileAfter = service.getReputation(agentId)!;
        const roleAfter = service.getReputationByRole(agentId, signal.roleId!);

        // Role record must exist after processing a signal with roleId
        expect(roleAfter).toBeDefined();
        expect(roleAfter!.roleId).toBe(signal.roleId);

        // Overall profile must have been updated (totalTasks incremented)
        expect(profileAfter.totalTasks).toBe(1);

        // Role record must have been updated (totalTasksInRole incremented)
        expect(roleAfter!.totalTasksInRole).toBe(1);

        // Since both overall and role started at the same initial score (500),
        // and the same signal is used, the dimension changes should be identical.
        // Compute deltas by comparing after-state with the known initial score.
        const overallQualityDelta =
          profileAfter.dimensions.qualityScore - dimsBefore.qualityScore;
        const overallSpeedDelta =
          profileAfter.dimensions.speedScore - dimsBefore.speedScore;
        const overallEfficiencyDelta =
          profileAfter.dimensions.efficiencyScore - dimsBefore.efficiencyScore;
        const overallCollabDelta =
          profileAfter.dimensions.collaborationScore -
          dimsBefore.collaborationScore;
        const overallReliabilityDelta =
          profileAfter.dimensions.reliabilityScore -
          dimsBefore.reliabilityScore;

        // Role started at same initial score (500 for internal), so role deltas should match
        const roleQualityDelta = roleAfter!.dimensions.qualityScore - initScore;
        const roleSpeedDelta = roleAfter!.dimensions.speedScore - initScore;
        const roleEfficiencyDelta =
          roleAfter!.dimensions.efficiencyScore - initScore;
        const roleCollabDelta =
          roleAfter!.dimensions.collaborationScore - initScore;
        const roleReliabilityDelta =
          roleAfter!.dimensions.reliabilityScore - initScore;

        expect(roleQualityDelta).toBe(overallQualityDelta);
        expect(roleSpeedDelta).toBe(overallSpeedDelta);
        expect(roleEfficiencyDelta).toBe(overallEfficiencyDelta);
        expect(roleCollabDelta).toBe(overallCollabDelta);
        expect(roleReliabilityDelta).toBe(overallReliabilityDelta);
      }),
      { numRuns: 100 }
    );
  });

  it("multiple signals with same roleId accumulate in both overall and role records", () => {
    fc.assert(
      fc.property(
        roleIdArb,
        fc.integer({ min: 2, max: 5 }),
        (roleId, signalCount) => {
          const service = createService();
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          // Send multiple signals with the same roleId
          for (let i = 0; i < signalCount; i++) {
            const signal: ReputationSignal = {
              agentId,
              taskId: `task-${i}`,
              roleId,
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
          }

          const profileAfter = service.getReputation(agentId)!;
          const roleAfter = service.getReputationByRole(agentId, roleId);

          // Both must be updated
          expect(profileAfter.totalTasks).toBe(signalCount);
          expect(roleAfter).toBeDefined();
          expect(roleAfter!.totalTasksInRole).toBe(signalCount);

          // Both overall and role should have been updated from initial values
          expect(profileAfter.overallScore).toBeGreaterThanOrEqual(0);
          expect(profileAfter.overallScore).toBeLessThanOrEqual(1000);
          expect(roleAfter!.overallScore).toBeGreaterThanOrEqual(0);
          expect(roleAfter!.overallScore).toBeLessThanOrEqual(1000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("signal without roleId does NOT create a role record", () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 60 }), qualityScore => {
        const service = createService();
        const agentId = uniqueAgentId();
        service.initializeProfile(agentId, false);

        const signal: ReputationSignal = {
          agentId,
          taskId: "task-no-role",
          // No roleId
          taskQualityScore: qualityScore,
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

        const profileAfter = service.getReputation(agentId)!;
        // Overall should be updated
        expect(profileAfter.totalTasks).toBe(1);
        // No role records should exist
        expect(Object.keys(profileAfter.roleReputation)).toHaveLength(0);
      }),
      { numRuns: 50 }
    );
  });
});
