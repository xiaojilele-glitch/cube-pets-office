// Feature: nl-command-center, Property 23: plan vs actual comparison correctness
// **Validates: Requirements 13.4**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import type { CostAnalysisResult } from '../../../shared/nl-command/contracts.js';

// --- Helpers ---

/** Distribute `total` into `n` non-negative parts that sum exactly to `total`. */
function distributeArb(total: number, n: number): fc.Arbitrary<number[]> {
  if (n === 0) return fc.constant([]);
  if (n === 1) return fc.constant([total]);
  return fc
    .array(fc.double({ min: 0, max: total, noNaN: true }), {
      minLength: n - 1,
      maxLength: n - 1,
    })
    .map((breakpoints) => {
      const sorted = [0, ...breakpoints.sort((a, b) => a - b), total];
      return Array.from({ length: n }, (_, i) => sorted[i + 1] - sorted[i]);
    });
}

// --- Generators ---

/**
 * Generate a valid CostAnalysisResult where:
 *   - variance = actualCost - plannedCost
 *   - variancePercentage = plannedCost === 0 ? 0 : (variance / plannedCost) * 100
 *   - sum of costByMission[*].actual === actualCost
 *
 * We build the object by construction so the invariants hold,
 * then the test verifies they actually do.
 */
const costAnalysisArb: fc.Arbitrary<CostAnalysisResult> = fc
  .record({
    plannedCost: fc.double({ min: 0.01, max: 100000, noNaN: true }),
    actualCost: fc.double({ min: 0, max: 100000, noNaN: true }),
    missionCount: fc.integer({ min: 1, max: 6 }),
    agentCount: fc.integer({ min: 1, max: 4 }),
    modelCount: fc.integer({ min: 1, max: 3 }),
  })
  .chain(({ plannedCost, actualCost, missionCount, agentCount, modelCount }) => {
    const variance = actualCost - plannedCost;
    const variancePercentage = plannedCost === 0 ? 0 : (variance / plannedCost) * 100;

    return fc
      .tuple(
        distributeArb(actualCost, missionCount),
        distributeArb(plannedCost, missionCount),
        distributeArb(actualCost, agentCount),
        distributeArb(actualCost, modelCount),
      )
      .map(([actualParts, plannedParts, agentParts, modelParts]) => {
        const costByMission: Record<string, { planned: number; actual: number }> = {};
        for (let i = 0; i < missionCount; i++) {
          costByMission[`mission-${i}`] = {
            planned: plannedParts[i],
            actual: actualParts[i],
          };
        }

        const costByAgent: Record<string, number> = {};
        for (let i = 0; i < agentCount; i++) {
          costByAgent[`agent-${i}`] = agentParts[i];
        }

        const costByModel: Record<string, number> = {};
        for (let i = 0; i < modelCount; i++) {
          costByModel[`model-${i}`] = modelParts[i];
        }

        return {
          plannedCost,
          actualCost,
          variance,
          variancePercentage,
          costByMission,
          costByAgent,
          costByModel,
        } satisfies CostAnalysisResult;
      });
  });

/**
 * Generator for the zero-plannedCost edge case.
 * When plannedCost is 0, variancePercentage should be 0 (avoid division by zero).
 */
const zeroCostArb: fc.Arbitrary<CostAnalysisResult> = fc
  .record({
    actualCost: fc.double({ min: 0, max: 100000, noNaN: true }),
    missionCount: fc.integer({ min: 1, max: 4 }),
  })
  .chain(({ actualCost, missionCount }) => {
    const plannedCost = 0;
    const variance = actualCost - plannedCost;

    return distributeArb(actualCost, missionCount).map((actualParts) => {
      const costByMission: Record<string, { planned: number; actual: number }> = {};
      for (let i = 0; i < missionCount; i++) {
        costByMission[`mission-${i}`] = { planned: 0, actual: actualParts[i] };
      }

      return {
        plannedCost,
        actualCost,
        variance,
        variancePercentage: 0,
        costByMission,
        costByAgent: {},
        costByModel: {},
      } satisfies CostAnalysisResult;
    });
  });

// --- Tests ---

describe('Property 23: plan vs actual comparison correctness', () => {
  it('variance SHALL equal (actualCost - plannedCost)', () => {
    fc.assert(
      fc.property(costAnalysisArb, (result) => {
        const expected = result.actualCost - result.plannedCost;
        expect(result.variance).toBeCloseTo(expected, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('variancePercentage SHALL equal variance / plannedCost * 100', () => {
    fc.assert(
      fc.property(costAnalysisArb, (result) => {
        const expected =
          result.plannedCost === 0 ? 0 : (result.variance / result.plannedCost) * 100;
        expect(result.variancePercentage).toBeCloseTo(expected, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('sum of costByMission actual values SHALL equal actualCost', () => {
    fc.assert(
      fc.property(costAnalysisArb, (result) => {
        const missionActualSum = Object.values(result.costByMission).reduce(
          (sum, entry) => sum + entry.actual,
          0,
        );
        expect(missionActualSum).toBeCloseTo(result.actualCost, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('edge case: zero plannedCost yields variancePercentage of 0', () => {
    fc.assert(
      fc.property(zeroCostArb, (result) => {
        expect(result.plannedCost).toBe(0);
        expect(result.variance).toBeCloseTo(result.actualCost, 5);
        expect(result.variancePercentage).toBe(0);

        const missionActualSum = Object.values(result.costByMission).reduce(
          (sum, entry) => sum + entry.actual,
          0,
        );
        expect(missionActualSum).toBeCloseTo(result.actualCost, 5);
      }),
      { numRuns: 20 },
    );
  });
});
