/**
 * 审批管理器 (Plan Approval)
 *
 * 管理 NL 执行计划的审批流程，支持多级审批。
 * 每个审批请求跟踪所有必需审批人的决策，
 * 并根据决策自动计算审批状态。
 *
 * @see Requirements 7.1, 7.2, 7.4, 7.5, 7.6
 */

import { randomUUID } from "node:crypto";

import type {
  ApprovalDecision,
  ApprovalStatus,
  AuditEntry,
  NLExecutionPlan,
  PlanApprovalRequest,
} from "../../../shared/nl-command/contracts.js";
import type { AuditTrail } from "./audit-trail.js";

export interface PlanApprovalOptions {
  auditTrail: AuditTrail;
  /** Default list of required approvers when none specified. */
  defaultApprovers?: string[];
}

export class PlanApproval {
  private readonly requests = new Map<string, PlanApprovalRequest>();
  private readonly auditTrail: AuditTrail;
  private readonly defaultApprovers: string[];

  constructor(options: PlanApprovalOptions) {
    this.auditTrail = options.auditTrail;
    this.defaultApprovers = options.defaultApprovers ?? ["admin"];
  }

  /**
   * 创建审批请求。
   * @see Requirement 7.1, 7.2
   */
  async createApprovalRequest(
    plan: NLExecutionPlan,
    requiredApprovers?: string[]
  ): Promise<PlanApprovalRequest> {
    const now = Date.now();
    const request: PlanApprovalRequest = {
      requestId: randomUUID(),
      planId: plan.planId,
      requiredApprovers: requiredApprovers ?? [...this.defaultApprovers],
      approvals: [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.requests.set(request.requestId, request);

    await this.recordAudit(
      "approval_submitted",
      request.requiredApprovers[0] ?? "system",
      {
        content: `Approval request created for plan ${plan.planId}`,
        entityId: plan.planId,
        entityType: "plan",
        metadata: {
          requestId: request.requestId,
          requiredApprovers: request.requiredApprovers,
        },
      }
    );

    return { ...request };
  }

  /**
   * 提交审批意见。
   * @see Requirement 7.4, 7.5
   */
  async submitApproval(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected" | "revision_requested",
    comments?: string
  ): Promise<PlanApprovalRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    if (!request.requiredApprovers.includes(approverId)) {
      throw new Error(
        `Approver ${approverId} is not a required approver for request ${requestId}`
      );
    }

    // Check for duplicate submission
    if (request.approvals.some(a => a.approverId === approverId)) {
      throw new Error(
        `Approver ${approverId} has already submitted a decision for request ${requestId}`
      );
    }

    const approvalDecision: ApprovalDecision = {
      approverId,
      decision,
      comments,
      timestamp: Date.now(),
    };

    request.approvals.push(approvalDecision);
    request.status = this.computeStatus(request);
    request.updatedAt = Date.now();

    await this.recordAudit(
      request.status === "pending"
        ? "approval_submitted"
        : "approval_completed",
      approverId,
      {
        content: `Approver ${approverId} submitted '${decision}' for plan ${request.planId}`,
        entityId: request.planId,
        entityType: "plan",
        metadata: { requestId, decision, comments },
      }
    );

    return { ...request, approvals: [...request.approvals] };
  }

  /**
   * 检查审批是否完成（状态不再是 pending）。
   * @see Requirement 7.5
   */
  isApprovalComplete(request: PlanApprovalRequest): boolean {
    return request.status !== "pending";
  }

  /**
   * 获取审批请求（用于外部查询）。
   */
  getRequest(requestId: string): PlanApprovalRequest | undefined {
    const req = this.requests.get(requestId);
    return req ? { ...req, approvals: [...req.approvals] } : undefined;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * 根据所有已提交的决策计算审批状态。
   *
   * Property 10 规则：
   * - 任何人 rejected → 'rejected'
   * - 任何人 revision_requested → 'revision_requested'
   * - 全部 approved → 'approved'
   * - 否则 → 'pending'
   */
  private computeStatus(request: PlanApprovalRequest): ApprovalStatus {
    const decisions = request.approvals;

    if (decisions.some(d => d.decision === "rejected")) {
      return "rejected";
    }

    if (decisions.some(d => d.decision === "revision_requested")) {
      return "revision_requested";
    }

    const allApproved =
      request.requiredApprovers.length > 0 &&
      request.requiredApprovers.every(approver =>
        decisions.some(
          d => d.approverId === approver && d.decision === "approved"
        )
      );

    return allApproved ? "approved" : "pending";
  }

  private async recordAudit(
    operationType: AuditEntry["operationType"],
    operator: string,
    details: {
      content: string;
      entityId?: string;
      entityType?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.auditTrail.record({
      entryId: randomUUID(),
      operationType,
      operator,
      content: details.content,
      timestamp: Date.now(),
      result: "success",
      entityId: details.entityId,
      entityType: details.entityType,
      metadata: details.metadata,
    });
  }
}
