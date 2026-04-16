// Feature: nl-command-center, Property 10: approval workflow completeness
// **Validates: Requirements 7.2, 7.5, 8.4, 11.5, 15.3**

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NLExecutionPlan } from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { PlanApproval } from "../../core/nl-command/plan-approval.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_approval_prop__/nl-audit.json"
);

// --- Helpers ---

function makePlan(planId = "plan-1"): NLExecutionPlan {
  return {
    planId,
    commandId: "cmd-1",
    status: "pending_approval",
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

// --- Generators ---

/** Generate a unique list of approver IDs (1..5 approvers). */
const approversArb = fc
  .uniqueArray(fc.stringMatching(/^[a-z]{3,8}$/), {
    minLength: 1,
    maxLength: 5,
  })
  .filter(arr => arr.length >= 1);

type Decision = "approved" | "rejected" | "revision_requested";
const decisionArb: fc.Arbitrary<Decision> = fc.constantFrom(
  "approved",
  "rejected",
  "revision_requested"
);

// --- Tests ---

describe("Property 10: approval workflow completeness", () => {
  let auditTrail: AuditTrail;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("status SHALL remain pending until all N approvers submit approved decisions", async () => {
    await fc.assert(
      fc.asyncProperty(approversArb, async approvers => {
        const approval = new PlanApproval({ auditTrail });
        const req = await approval.createApprovalRequest(makePlan(), approvers);
        expect(req.status).toBe("pending");

        // Submit approved for all but the last approver
        for (let i = 0; i < approvers.length - 1; i++) {
          const updated = await approval.submitApproval(
            req.requestId,
            approvers[i],
            "approved"
          );
          expect(updated.status).toBe("pending");
        }
      }),
      { numRuns: 20 }
    );
  });

  it("when all N approvers approve, status SHALL transition to approved", async () => {
    await fc.assert(
      fc.asyncProperty(approversArb, async approvers => {
        const approval = new PlanApproval({ auditTrail });
        const req = await approval.createApprovalRequest(makePlan(), approvers);

        let result = req;
        for (const approver of approvers) {
          result = await approval.submitApproval(
            req.requestId,
            approver,
            "approved"
          );
        }

        expect(result.status).toBe("approved");
      }),
      { numRuns: 20 }
    );
  });

  it("if any approver submits rejected, status SHALL transition to rejected", async () => {
    await fc.assert(
      fc.asyncProperty(
        approversArb.filter(a => a.length >= 2),
        fc.nat().map(n => n), // index for the rejector
        async (approvers, rawIdx) => {
          const rejectIdx = rawIdx % approvers.length;
          const approval = new PlanApproval({ auditTrail });
          const req = await approval.createApprovalRequest(
            makePlan(),
            approvers
          );

          let result = req;
          for (let i = 0; i < approvers.length; i++) {
            // Skip approvers after a rejection since duplicate would throw
            if (result.status === "rejected") break;
            const decision: Decision =
              i === rejectIdx ? "rejected" : "approved";
            result = await approval.submitApproval(
              req.requestId,
              approvers[i],
              decision
            );
          }

          expect(result.status).toBe("rejected");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("for any sequence of decisions, final status is consistent with Property 10 rules", async () => {
    await fc.assert(
      fc.asyncProperty(
        approversArb,
        fc.infiniteStream(decisionArb),
        async (approvers, decisionStream) => {
          const decisions: Decision[] = [];
          const iter = decisionStream[Symbol.iterator]();
          for (let i = 0; i < approvers.length; i++) {
            decisions.push(iter.next().value as Decision);
          }

          const approval = new PlanApproval({ auditTrail });
          const req = await approval.createApprovalRequest(
            makePlan(),
            approvers
          );

          let result = req;
          for (let i = 0; i < approvers.length; i++) {
            // Stop submitting if already finalized (rejected/revision_requested)
            if (result.status !== "pending") break;
            result = await approval.submitApproval(
              req.requestId,
              approvers[i],
              decisions[i]
            );
          }

          const submitted = result.approvals;
          const hasRejected = submitted.some(d => d.decision === "rejected");
          const hasRevision = submitted.some(
            d => d.decision === "revision_requested"
          );
          const allApproved = approvers.every(a =>
            submitted.some(d => d.approverId === a && d.decision === "approved")
          );

          if (hasRejected) {
            expect(result.status).toBe("rejected");
          } else if (hasRevision) {
            expect(result.status).toBe("revision_requested");
          } else if (allApproved) {
            expect(result.status).toBe("approved");
          } else {
            expect(result.status).toBe("pending");
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
