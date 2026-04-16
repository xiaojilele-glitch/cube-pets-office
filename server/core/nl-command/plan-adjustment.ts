/**
 * 动态调整器 (Plan Adjustment Manager)
 *
 * 管理 NL 执行计划的动态调整，包括偏差检测、调整提议和应用。
 * 支持审批流程集成和审计链记录。
 *
 * @see Requirements 8.1, 8.2, 8.3, 8.5, 8.6
 */

import { randomUUID } from "node:crypto";

import type {
  AdjustmentChange,
  AdjustmentImpact,
  NLExecutionPlan,
  PlanAdjustment,
} from "../../../shared/nl-command/contracts.js";
import type { AuditTrail } from "./audit-trail.js";

export interface ActualProgress {
  /** entityId → progress ratio 0..1 */
  progress: Record<string, number>;
  /** entityId → actual cost spent so far */
  costs: Record<string, number>;
}

export interface DeviationResult {
  delayed: string[];
  costExceeded: string[];
}

export interface PlanAdjustmentManagerOptions {
  auditTrail: AuditTrail;
}

export class PlanAdjustmentManager {
  private readonly adjustments = new Map<string, PlanAdjustment>();
  private readonly auditTrail: AuditTrail;

  constructor(options: PlanAdjustmentManagerOptions) {
    this.auditTrail = options.auditTrail;
  }

  /**
   * Propose a new adjustment for a plan.
   * @see Requirement 8.1, 8.3
   */
  async proposeAdjustment(
    planId: string,
    reason: string,
    changes: AdjustmentChange[],
    impact: AdjustmentImpact,
    approvalRequired = true
  ): Promise<PlanAdjustment> {
    const adjustment: PlanAdjustment = {
      adjustmentId: randomUUID(),
      planId,
      reason,
      changes,
      impact,
      approvalRequired,
      status: "proposed",
      createdAt: Date.now(),
    };

    this.adjustments.set(adjustment.adjustmentId, adjustment);

    await this.auditTrail.record({
      entryId: randomUUID(),
      operationType: "adjustment_proposed",
      operator: "system",
      content: `Proposed adjustment for plan ${planId}: ${reason}`,
      timestamp: Date.now(),
      result: "success",
      entityId: planId,
      entityType: "plan",
      metadata: {
        adjustmentId: adjustment.adjustmentId,
        changeCount: changes.length,
        approvalRequired,
      },
    });

    return { ...adjustment, changes: [...changes] };
  }

  /**
   * Apply an approved adjustment to a plan, updating the plan in-place.
   *
   * Property 11: After applying, plan.updatedAt must increase and changes must be reflected.
   *
   * @see Requirement 8.5, 8.6
   */
  async applyAdjustment(
    adjustmentId: string,
    plan: NLExecutionPlan
  ): Promise<PlanAdjustment> {
    const adjustment = this.adjustments.get(adjustmentId);
    if (!adjustment) {
      throw new Error(`Adjustment not found: ${adjustmentId}`);
    }

    if (adjustment.status === "applied") {
      throw new Error(`Adjustment already applied: ${adjustmentId}`);
    }

    if (adjustment.status === "rejected") {
      throw new Error(`Cannot apply rejected adjustment: ${adjustmentId}`);
    }

    if (adjustment.approvalRequired && adjustment.status !== "approved") {
      throw new Error(
        `Adjustment requires approval before applying: ${adjustmentId}`
      );
    }

    // Apply each change to the plan
    for (const change of adjustment.changes) {
      this.applyChange(plan, change);
    }

    // Property 11: updatedAt must increase
    plan.updatedAt = Date.now();

    adjustment.status = "applied";

    await this.auditTrail.record({
      entryId: randomUUID(),
      operationType: "adjustment_applied",
      operator: "system",
      content: `Applied adjustment ${adjustmentId} to plan ${adjustment.planId}: ${adjustment.reason}`,
      timestamp: Date.now(),
      result: "success",
      entityId: adjustment.planId,
      entityType: "plan",
      metadata: {
        adjustmentId,
        changeCount: adjustment.changes.length,
        impact: adjustment.impact,
      },
    });

    return { ...adjustment, changes: [...adjustment.changes] };
  }

  /**
   * Approve a proposed adjustment (transitions status to 'approved').
   */
  approveAdjustment(adjustmentId: string): PlanAdjustment {
    const adjustment = this.adjustments.get(adjustmentId);
    if (!adjustment) {
      throw new Error(`Adjustment not found: ${adjustmentId}`);
    }
    if (adjustment.status !== "proposed") {
      throw new Error(
        `Can only approve proposed adjustments, current status: ${adjustment.status}`
      );
    }
    adjustment.status = "approved";
    return { ...adjustment, changes: [...adjustment.changes] };
  }

  /**
   * Reject a proposed adjustment.
   */
  rejectAdjustment(adjustmentId: string): PlanAdjustment {
    const adjustment = this.adjustments.get(adjustmentId);
    if (!adjustment) {
      throw new Error(`Adjustment not found: ${adjustmentId}`);
    }
    if (adjustment.status !== "proposed") {
      throw new Error(
        `Can only reject proposed adjustments, current status: ${adjustment.status}`
      );
    }
    adjustment.status = "rejected";
    return { ...adjustment, changes: [...adjustment.changes] };
  }

  /**
   * Detect deviations between planned and actual progress.
   *
   * Property 24: Flags tasks as delayed if actual progress < expected progress
   * at the current time based on the timeline. Flags cost exceeded if actual
   * cost exceeds the budgeted cost.
   *
   * @see Requirement 8.2
   */
  detectDeviation(
    plan: NLExecutionPlan,
    actualProgress: ActualProgress
  ): DeviationResult {
    const now = Date.now();
    const delayed: string[] = [];
    const costExceeded: string[] = [];

    for (const entry of plan.timeline.entries) {
      const { entityId, startTime, endTime } = entry;

      // Calculate expected progress based on timeline
      let expectedProgress: number;
      if (now >= endTime) {
        expectedProgress = 1;
      } else if (now <= startTime) {
        expectedProgress = 0;
      } else {
        expectedProgress = (now - startTime) / (endTime - startTime);
      }

      const actual = actualProgress.progress[entityId] ?? 0;
      if (actual < expectedProgress) {
        delayed.push(entityId);
      }
    }

    // Check cost deviations against budget
    const allCosts = {
      ...plan.costBudget.missionCosts,
      ...plan.costBudget.taskCosts,
    };
    for (const [entityId, budgetedCost] of Object.entries(allCosts)) {
      const actualCost = actualProgress.costs[entityId] ?? 0;
      if (actualCost > budgetedCost) {
        costExceeded.push(entityId);
      }
    }

    return { delayed, costExceeded };
  }

  /**
   * Get a single adjustment by ID.
   */
  getAdjustment(adjustmentId: string): PlanAdjustment | undefined {
    const adj = this.adjustments.get(adjustmentId);
    return adj ? { ...adj, changes: [...adj.changes] } : undefined;
  }

  /**
   * List all adjustments for a given plan.
   */
  listAdjustments(planId: string): PlanAdjustment[] {
    return Array.from(this.adjustments.values())
      .filter(a => a.planId === planId)
      .map(a => ({ ...a, changes: [...a.changes] }));
  }

  // ─── Private helpers ───

  /**
   * Apply a single AdjustmentChange to the plan.
   */
  private applyChange(plan: NLExecutionPlan, change: AdjustmentChange): void {
    const { entityId, entityType, field, newValue } = change;

    if (entityType === "mission") {
      const mission = plan.missions.find(m => m.missionId === entityId);
      if (mission && field in mission) {
        (mission as unknown as Record<string, unknown>)[field] = newValue;
      }
    } else if (entityType === "task") {
      const task = plan.tasks.find(t => t.taskId === entityId);
      if (task && field in task) {
        (task as unknown as Record<string, unknown>)[field] = newValue;
      }
    } else if (entityType === "timeline") {
      const entry = plan.timeline.entries.find(e => e.entityId === entityId);
      if (entry && field in entry) {
        (entry as unknown as Record<string, unknown>)[field] = newValue;
      }
    } else if (entityType === "resource") {
      const resource = plan.resourceAllocation.entries.find(
        e => e.taskId === entityId
      );
      if (resource && field in resource) {
        (resource as unknown as Record<string, unknown>)[field] = newValue;
      }
    }
  }
}
