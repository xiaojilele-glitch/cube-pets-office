import {
  WORKFLOW_STAGES,
  type AgentHandle,
  type FinalWorkflowReportRecord,
  type TaskRecord,
  type WorkflowRuntime,
  type WorkflowStage,
  type WorkflowStatus,
} from "../../shared/workflow-runtime.js";
import type {
  WorkflowOrganizationDepartment,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "../../shared/organization-schema.js";
import { Agent } from "./agent.js";
import { getAIConfig } from "./ai-config.js";
import {
  generateWorkflowOrganization,
  materializeWorkflowOrganization,
  persistOrganizationDebugLog,
} from "./dynamic-organization.js";
import { serverRuntime } from "../runtime/server-runtime.js";
import {
  buildWorkflowDirectiveContext,
  buildWorkflowInputSignature,
  type WorkflowInputAttachment,
} from "../../shared/workflow-input.js";

interface WorkflowStartOptions {
  attachments?: WorkflowInputAttachment[];
  directiveContext?: string;
  inputSignature?: string;
}

export const V3_STAGES = WORKFLOW_STAGES;
export type Stage = WorkflowStage;

interface ManagerPlan {
  plan_summary: string;
  tasks: Array<{
    worker_id: string;
    description: string;
  }>;
}

interface ReviewScore {
  accuracy: number;
  completeness: number;
  actionability: number;
  format: number;
  total: number;
  feedback: string;
}

interface VerifyResult {
  items: Array<{ point: string; addressed: boolean; comment: string }>;
  unaddressed_ratio: number;
  verdict: "pass" | "needs_v3";
}

interface WorkflowIssue {
  stage: Stage;
  scope: "workflow" | "task" | "agent";
  severity: "warning" | "error";
  message: string;
  timestamp: string;
  taskId?: number;
  agentId?: string;
}

function createWorkflowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function bestDeliverable(task: TaskRecord): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || "(no deliverable)";
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  const concurrency = Math.max(1, limit);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await handler(current);
    }
  });

  await Promise.all(workers);
}

export class WorkflowEngine {
  constructor(private readonly runtime: WorkflowRuntime) {}

  protected get repo() {
    return this.runtime.workflowRepo;
  }

  protected emit(event: Parameters<WorkflowRuntime["eventEmitter"]["emit"]>[0]) {
    this.runtime.eventEmitter.emit(event);
  }

  protected isTemporaryLLMError(error: unknown): boolean {
    return this.runtime.llmProvider.isTemporarilyUnavailable?.(error) || false;
  }

  private getWorkflowDirectiveContext(workflowId: string, fallbackDirective: string) {
    const workflow = this.repo.getWorkflow(workflowId);
    const inputContext = workflow?.results?.input?.directiveContext;
    return typeof inputContext === "string" && inputContext.trim()
      ? inputContext
      : fallbackDirective;
  }

  async startWorkflow(
    directive: string,
    options: WorkflowStartOptions = {}
  ): Promise<string> {
    const workflowId = createWorkflowId();
    const attachments = Array.isArray(options.attachments) ? options.attachments : [];
    const directiveContext =
      options.directiveContext ||
      buildWorkflowDirectiveContext(directive, attachments);
    const inputSignature =
      options.inputSignature ||
      buildWorkflowInputSignature(directive, attachments);

    this.repo.createWorkflow(workflowId, directive, []);
    this.repo.updateWorkflow(workflowId, {
      status: "running",
      started_at: new Date().toISOString(),
      results: {
        input: {
          attachments,
          directiveContext,
          signature: inputSignature,
        },
      },
    });

    this.runPipeline(workflowId, directiveContext).catch((error: any) => {
      const workflow = this.repo.getWorkflow(workflowId);
      this.repo.updateWorkflow(workflowId, {
        status: "failed",
        results: {
          ...(workflow?.results || {}),
          last_error: error.message,
          failed_stage: workflow?.current_stage || null,
        },
      });
      this.emit({ type: "workflow_error", workflowId, error: error.message });
    });

    return workflowId;
  }

  private async runPipeline(workflowId: string, directive: string): Promise<void> {
    try {
      const organization = await this.runDirection(workflowId, directive);
      await this.emitStageCompleted(workflowId, "direction");

      await this.runPlanning(workflowId, organization);
      await this.emitStageCompleted(workflowId, "planning");

      await this.runExecution(workflowId, organization);
      await this.emitStageCompleted(workflowId, "execution");

      await this.runReview(workflowId, organization);
      await this.emitStageCompleted(workflowId, "review");

      await this.runMetaAudit(workflowId, organization);
      await this.emitStageCompleted(workflowId, "meta_audit");

      await this.runRevision(workflowId);
      await this.emitStageCompleted(workflowId, "revision");

      await this.runVerify(workflowId);
      await this.emitStageCompleted(workflowId, "verify");

      await this.runSummary(workflowId, organization);
      await this.emitStageCompleted(workflowId, "summary");

      await this.runFeedback(workflowId, organization);
      await this.emitStageCompleted(workflowId, "feedback");

      await this.runEvolution(workflowId);
      await this.emitStageCompleted(workflowId, "evolution");

      let finalStatus = this.getCompletionStatus(workflowId);
      this.repo.updateWorkflow(workflowId, {
        status: finalStatus,
        completed_at: new Date().toISOString(),
      });

      try {
        this.persistFinalReport(workflowId, organization);
      } catch (reportError: any) {
        this.recordWorkflowIssue(workflowId, {
          stage: "summary",
          scope: "workflow",
          severity: "warning",
          message: `Final report persistence failed: ${reportError.message}`,
        });
        finalStatus = "completed_with_errors";
        const workflow = this.repo.getWorkflow(workflowId);
        this.repo.updateWorkflow(workflowId, {
          status: finalStatus,
          results: {
            ...(workflow?.results || {}),
            report_error: reportError.message,
          },
        });
      }

      this.runtime.memoryRepo.materializeWorkflowMemories(workflowId);
      this.emit({
        type: "workflow_complete",
        workflowId,
        status: finalStatus,
        summary:
          finalStatus === "completed_with_errors"
            ? "Workflow completed with recoverable errors"
            : "Workflow completed successfully",
      });
    } catch (error: any) {
      const workflow = this.repo.getWorkflow(workflowId);
      this.repo.updateWorkflow(workflowId, {
        status: "failed",
        results: {
          ...(workflow?.results || {}),
          last_error: error.message,
          failed_stage: workflow?.current_stage || null,
        },
      });
      this.runtime.memoryRepo.materializeWorkflowMemories(workflowId);
      this.emit({ type: "workflow_error", workflowId, error: error.message });
      throw error;
    }
  }

  private emitStage(workflowId: string, stage: Stage): void {
    this.repo.updateWorkflow(workflowId, { current_stage: stage });
    this.emit({ type: "stage_change", workflowId, stage });
  }

  /**
   * Emit a stage_complete event and invoke the optional onStageCompleted callback.
   * Called from runPipeline after each stage finishes successfully.
   */
  private async emitStageCompleted(workflowId: string, completedStage: string): Promise<void> {
    this.emit({ type: "stage_complete", workflowId, stage: completedStage });
    try {
      await this.runtime.onStageCompleted?.(workflowId, completedStage);
    } catch (err) {
      console.warn(
        `[WorkflowEngine] onStageCompleted callback failed for ${workflowId}/${completedStage}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  private recordWorkflowIssue(
    workflowId: string,
    issue: Omit<WorkflowIssue, "timestamp">
  ): void {
    const workflow = this.repo.getWorkflow(workflowId);
    if (!workflow) return;

    const issues = Array.isArray(workflow.results?.workflow_issues)
      ? [...workflow.results.workflow_issues]
      : [];

    issues.push({ ...issue, timestamp: new Date().toISOString() });
    this.repo.updateWorkflow(workflowId, {
      results: {
        ...(workflow.results || {}),
        workflow_issues: issues,
      },
    });
  }

  private hasWorkflowIssues(workflowId: string): boolean {
    const workflow = this.repo.getWorkflow(workflowId);
    return (
      Array.isArray(workflow?.results?.workflow_issues) &&
      workflow.results.workflow_issues.length > 0
    );
  }

  private getCompletionStatus(workflowId: string): WorkflowStatus {
    return this.hasWorkflowIssues(workflowId)
      ? "completed_with_errors"
      : "completed";
  }

  private getOrganization(workflowId: string): WorkflowOrganizationSnapshot {
    const workflow = this.repo.getWorkflow(workflowId);
    const organization = workflow?.results?.organization as WorkflowOrganizationSnapshot | undefined;
    if (!organization?.nodes?.length) {
      throw new Error("Workflow organization is not available.");
    }
    return organization;
  }

  private getNodeMap(organization: WorkflowOrganizationSnapshot) {
    return new Map(organization.nodes.map(node => [node.id, node]));
  }

  private getRootNode(organization: WorkflowOrganizationSnapshot): WorkflowOrganizationNode {
    const root = organization.nodes.find(node => node.id === organization.rootNodeId);
    if (!root) {
      throw new Error("Root organization node not found.");
    }
    return root;
  }

  private getManagerNode(
    organization: WorkflowOrganizationSnapshot,
    department: WorkflowOrganizationDepartment
  ): WorkflowOrganizationNode {
    const node = organization.nodes.find(item => item.id === department.managerNodeId);
    if (!node) {
      throw new Error(`Manager node missing for department ${department.id}.`);
    }
    return node;
  }

  private getWorkersForManager(
    organization: WorkflowOrganizationSnapshot,
    managerNode: WorkflowOrganizationNode
  ): WorkflowOrganizationNode[] {
    return organization.nodes.filter(
      node => node.parentId === managerNode.id && node.role === "worker"
    );
  }

  private getAuditNodes(organization: WorkflowOrganizationSnapshot): WorkflowOrganizationNode[] {
    return organization.nodes.filter(node => node.execution.mode === "audit");
  }

  private getAgent(agentId: string): AgentHandle {
    return this.runtime.agentDirectory.get(agentId) || Agent.fromDB(agentId) || (() => {
      throw new Error(`Agent ${agentId} is not available.`);
    })();
  }

  private applyDefaultReview(task: TaskRecord, feedback: string): void {
    this.repo.updateTask(task.id, {
      score_accuracy: 3,
      score_completeness: 3,
      score_actionability: 3,
      score_format: 3,
      total_score: 12,
      manager_feedback: feedback,
      status: "reviewed",
    });
  }

  private async runDirection(
    workflowId: string,
    directive: string
  ): Promise<WorkflowOrganizationSnapshot> {
    this.emitStage(workflowId, "direction");

    const rootStatusPlaceholder = `wf-${workflowId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase()}-root`;
    this.emit({
      type: "agent_active",
      agentId: rootStatusPlaceholder,
      action: "analyzing",
      workflowId,
    });

    const aiConfig = getAIConfig();
    const { organization, debug } = await generateWorkflowOrganization({
      workflowId,
      directive,
      llmProvider: this.runtime.llmProvider,
      model: aiConfig.model,
    });

    materializeWorkflowOrganization(organization);
    const debugLogPath = persistOrganizationDebugLog(organization, debug);
    const rootNode = this.getRootNode(organization);

    this.repo.updateWorkflow(workflowId, {
      departments_involved: organization.departments.map(item => item.id),
      results: {
        ...(this.repo.getWorkflow(workflowId)?.results || {}),
        organization,
        organization_debug: {
          ...debug,
          logPath: debugLogPath,
        },
      },
    });

    this.emit({
      type: "agent_active",
      agentId: rootNode.agentId,
      action: "analyzing",
      workflowId,
    });

    for (const department of organization.departments) {
      const managerNode = this.getManagerNode(organization, department);
      await this.runtime.messageBus.send(
        rootNode.agentId,
        managerNode.agentId,
        department.direction,
        workflowId,
        "direction",
        {
          departmentLabel: department.label,
          strategy: department.strategy,
          maxConcurrency: department.maxConcurrency,
          skills: managerNode.skills.map(skill => skill.id),
          mcp: managerNode.mcp.map(item => item.id),
        }
      );
    }

    this.emit({
      type: "agent_active",
      agentId: rootNode.agentId,
      action: "idle",
      workflowId,
    });

    return organization;
  }

  private async runPlanning(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): Promise<void> {
    this.emitStage(workflowId, "planning");

    const managers = organization.departments.map(department => ({
      department,
      managerNode: this.getManagerNode(organization, department),
    }));

    await Promise.all(
      managers.map(async ({ department, managerNode }) => {
        const manager = this.getAgent(managerNode.agentId);
        const workers = this.getWorkersForManager(organization, managerNode);
        const inbox = await this.runtime.messageBus.getInbox(managerNode.agentId, workflowId);
        const directionMessage = inbox.find(message => message.stage === "direction");
        if (!directionMessage) return;

        this.emit({
          type: "agent_active",
          agentId: managerNode.agentId,
          action: "planning",
          workflowId,
        });

        const plan = await manager.invokeJson<ManagerPlan>(
          `You are planning work for ${department.label}.

Department direction:
${directionMessage.content}

Execution policy:
- strategy: ${department.strategy}
- max concurrency: ${department.maxConcurrency}

Available workers:
${workers
  .map(
    worker =>
      `- ${worker.agentId}: ${worker.name} / ${worker.title}\n  responsibility: ${worker.responsibility}\n  skills: ${worker.skills.map(skill => skill.name).join(", ")}\n  MCP: ${worker.mcp.map(item => item.name).join(", ")}`
  )
  .join("\n")}

Return valid JSON only:
{
  "plan_summary": "brief department execution plan",
  "tasks": [
    {
      "worker_id": "one of the worker ids above",
      "description": "clear executable task"
    }
  ]
}

Rules:
- Only assign work to listed worker ids.
- Give the smallest set of tasks that still covers the department direction.
- Make each task specific enough that the worker can respond directly.`,
          undefined,
          { workflowId, stage: "planning" }
        );

        for (const task of plan.tasks || []) {
          const workerNode = workers.find(worker => worker.agentId === task.worker_id);
          if (!workerNode) continue;

          const taskRow = this.repo.createTask({
            workflow_id: workflowId,
            worker_id: workerNode.agentId,
            manager_id: managerNode.agentId,
            department: department.id,
            description: task.description,
            deliverable: null,
            deliverable_v2: null,
            deliverable_v3: null,
            score_accuracy: null,
            score_completeness: null,
            score_actionability: null,
            score_format: null,
            total_score: null,
            manager_feedback: null,
            meta_audit_feedback: null,
            verify_result: null,
            version: 1,
            status: "assigned",
          });

          await this.runtime.messageBus.send(
            managerNode.agentId,
            workerNode.agentId,
            task.description,
            workflowId,
            "planning",
            {
              taskId: taskRow.id,
              departmentId: department.id,
              departmentLabel: department.label,
              managerPlan: plan.plan_summary || "",
            }
          );
        }

        this.emit({
          type: "agent_active",
          agentId: managerNode.agentId,
          action: "idle",
          workflowId,
        });
      })
    );
  }

  private async runExecution(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): Promise<void> {
    this.emitStage(workflowId, "execution");

    for (const department of organization.departments) {
      const managerNode = this.getManagerNode(organization, department);
      const departmentTasks = this.repo
        .getTasksByWorkflow(workflowId)
        .filter(task => task.manager_id === managerNode.agentId);

      await runWithConcurrencyLimit(
        departmentTasks,
        department.maxConcurrency,
        async task => {
          const worker = this.getAgent(task.worker_id);
          this.emit({
            type: "agent_active",
            agentId: task.worker_id,
            action: "executing",
            workflowId,
          });
          this.repo.updateTask(task.id, { status: "executing" });
          this.emit({
            type: "task_update",
            workflowId,
            taskId: task.id,
            workerId: task.worker_id,
            status: "executing",
          });

          try {
            const deliverable = await worker.invoke(
              `Complete the following task for the ${department.label} department.

Task:
${task.description}

Requirements:
- Keep the answer concrete and implementation-ready.
- Use your attached skills and MCP context when it helps.
- Prefer actionable steps, decisions, examples, and explicit risks.
- Make the result easy for your manager to review.`,
              undefined,
              { workflowId, stage: "execution" }
            );

            this.repo.updateTask(task.id, {
              deliverable,
              status: "submitted",
            });

            await this.runtime.messageBus.send(
              task.worker_id,
              task.manager_id,
              deliverable,
              workflowId,
              "execution",
              { taskId: task.id }
            );

            this.emit({
              type: "task_update",
              workflowId,
              taskId: task.id,
              workerId: task.worker_id,
              status: "submitted",
            });
          } catch (error: any) {
            this.repo.updateTask(task.id, {
              status: "failed",
              deliverable: `Error: ${error.message}`,
            });
            this.recordWorkflowIssue(workflowId, {
              stage: "execution",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: task.worker_id,
              message: `Worker execution failed: ${error.message}`,
            });
          }

          this.emit({
            type: "agent_active",
            agentId: task.worker_id,
            action: "idle",
            workflowId,
          });
        }
      );
    }
  }

  private async runReview(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): Promise<void> {
    this.emitStage(workflowId, "review");

    const tasksByManager = new Map<string, TaskRecord[]>();
    for (const task of this.repo.getTasksByWorkflow(workflowId)) {
      if (task.status !== "submitted") continue;
      const list = tasksByManager.get(task.manager_id) || [];
      list.push(task);
      tasksByManager.set(task.manager_id, list);
    }

    await Promise.all(
      Array.from(tasksByManager.entries()).map(async ([managerId, tasks]) => {
        const managerNode = organization.nodes.find(node => node.agentId === managerId);
        if (!managerNode) return;
        const manager = this.getAgent(managerId);

        this.emit({
          type: "agent_active",
          agentId: managerId,
          action: "reviewing",
          workflowId,
        });

        let llmOutageMessage: string | null = null;

        for (const task of tasks) {
          if (llmOutageMessage) {
            this.applyDefaultReview(
              task,
              `Review skipped after LLM degradation: ${llmOutageMessage}`
            );
            continue;
          }

          try {
            const score = await manager.invokeJson<ReviewScore>(
              `Review the following deliverable for ${managerNode.departmentLabel}.

Task description:
${task.description}

Deliverable:
${task.deliverable}

Return valid JSON only:
{
  "accuracy": 0,
  "completeness": 0,
  "actionability": 0,
  "format": 0,
  "total": 0,
  "feedback": "specific strengths, issues, and revision advice"
}`,
              undefined,
              { workflowId, stage: "review" }
            );

            const accuracy = Math.min(5, Math.max(0, Math.round(score.accuracy || 0)));
            const completeness = Math.min(
              5,
              Math.max(0, Math.round(score.completeness || 0))
            );
            const actionability = Math.min(
              5,
              Math.max(0, Math.round(score.actionability || 0))
            );
            const format = Math.min(5, Math.max(0, Math.round(score.format || 0)));
            const total = accuracy + completeness + actionability + format;

            this.repo.updateTask(task.id, {
              score_accuracy: accuracy,
              score_completeness: completeness,
              score_actionability: actionability,
              score_format: format,
              total_score: total,
              manager_feedback: score.feedback || "",
              status: "reviewed",
            });

            this.emit({
              type: "score_assigned",
              workflowId,
              taskId: task.id,
              workerId: task.worker_id,
              score: total,
            });

            await this.runtime.messageBus.send(
              managerId,
              task.worker_id,
              `Score: ${total}/20\nFeedback: ${score.feedback}`,
              workflowId,
              "review",
              { taskId: task.id }
            );
          } catch (error: any) {
            this.applyDefaultReview(task, "Review failed, falling back to a default score.");
            this.recordWorkflowIssue(workflowId, {
              stage: "review",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: managerId,
              message: `Review failed: ${error.message}`,
            });
            if (this.isTemporaryLLMError(error)) {
              llmOutageMessage = error.message;
            }
          }
        }

        this.emit({
          type: "agent_active",
          agentId: managerId,
          action: "idle",
          workflowId,
        });
      })
    );
  }

  private async runMetaAudit(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): Promise<void> {
    this.emitStage(workflowId, "meta_audit");

    const tasks = this.repo
      .getTasksByWorkflow(workflowId)
      .filter(task => task.status === "reviewed");
    if (tasks.length === 0) return;

    const taskSummary = tasks
      .map(
        task =>
          `[${task.worker_id}] Task: ${task.description}\nScore: ${
            task.total_score
          }/20\nDeliverable preview: ${bestDeliverable(task).substring(0, 500)}`
      )
      .join("\n\n---\n\n");

    const auditResults: string[] = [];

    for (const auditorNode of this.getAuditNodes(organization)) {
      const auditor = this.getAgent(auditorNode.agentId);
      this.emit({
        type: "agent_active",
        agentId: auditorNode.agentId,
        action: "auditing",
        workflowId,
      });

      try {
        const audit = await auditor.invoke(
          `Audit the following workflow outputs from the perspective of ${auditorNode.title}.

Focus areas:
${auditorNode.summaryFocus.map(item => `- ${item}`).join("\n")}

Task outputs:
${taskSummary}

Return a concise audit with concrete findings and revision guidance.`,
          undefined,
          { workflowId, stage: "meta_audit" }
        );
        auditResults.push(`[${auditorNode.name}]\n${audit}`);
      } catch (error: any) {
        auditResults.push(`[${auditorNode.name}] Analysis failed: ${error.message}`);
        this.recordWorkflowIssue(workflowId, {
          stage: "meta_audit",
          scope: "agent",
          severity: "warning",
          agentId: auditorNode.agentId,
          message: `${auditorNode.name} audit failed: ${error.message}`,
        });
      }

      this.emit({
        type: "agent_active",
        agentId: auditorNode.agentId,
        action: "idle",
        workflowId,
      });
    }

    const auditFeedback = auditResults.join("\n\n");
    for (const task of tasks) {
      this.repo.updateTask(task.id, {
        meta_audit_feedback: auditFeedback,
        status: "audited",
      });
    }
  }

  private async runRevision(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "revision");

    const tasks = this.repo
      .getTasksByWorkflow(workflowId)
      .filter(task => task.status === "audited");
    const needsRevision = tasks.filter(task => (task.total_score || 0) < 16);
    const passed = tasks.filter(task => (task.total_score || 0) >= 16);

    for (const task of passed) {
      this.repo.updateTask(task.id, { status: "passed" });
      this.emit({
        type: "task_update",
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        status: "passed",
      });
    }

    const tasksByWorker = new Map<string, TaskRecord[]>();
    for (const task of needsRevision) {
      const list = tasksByWorker.get(task.worker_id) || [];
      list.push(task);
      tasksByWorker.set(task.worker_id, list);
    }

    await Promise.all(
      Array.from(tasksByWorker.entries()).map(async ([workerId, workerTasks]) => {
        const worker = this.getAgent(workerId);
        let llmOutageMessage: string | null = null;

        for (const task of workerTasks) {
          if (llmOutageMessage) {
            this.repo.updateTask(task.id, { status: "passed" });
            continue;
          }

          this.emit({
            type: "agent_active",
            agentId: workerId,
            action: "revising",
            workflowId,
          });
          this.repo.updateTask(task.id, { status: "revising" });

          try {
            const combinedFeedback = [
              task.manager_feedback ? `Manager feedback: ${task.manager_feedback}` : "",
              task.meta_audit_feedback ? `Meta audit feedback: ${task.meta_audit_feedback}` : "",
            ]
              .filter(Boolean)
              .join("\n\n");

            const revised = await worker.invoke(
              `Revise your previous deliverable based on the feedback below.

Original task:
${task.description}

Your v1 deliverable:
${task.deliverable}

Current score:
${task.total_score}/20

Feedback received:
${combinedFeedback}

Return a complete v2 deliverable that directly fixes the issues.`,
              undefined,
              { workflowId, stage: "revision" }
            );

            this.repo.updateTask(task.id, {
              deliverable_v2: revised,
              version: 2,
              status: "submitted",
            });

            await this.runtime.messageBus.send(
              task.worker_id,
              task.manager_id,
              revised,
              workflowId,
              "revision",
              { taskId: task.id, version: 2 }
            );
          } catch (error: any) {
            this.repo.updateTask(task.id, { status: "passed" });
            this.recordWorkflowIssue(workflowId, {
              stage: "revision",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: task.worker_id,
              message: `Revision failed: ${error.message}`,
            });
            if (this.isTemporaryLLMError(error)) {
              llmOutageMessage = error.message;
            }
          }

          this.emit({
            type: "agent_active",
            agentId: workerId,
            action: "idle",
            workflowId,
          });
        }
      })
    );
  }

  private async runVerify(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "verify");

    const tasks = this.repo
      .getTasksByWorkflow(workflowId)
      .filter(task => task.status === "submitted" && task.version === 2);
    if (tasks.length === 0) return;

    const tasksByManager = new Map<string, TaskRecord[]>();
    for (const task of tasks) {
      const list = tasksByManager.get(task.manager_id) || [];
      list.push(task);
      tasksByManager.set(task.manager_id, list);
    }

    await Promise.all(
      Array.from(tasksByManager.entries()).map(async ([managerId, managerTasks]) => {
        const manager = this.getAgent(managerId);
        let llmOutageMessage: string | null = null;

        for (const task of managerTasks) {
          if (llmOutageMessage) {
            this.repo.updateTask(task.id, { status: "passed" });
            continue;
          }

          this.emit({
            type: "agent_active",
            agentId: managerId,
            action: "verifying",
            workflowId,
          });

          try {
            const result = await manager.invokeJson<VerifyResult>(
              `Check whether the revised deliverable fully addresses the feedback.

Original feedback:
${task.manager_feedback || "(No manager feedback)"}

Revised deliverable:
${task.deliverable_v2}

Return valid JSON only:
{
  "items": [
    {
      "point": "feedback point",
      "addressed": true,
      "comment": "what changed"
    }
  ],
  "unaddressed_ratio": 0.0,
  "verdict": "pass"
}`,
              undefined,
              { workflowId, stage: "verify" }
            );

            this.repo.updateTask(task.id, {
              verify_result: result,
              status:
                result.verdict === "pass" || (result.unaddressed_ratio || 0) <= 0.3
                  ? "passed"
                  : "verified",
            });

            if (
              result.verdict === "needs_v3" &&
              (result.unaddressed_ratio || 0) > 0.3 &&
              !task.deliverable_v3
            ) {
              const worker = this.getAgent(task.worker_id);
              const unresolved = result.items
                .filter(item => !item.addressed)
                .map(item => `- ${item.point}: ${item.comment}`)
                .join("\n");

              const v3 = await worker.invoke(
                `Your v2 deliverable still leaves some feedback unresolved. Continue revising.

Unresolved feedback points:
${unresolved}

Your v2 deliverable:
${task.deliverable_v2}

Return a complete v3 deliverable.`,
                undefined,
                { workflowId, stage: "verify" }
              );

              this.repo.updateTask(task.id, {
                deliverable_v3: v3,
                version: 3,
                status: "passed",
              });
            } else {
              this.repo.updateTask(task.id, { status: "passed" });
            }
          } catch (error: any) {
            this.repo.updateTask(task.id, { status: "passed" });
            this.recordWorkflowIssue(workflowId, {
              stage: "verify",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: managerId,
              message: `Verification failed: ${error.message}`,
            });
            if (this.isTemporaryLLMError(error)) {
              llmOutageMessage = error.message;
            }
          }

          this.emit({
            type: "agent_active",
            agentId: managerId,
            action: "idle",
            workflowId,
          });
        }
      })
    );
  }

  private async runSummary(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): Promise<void> {
    this.emitStage(workflowId, "summary");

    const workflow = this.repo.getWorkflow(workflowId);
    if (!workflow) return;

    const summaries: string[] = [];
    const departmentReports: Array<{
      manager_id: string;
      manager_name: string;
      department: string;
      department_label: string;
      summary: string;
      task_count: number;
      average_score: number | null;
      report_json_path: string;
      report_markdown_path: string;
    }> = [];

    for (const department of organization.departments) {
      const managerNode = this.getManagerNode(organization, department);
      const manager = this.getAgent(managerNode.agentId);
      const departmentTasks = this.repo
        .getTasksByWorkflow(workflowId)
        .filter(task => task.manager_id === managerNode.agentId);

      this.emit({
        type: "agent_active",
        agentId: managerNode.agentId,
        action: "summarizing",
        workflowId,
      });

      try {
        const taskResults = departmentTasks
          .map(
            task =>
              `Worker: ${task.worker_id}\nTask: ${task.description}\nScore: ${task.total_score}/20\nDeliverable:\n${bestDeliverable(task)}`
          )
          .join("\n\n---\n\n");

        const summary = await manager.invoke(
          `Summarize your department's execution results for the root orchestrator.

Department: ${department.label}
Direction: ${department.direction}

Department task results:
${taskResults}

Cover:
1. What the department completed
2. The most important outcomes
3. Open issues or risks
4. Recommended next actions`,
          undefined,
          { workflowId, stage: "summary" }
        );

        await this.runtime.messageBus.send(
          managerNode.agentId,
          organization.rootAgentId,
          summary,
          workflowId,
          "summary"
        );

        const report = this.runtime.reportRepo.buildDepartmentReport(
          workflow,
          {
            id: managerNode.agentId,
            name: managerNode.name,
            department: department.label,
          },
          summary,
          departmentTasks
        );
        const saved = this.runtime.reportRepo.saveDepartmentReport(report);

        summaries.push(`## ${department.label}\n\n${summary}`);
        departmentReports.push({
          manager_id: managerNode.agentId,
          manager_name: managerNode.name,
          department: department.id,
          department_label: department.label,
          summary,
          task_count: departmentTasks.length,
          average_score: report.stats.averageScore,
          report_json_path: saved.jsonPath,
          report_markdown_path: saved.markdownPath,
        });
      } catch (error: any) {
        this.recordWorkflowIssue(workflowId, {
          stage: "summary",
          scope: "agent",
          severity: "warning",
          agentId: managerNode.agentId,
          message: `Department summary failed: ${error.message}`,
        });
      }

      this.emit({
        type: "agent_active",
        agentId: managerNode.agentId,
        action: "idle",
        workflowId,
      });
    }

    this.repo.updateWorkflow(workflowId, {
      results: {
        ...(workflow.results || {}),
        summaries: summaries.join("\n\n"),
        department_reports: departmentReports,
      },
    });
  }

  private async runFeedback(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): Promise<void> {
    this.emitStage(workflowId, "feedback");

    const rootNode = this.getRootNode(organization);
    const rootAgent = this.getAgent(rootNode.agentId);
    const workflow = this.repo.getWorkflow(workflowId);
    const summaryMessages = this.repo
      .getMessagesByWorkflow(workflowId)
      .filter(message => message.stage === "summary" && message.to_agent === rootNode.agentId);
    const summaryText = summaryMessages
      .map(message => `[${message.from_agent}]\n${message.content}`)
      .join("\n\n---\n\n");

    this.emit({
      type: "agent_active",
      agentId: rootNode.agentId,
      action: "evaluating",
      workflowId,
    });

    try {
      const feedback = await rootAgent.invoke(
        `All departments have submitted their summaries. Provide an overall retrospective.

Original user directive:
${this.getWorkflowDirectiveContext(workflowId, workflow?.directive || "")}

Department summaries:
${summaryText}

Cover:
1. Overall judgment
2. Highlights by department
3. Current weaknesses or risks
4. Recommended next actions`,
        undefined,
        { workflowId, stage: "feedback" }
      );

      this.repo.updateWorkflow(workflowId, {
        results: {
          ...(workflow?.results || {}),
          ceo_feedback: feedback,
          executive_feedback: feedback,
        },
      });

      for (const department of organization.departments) {
        const managerNode = this.getManagerNode(organization, department);
        await this.runtime.messageBus.send(
          rootNode.agentId,
          managerNode.agentId,
          feedback,
          workflowId,
          "feedback"
        );
      }
    } catch (error: any) {
      this.recordWorkflowIssue(workflowId, {
        stage: "feedback",
        scope: "agent",
        severity: "warning",
        agentId: rootNode.agentId,
        message: `Root feedback unavailable: ${error.message}`,
      });
    }

    this.emit({
      type: "agent_active",
      agentId: rootNode.agentId,
      action: "idle",
      workflowId,
    });
  }

  private async runEvolution(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "evolution");
    const workflow = this.repo.getWorkflow(workflowId);
    const evolution = this.runtime.evolutionService.evolveWorkflow(workflowId);
    this.repo.updateWorkflow(workflowId, {
      results: {
        ...(workflow?.results || {}),
        evolution,
      },
    });
  }

  private persistFinalReport(
    workflowId: string,
    organization: WorkflowOrganizationSnapshot
  ): void {
    const workflow = this.repo.getWorkflow(workflowId);
    if (!workflow) return;

    const rootNode = this.getRootNode(organization);
    const tasks = this.repo.getTasksByWorkflow(workflowId);
    const messages = this.repo.getMessagesByWorkflow(workflowId);
    const scoredTasks = tasks.filter(task => task.total_score !== null);
    const averageScore =
      scoredTasks.length > 0
        ? scoredTasks.reduce((sum, task) => sum + (task.total_score || 0), 0) /
          scoredTasks.length
        : null;

    const departmentReports = Array.isArray(workflow.results?.department_reports)
      ? workflow.results.department_reports
      : [];

    const keyIssues = tasks
      .filter(task => task.status === "failed" || (task.total_score || 0) < 16)
      .flatMap(task => {
        const items: string[] = [];
        if (task.total_score !== null && task.total_score < 16) {
          items.push(
            `${task.worker_id} scored ${task.total_score}/20 on task ${task.id}: ${task.description}`
          );
        }
        if (task.manager_feedback) {
          items.push(`Manager feedback for task ${task.id}: ${task.manager_feedback}`);
        }
        return items;
      })
      .slice(0, 12);

    const report: FinalWorkflowReportRecord = {
      kind: "final_workflow_report",
      version: 1,
      workflowId,
      generatedAt: new Date().toISOString(),
      workflow: {
        rootAgentId: rootNode.agentId,
        rootAgentName: rootNode.name,
        directive: workflow.directive,
        status: workflow.status,
        currentStage: workflow.current_stage,
        startedAt: workflow.started_at,
        completedAt: workflow.completed_at,
        departmentsInvolved: workflow.departments_involved || [],
      },
      stats: {
        messageCount: messages.length,
        taskCount: tasks.length,
        passedTaskCount: tasks.filter(task => task.status === "passed").length,
        revisedTaskCount: tasks.filter(task => task.version > 1).length,
        averageScore,
      },
      departmentReports: departmentReports.map((item: any) => ({
        managerId: item.manager_id,
        managerName: item.manager_name,
        department: item.department_label || item.department,
        summary: item.summary,
        taskCount: item.task_count,
        averageScore: item.average_score,
        reportJsonPath: item.report_json_path,
        reportMarkdownPath: item.report_markdown_path,
      })),
      ceoFeedback: workflow.results?.ceo_feedback || "",
      keyIssues,
      tasks: tasks.map(task => ({
        id: task.id,
        department: task.department,
        workerId: task.worker_id,
        managerId: task.manager_id,
        status: task.status,
        totalScore: task.total_score,
        description: task.description,
        deliverablePreview: bestDeliverable(task).substring(0, 800),
      })),
    };

    const savedReport = this.runtime.reportRepo.saveFinalWorkflowReport(report);
    this.repo.updateWorkflow(workflowId, {
      results: {
        ...(workflow.results || {}),
        final_report: {
          generated_at: report.generatedAt,
          json_path: savedReport.jsonPath,
          markdown_path: savedReport.markdownPath,
          overview: {
            department_count: report.departmentReports.length,
            task_count: report.stats.taskCount,
            passed_task_count: report.stats.passedTaskCount,
            average_score: report.stats.averageScore,
            message_count: report.stats.messageCount,
          },
        },
      },
    });
  }
}

export const workflowEngine = new WorkflowEngine(serverRuntime);
