// Feature: nl-command-center, Property 8: cost budget summation invariant
// **Validates: Requirements 5.5, 15.5**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import type { CostBudget, DecomposedMission } from '../../../shared/nl-command/contracts.js';

// --- Helpers ---

/** Distribute `total` into `n` non-negative parts that sum exactly to `total`. */
function distributeArb(total: number, n: number): fc.Arbitrary<number[]> {
  if (n === 0) return fc.constant([]);
  if (n === 1) return fc.constant([total]);
  // Generate n-1 random breakpoints in [0, total], sort, then compute diffs
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
 * Generate a valid CostBudget where all summation invariants hold by construction.
 * Strategy:
 *   1. Pick a totalBudget > 0
 *   2. Pick 1-5 missions, distribute totalBudget across missionCosts
 *   3. For each mission, pick 1-4 tasks, distribute that mission's cost across taskCosts
 *   4. Distribute totalBudget across agentCosts (1-4 agents)
 *   5. Distribute totalBudget across modelCosts (1-3 models)
 */
const costBudgetWithMissionsArb: fc.Arbitrary<{
  budget: CostBudget;
  missions: DecomposedMission[];
  missionTaskMap: Record<string, string[]>;
}> = fc
  .record({
    totalBudget: fc.double({ min: 1, max: 100000, noNaN: true }),
    missionCount: fc.integer({ min: 1, max: 5 }),
    agentCount: fc.integer({ min: 1, max: 4 }),
    modelCount: fc.integer({ min: 1, max: 3 }),
    currency: fc.constantFrom('USD', 'EUR', 'CNY'),
  })
  .chain(({ totalBudget, missionCount, agentCount, modelCount, currency }) => {
    const missionIds = Array.from({ length: missionCount }, (_, i) => `mission-${i}`);

    return fc
      .tuple(
        distributeArb(totalBudget, missionCount),
        distributeArb(totalBudget, agentCount),
        distributeArb(totalBudget, modelCount),
        // For each mission, how many tasks (1-4)
        fc.array(fc.integer({ min: 1, max: 4 }), {
          minLength: missionCount,
          maxLength: missionCount,
        }),
      )
      .chain(([missionAmounts, agentAmounts, modelAmounts, taskCounts]) => {
        // Build missionCosts
        const missionCosts: Record<string, number> = {};
        missionIds.forEach((id, i) => {
          missionCosts[id] = missionAmounts[i];
        });

        // Build agentCosts
        const agentCosts: Record<string, number> = {};
        for (let i = 0; i < agentCount; i++) {
          agentCosts[`agent-${i}`] = agentAmounts[i];
        }

        // Build modelCosts
        const modelCosts: Record<string, number> = {};
        for (let i = 0; i < modelCount; i++) {
          modelCosts[`model-${i}`] = modelAmounts[i];
        }

        // For each mission, distribute its cost across tasks
        const taskDistributions = missionIds.map((_, i) =>
          distributeArb(missionAmounts[i], taskCounts[i]),
        );

        return fc.tuple(...taskDistributions).map((distributions) => {
          const taskCostsMap: Record<string, number> = {};
          const missionTaskMap: Record<string, string[]> = {};
          const missions: DecomposedMission[] = [];

          missionIds.forEach((mId, i) => {
            const taskIds: string[] = [];
            distributions[i].forEach((cost: number, j: number) => {
              const taskId = `${mId}-task-${j}`;
              taskIds.push(taskId);
              taskCostsMap[taskId] = cost;
            });
            missionTaskMap[mId] = taskIds;

            missions.push({
              missionId: mId,
              title: `Mission ${i}`,
              description: `Description for mission ${i}`,
              objectives: [`objective-${i}`],
              constraints: [],
              estimatedDuration: 60,
              estimatedCost: missionAmounts[i],
              priority: 'medium',
            });
          });

          const budget: CostBudget = {
            totalBudget,
            missionCosts,
            taskCosts: taskCostsMap,
            agentCosts,
            modelCosts,
            currency,
          };

          return { budget, missions, missionTaskMap };
        });
      });
  });

// --- Tests ---

describe('Property 8: cost budget summation invariant', () => {
  it('sum of all missionCosts SHALL equal totalBudget', () => {
    fc.assert(
      fc.property(costBudgetWithMissionsArb, ({ budget }) => {
        const missionSum = Object.values(budget.missionCosts).reduce((a, b) => a + b, 0);
        expect(missionSum).toBeCloseTo(budget.totalBudget, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('sum of taskCosts for each mission SHALL equal that mission cost', () => {
    fc.assert(
      fc.property(costBudgetWithMissionsArb, ({ budget, missionTaskMap }) => {
        for (const [missionId, taskIds] of Object.entries(missionTaskMap)) {
          const taskSum = taskIds.reduce((sum, tId) => sum + (budget.taskCosts[tId] ?? 0), 0);
          expect(taskSum).toBeCloseTo(budget.missionCosts[missionId], 5);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('sum of agentCosts SHALL equal totalBudget', () => {
    fc.assert(
      fc.property(costBudgetWithMissionsArb, ({ budget }) => {
        const agentSum = Object.values(budget.agentCosts).reduce((a, b) => a + b, 0);
        expect(agentSum).toBeCloseTo(budget.totalBudget, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('sum of modelCosts SHALL equal totalBudget', () => {
    fc.assert(
      fc.property(costBudgetWithMissionsArb, ({ budget }) => {
        const modelSum = Object.values(budget.modelCosts).reduce((a, b) => a + b, 0);
        expect(modelSum).toBeCloseTo(budget.totalBudget, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('all cost values SHALL be non-negative', () => {
    fc.assert(
      fc.property(costBudgetWithMissionsArb, ({ budget }) => {
        expect(budget.totalBudget).toBeGreaterThanOrEqual(0);
        for (const v of Object.values(budget.missionCosts)) expect(v).toBeGreaterThanOrEqual(0);
        for (const v of Object.values(budget.taskCosts)) expect(v).toBeGreaterThanOrEqual(0);
        for (const v of Object.values(budget.agentCosts)) expect(v).toBeGreaterThanOrEqual(0);
        for (const v of Object.values(budget.modelCosts)) expect(v).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 20 },
    );
  });
});
