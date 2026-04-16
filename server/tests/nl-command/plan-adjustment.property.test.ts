// Feature: nl-command-center, Property 11: plan adjustment update invariant
// **Validates: Requirements 8.5**

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AdjustmentChange,
  AdjustmentImpact,
  DecomposedMission,
  DecomposedTask,
  NLExecutionPlan,
  TimelineEntry,
  ResourceEntry,
} from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { PlanAdjustmentManager } from "../../core/nl-command/plan-adjustment.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_plan_adj_prop__/nl-audit.json"
);

const DEFAULT_IMPACT: AdjustmentImpact = {
  timelineImpact: "minor",
  costImpact: "minor",
  riskImpact: "none",
};

// --- Helpers ---

function makePlan(overrides: {
  missions?: DecomposedMission[];
  tasks?: DecomposedTask[];
  timelineEntries?: TimelineEntry[];
  resourceEntries?: ResourceEntry[];
}): NLExecutionPlan {
  const now = Date.now();
  return {
    planId: "plan-1",
    commandId: "cmd-1",
    status: "executing",
    missions: overrides.missions ?? [],
    tasks: overrides.tasks ?? [],
    timeline: {
      startDate: new Date(now).toISOString(),
      endDate: new Date(now + 3600_000).toISOString(),
      criticalPath: [],
      milestones: [],
      entries: overrides.timelineEntries ?? [],
    },
    resourceAllocation: {
      entries: overrides.resourceEntries ?? [],
      totalAgents: 1,
      peakConcurrency: 1,
    },
    riskAssessment: { risks: [], overallRiskLevel: "low" },
    costBudget: {
      totalBudget: 0,
      missionCosts: {},
      taskCosts: {},
      agentCosts: {},
      modelCosts: {},
      currency: "CNY",
    },
    contingencyPlan: {
      alternatives: [],
      degradationStrategies: [],
      rollbackPlan: "",
    },
    createdAt: now - 10_000,
    updatedAt: now - 5_000, // set in the past so updatedAt increase is testable
  };
}

// --- Generators ---

const missionArb = fc
  .record({
    id: fc.stringMatching(/^m-[0-9]{1,3}$/),
    duration: fc.integer({ min: 1, max: 1000 }),
    cost: fc.integer({ min: 0, max: 100_000 }),
  })
  .map(
    ({ id, duration, cost }): DecomposedMission => ({
      missionId: id,
      title: `Mission ${id}`,
      description: "desc",
      objectives: ["obj"],
      constraints: [],
      estimatedDuration: duration,
      estimatedCost: cost,
      priority: "medium",
    })
  );

const taskArb = fc
  .record({
    id: fc.stringMatching(/^t-[0-9]{1,3}$/),
    duration: fc.integer({ min: 1, max: 1000 }),
    cost: fc.integer({ min: 0, max: 100_000 }),
  })
  .map(
    ({ id, duration, cost }): DecomposedTask => ({
      taskId: id,
      title: `Task ${id}`,
      description: "desc",
      objectives: ["obj"],
      constraints: [],
      estimatedDuration: duration,
      estimatedCost: cost,
      requiredSkills: ["dev"],
      priority: "medium",
    })
  );

/** Generate a mission-level AdjustmentChange targeting estimatedDuration or estimatedCost. */
function missionChangeArb(missionId: string): fc.Arbitrary<AdjustmentChange> {
  return fc
    .record({
      field: fc.constantFrom("estimatedDuration", "estimatedCost"),
      newValue: fc.integer({ min: 1, max: 100_000 }),
    })
    .map(({ field, newValue }) => ({
      entityId: missionId,
      entityType: "mission" as const,
      field,
      oldValue: 0, // placeholder
      newValue,
    }));
}

/** Generate a task-level AdjustmentChange targeting estimatedDuration or estimatedCost. */
function taskChangeArb(taskId: string): fc.Arbitrary<AdjustmentChange> {
  return fc
    .record({
      field: fc.constantFrom("estimatedDuration", "estimatedCost"),
      newValue: fc.integer({ min: 1, max: 100_000 }),
    })
    .map(({ field, newValue }) => ({
      entityId: taskId,
      entityType: "task" as const,
      field,
      oldValue: 0,
      newValue,
    }));
}

// --- Tests ---

describe("Property 11: plan adjustment update invariant", () => {
  let auditTrail: AuditTrail;
  let manager: PlanAdjustmentManager;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    manager = new PlanAdjustmentManager({ auditTrail });
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("updatedAt SHALL be greater than its previous updatedAt after applying an adjustment", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(missionArb, {
          minLength: 1,
          maxLength: 3,
          selector: m => m.missionId,
        }),
        fc.uniqueArray(taskArb, {
          minLength: 1,
          maxLength: 3,
          selector: t => t.taskId,
        }),
        async (missions, tasks) => {
          const plan = makePlan({ missions, tasks });
          const prevUpdatedAt = plan.updatedAt;

          // Pick the first task to change
          const changes: AdjustmentChange[] = [
            {
              entityId: tasks[0].taskId,
              entityType: "task",
              field: "estimatedDuration",
              oldValue: tasks[0].estimatedDuration,
              newValue: tasks[0].estimatedDuration + 10,
            },
          ];

          const adj = await manager.proposeAdjustment(
            plan.planId,
            "schedule adjustment",
            changes,
            DEFAULT_IMPACT,
            false
          );

          await manager.applyAdjustment(adj.adjustmentId, plan);

          expect(plan.updatedAt).toBeGreaterThan(prevUpdatedAt);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("mission changes SHALL be reflected in the updated plan fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(missionArb, {
          minLength: 1,
          maxLength: 3,
          selector: m => m.missionId,
        }),
        async missions => {
          const plan = makePlan({ missions });

          // Generate a change for each mission
          const changes: AdjustmentChange[] = missions.map(m => ({
            entityId: m.missionId,
            entityType: "mission" as const,
            field: "estimatedCost",
            oldValue: m.estimatedCost,
            newValue: m.estimatedCost + 500,
          }));

          const adj = await manager.proposeAdjustment(
            plan.planId,
            "cost revision",
            changes,
            DEFAULT_IMPACT,
            false
          );

          await manager.applyAdjustment(adj.adjustmentId, plan);

          // Verify each change is reflected
          for (const change of changes) {
            const mission = plan.missions.find(
              m => m.missionId === change.entityId
            );
            expect(mission).toBeDefined();
            expect((mission as Record<string, unknown>)[change.field]).toBe(
              change.newValue
            );
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("task changes SHALL be reflected in the updated plan fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(taskArb, {
          minLength: 1,
          maxLength: 3,
          selector: t => t.taskId,
        }),
        async tasks => {
          const plan = makePlan({ tasks });

          const changes: AdjustmentChange[] = tasks.map(t => ({
            entityId: t.taskId,
            entityType: "task" as const,
            field: "estimatedDuration",
            oldValue: t.estimatedDuration,
            newValue: t.estimatedDuration + 20,
          }));

          const adj = await manager.proposeAdjustment(
            plan.planId,
            "duration revision",
            changes,
            DEFAULT_IMPACT,
            false
          );

          await manager.applyAdjustment(adj.adjustmentId, plan);

          for (const change of changes) {
            const task = plan.tasks.find(t => t.taskId === change.entityId);
            expect(task).toBeDefined();
            expect((task as Record<string, unknown>)[change.field]).toBe(
              change.newValue
            );
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("randomly generated changes across entity types SHALL all be reflected after apply", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(missionArb, {
          minLength: 1,
          maxLength: 2,
          selector: m => m.missionId,
        }),
        fc.uniqueArray(taskArb, {
          minLength: 1,
          maxLength: 2,
          selector: t => t.taskId,
        }),
        async (missions, tasks) => {
          const plan = makePlan({ missions, tasks });
          const prevUpdatedAt = plan.updatedAt;

          // Build mixed changes: one per mission + one per task
          const changes: AdjustmentChange[] = [
            ...missions.map(m => ({
              entityId: m.missionId,
              entityType: "mission" as const,
              field: "estimatedDuration" as const,
              oldValue: m.estimatedDuration as unknown,
              newValue: (m.estimatedDuration + 100) as unknown,
            })),
            ...tasks.map(t => ({
              entityId: t.taskId,
              entityType: "task" as const,
              field: "estimatedCost" as const,
              oldValue: t.estimatedCost as unknown,
              newValue: (t.estimatedCost + 200) as unknown,
            })),
          ];

          const adj = await manager.proposeAdjustment(
            plan.planId,
            "mixed adjustment",
            changes,
            DEFAULT_IMPACT,
            false
          );

          await manager.applyAdjustment(adj.adjustmentId, plan);

          // updatedAt invariant
          expect(plan.updatedAt).toBeGreaterThan(prevUpdatedAt);

          // All changes reflected
          for (const change of changes) {
            if (change.entityType === "mission") {
              const m = plan.missions.find(
                x => x.missionId === change.entityId
              );
              expect(m).toBeDefined();
              expect((m as Record<string, unknown>)[change.field]).toBe(
                change.newValue
              );
            } else if (change.entityType === "task") {
              const t = plan.tasks.find(x => x.taskId === change.entityId);
              expect(t).toBeDefined();
              expect((t as Record<string, unknown>)[change.field]).toBe(
                change.newValue
              );
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
