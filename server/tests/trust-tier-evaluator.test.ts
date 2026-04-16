import { describe, expect, it } from "vitest";
import { TrustTierEvaluator } from "../core/reputation/trust-tier-evaluator.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  ReputationProfile,
  ReputationGrade,
} from "../../shared/reputation.js";

const evaluator = new TrustTierEvaluator(DEFAULT_REPUTATION_CONFIG);

// ---------------------------------------------------------------------------
// Helper: create a minimal ReputationProfile for external agent tests
// ---------------------------------------------------------------------------
function makeExternalProfile(
  overrides: Partial<ReputationProfile> = {}
): ReputationProfile {
  return {
    agentId: "ext-agent-1",
    overallScore: 400,
    dimensions: {
      qualityScore: 400,
      speedScore: 400,
      efficiencyScore: 400,
      collaborationScore: 400,
      reliabilityScore: 400,
    },
    grade: "C",
    trustTier: "probation",
    isExternal: true,
    totalTasks: 0,
    consecutiveHighQuality: 0,
    roleReputation: {},
    lastActiveAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeGrade
// ---------------------------------------------------------------------------
describe("TrustTierEvaluator.computeGrade", () => {
  it("returns S for scores 900-1000", () => {
    expect(evaluator.computeGrade(900)).toBe("S");
    expect(evaluator.computeGrade(950)).toBe("S");
    expect(evaluator.computeGrade(1000)).toBe("S");
  });

  it("returns A for scores 700-899", () => {
    expect(evaluator.computeGrade(700)).toBe("A");
    expect(evaluator.computeGrade(800)).toBe("A");
    expect(evaluator.computeGrade(899)).toBe("A");
  });

  it("returns B for scores 500-699", () => {
    expect(evaluator.computeGrade(500)).toBe("B");
    expect(evaluator.computeGrade(600)).toBe("B");
    expect(evaluator.computeGrade(699)).toBe("B");
  });

  it("returns C for scores 300-499", () => {
    expect(evaluator.computeGrade(300)).toBe("C");
    expect(evaluator.computeGrade(400)).toBe("C");
    expect(evaluator.computeGrade(499)).toBe("C");
  });

  it("returns D for scores 0-299", () => {
    expect(evaluator.computeGrade(0)).toBe("D");
    expect(evaluator.computeGrade(150)).toBe("D");
    expect(evaluator.computeGrade(299)).toBe("D");
  });
});

// ---------------------------------------------------------------------------
// computeTrustTier
// ---------------------------------------------------------------------------
describe("TrustTierEvaluator.computeTrustTier", () => {
  it("maps S to trusted", () => {
    expect(evaluator.computeTrustTier("S")).toBe("trusted");
  });

  it("maps A to trusted", () => {
    expect(evaluator.computeTrustTier("A")).toBe("trusted");
  });

  it("maps B to standard", () => {
    expect(evaluator.computeTrustTier("B")).toBe("standard");
  });

  it("maps C to probation", () => {
    expect(evaluator.computeTrustTier("C")).toBe("probation");
  });

  it("maps D to probation", () => {
    expect(evaluator.computeTrustTier("D")).toBe("probation");
  });
});

// ---------------------------------------------------------------------------
// evaluateExternalUpgrade
// ---------------------------------------------------------------------------
describe("TrustTierEvaluator.evaluateExternalUpgrade", () => {
  it("returns trusted when totalTasks >= 50 and overallScore >= 700", () => {
    const profile = makeExternalProfile({ totalTasks: 50, overallScore: 700 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("trusted");
  });

  it("returns trusted when exceeding thresholds", () => {
    const profile = makeExternalProfile({ totalTasks: 100, overallScore: 900 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("trusted");
  });

  it("returns standard when totalTasks >= 20 and overallScore >= 500", () => {
    const profile = makeExternalProfile({ totalTasks: 20, overallScore: 500 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("standard");
  });

  it("returns standard when tasks meet trusted count but score does not", () => {
    const profile = makeExternalProfile({ totalTasks: 50, overallScore: 600 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("standard");
  });

  it("returns probation when neither threshold is met", () => {
    const profile = makeExternalProfile({ totalTasks: 10, overallScore: 400 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("probation");
  });

  it("returns probation when tasks meet standard count but score does not", () => {
    const profile = makeExternalProfile({ totalTasks: 25, overallScore: 400 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("probation");
  });

  it("returns probation when score meets standard but tasks do not", () => {
    const profile = makeExternalProfile({ totalTasks: 15, overallScore: 600 });
    expect(evaluator.evaluateExternalUpgrade(profile)).toBe("probation");
  });
});

// ---------------------------------------------------------------------------
// evaluateGradeChange
// ---------------------------------------------------------------------------
describe("TrustTierEvaluator.evaluateGradeChange", () => {
  it("generates REPUTATION_DOWNGRADE event on grade drop", () => {
    const events = evaluator.evaluateGradeChange(
      "A",
      "B",
      "agent-1",
      "task-42"
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("REPUTATION_DOWNGRADE");
    expect(events[0].detail).toContain("agent-1");
    expect(events[0].detail).toContain("A");
    expect(events[0].detail).toContain("B");
  });

  it("generates both DOWNGRADE and CRITICAL events when dropping to D", () => {
    const events = evaluator.evaluateGradeChange(
      "B",
      "D",
      "agent-2",
      "task-99"
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("REPUTATION_DOWNGRADE");
    expect(events[1].type).toBe("AGENT_REPUTATION_CRITICAL");
    expect(events[1].detail).toContain("agent-2");
  });

  it("generates CRITICAL when dropping from C to D", () => {
    const events = evaluator.evaluateGradeChange("C", "D", "agent-3", 100);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("REPUTATION_DOWNGRADE");
    expect(events[1].type).toBe("AGENT_REPUTATION_CRITICAL");
  });

  it("returns empty array when grade stays the same", () => {
    const events = evaluator.evaluateGradeChange("B", "B", "agent-1", "task-1");
    expect(events).toHaveLength(0);
  });

  it("returns empty array when grade improves", () => {
    const events = evaluator.evaluateGradeChange("C", "A", "agent-1", "task-1");
    expect(events).toHaveLength(0);
  });

  it("generates DOWNGRADE but not CRITICAL for S to A drop", () => {
    const events = evaluator.evaluateGradeChange("S", "A", "agent-1", "task-1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("REPUTATION_DOWNGRADE");
  });

  it("includes taskId in event detail", () => {
    const events = evaluator.evaluateGradeChange(
      "A",
      "C",
      "agent-1",
      "task-xyz"
    );
    expect(events[0].detail).toContain("task-xyz");
  });
});
