import { describe, expect, it } from "vitest";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  DimensionScores,
  ReputationSignal,
} from "../../shared/reputation.js";

const calc = new ReputationCalculator(DEFAULT_REPUTATION_CONFIG);

// ---------------------------------------------------------------------------
// ema
// ---------------------------------------------------------------------------
describe("ReputationCalculator.ema", () => {
  it("returns weighted average of current and new value", () => {
    // ema(500, 1000, 0.15) = 500*0.85 + 1000*0.15 = 425 + 150 = 575
    expect(calc.ema(500, 1000, 0.15)).toBeCloseTo(575, 5);
  });

  it("returns current when alpha is 0", () => {
    expect(calc.ema(700, 300, 0)).toBe(700);
  });

  it("returns newValue when alpha is 1", () => {
    expect(calc.ema(700, 300, 1)).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// ratioToScore
// ---------------------------------------------------------------------------
describe("ReputationCalculator.ratioToScore", () => {
  it("returns 1000 when ratio <= 1.0", () => {
    expect(calc.ratioToScore(0.5)).toBe(1000);
    expect(calc.ratioToScore(1.0)).toBe(1000);
  });

  it("returns 0 when ratio >= 2.0", () => {
    expect(calc.ratioToScore(2.0)).toBe(0);
    expect(calc.ratioToScore(3.0)).toBe(0);
  });

  it("linearly interpolates between 1.0 and 2.0", () => {
    expect(calc.ratioToScore(1.5)).toBe(500);
    expect(calc.ratioToScore(1.25)).toBe(750);
    expect(calc.ratioToScore(1.75)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// computeDimensionDeltas
// ---------------------------------------------------------------------------
describe("ReputationCalculator.computeDimensionDeltas", () => {
  const baseDimensions: DimensionScores = {
    qualityScore: 500,
    speedScore: 500,
    efficiencyScore: 500,
    collaborationScore: 500,
    reliabilityScore: 500,
  };

  const baseSignal: ReputationSignal = {
    agentId: "agent-1",
    taskId: "task-1",
    taskQualityScore: 80,
    actualDurationMs: 1000,
    estimatedDurationMs: 1000,
    tokenConsumed: 500,
    tokenBudget: 1000,
    wasRolledBack: false,
    downstreamFailures: 0,
    timestamp: new Date().toISOString(),
  };

  it("computes quality delta using EMA", () => {
    const deltas = calc.computeDimensionDeltas(baseDimensions, baseSignal, 0);
    // EMA(500, 80*10=800, 0.15) = 500*0.85 + 800*0.15 = 425+120 = 545
    // delta = 545 - 500 = 45
    expect(deltas.qualityDelta).toBeCloseTo(45, 5);
  });

  it("computes speed delta using ratioToScore + EMA", () => {
    const deltas = calc.computeDimensionDeltas(baseDimensions, baseSignal, 0);
    // ratio = 1000/1000 = 1.0 → score = 1000
    // EMA(500, 1000, 0.15) = 575 → delta = 75
    expect(deltas.speedDelta).toBeCloseTo(75, 5);
  });

  it("computes efficiency delta using ratioToScore + EMA", () => {
    const deltas = calc.computeDimensionDeltas(baseDimensions, baseSignal, 0);
    // ratio = 500/1000 = 0.5 → score = 1000
    // EMA(500, 1000, 0.15) = 575 → delta = 75
    expect(deltas.efficiencyDelta).toBeCloseTo(75, 5);
  });

  it("returns 0 collaboration delta when no collaborationRating", () => {
    const deltas = calc.computeDimensionDeltas(baseDimensions, baseSignal, 0);
    expect(deltas.collaborationDelta).toBe(0);
  });

  it("computes collaboration delta when collaborationRating exists", () => {
    const signal = { ...baseSignal, collaborationRating: 90 };
    const deltas = calc.computeDimensionDeltas(baseDimensions, signal, 0);
    // EMA(500, 90*10=900, 0.2) = 500*0.8 + 900*0.2 = 400+180 = 580
    // delta = 80
    expect(deltas.collaborationDelta).toBeCloseTo(80, 5);
  });

  it("applies rollback penalty to reliability", () => {
    const signal = { ...baseSignal, wasRolledBack: true };
    const deltas = calc.computeDimensionDeltas(baseDimensions, signal, 0);
    // wasRolledBack → -30, no successRecovery
    expect(deltas.reliabilityDelta).toBe(-30);
  });

  it("applies downstream failure penalty to reliability", () => {
    const signal = { ...baseSignal, downstreamFailures: 2 };
    const deltas = calc.computeDimensionDeltas(baseDimensions, signal, 0);
    // no rollback → +5 successRecovery, 2 downstream → -30
    // total = 5 - 30 = -25
    expect(deltas.reliabilityDelta).toBe(-25);
  });

  it("applies success recovery when task succeeds without rollback", () => {
    const deltas = calc.computeDimensionDeltas(baseDimensions, baseSignal, 0);
    expect(deltas.reliabilityDelta).toBe(5);
  });

  it("uses streak-boosted alpha when streakCount >= threshold", () => {
    const deltas = calc.computeDimensionDeltas(baseDimensions, baseSignal, 10);
    // alpha = 0.15 * 1.5 = 0.225
    // EMA(500, 800, 0.225) = 500*0.775 + 800*0.225 = 387.5+180 = 567.5
    // delta = 67.5
    expect(deltas.qualityDelta).toBeCloseTo(67.5, 5);
  });
});

// ---------------------------------------------------------------------------
// clampDeltas
// ---------------------------------------------------------------------------
describe("ReputationCalculator.clampDeltas", () => {
  it("clamps positive deltas to maxDelta", () => {
    const deltas = {
      qualityDelta: 100,
      speedDelta: 60,
      efficiencyDelta: 50,
      collaborationDelta: 30,
      reliabilityDelta: 10,
    };
    const clamped = calc.clampDeltas(deltas, 50);
    expect(clamped.qualityDelta).toBe(50);
    expect(clamped.speedDelta).toBe(50);
    expect(clamped.efficiencyDelta).toBe(50);
    expect(clamped.collaborationDelta).toBe(30);
    expect(clamped.reliabilityDelta).toBe(10);
  });

  it("clamps negative deltas to -maxDelta", () => {
    const deltas = {
      qualityDelta: -100,
      speedDelta: -60,
      efficiencyDelta: -30,
      collaborationDelta: -50,
      reliabilityDelta: -10,
    };
    const clamped = calc.clampDeltas(deltas, 50);
    expect(clamped.qualityDelta).toBe(-50);
    expect(clamped.speedDelta).toBe(-50);
    expect(clamped.efficiencyDelta).toBe(-30);
    expect(clamped.collaborationDelta).toBe(-50);
    expect(clamped.reliabilityDelta).toBe(-10);
  });
});

// ---------------------------------------------------------------------------
// computeOverallScore
// ---------------------------------------------------------------------------
describe("ReputationCalculator.computeOverallScore", () => {
  it("computes weighted sum with default weights", () => {
    const dims: DimensionScores = {
      qualityScore: 800,
      speedScore: 600,
      efficiencyScore: 700,
      collaborationScore: 500,
      reliabilityScore: 900,
    };
    // 800*0.30 + 600*0.15 + 700*0.20 + 500*0.15 + 900*0.20
    // = 240 + 90 + 140 + 75 + 180 = 725
    expect(calc.computeOverallScore(dims)).toBe(725);
  });

  it("clamps result to 0 minimum", () => {
    const dims: DimensionScores = {
      qualityScore: 0,
      speedScore: 0,
      efficiencyScore: 0,
      collaborationScore: 0,
      reliabilityScore: 0,
    };
    expect(calc.computeOverallScore(dims)).toBe(0);
  });

  it("clamps result to 1000 maximum", () => {
    const dims: DimensionScores = {
      qualityScore: 1000,
      speedScore: 1000,
      efficiencyScore: 1000,
      collaborationScore: 1000,
      reliabilityScore: 1000,
    };
    expect(calc.computeOverallScore(dims)).toBe(1000);
  });

  it("accepts custom weights", () => {
    const dims: DimensionScores = {
      qualityScore: 1000,
      speedScore: 0,
      efficiencyScore: 0,
      collaborationScore: 0,
      reliabilityScore: 0,
    };
    const weights = {
      quality: 1.0,
      speed: 0,
      efficiency: 0,
      collaboration: 0,
      reliability: 0,
    };
    expect(calc.computeOverallScore(dims, weights)).toBe(1000);
  });

  it("rounds to nearest integer", () => {
    const dims: DimensionScores = {
      qualityScore: 501,
      speedScore: 501,
      efficiencyScore: 501,
      collaborationScore: 501,
      reliabilityScore: 501,
    };
    // 501 * (0.30+0.15+0.20+0.15+0.20) = 501 * 1.0 = 501
    expect(calc.computeOverallScore(dims)).toBe(501);
  });
});
