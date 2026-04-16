import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AdjustmentChange,
  AdjustmentImpact,
  NLExecutionPlan,
} from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import {
  PlanAdjustmentManager,
  type ActualProgress,
} from "../../core/nl-command/plan-adjustment.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_plan_adjustment__/nl-audit.json"
);

const DEFAULT_IMPACT: AdjustmentImpact = {
  timelineImpact: "none",
  costImpact: "none",
  riskImpact: "none",
};

function makePlan(overrides: Partial<NLExecutionPlan> = {}): NLExecutionPlan {
  const now = Date.now();
  return {
    planId: overrides.planId ?? "plan-1",
    commandId: overrides.commandId ?? "cmd-1",
    status: overrides.status ?? "executing",
    missions: overrides.missions ?? [
      {
        missionId: "m-1",
        title: "Mission 1",
        description: "desc",
        objectives: ["obj"],
        constraints: [],
        estimatedDuration: 60,
        estimatedCost: 100,
        priority: "medium",
      },
    ],
    tasks: overrides.tasks ?? [
      {
        taskId: "t-1",
        title: "Task 1",
        description: "desc",
        objectives: ["obj"],
        constraints: [],
        estimatedDuration: 30,
        estimatedCost: 50,
        requiredSkills: ["dev"],
        priority: "medium",
      },
    ],
    timeline: overrides.timeline ?? {
      startDate: new Date(now).toISOString(),
      endDate: new Date(now + 3600_000).toISOString(),
      criticalPath: ["m-1"],
      milestones: [],
      entries: [
        {
          entityId: "m-1",
          entityType: "mission",
          startTime: now - 1800_000,
          endTime: now + 1800_000,
          duration: 60,
          isCriticalPath: true,
        },
        {
          entityId: "t-1",
          entityType: "task",
          startTime: now - 1800_000,
          endTime: now + 1800_000,
          duration: 30,
          isCriticalPath: false,
        },
      ],
    },
    resourceAllocation: overrides.resourceAllocation ?? {
      entries: [],
      totalAgents: 1,
      peakConcurrency: 1,
    },
    riskAssessment: overrides.riskAssessment ?? {
      risks: [],
      overallRiskLevel: "low",
    },
    costBudget: overrides.costBudget ?? {
      totalBudget: 100,
      missionCosts: { "m-1": 100 },
      taskCosts: { "t-1": 50 },
      agentCosts: {},
      modelCosts: {},
      currency: "CNY",
    },
    contingencyPlan: overrides.contingencyPlan ?? {
      alternatives: [],
      degradationStrategies: [],
      rollbackPlan: "",
    },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeChange(
  overrides: Partial<AdjustmentChange> = {}
): AdjustmentChange {
  return {
    entityId: overrides.entityId ?? "t-1",
    entityType: overrides.entityType ?? "task",
    field: overrides.field ?? "estimatedDuration",
    oldValue: overrides.oldValue ?? 30,
    newValue: overrides.newValue ?? 45,
  };
}

describe("PlanAdjustmentManager", () => {
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

  // ─── proposeAdjustment ───

  describe("proposeAdjustment()", () => {
    it("should create a proposed adjustment with correct fields", async () => {
      const changes = [makeChange()];
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "Task delayed",
        changes,
        DEFAULT_IMPACT
      );

      expect(adj.adjustmentId).toBeTruthy();
      expect(adj.planId).toBe("plan-1");
      expect(adj.reason).toBe("Task delayed");
      expect(adj.changes).toHaveLength(1);
      expect(adj.impact).toEqual(DEFAULT_IMPACT);
      expect(adj.approvalRequired).toBe(true);
      expect(adj.status).toBe("proposed");
      expect(adj.createdAt).toBeGreaterThan(0);
    });

    it("should allow approvalRequired=false", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "Minor fix",
        [makeChange()],
        DEFAULT_IMPACT,
        false
      );
      expect(adj.approvalRequired).toBe(false);
    });

    it("should record an audit entry", async () => {
      await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      const entries = await auditTrail.query({
        operationType: "adjustment_proposed",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("plan-1");
    });
  });

  // ─── applyAdjustment ───

  describe("applyAdjustment()", () => {
    it("should apply changes to the plan and update status (no approval required)", async () => {
      const plan = makePlan();
      const prevUpdatedAt = plan.updatedAt;
      const changes: AdjustmentChange[] = [
        {
          entityId: "t-1",
          entityType: "task",
          field: "estimatedDuration",
          oldValue: 30,
          newValue: 60,
        },
      ];

      const adj = await manager.proposeAdjustment(
        "plan-1",
        "extend task",
        changes,
        DEFAULT_IMPACT,
        false
      );

      // Small delay to ensure updatedAt increases
      await new Promise(r => setTimeout(r, 5));

      const applied = await manager.applyAdjustment(adj.adjustmentId, plan);

      expect(applied.status).toBe("applied");
      expect(plan.updatedAt).toBeGreaterThan(prevUpdatedAt);
      expect(plan.tasks[0].estimatedDuration).toBe(60);
    });

    it("should apply mission changes", async () => {
      const plan = makePlan();
      const changes: AdjustmentChange[] = [
        {
          entityId: "m-1",
          entityType: "mission",
          field: "estimatedCost",
          oldValue: 100,
          newValue: 200,
        },
      ];

      const adj = await manager.proposeAdjustment(
        "plan-1",
        "cost increase",
        changes,
        DEFAULT_IMPACT,
        false
      );
      await manager.applyAdjustment(adj.adjustmentId, plan);

      expect(plan.missions[0].estimatedCost).toBe(200);
    });

    it("should require approval when approvalRequired=true", async () => {
      const plan = makePlan();
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT,
        true
      );

      await expect(
        manager.applyAdjustment(adj.adjustmentId, plan)
      ).rejects.toThrow("requires approval");
    });

    it("should apply after approval", async () => {
      const plan = makePlan();
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT,
        true
      );
      manager.approveAdjustment(adj.adjustmentId);

      await new Promise(r => setTimeout(r, 5));
      const applied = await manager.applyAdjustment(adj.adjustmentId, plan);
      expect(applied.status).toBe("applied");
    });

    it("should throw for unknown adjustment", async () => {
      const plan = makePlan();
      await expect(
        manager.applyAdjustment("nonexistent", plan)
      ).rejects.toThrow("not found");
    });

    it("should throw for already applied adjustment", async () => {
      const plan = makePlan();
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT,
        false
      );
      await manager.applyAdjustment(adj.adjustmentId, plan);
      await expect(
        manager.applyAdjustment(adj.adjustmentId, plan)
      ).rejects.toThrow("already applied");
    });

    it("should throw for rejected adjustment", async () => {
      const plan = makePlan();
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT,
        false
      );
      manager.rejectAdjustment(adj.adjustmentId);
      await expect(
        manager.applyAdjustment(adj.adjustmentId, plan)
      ).rejects.toThrow("rejected");
    });

    it("should record an audit entry on apply", async () => {
      const plan = makePlan();
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT,
        false
      );
      await manager.applyAdjustment(adj.adjustmentId, plan);

      const entries = await auditTrail.query({
        operationType: "adjustment_applied",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("plan-1");
    });
  });

  // ─── approveAdjustment / rejectAdjustment ───

  describe("approveAdjustment()", () => {
    it("should transition status to approved", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      const approved = manager.approveAdjustment(adj.adjustmentId);
      expect(approved.status).toBe("approved");
    });

    it("should throw for non-proposed adjustment", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      manager.approveAdjustment(adj.adjustmentId);
      expect(() => manager.approveAdjustment(adj.adjustmentId)).toThrow(
        "Can only approve proposed"
      );
    });

    it("should throw for unknown adjustment", () => {
      expect(() => manager.approveAdjustment("nonexistent")).toThrow(
        "not found"
      );
    });
  });

  describe("rejectAdjustment()", () => {
    it("should transition status to rejected", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      const rejected = manager.rejectAdjustment(adj.adjustmentId);
      expect(rejected.status).toBe("rejected");
    });

    it("should throw for non-proposed adjustment", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      manager.rejectAdjustment(adj.adjustmentId);
      expect(() => manager.rejectAdjustment(adj.adjustmentId)).toThrow(
        "Can only reject proposed"
      );
    });
  });

  // ─── detectDeviation (Property 24) ───

  describe("detectDeviation()", () => {
    it("should flag delayed tasks when actual progress < expected", () => {
      const now = Date.now();
      const plan = makePlan({
        timeline: {
          startDate: new Date(now - 3600_000).toISOString(),
          endDate: new Date(now + 3600_000).toISOString(),
          criticalPath: [],
          milestones: [],
          entries: [
            {
              entityId: "t-1",
              entityType: "task",
              startTime: now - 3600_000,
              endTime: now + 3600_000,
              duration: 120,
              isCriticalPath: false,
            },
          ],
        },
      });

      // Task is at midpoint (50% expected), but only 10% actual
      const progress: ActualProgress = {
        progress: { "t-1": 0.1 },
        costs: {},
      };

      const result = manager.detectDeviation(plan, progress);
      expect(result.delayed).toContain("t-1");
    });

    it("should not flag tasks that are on track", () => {
      const now = Date.now();
      const plan = makePlan({
        timeline: {
          startDate: new Date(now - 3600_000).toISOString(),
          endDate: new Date(now + 3600_000).toISOString(),
          criticalPath: [],
          milestones: [],
          entries: [
            {
              entityId: "t-1",
              entityType: "task",
              startTime: now - 3600_000,
              endTime: now + 3600_000,
              duration: 120,
              isCriticalPath: false,
            },
          ],
        },
      });

      // Task is at midpoint (50% expected), and 60% actual — ahead of schedule
      const progress: ActualProgress = {
        progress: { "t-1": 0.6 },
        costs: {},
      };

      const result = manager.detectDeviation(plan, progress);
      expect(result.delayed).not.toContain("t-1");
    });

    it("should flag tasks past their end time with incomplete progress", () => {
      const now = Date.now();
      const plan = makePlan({
        timeline: {
          startDate: new Date(now - 7200_000).toISOString(),
          endDate: new Date(now - 3600_000).toISOString(),
          criticalPath: [],
          milestones: [],
          entries: [
            {
              entityId: "t-1",
              entityType: "task",
              startTime: now - 7200_000,
              endTime: now - 3600_000,
              duration: 60,
              isCriticalPath: false,
            },
          ],
        },
      });

      const progress: ActualProgress = {
        progress: { "t-1": 0.8 },
        costs: {},
      };

      const result = manager.detectDeviation(plan, progress);
      expect(result.delayed).toContain("t-1");
    });

    it("should not flag tasks that have not started yet", () => {
      const now = Date.now();
      const plan = makePlan({
        timeline: {
          startDate: new Date(now + 3600_000).toISOString(),
          endDate: new Date(now + 7200_000).toISOString(),
          criticalPath: [],
          milestones: [],
          entries: [
            {
              entityId: "t-1",
              entityType: "task",
              startTime: now + 3600_000,
              endTime: now + 7200_000,
              duration: 60,
              isCriticalPath: false,
            },
          ],
        },
      });

      const progress: ActualProgress = {
        progress: { "t-1": 0 },
        costs: {},
      };

      const result = manager.detectDeviation(plan, progress);
      expect(result.delayed).not.toContain("t-1");
    });

    it("should flag cost exceeded when actual cost > budgeted cost", () => {
      const plan = makePlan({
        costBudget: {
          totalBudget: 100,
          missionCosts: { "m-1": 100 },
          taskCosts: { "t-1": 50 },
          agentCosts: {},
          modelCosts: {},
          currency: "CNY",
        },
      });

      const progress: ActualProgress = {
        progress: {},
        costs: { "t-1": 80 },
      };

      const result = manager.detectDeviation(plan, progress);
      expect(result.costExceeded).toContain("t-1");
    });

    it("should not flag cost when within budget", () => {
      const plan = makePlan({
        costBudget: {
          totalBudget: 100,
          missionCosts: { "m-1": 100 },
          taskCosts: { "t-1": 50 },
          agentCosts: {},
          modelCosts: {},
          currency: "CNY",
        },
      });

      const progress: ActualProgress = {
        progress: {},
        costs: { "t-1": 30 },
      };

      const result = manager.detectDeviation(plan, progress);
      expect(result.costExceeded).not.toContain("t-1");
    });
  });

  // ─── getAdjustment / listAdjustments ───

  describe("getAdjustment()", () => {
    it("should return adjustment by ID", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      const fetched = manager.getAdjustment(adj.adjustmentId);
      expect(fetched).toBeDefined();
      expect(fetched!.adjustmentId).toBe(adj.adjustmentId);
    });

    it("should return undefined for unknown ID", () => {
      expect(manager.getAdjustment("nonexistent")).toBeUndefined();
    });

    it("should return a copy (not a reference)", async () => {
      const adj = await manager.proposeAdjustment(
        "plan-1",
        "reason",
        [makeChange()],
        DEFAULT_IMPACT
      );
      const fetched = manager.getAdjustment(adj.adjustmentId)!;
      fetched.reason = "mutated";
      const fetchedAgain = manager.getAdjustment(adj.adjustmentId)!;
      expect(fetchedAgain.reason).toBe("reason");
    });
  });

  describe("listAdjustments()", () => {
    it("should return all adjustments for a plan", async () => {
      await manager.proposeAdjustment(
        "plan-1",
        "reason1",
        [makeChange()],
        DEFAULT_IMPACT
      );
      await manager.proposeAdjustment(
        "plan-1",
        "reason2",
        [makeChange()],
        DEFAULT_IMPACT
      );
      await manager.proposeAdjustment(
        "plan-2",
        "other",
        [makeChange()],
        DEFAULT_IMPACT
      );

      const list = manager.listAdjustments("plan-1");
      expect(list).toHaveLength(2);
      expect(list.every(a => a.planId === "plan-1")).toBe(true);
    });

    it("should return empty array for unknown plan", () => {
      expect(manager.listAdjustments("nonexistent")).toEqual([]);
    });
  });
});
