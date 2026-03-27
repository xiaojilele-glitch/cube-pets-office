import type {
  FinalWorkflowReportRecord,
  TaskRecord,
  WorkflowRuntime,
  WorkflowStage,
  WorkflowStatus,
} from "./workflow-runtime.js";
import { WORKFLOW_STAGES } from "./workflow-runtime.js";

export const V3_STAGES = WORKFLOW_STAGES;
export type Stage = WorkflowStage;

interface CEOAnalysis {
  analysis: string;
  departments: Array<{
    id: string;
    managerId: string;
    direction: string;
  }>;
}

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
  return (
    task.deliverable_v3 ||
    task.deliverable_v2 ||
    task.deliverable ||
    "(no deliverable)"
  );
}

export class WorkflowKernel {
  constructor(protected readonly runtime: WorkflowRuntime) {}

  protected get repo() {
    return this.runtime.workflowRepo;
  }

  protected emit(event: Parameters<WorkflowRuntime["eventEmitter"]["emit"]>[0]) {
    this.runtime.eventEmitter.emit(event);
  }

  protected isTemporaryLLMError(error: unknown): boolean {
    return this.runtime.llmProvider.isTemporarilyUnavailable?.(error) || false;
  }

  async startWorkflow(directive: string): Promise<string> {
    const workflowId = createWorkflowId();

    this.repo.createWorkflow(workflowId, directive, []);
    this.repo.updateWorkflow(workflowId, {
      status: "running",
      started_at: new Date().toISOString(),
    });

    this.runPipeline(workflowId, directive).catch((err: any) => {
      const workflow = this.repo.getWorkflow(workflowId);
      this.repo.updateWorkflow(workflowId, {
        status: "failed",
        results: {
          ...(workflow?.results || {}),
          last_error: err.message,
          failed_stage: workflow?.current_stage || null,
        },
      });
      this.emit({ type: "workflow_error", workflowId, error: err.message });
    });

    return workflowId;
  }

  private async runPipeline(workflowId: string, directive: string): Promise<void> {
    try {
      await this.runDirection(workflowId, directive);
      await this.runPlanning(workflowId);
      await this.runExecution(workflowId);
      await this.runReview(workflowId);
      await this.runMetaAudit(workflowId);
      await this.runRevision(workflowId);
      await this.runVerify(workflowId);
      await this.runSummary(workflowId);
      await this.runFeedback(workflowId);
      await this.runEvolution(workflowId);

      let finalStatus = this.getCompletionStatus(workflowId);
      this.repo.updateWorkflow(workflowId, {
        status: finalStatus,
        completed_at: new Date().toISOString(),
      });

      try {
        this.persistFinalReport(workflowId);
      } catch (reportErr: any) {
        this.recordWorkflowIssue(workflowId, {
          stage: "summary",
          scope: "workflow",
          severity: "warning",
          message: `Final report persistence failed: ${reportErr.message}`,
        });
        finalStatus = "completed_with_errors";
        const workflow = this.repo.getWorkflow(workflowId);
        this.repo.updateWorkflow(workflowId, {
          status: finalStatus,
          results: {
            ...(workflow?.results || {}),
            report_error: reportErr.message,
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
    } catch (err: any) {
      const workflow = this.repo.getWorkflow(workflowId);
      this.repo.updateWorkflow(workflowId, {
        status: "failed",
        results: {
          ...(workflow?.results || {}),
          last_error: err.message,
          failed_stage: workflow?.current_stage || null,
        },
      });
      this.runtime.memoryRepo.materializeWorkflowMemories(workflowId);
      this.emit({ type: "workflow_error", workflowId, error: err.message });
      throw err;
    }
  }

  private emitStage(workflowId: string, stage: Stage): void {
    this.repo.updateWorkflow(workflowId, { current_stage: stage });
    this.emit({ type: "stage_change", workflowId, stage });
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

    issues.push({
      ...issue,
      timestamp: new Date().toISOString(),
    });

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

  private async runDirection(workflowId: string, directive: string): Promise<void> {
    this.emitStage(workflowId, "direction");

    const ceo = this.runtime.agentDirectory.getCEO();
    if (!ceo) throw new Error("CEO agent not found");

    this.emit({
      type: "agent_active",
      agentId: "ceo",
      action: "analyzing",
      workflowId,
    });

    const analysis = await ceo.invokeJson<CEOAnalysis>(
      `Analyze the user directive and decide which departments should participate.

Available departments:
- game managed by pixel, responsible for gameplay, systems, and player experience
- ai managed by nexus, responsible for models, data, and AI implementation
- life managed by echo, responsible for content, community, and user communication

Requirements:
- choose only the departments that are truly needed
- provide one clear direction for each selected department
- return valid JSON only

User directive:
${directive}

Return:
{
  "analysis": "high-level understanding",
  "departments": [
    {
      "id": "game|ai|life",
      "managerId": "pixel|nexus|echo",
      "direction": "clear department direction"
    }
  ]
}`,
      undefined,
      { workflowId, stage: "direction" }
    );

    const departments = Array.isArray(analysis.departments)
      ? analysis.departments
      : [];
    this.repo.updateWorkflow(workflowId, {
      departments_involved: departments.map(item => item.id),
    });

    for (const department of departments) {
      await this.runtime.messageBus.send(
        "ceo",
        department.managerId,
        department.direction,
        workflowId,
        "direction",
        { analysis: analysis.analysis }
      );
    }

    this.emit({
      type: "agent_active",
      agentId: "ceo",
      action: "idle",
      workflowId,
    });
  }

  private async runPlanning(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "planning");

    const workflow = this.repo.getWorkflow(workflowId);
    if (!workflow) throw new Error("Workflow not found");

    await Promise.all(
      (workflow.departments_involved || []).map(async deptId => {
        const manager = this.runtime.agentDirectory.getManagerByDepartment(deptId);
        if (!manager) return;

        this.emit({
          type: "agent_active",
          agentId: manager.config.id,
          action: "planning",
          workflowId,
        });

        const inbox = await this.runtime.messageBus.getInbox(
          manager.config.id,
          workflowId
        );
        const directionMsg = inbox.find(message => message.stage === "direction");
        if (!directionMsg) {
          this.emit({
            type: "agent_active",
            agentId: manager.config.id,
            action: "idle",
            workflowId,
          });
          return;
        }

        const workers = this.runtime.agentDirectory.getWorkersByManager(
          manager.config.id
        );
        const workerList = workers
          .map(worker => `- ${worker.config.id}: ${worker.config.name}`)
          .join("\n");

        const plan = await manager.invokeJson<ManagerPlan>(
          `You received the following department direction:
${directionMsg.content}

Available team members:
${workerList}

Break the direction into concrete worker tasks. Return valid JSON only:
{
  "plan_summary": "department execution summary",
  "tasks": [
    {
      "worker_id": "worker id from the list above",
      "description": "clear executable task"
    }
  ]
}`,
          undefined,
          { workflowId, stage: "planning" }
        );

        for (const task of plan.tasks || []) {
          const worker = workers.find(item => item.config.id === task.worker_id);
          if (!worker) continue;

          const taskRow = this.repo.createTask({
            workflow_id: workflowId,
            worker_id: task.worker_id,
            manager_id: manager.config.id,
            department: manager.config.department as TaskRecord["department"],
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
            manager.config.id,
            task.worker_id,
            task.description,
            workflowId,
            "planning",
            { taskId: taskRow.id }
          );
        }

        this.emit({
          type: "agent_active",
          agentId: manager.config.id,
          action: "idle",
          workflowId,
        });
      })
    );
  }

  private async runExecution(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "execution");

    const tasks = this.repo.getTasksByWorkflow(workflowId);
    const tasksByWorker = new Map<string, TaskRecord[]>();
    for (const task of tasks) {
      const list = tasksByWorker.get(task.worker_id) || [];
      list.push(task);
      tasksByWorker.set(task.worker_id, list);
    }

    await Promise.all(
      Array.from(tasksByWorker.entries()).map(async ([workerId, workerTasks]) => {
        const worker = this.runtime.agentDirectory.get(workerId);
        if (!worker) return;

        let llmOutageMessage: string | null = null;

        for (const task of workerTasks) {
          if (llmOutageMessage) {
            this.repo.updateTask(task.id, {
              status: "failed",
              deliverable: `Skipped after LLM degradation: ${llmOutageMessage}`,
            });
            this.emit({
              type: "task_update",
              workflowId,
              taskId: task.id,
              workerId: task.worker_id,
              status: "failed",
            });
            continue;
          }

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
              `Complete the following task and return a detailed, actionable deliverable.

Task:
${task.description}

Requirements:
- avoid vague statements
- prefer structured output, steps, examples, and reasoning
- make the result reviewable by a manager`,
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
          } catch (err: any) {
            this.repo.updateTask(task.id, {
              status: "failed",
              deliverable: `Error: ${err.message}`,
            });
            this.recordWorkflowIssue(workflowId, {
              stage: "execution",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: task.worker_id,
              message: `Worker execution failed: ${err.message}`,
            });
            if (this.isTemporaryLLMError(err)) {
              llmOutageMessage = err.message;
            }
          }

          this.emit({
            type: "agent_active",
            agentId: task.worker_id,
            action: "idle",
            workflowId,
          });
        }
      })
    );
  }

  private async runReview(workflowId: string): Promise<void> {
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
        const manager = this.runtime.agentDirectory.get(managerId);
        if (!manager) return;

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
            `Review the following deliverable and score each dimension from 0 to 5.

Dimensions:
- accuracy
- completeness
- actionability
- format

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
              {
                taskId: task.id,
                score: { accuracy, completeness, actionability, format, total },
              }
            );
          } catch (err: any) {
            this.applyDefaultReview(
              task,
              "Review failed, falling back to a default score."
            );
            this.recordWorkflowIssue(workflowId, {
              stage: "review",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: managerId,
              message: `Review failed: ${err.message}`,
            });
            if (this.isTemporaryLLMError(err)) {
              llmOutageMessage = err.message;
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

  private async runMetaAudit(workflowId: string): Promise<void> {
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

    const warden = this.runtime.agentDirectory.get("warden");
    if (warden) {
      this.emit({
        type: "agent_active",
        agentId: "warden",
        action: "auditing",
        workflowId,
      });
      try {
        const wardenAudit = await warden.invoke(
          `Audit the following task outputs for role alignment and hierarchy safety.

Focus on:
- whether the worker stayed within role boundaries
- whether the output responds to the assigned task
- whether there are collaboration or ownership risks

Task outputs:
${taskSummary}

Return a concise audit note with concrete findings.`,
          undefined,
          { workflowId, stage: "meta_audit" }
        );
        auditResults.push(`[Warden]\n${wardenAudit}`);
      } catch (err: any) {
        auditResults.push(`[Warden] Audit failed: ${err.message}`);
        this.recordWorkflowIssue(workflowId, {
          stage: "meta_audit",
          scope: "agent",
          severity: "warning",
          agentId: "warden",
          message: `Warden audit failed: ${err.message}`,
        });
      }
      this.emit({
        type: "agent_active",
        agentId: "warden",
        action: "idle",
        workflowId,
      });
    }

    const prism = this.runtime.agentDirectory.get("prism");
    if (prism) {
      this.emit({
        type: "agent_active",
        agentId: "prism",
        action: "auditing",
        workflowId,
      });
      try {
        const prismAudit = await prism.invoke(
          `Audit the following task outputs for content quality.

Focus on:
- filler language or empty claims
- missing evidence, examples, steps, or decision criteria
- whether the output is actionable

Task outputs:
${taskSummary}

Return a concise quality analysis with concrete findings.`,
          undefined,
          { workflowId, stage: "meta_audit" }
        );
        auditResults.push(`[Prism]\n${prismAudit}`);
      } catch (err: any) {
        auditResults.push(`[Prism] Analysis failed: ${err.message}`);
        this.recordWorkflowIssue(workflowId, {
          stage: "meta_audit",
          scope: "agent",
          severity: "warning",
          agentId: "prism",
          message: `Prism audit failed: ${err.message}`,
        });
      }
      this.emit({
        type: "agent_active",
        agentId: "prism",
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

    if (needsRevision.length === 0) {
      return;
    }

    const tasksByWorker = new Map<string, TaskRecord[]>();
    for (const task of needsRevision) {
      const list = tasksByWorker.get(task.worker_id) || [];
      list.push(task);
      tasksByWorker.set(task.worker_id, list);
    }

    await Promise.all(
      Array.from(tasksByWorker.entries()).map(async ([workerId, workerTasks]) => {
        const worker = this.runtime.agentDirectory.get(workerId);
        if (!worker) return;

        let llmOutageMessage: string | null = null;

        for (const task of workerTasks) {
          if (llmOutageMessage) {
            this.repo.updateTask(task.id, { status: "passed" });
            this.emit({
              type: "task_update",
              workflowId,
              taskId: task.id,
              workerId: task.worker_id,
              status: "passed",
            });
            continue;
          }

          this.emit({
            type: "agent_active",
            agentId: task.worker_id,
            action: "revising",
            workflowId,
          });
          this.repo.updateTask(task.id, { status: "revising" });
          this.emit({
            type: "task_update",
            workflowId,
            taskId: task.id,
            workerId: task.worker_id,
            status: "revising",
          });

          try {
            const combinedFeedback = [
              task.manager_feedback
                ? `Manager feedback: ${task.manager_feedback}`
                : "",
              task.meta_audit_feedback
                ? `Meta audit feedback: ${task.meta_audit_feedback}`
                : "",
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

            this.emit({
              type: "task_update",
              workflowId,
              taskId: task.id,
              workerId: task.worker_id,
              status: "submitted",
            });
          } catch (err: any) {
            this.repo.updateTask(task.id, { status: "passed" });
            this.recordWorkflowIssue(workflowId, {
              stage: "revision",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: task.worker_id,
              message: `Revision failed: ${err.message}`,
            });
            if (this.isTemporaryLLMError(err)) {
              llmOutageMessage = err.message;
            }
          }

          this.emit({
            type: "agent_active",
            agentId: task.worker_id,
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
        const manager = this.runtime.agentDirectory.get(managerId);
        if (!manager) {
          for (const task of managerTasks) {
            this.repo.updateTask(task.id, { status: "passed" });
          }
          return;
        }

        let llmOutageMessage: string | null = null;

        for (const task of managerTasks) {
          if (llmOutageMessage) {
            this.repo.updateTask(task.id, { status: "passed" });
            continue;
          }

          this.emit({
            type: "agent_active",
            agentId: task.manager_id,
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
              const worker = this.runtime.agentDirectory.get(task.worker_id);
              if (worker) {
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
              }
            } else {
              this.repo.updateTask(task.id, { status: "passed" });
            }
          } catch (err: any) {
            this.repo.updateTask(task.id, { status: "passed" });
            this.recordWorkflowIssue(workflowId, {
              stage: "verify",
              scope: "task",
              severity: "warning",
              taskId: task.id,
              agentId: task.manager_id,
              message: `Verification failed: ${err.message}`,
            });
            if (this.isTemporaryLLMError(err)) {
              llmOutageMessage = err.message;
            }
          }

          this.emit({
            type: "agent_active",
            agentId: task.manager_id,
            action: "idle",
            workflowId,
          });
        }
      })
    );
  }

  private async runSummary(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "summary");

    const workflow = this.repo.getWorkflow(workflowId);
    if (!workflow) return;

    const summaries: string[] = [];
    const departmentReports: Array<{
      manager_id: string;
      manager_name: string;
      department: string;
      summary: string;
      task_count: number;
      average_score: number | null;
      report_json_path: string;
      report_markdown_path: string;
    }> = [];

    const summaryResults = await Promise.all(
      (workflow.departments_involved || []).map(async deptId => {
        const manager = this.runtime.agentDirectory.getManagerByDepartment(deptId);
        if (!manager) {
          return {
            deptId,
            summaryBlock: null as string | null,
            report: null as (typeof departmentReports)[number] | null,
          };
        }

        this.emit({
          type: "agent_active",
          agentId: manager.config.id,
          action: "summarizing",
          workflowId,
        });

        const deptTasks = this.repo
          .getTasksByWorkflow(workflowId)
          .filter(task => task.department === deptId);

        const taskResults = deptTasks
          .map(
            task =>
              `Worker: ${task.worker_id}
Task: ${task.description}
Score: ${task.total_score}/20
Deliverable:
${bestDeliverable(task)}`
          )
          .join("\n\n---\n\n");

        try {
          const summary = await manager.invoke(
            `Summarize your department's execution results for the CEO.

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
            manager.config.id,
            "ceo",
            summary,
            workflowId,
            "summary"
          );

          const departmentReport = this.runtime.reportRepo.buildDepartmentReport(
            workflow,
            {
              id: manager.config.id,
              name: manager.config.name,
              department: deptId,
            },
            summary,
            deptTasks
          );
          const savedReport = this.runtime.reportRepo.saveDepartmentReport(
            departmentReport
          );

          return {
            deptId,
            summaryBlock: `## ${deptId} Department (${manager.config.name})\n\n${summary}`,
            report: {
              manager_id: manager.config.id,
              manager_name: manager.config.name,
              department: deptId,
              summary,
              task_count: deptTasks.length,
              average_score: departmentReport.stats.averageScore,
              report_json_path: savedReport.jsonPath,
              report_markdown_path: savedReport.markdownPath,
            },
          };
        } catch (err: any) {
          this.recordWorkflowIssue(workflowId, {
            stage: "summary",
            scope: "agent",
            severity: "warning",
            agentId: manager.config.id,
            message: `Department summary failed: ${err.message}`,
          });

          return {
            deptId,
            summaryBlock: `## ${deptId} Department\n\nSummary generation failed: ${err.message}`,
            report: null,
          };
        } finally {
          this.emit({
            type: "agent_active",
            agentId: manager.config.id,
            action: "idle",
            workflowId,
          });
        }
      })
    );

    for (const result of summaryResults) {
      if (result.summaryBlock) {
        summaries.push(result.summaryBlock);
      }
      if (result.report) {
        departmentReports.push(result.report);
      }
    }

    this.repo.updateWorkflow(workflowId, {
      results: {
        ...(workflow.results || {}),
        summaries: summaries.join("\n\n"),
        department_reports: departmentReports,
      },
    });
  }

  private async runFeedback(workflowId: string): Promise<void> {
    this.emitStage(workflowId, "feedback");

    const ceo = this.runtime.agentDirectory.getCEO();
    if (!ceo) return;

    this.emit({
      type: "agent_active",
      agentId: "ceo",
      action: "evaluating",
      workflowId,
    });

    const workflow = this.repo.getWorkflow(workflowId);
    const summaryMessages = this.repo
      .getMessagesByWorkflow(workflowId)
      .filter(message => message.stage === "summary" && message.to_agent === "ceo");
    const summaryText = summaryMessages
      .map(message => `[${message.from_agent}]\n${message.content}`)
      .join("\n\n---\n\n");

    try {
      const feedback = await ceo.invoke(
        `All departments have submitted their summaries. Provide an overall retrospective.

Original user directive:
${workflow?.directive}

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
        },
      });

      for (const deptId of workflow?.departments_involved || []) {
        const manager = this.runtime.agentDirectory.getManagerByDepartment(deptId);
        if (!manager) continue;
        await this.runtime.messageBus.send(
          "ceo",
          manager.config.id,
          feedback,
          workflowId,
          "feedback"
        );
      }
    } catch (err: any) {
      this.recordWorkflowIssue(workflowId, {
        stage: "feedback",
        scope: "agent",
        severity: "warning",
        agentId: "ceo",
        message: `CEO feedback unavailable: ${err.message}`,
      });
    }

    this.emit({
      type: "agent_active",
      agentId: "ceo",
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

  private persistFinalReport(workflowId: string): void {
    const workflow = this.repo.getWorkflow(workflowId);
    if (!workflow) return;

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
        rootAgentId: "ceo",
        rootAgentName: "CEO Gateway",
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
        department: item.department,
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
