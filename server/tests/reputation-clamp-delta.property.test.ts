/**
 * Property-Based Test: 单次更新变动幅度限制
 *
 * **Feature: agent-reputation, Property 4: 单次更新变动幅度限制**
 * **Validates: Requirements 2.4**
 *
 * For any 信誉更新操作，任意维度的单次变动绝对值不超过 maxDeltaPerUpdate。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  DimensionScores,
  DimensionDeltas,
  ReputationSignal,
} from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const scoreArb = fc.integer({ min: 0, max: 1000 });

const dimensionScoresArb: fc.Arbitrary<DimensionScores> = fc.record({
  qualityScore: scoreArb,
  speedScore: scoreArb,
  efficiencyScore: scoreArb,
  collaborationScore: scoreArb,
  reliabilityScore: scoreArb,
});

const signalArb: fc.Arbitrary<ReputationSignal> = fc.record({
  agentId: fc.constant("agent-test"),
  taskId: fc.constant("task-1"),
  roleId: fc.option(fc.string({ minLength: 1, maxLength: 10 }), {
    nil: undefined,
  }),
  taskQualityScore: fc.integer({ min: 0, max: 100 }),
  actualDurationMs: fc.integer({ min: 1, max: 100_000 }),
  estimatedDurationMs: fc.integer({ min: 1, max: 100_000 }),
  tokenConsumed: fc.integer({ min: 0, max: 100_000 }),
  tokenBudget: fc.integer({ min: 1, max: 100_000 }),
  wasRolledBack: fc.boolean(),
  downstreamFailures: fc.integer({ min: 0, max: 10 }),
  collaborationRating: fc.option(fc.integer({ min: 0, max: 100 }), {
    nil: undefined,
  }),
  taskComplexity: fc.option(
    fc.constantFrom("low" as const, "medium" as const, "high" as const),
    { nil: undefined }
  ),
  timestamp: fc.constant(new Date().toISOString()),
});

const streakCountArb = fc.integer({ min: 0, max: 50 });

/** Arbitrary for a positive maxDelta value */
const maxDeltaArb = fc.integer({ min: 1, max: 200 });

/** Arbitrary for unconstrained deltas (can exceed any maxDelta) */
const rawDeltasArb: fc.Arbitrary<DimensionDeltas> = fc.record({
  qualityDelta: fc.double({
    min: -500,
    max: 500,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  speedDelta: fc.double({
    min: -500,
    max: 500,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  efficiencyDelta: fc.double({
    min: -500,
    max: 500,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  collaborationDelta: fc.double({
    min: -500,
    max: 500,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  reliabilityDelta: fc.double({
    min: -500,
    max: 500,
    noNaN: true,
    noDefaultInfinity: true,
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert every delta in a DimensionDeltas is within [-maxDelta, maxDelta] */
function assertAllDeltasClamped(
  deltas: DimensionDeltas,
  maxDelta: number
): void {
  expect(Math.abs(deltas.qualityDelta)).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(deltas.speedDelta)).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(deltas.efficiencyDelta)).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(deltas.collaborationDelta)).toBeLessThanOrEqual(maxDelta);
  expect(Math.abs(deltas.reliabilityDelta)).toBeLessThanOrEqual(maxDelta);
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 4: 单次更新变动幅度限制", () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const calc = new ReputationCalculator(config);

  it("clampDeltas limits every dimension delta to [-maxDelta, maxDelta] for any raw deltas and any maxDelta", () => {
    fc.assert(
      fc.property(rawDeltasArb, maxDeltaArb, (rawDeltas, maxDelta) => {
        const clamped = calc.clampDeltas(rawDeltas, maxDelta);
        assertAllDeltasClamped(clamped, maxDelta);
      }),
      { numRuns: 200 }
    );
  });

  it("clampDeltas with default maxDeltaPerUpdate limits all deltas from computeDimensionDeltas", () => {
    fc.assert(
      fc.property(
        dimensionScoresArb,
        signalArb,
        streakCountArb,
        (dims, signal, streak) => {
          const rawDeltas = calc.computeDimensionDeltas(dims, signal, streak);
          const clamped = calc.clampDeltas(rawDeltas, config.maxDeltaPerUpdate);
          assertAllDeltasClamped(clamped, config.maxDeltaPerUpdate);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("clampDeltas preserves deltas that are already within bounds", () => {
    fc.assert(
      fc.property(maxDeltaArb, maxDelta => {
        // Generate deltas that are strictly within bounds
        const withinBoundsArb: fc.Arbitrary<DimensionDeltas> = fc.record({
          qualityDelta: fc.double({
            min: -maxDelta,
            max: maxDelta,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          speedDelta: fc.double({
            min: -maxDelta,
            max: maxDelta,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          efficiencyDelta: fc.double({
            min: -maxDelta,
            max: maxDelta,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          collaborationDelta: fc.double({
            min: -maxDelta,
            max: maxDelta,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          reliabilityDelta: fc.double({
            min: -maxDelta,
            max: maxDelta,
            noNaN: true,
            noDefaultInfinity: true,
          }),
        });

        fc.assert(
          fc.property(withinBoundsArb, deltas => {
            const clamped = calc.clampDeltas(deltas, maxDelta);
            expect(clamped.qualityDelta).toBe(deltas.qualityDelta);
            expect(clamped.speedDelta).toBe(deltas.speedDelta);
            expect(clamped.efficiencyDelta).toBe(deltas.efficiencyDelta);
            expect(clamped.collaborationDelta).toBe(deltas.collaborationDelta);
            expect(clamped.reliabilityDelta).toBe(deltas.reliabilityDelta);
          }),
          { numRuns: 50 }
        );
      }),
      { numRuns: 10 }
    );
  });

  it("clampDeltas preserves the sign of each delta", () => {
    fc.assert(
      fc.property(rawDeltasArb, maxDeltaArb, (rawDeltas, maxDelta) => {
        const clamped = calc.clampDeltas(rawDeltas, maxDelta);

        const checkSign = (raw: number, result: number) => {
          if (raw > 0) expect(result).toBeGreaterThanOrEqual(0);
          if (raw < 0) expect(result).toBeLessThanOrEqual(0);
          // raw === 0 (including -0): result should also be zero-valued
          if (Object.is(raw, 0) || Object.is(raw, -0))
            expect(result + 0).toBe(0);
        };

        checkSign(rawDeltas.qualityDelta, clamped.qualityDelta);
        checkSign(rawDeltas.speedDelta, clamped.speedDelta);
        checkSign(rawDeltas.efficiencyDelta, clamped.efficiencyDelta);
        checkSign(rawDeltas.collaborationDelta, clamped.collaborationDelta);
        checkSign(rawDeltas.reliabilityDelta, clamped.reliabilityDelta);
      }),
      { numRuns: 200 }
    );
  });
});
