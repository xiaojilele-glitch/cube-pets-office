/**
 * Property-Based Test: 信誉等级降级事件
 *
 * **Feature: agent-reputation, Property 13: 信誉等级降级事件**
 * **Validates: Requirements 5.4**
 *
 * For any grade transition from high to low (e.g. A→B), the system should generate
 * a REPUTATION_DOWNGRADE event. When downgrading to grade D, an additional
 * AGENT_REPUTATION_CRITICAL alert should be generated.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { TrustTierEvaluator } from "../core/reputation/trust-tier-evaluator.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type { ReputationGrade } from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GRADE_ORDER: Record<ReputationGrade, number> = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
  D: 0,
};

const ALL_GRADES: ReputationGrade[] = ["S", "A", "B", "C", "D"];

function isDowngrade(
  oldGrade: ReputationGrade,
  newGrade: ReputationGrade
): boolean {
  return GRADE_ORDER[newGrade] < GRADE_ORDER[oldGrade];
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const gradeArb = fc.constantFrom<ReputationGrade>(...ALL_GRADES);
const agentIdArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(s => s.trim().length > 0);
const taskIdArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  fc.integer({ min: 1, max: 10000 })
);

/** Generate a pair where oldGrade is strictly higher than newGrade */
const downgradePairArb = fc
  .tuple(gradeArb, gradeArb)
  .filter(([old, nw]) => GRADE_ORDER[nw] < GRADE_ORDER[old]);

/** Generate a pair where newGrade is D and oldGrade is higher */
const downgradeToD_Arb = fc
  .constantFrom<ReputationGrade>("S", "A", "B", "C")
  .map(old => [old, "D" as ReputationGrade] as const);

/** Generate a pair where grade stays same or goes up */
const nonDowngradePairArb = fc
  .tuple(gradeArb, gradeArb)
  .filter(([old, nw]) => GRADE_ORDER[nw] >= GRADE_ORDER[old]);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 13: 信誉等级降级事件", () => {
  const evaluator = new TrustTierEvaluator(DEFAULT_REPUTATION_CONFIG);

  it("any downgrade generates at least one REPUTATION_DOWNGRADE event", () => {
    fc.assert(
      fc.property(
        downgradePairArb,
        agentIdArb,
        taskIdArb,
        ([oldGrade, newGrade], agentId, taskId) => {
          const events = evaluator.evaluateGradeChange(
            oldGrade,
            newGrade,
            agentId,
            taskId
          );
          const downgradeEvents = events.filter(
            e => e.type === "REPUTATION_DOWNGRADE"
          );
          expect(downgradeEvents).toHaveLength(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("downgrade event detail contains agentId, old grade, new grade, and taskId", () => {
    fc.assert(
      fc.property(
        downgradePairArb,
        agentIdArb,
        taskIdArb,
        ([oldGrade, newGrade], agentId, taskId) => {
          const events = evaluator.evaluateGradeChange(
            oldGrade,
            newGrade,
            agentId,
            taskId
          );
          const downgradeEvent = events.find(
            e => e.type === "REPUTATION_DOWNGRADE"
          )!;
          expect(downgradeEvent.detail).toContain(agentId);
          expect(downgradeEvent.detail).toContain(oldGrade);
          expect(downgradeEvent.detail).toContain(newGrade);
          expect(downgradeEvent.detail).toContain(String(taskId));
        }
      ),
      { numRuns: 200 }
    );
  });

  it("downgrade to D generates both REPUTATION_DOWNGRADE and AGENT_REPUTATION_CRITICAL", () => {
    fc.assert(
      fc.property(
        downgradeToD_Arb,
        agentIdArb,
        taskIdArb,
        ([oldGrade, newGrade], agentId, taskId) => {
          const events = evaluator.evaluateGradeChange(
            oldGrade,
            newGrade,
            agentId,
            taskId
          );
          const types = events.map(e => e.type);
          expect(types).toContain("REPUTATION_DOWNGRADE");
          expect(types).toContain("AGENT_REPUTATION_CRITICAL");
          expect(events).toHaveLength(2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("downgrade to non-D grade generates only REPUTATION_DOWNGRADE (no critical alert)", () => {
    const downgradeToNonD = fc
      .tuple(gradeArb, gradeArb)
      .filter(([old, nw]) => GRADE_ORDER[nw] < GRADE_ORDER[old] && nw !== "D");

    fc.assert(
      fc.property(
        downgradeToNonD,
        agentIdArb,
        taskIdArb,
        ([oldGrade, newGrade], agentId, taskId) => {
          const events = evaluator.evaluateGradeChange(
            oldGrade,
            newGrade,
            agentId,
            taskId
          );
          const types = events.map(e => e.type);
          expect(types).toContain("REPUTATION_DOWNGRADE");
          expect(types).not.toContain("AGENT_REPUTATION_CRITICAL");
          expect(events).toHaveLength(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("no events generated when grade stays the same or upgrades", () => {
    fc.assert(
      fc.property(
        nonDowngradePairArb,
        agentIdArb,
        taskIdArb,
        ([oldGrade, newGrade], agentId, taskId) => {
          const events = evaluator.evaluateGradeChange(
            oldGrade,
            newGrade,
            agentId,
            taskId
          );
          expect(events).toHaveLength(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("AGENT_REPUTATION_CRITICAL detail contains agentId and taskId", () => {
    fc.assert(
      fc.property(
        downgradeToD_Arb,
        agentIdArb,
        taskIdArb,
        ([oldGrade, newGrade], agentId, taskId) => {
          const events = evaluator.evaluateGradeChange(
            oldGrade,
            newGrade,
            agentId,
            taskId
          );
          const criticalEvent = events.find(
            e => e.type === "AGENT_REPUTATION_CRITICAL"
          )!;
          expect(criticalEvent.detail).toContain(agentId);
          expect(criticalEvent.detail).toContain(String(taskId));
        }
      ),
      { numRuns: 200 }
    );
  });
});
