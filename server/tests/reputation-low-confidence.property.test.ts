/**
 * Property-Based Test: 低置信度标记
 *
 * **Feature: agent-reputation, Property 7: 低置信度标记**
 * **Validates: Requirements 3.3**
 *
 * For any RoleReputationRecord，当 totalTasksInRole < 10 时 lowConfidence 为 true，
 * 当 totalTasksInRole >= 10 时 lowConfidence 为 false。
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
  return `pbt7-agent-${++counter}-${Date.now()}`;
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

function makeSignal(
  agentId: string,
  roleId: string,
  taskIndex: number
): ReputationSignal {
  return {
    agentId,
    taskId: `task-${taskIndex}`,
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
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

const THRESHOLD = DEFAULT_REPUTATION_CONFIG.lowConfidence.taskThreshold; // 10

describe("Property 7: 低置信度标记", () => {
  it("lowConfidence is true when totalTasksInRole < threshold, false when >= threshold", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("coder", "reviewer", "lead", "tester", "architect"),
        fc.integer({ min: 1, max: 20 }),
        (roleId, totalSignals) => {
          const service = createService();
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          for (let i = 0; i < totalSignals; i++) {
            service.handleTaskCompleted(makeSignal(agentId, roleId, i));

            const roleRep = service.getReputationByRole(agentId, roleId);
            expect(roleRep).toBeDefined();
            expect(roleRep!.totalTasksInRole).toBe(i + 1);

            if (i + 1 < THRESHOLD) {
              expect(roleRep!.lowConfidence).toBe(true);
            } else {
              expect(roleRep!.lowConfidence).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("lowConfidence transitions from true to false exactly at the threshold boundary", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("coder", "reviewer", "lead", "tester", "architect"),
        roleId => {
          const service = createService();
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          // Send exactly threshold - 1 signals: should still be lowConfidence
          for (let i = 0; i < THRESHOLD - 1; i++) {
            service.handleTaskCompleted(makeSignal(agentId, roleId, i));
          }

          const beforeThreshold = service.getReputationByRole(agentId, roleId)!;
          expect(beforeThreshold.totalTasksInRole).toBe(THRESHOLD - 1);
          expect(beforeThreshold.lowConfidence).toBe(true);

          // Send one more signal to reach threshold: lowConfidence should flip to false
          service.handleTaskCompleted(
            makeSignal(agentId, roleId, THRESHOLD - 1)
          );

          const atThreshold = service.getReputationByRole(agentId, roleId)!;
          expect(atThreshold.totalTasksInRole).toBe(THRESHOLD);
          expect(atThreshold.lowConfidence).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("lowConfidence remains false once totalTasksInRole exceeds threshold", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("coder", "reviewer", "lead", "tester", "architect"),
        fc.integer({ min: THRESHOLD, max: 25 }),
        (roleId, totalSignals) => {
          const service = createService();
          const agentId = uniqueAgentId();
          service.initializeProfile(agentId, false);

          for (let i = 0; i < totalSignals; i++) {
            service.handleTaskCompleted(makeSignal(agentId, roleId, i));
          }

          const roleRep = service.getReputationByRole(agentId, roleId)!;
          expect(roleRep.totalTasksInRole).toBe(totalSignals);
          expect(roleRep.lowConfidence).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
