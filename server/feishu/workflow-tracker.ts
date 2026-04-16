import db from "../db/index.js";
import {
  WORKFLOW_STAGE_LABELS,
  type WorkflowRecord,
} from "../../shared/workflow-runtime.js";
import type { FeishuTaskStore } from "./task-store.js";

const WORKFLOW_STAGE_PROGRESS: Record<string, number> = {
  direction: 18,
  planning: 30,
  execution: 60,
  review: 72,
  meta_audit: 80,
  revision: 86,
  verify: 92,
  summary: 96,
  feedback: 98,
  evolution: 99,
};

function workflowSummary(workflow: WorkflowRecord): string {
  return (
    workflow.results?.executive_feedback ||
    workflow.results?.ceo_feedback ||
    workflow.results?.summaries ||
    "Workflow completed"
  );
}

function workflowFailureDetail(workflow: WorkflowRecord): string {
  return (
    workflow.results?.last_error ||
    workflow.results?.report_error ||
    "Workflow failed"
  );
}

export class FeishuWorkflowTracker {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly snapshots = new Map<string, string>();

  constructor(
    private readonly taskStore: FeishuTaskStore,
    private readonly pollMs = 750
  ) {}

  trackTask(taskId: string, workflowId: string): void {
    this.stop(taskId);

    const tick = async () => {
      const workflow = db.getWorkflow(workflowId);
      if (!workflow) return;

      const snapshot = `${workflow.status}:${workflow.current_stage || ""}:${
        workflow.results?.last_error || ""
      }`;
      if (this.snapshots.get(taskId) === snapshot) {
        if (
          workflow.status === "completed" ||
          workflow.status === "completed_with_errors" ||
          workflow.status === "failed"
        ) {
          this.stop(taskId);
        }
        return;
      }
      this.snapshots.set(taskId, snapshot);

      if (workflow.status === "failed") {
        await this.taskStore.failTask(taskId, {
          detail: workflowFailureDetail(workflow),
          stageKey: workflow.current_stage || "evolution",
          stageLabel:
            WORKFLOW_STAGE_LABELS[
              (workflow.current_stage ||
                "evolution") as keyof typeof WORKFLOW_STAGE_LABELS
            ] || "执行失败",
        });
        this.stop(taskId);
        return;
      }

      if (
        workflow.status === "completed" ||
        workflow.status === "completed_with_errors"
      ) {
        await this.taskStore.completeTask(taskId, {
          summary: workflowSummary(workflow),
          detail:
            workflow.status === "completed_with_errors"
              ? "Workflow completed with recoverable issues"
              : "Workflow completed successfully",
          stageKey: "evolution",
          stageLabel: "执行完成",
          progress: 100,
        });
        this.stop(taskId);
        return;
      }

      if (!workflow.current_stage) return;

      const stageKey = workflow.current_stage;
      const stageLabel =
        WORKFLOW_STAGE_LABELS[stageKey as keyof typeof WORKFLOW_STAGE_LABELS] ||
        stageKey;
      const progress = WORKFLOW_STAGE_PROGRESS[stageKey] ?? 25;
      await this.taskStore.markTaskRunning(taskId, {
        stageKey,
        stageLabel,
        detail: `Workflow 当前阶段：${stageLabel}`,
        progress,
        eventType: "log",
      });
    };

    void tick();
    const timer = setInterval(() => {
      void tick().catch(error => {
        console.error("[feishu:workflow-tracker]", error);
      });
    }, this.pollMs);
    this.timers.set(taskId, timer);
  }

  stop(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskId);
    }
    this.snapshots.delete(taskId);
  }

  dispose(): void {
    for (const [taskId, timer] of Array.from(this.timers.entries())) {
      clearInterval(timer);
      this.timers.delete(taskId);
    }
    this.snapshots.clear();
  }
}
