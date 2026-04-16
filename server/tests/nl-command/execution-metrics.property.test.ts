// Feature: nl-command-center, Property 21: execution metrics collection and deviation calculation
// **Validates: Requirements 20.1, 20.2**

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  NLExecutionPlan,
  TimelineEntry,
} from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { DecisionSupportEngine } from "../../core/nl-command/decision-support.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_exec_metrics_prop__/nl-audit.json"
);

function cleanup() {
  const dir = dirname(TEST_AUDIT_PATH);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Minimal mock LLM provider (not used by collectExecutionData but required by constructor). */
function makeMockProvider() {
  return {
    name: "mock" as const,
    generate: async () => ({
      content: "{}",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      model: "mock",
      provider: "mock",
    }),
    streamGenerate: async function* () {},
    healthCheck: async () => ({ healthy: true, provider: "mock" }),
  };
}

// --- Generators ---

/** Generate a random timeline entry with constrained start/end times. */
const timelineEntryArb = (index: number): fc.Arbitrary<TimelineEntry> =>
  fc
    .record({
      startTime: fc.integer({ min: 0, max: 10000 }),
      duration: fc.integer({ min: 1, max: 5000 }),
    })
    .map(({ startTime, duration }) => ({
      entityId: `t-${index}`,
      entityType: "task" as const,
      startTime,
      endTime: startTime + duration,
      duration,
      isCriticalPath: false,
    }));

/**
 * Generate a completed NLExecutionPlan with random timeline entries and cost budget.
 * Returns the plan plus the expected metric values for verification.
 */
const planWithExpectedMetricsArb: fc.Arbitrary<{
  plan: NLExecutionPlan;
  expectedPlannedDuration: number;
  expectedPlannedCost: number;
  expectedActualDuration: number;
  expectedActualCost: number;
}> = fc
  .integer({ min: 1, max: 6 })
  .chain(entryCount => {
    const entriesArb = fc.tuple(
      ...Array.from({ length: entryCount }, (_, i) => timelineEntryArb(i))
    );
    return fc.tuple(
      entriesArb,
      fc.double({ min: 1, max: 100000, noNaN: true, noDefaultInfinity: true })
    );
  })
  .map(([entries, totalBudget]) => {
    // Build taskCosts from entries
    const taskCosts: Record<string, number> = {};
    // Distribute random costs per task
    const perTaskCost = totalBudget / entries.length;
    entries.forEach((e, i) => {
      // Vary each task cost slightly so they sum to a known total
      taskCosts[e.entityId] =
        i === entries.length - 1
          ? totalBudget - Object.values(taskCosts).reduce((s, v) => s + v, 0)
          : Math.round(perTaskCost * 100) / 100;
    });

    const actualCost = Object.values(taskCosts).reduce((s, v) => s + v, 0);
    const plannedDuration = entries.reduce((s, e) => s + e.duration, 0);
    const minStart = Math.min(...entries.map(e => e.startTime));
    const maxEnd = Math.max(...entries.map(e => e.endTime));
    const actualDuration = maxEnd - minStart;

    const plan: NLExecutionPlan = {
      planId: "plan-prop",
      commandId: "cmd-prop",
      status: "completed",
      missions: [
        {
          missionId: "m1",
          title: "M1",
          description: "d",
          objectives: ["o"],
          constraints: [],
          estimatedDuration: 60,
          estimatedCost: totalBudget,
          priority: "medium",
        },
      ],
      tasks: entries.map(e => ({
        taskId: e.entityId,
        title: e.entityId,
        description: "d",
        objectives: ["o"],
        constraints: [],
        estimatedDuration: e.duration,
        estimatedCost: taskCosts[e.entityId],
        requiredSkills: ["ts"],
        priority: "medium" as const,
      })),
      timeline: {
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        criticalPath: [],
        milestones: [],
        entries,
      },
      resourceAllocation: { entries: [], totalAgents: 1, peakConcurrency: 1 },
      riskAssessment: { risks: [], overallRiskLevel: "low" },
      costBudget: {
        totalBudget,
        missionCosts: { m1: totalBudget },
        taskCosts,
        agentCosts: {},
        modelCosts: {},
        currency: "USD",
      },
      contingencyPlan: {
        alternatives: [],
        degradationStrategies: [],
        rollbackPlan: "",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return {
      plan,
      expectedPlannedDuration: plannedDuration,
      expectedPlannedCost: totalBudget,
      expectedActualDuration: actualDuration,
      expectedActualCost: actualCost,
    };
  });

/** Generate a plan with zero timeline entries (edge case: division by zero). */
const emptyTimelinePlanArb: fc.Arbitrary<NLExecutionPlan> = fc
  .double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true })
  .map(totalBudget => ({
    planId: "plan-empty",
    commandId: "cmd-empty",
    status: "completed" as const,
    missions: [],
    tasks: [],
    timeline: {
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      criticalPath: [],
      milestones: [],
      entries: [],
    },
    resourceAllocation: { entries: [], totalAgents: 0, peakConcurrency: 0 },
    riskAssessment: { risks: [], overallRiskLevel: "low" as const },
    costBudget: {
      totalBudget,
      missionCosts: {},
      taskCosts: {},
      agentCosts: {},
      modelCosts: {},
      currency: "USD",
    },
    contingencyPlan: {
      alternatives: [],
      degradationStrategies: [],
      rollbackPlan: "",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

// --- Tests ---

describe("Property 21: execution metrics collection and deviation calculation", () => {
  let auditTrail: AuditTrail;
  let engine: DecisionSupportEngine;

  beforeEach(() => {
    cleanup();
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    engine = new DecisionSupportEngine({
      llmProvider: makeMockProvider() as any,
      model: "test",
      auditTrail,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("collected metrics SHALL contain actualDuration, actualCost, plannedDuration, plannedCost", () => {
    fc.assert(
      fc.asyncProperty(planWithExpectedMetricsArb, async ({ plan }) => {
        const metrics = await engine.collectExecutionData(plan);
        expect(metrics.actualDuration).toBeDefined();
        expect(metrics.actualCost).toBeDefined();
        expect(metrics.plannedDuration).toBeDefined();
        expect(metrics.plannedCost).toBeDefined();
        expect(typeof metrics.actualDuration).toBe("number");
        expect(typeof metrics.actualCost).toBe("number");
        expect(typeof metrics.plannedDuration).toBe("number");
        expect(typeof metrics.plannedCost).toBe("number");
        expect(metrics.completedAt).toBeGreaterThan(0);
      }),
      { numRuns: 20 }
    );
  });

  it("durationDeviation SHALL equal (actualDuration - plannedDuration) / plannedDuration", () => {
    fc.assert(
      fc.asyncProperty(
        planWithExpectedMetricsArb,
        async ({ plan, expectedPlannedDuration, expectedActualDuration }) => {
          const metrics = await engine.collectExecutionData(plan);
          const expectedDeviation =
            expectedPlannedDuration === 0
              ? 0
              : (expectedActualDuration - expectedPlannedDuration) /
                expectedPlannedDuration;
          expect(metrics.durationDeviation).toBeCloseTo(expectedDeviation, 8);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("costDeviation SHALL equal (actualCost - plannedCost) / plannedCost", () => {
    fc.assert(
      fc.asyncProperty(
        planWithExpectedMetricsArb,
        async ({ plan, expectedPlannedCost, expectedActualCost }) => {
          const metrics = await engine.collectExecutionData(plan);
          const expectedDeviation =
            expectedPlannedCost === 0
              ? 0
              : (expectedActualCost - expectedPlannedCost) /
                expectedPlannedCost;
          expect(metrics.costDeviation).toBeCloseTo(expectedDeviation, 8);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("zero planned duration/cost SHALL not cause division by zero (deviation = 0)", () => {
    fc.assert(
      fc.asyncProperty(emptyTimelinePlanArb, async plan => {
        const metrics = await engine.collectExecutionData(plan);
        // plannedDuration is 0 (no entries), so durationDeviation must be 0
        expect(metrics.plannedDuration).toBe(0);
        expect(metrics.durationDeviation).toBe(0);
        expect(metrics.actualDuration).toBe(0);
        // plannedCost = totalBudget, actualCost = sum of taskCosts = 0 (empty)
        // costDeviation = (0 - totalBudget) / totalBudget when totalBudget > 0, or 0 when totalBudget = 0
        if (plan.costBudget.totalBudget === 0) {
          expect(metrics.costDeviation).toBe(0);
        } else {
          const expected =
            (0 - plan.costBudget.totalBudget) / plan.costBudget.totalBudget;
          expect(metrics.costDeviation).toBeCloseTo(expected, 8);
        }
      }),
      { numRuns: 20 }
    );
  });
});
