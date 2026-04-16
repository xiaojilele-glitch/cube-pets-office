import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NLExecutionPlan } from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { PlanApproval } from "../../core/nl-command/plan-approval.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_plan_approval__/nl-audit.json"
);

/** Minimal plan fixture for testing. */
function makePlan(overrides: Partial<NLExecutionPlan> = {}): NLExecutionPlan {
  return {
    planId: overrides.planId ?? "plan-1",
    commandId: overrides.commandId ?? "cmd-1",
    status: overrides.status ?? "pending_approval",
    missions: [],
    tasks: [],
    timeline: {
      startDate: "",
      endDate: "",
      criticalPath: [],
      milestones: [],
      entries: [],
    },
    resourceAllocation: { entries: [], totalAgents: 0, peakConcurrency: 0 },
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("PlanApproval", () => {
  let auditTrail: AuditTrail;
  let approval: PlanApproval;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    approval = new PlanApproval({ auditTrail });
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  // ─── createApprovalRequest ───

  describe("createApprovalRequest()", () => {
    it("should create a pending request with default approvers", async () => {
      const req = await approval.createApprovalRequest(makePlan());
      expect(req.requestId).toBeTruthy();
      expect(req.planId).toBe("plan-1");
      expect(req.requiredApprovers).toEqual(["admin"]);
      expect(req.approvals).toEqual([]);
      expect(req.status).toBe("pending");
      expect(req.createdAt).toBeGreaterThan(0);
    });

    it("should accept custom approvers", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      expect(req.requiredApprovers).toEqual(["alice", "bob"]);
    });

    it("should record an audit entry", async () => {
      await approval.createApprovalRequest(makePlan());
      const entries = await auditTrail.query({});
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.some(e => e.entityId === "plan-1")).toBe(true);
    });
  });

  // ─── submitApproval ───

  describe("submitApproval()", () => {
    it("should record an approval decision", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      const updated = await approval.submitApproval(
        req.requestId,
        "alice",
        "approved",
        "LGTM"
      );

      expect(updated.approvals).toHaveLength(1);
      expect(updated.approvals[0].approverId).toBe("alice");
      expect(updated.approvals[0].decision).toBe("approved");
      expect(updated.approvals[0].comments).toBe("LGTM");
    });

    it("should throw for unknown request", async () => {
      await expect(
        approval.submitApproval("nonexistent", "alice", "approved")
      ).rejects.toThrow("Approval request not found");
    });

    it("should throw for non-required approver", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      await expect(
        approval.submitApproval(req.requestId, "bob", "approved")
      ).rejects.toThrow("not a required approver");
    });

    it("should throw for duplicate submission", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      await approval.submitApproval(req.requestId, "alice", "approved");
      await expect(
        approval.submitApproval(req.requestId, "alice", "rejected")
      ).rejects.toThrow("already submitted");
    });
  });

  // ─── Status computation (Property 10) ───

  describe("approval status computation", () => {
    it("should remain pending until all approvers submit", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      const afterAlice = await approval.submitApproval(
        req.requestId,
        "alice",
        "approved"
      );
      expect(afterAlice.status).toBe("pending");
    });

    it("should transition to approved when all approve", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      await approval.submitApproval(req.requestId, "alice", "approved");
      const final = await approval.submitApproval(
        req.requestId,
        "bob",
        "approved"
      );
      expect(final.status).toBe("approved");
    });

    it("should transition to rejected if any approver rejects", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      const afterReject = await approval.submitApproval(
        req.requestId,
        "alice",
        "rejected",
        "Too risky"
      );
      expect(afterReject.status).toBe("rejected");
    });

    it("should transition to revision_requested if any approver requests revision", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      const afterRevision = await approval.submitApproval(
        req.requestId,
        "alice",
        "revision_requested",
        "Needs changes"
      );
      expect(afterRevision.status).toBe("revision_requested");
    });

    it("rejected takes precedence over revision_requested", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
        "charlie",
      ]);
      await approval.submitApproval(
        req.requestId,
        "alice",
        "revision_requested"
      );
      const afterReject = await approval.submitApproval(
        req.requestId,
        "bob",
        "rejected"
      );
      expect(afterReject.status).toBe("rejected");
    });

    it("single approver approved → status approved", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["admin"]);
      const result = await approval.submitApproval(
        req.requestId,
        "admin",
        "approved"
      );
      expect(result.status).toBe("approved");
    });
  });

  // ─── isApprovalComplete ───

  describe("isApprovalComplete()", () => {
    it("should return false for pending request", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      expect(approval.isApprovalComplete(req)).toBe(false);
    });

    it("should return true for approved request", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      const updated = await approval.submitApproval(
        req.requestId,
        "alice",
        "approved"
      );
      expect(approval.isApprovalComplete(updated)).toBe(true);
    });

    it("should return true for rejected request", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      const updated = await approval.submitApproval(
        req.requestId,
        "alice",
        "rejected"
      );
      expect(approval.isApprovalComplete(updated)).toBe(true);
    });

    it("should return true for revision_requested", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      const updated = await approval.submitApproval(
        req.requestId,
        "alice",
        "revision_requested"
      );
      expect(approval.isApprovalComplete(updated)).toBe(true);
    });
  });

  // ─── Audit integration ───

  describe("audit trail integration", () => {
    it("should record audit entries for each approval action", async () => {
      const req = await approval.createApprovalRequest(makePlan(), [
        "alice",
        "bob",
      ]);
      await approval.submitApproval(req.requestId, "alice", "approved");
      await approval.submitApproval(req.requestId, "bob", "approved");

      const entries = await auditTrail.query({ entityId: "plan-1" });
      // 1 for creation + 2 for submissions
      expect(entries.length).toBe(3);
    });

    it("should record approval_completed when status finalizes", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      await approval.submitApproval(req.requestId, "alice", "approved");

      const entries = await auditTrail.query({
        operationType: "approval_completed",
      });
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── getRequest ───

  describe("getRequest()", () => {
    it("should return a copy of the request", async () => {
      const req = await approval.createApprovalRequest(makePlan(), ["alice"]);
      const fetched = approval.getRequest(req.requestId);
      expect(fetched).toBeDefined();
      expect(fetched!.requestId).toBe(req.requestId);
    });

    it("should return undefined for unknown request", () => {
      expect(approval.getRequest("nonexistent")).toBeUndefined();
    });
  });
});
