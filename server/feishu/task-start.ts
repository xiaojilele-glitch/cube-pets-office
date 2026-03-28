import type { FeishuProgressBridge } from "./bridge.js";
import type { FeishuTaskStore } from "./task-store.js";
import type { FeishuTaskDispatcher } from "./workflow-dispatcher.js";
import type { FeishuWorkflowTracker } from "./workflow-tracker.js";

export interface ComplexRequestStartResult {
  kind: "task-start";
  taskId: string;
  ack: ReturnType<FeishuProgressBridge["createRequestAck"]>;
  dispatch: {
    intent: "pipeline" | "scan" | "report" | "analysis";
    action: "started";
    reason: string;
  };
  suggestedExecution: {
    type: "workflow-task" | "relay-task";
    nextStage: "understand" | "planning";
    suggestedActions: string[];
  };
}

export interface FeishuComplexTaskStartParams {
  text: string;
  chatId: string;
  threadId?: string;
  requestId?: string;
  replyToMessageId?: string;
  rootMessageId?: string;
  receiveDetail?: string;
  understandDetail?: string;
  autoDispatch?: boolean;
  suppressFinalSummary?: boolean;
}

export type FeishuComplexTaskStartOutcome =
  | {
      ok: true;
      result: ComplexRequestStartResult;
    }
  | {
      ok: false;
      taskId: string;
      error: "Failed to send initial Feishu ACK";
      detail: string;
    };

function inferIntent(text: string): ComplexRequestStartResult["dispatch"]["intent"] {
  const normalized = text.toLowerCase();
  if (normalized.includes("pipeline")) return "pipeline";
  if (normalized.includes("scan") || normalized.includes("扫描")) return "scan";
  if (normalized.includes("report") || normalized.includes("报告")) return "report";
  return "analysis";
}

export function previewDispatch(text: string): ComplexRequestStartResult["dispatch"] {
  const intent = inferIntent(text);
  const reason =
    intent === "pipeline"
      ? "The request looks like an execution flow that should enter the workflow pipeline."
      : intent === "scan"
        ? "The request looks like a scanning / analysis task that benefits from staged progress."
        : intent === "report"
          ? "The request looks like a report-oriented task that still needs multi-stage execution."
          : "The request looks complex enough to enter the staged task bridge.";
  return {
    intent,
    action: "started",
    reason,
  };
}

export function isComplexRequest(text: string): boolean {
  if (!text) return false;
  if (text.length >= 24) return true;
  const keywords = [
    "分析",
    "设计",
    "规划",
    "roadmap",
    "架构",
    "方案",
    "拆解",
    "仓库",
    "项目",
    "测试",
    "report",
    "pipeline",
    "scan",
    "analyze",
    "design",
    "plan",
    "review",
    "refactor",
    "generate",
    "complex",
    "task",
  ];
  return keywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
}

function buildTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Feishu complex task";
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}

export async function startComplexFeishuTask(
  taskStore: FeishuTaskStore,
  feishuBridge: FeishuProgressBridge,
  dispatcher: FeishuTaskDispatcher | undefined,
  workflowTracker: FeishuWorkflowTracker | undefined,
  params: FeishuComplexTaskStartParams
): Promise<FeishuComplexTaskStartOutcome> {
  const task = taskStore.createTask({
    kind: "chat",
    title: buildTitle(params.text),
    sourceText: params.text,
  });

  feishuBridge.bindTask(task.id, {
    chatId: params.chatId,
    threadId: params.threadId,
    requestId: params.requestId,
    replyToMessageId: params.replyToMessageId,
    rootMessageId: params.rootMessageId,
    source: "feishu",
    suppressFinalSummary: params.suppressFinalSummary,
  });

  try {
    await taskStore.markTaskRunning(task.id, {
      stageKey: "receive",
      stageLabel: "接收请求",
      detail: params.receiveDetail || "Task accepted from Feishu",
      progress: 8,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    feishuBridge.unbindTask(task.id);
    await taskStore.failTask(
      task.id,
      {
        detail: `Failed to send initial Feishu ACK: ${detail}`,
        progress: 8,
        stageKey: "receive",
        stageLabel: "接收请求",
      },
      { notify: false }
    );
    return {
      ok: false,
      taskId: task.id,
      error: "Failed to send initial Feishu ACK",
      detail,
    };
  }

  void taskStore
    .markTaskRunning(task.id, {
      stageKey: "understand",
      stageLabel: "理解问题",
      detail: params.understandDetail || "Understanding request context",
      progress: 15,
      eventType: "log",
    })
    .catch(error => {
      console.error("[feishu:task-start] failed to move task into understand stage", error);
    });

  const ack = feishuBridge.createRequestAck(task.id, {
    title: task.title,
    target: {
      chatId: params.chatId,
      threadId: params.threadId,
      requestId: params.requestId,
      replyToMessageId: params.replyToMessageId,
      rootMessageId: params.rootMessageId,
      source: "feishu",
      suppressFinalSummary: params.suppressFinalSummary,
    },
    kind: "chat",
    initialProgress: 15,
    stage: "理解问题",
    detail: "已收到复杂请求，正在进入任务执行态",
  });

  const dispatch = previewDispatch(params.text);

  if (params.autoDispatch !== false && dispatcher) {
    void dispatcher
      .start({ taskId: task.id, text: params.text })
      .then(result => {
        if (result.workflowId) {
          taskStore.bindWorkflow(task.id, result.workflowId);
          workflowTracker?.trackTask(task.id, result.workflowId);
        }
      })
      .catch(async error => {
        await taskStore.failTask(task.id, {
          detail: error instanceof Error ? error.message : String(error),
          stageKey: "planning",
          stageLabel: "规划执行",
        });
      });
  }

  return {
    ok: true,
    result: {
      kind: "task-start",
      taskId: task.id,
      ack,
      dispatch,
      suggestedExecution: {
        type: params.autoDispatch === false ? "relay-task" : "workflow-task",
        nextStage: "understand",
        suggestedActions:
          dispatch.intent === "analysis"
            ? ["start-local-workflow", "stream-progress-back-to-feishu"]
            : ["run-staged-task-flow", "stream-progress-back-to-feishu"],
      },
    },
  };
}
