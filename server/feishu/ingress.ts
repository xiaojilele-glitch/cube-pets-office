import type { Router } from "express";
import {
  describeTaskDecisionAlreadyProcessed,
  type FeishuResolvedDecision,
} from "./task-store.js";
import { isComplexRequest, startComplexFeishuTask } from "./task-start.js";
import { createFeishuWebhookSecurity } from "./webhook-security.js";
import type { FeishuBridgeRuntime } from "./runtime.js";

interface FeishuChallengeBody {
  type?: string;
  challenge?: string;
  token?: string;
  encrypt?: string;
}

interface FeishuEventSender {
  sender_id?: { open_id?: string; union_id?: string; user_id?: string };
  sender_type?: string;
}

interface FeishuEventMessage {
  message_id?: string;
  chat_id?: string;
  message_type?: string;
  content?: string;
}

interface FeishuEventBody {
  type?: string;
  token?: string;
  encrypt?: string;
  header?: {
    event_type?: string;
    event_id?: string;
    create_time?: string;
    token?: string;
    app_id?: string;
    tenant_key?: string;
  };
  event?: {
    sender?: FeishuEventSender;
    message?: FeishuEventMessage;
    action?: {
      value?: unknown;
    };
  };
}

interface DuplicateResult {
  ok: true;
  ignored: true;
  reason: string;
}

interface PassThroughResult {
  kind: "pass-through";
  reason: string;
}

interface FeishuCardActionValue {
  kind?: string;
  taskId?: string;
  optionId?: string;
  optionLabel?: string;
  freeText?: string;
  detail?: string;
  progress?: number;
}

interface FeishuWebhookToast {
  type: "success" | "info" | "warning" | "error";
  content: string;
}

interface FeishuWebhookActionResult {
  kind: "task-decision";
  taskId?: string;
  accepted: boolean;
  alreadyResolved?: boolean;
  decision?: {
    optionId?: string;
    optionLabel?: string;
    freeText?: string;
  };
  reason?: string;
}

function parseTextContent(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.text === "string") return parsed.text.trim();
  } catch {
    return raw.trim();
  }
  return "";
}

function createDedupKey(body: FeishuEventBody): string | undefined {
  const eventId = body.header?.event_id?.trim();
  if (eventId) return `event:${eventId}`;

  const messageId = body.event?.message?.message_id?.trim();
  if (messageId) return `message:${messageId}`;

  return undefined;
}

function parseCardActionValue(raw: unknown): FeishuCardActionValue | undefined {
  const candidate =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return undefined;
          }
        })()
      : raw;

  if (!candidate || typeof candidate !== "object") return undefined;
  const record = candidate as Record<string, unknown>;
  const progress =
    typeof record.progress === "number"
      ? record.progress
      : typeof record.progress === "string" && record.progress.trim()
        ? Number(record.progress)
        : undefined;

  return {
    kind: typeof record.kind === "string" ? record.kind.trim() : undefined,
    taskId: typeof record.taskId === "string" ? record.taskId.trim() : undefined,
    optionId: typeof record.optionId === "string" ? record.optionId.trim() : undefined,
    optionLabel:
      typeof record.optionLabel === "string" ? record.optionLabel.trim() : undefined,
    freeText: typeof record.freeText === "string" ? record.freeText.trim() : undefined,
    detail: typeof record.detail === "string" ? record.detail.trim() : undefined,
    progress: Number.isFinite(progress) ? progress : undefined,
  };
}

function callbackToast(
  type: FeishuWebhookToast["type"],
  content: string
): { toast: FeishuWebhookToast } {
  return {
    toast: {
      type,
      content,
    },
  };
}

function resolveDecisionToastContent(
  taskTitle: string,
  decision: FeishuResolvedDecision
): string {
  const choice = decision.optionLabel || decision.freeText || decision.optionId || "已确认";
  return `已确认：${choice}（${taskTitle}）`;
}

export function registerFeishuIngressRoutes(
  router: Router,
  runtime: FeishuBridgeRuntime
): void {
  const dedupTtlMs = Math.max(1, runtime.config.webhookDedupTtlSeconds ?? 600) * 1_000;
  const webhookSecurity = createFeishuWebhookSecurity(runtime.config);

  router.post("/webhook", async (request, response) => {
    const body = webhookSecurity.resolveBody(request, response) as
      | FeishuChallengeBody
      | FeishuEventBody
      | undefined;
    if (!body) return;

    if (body.type === "url_verification" && "challenge" in body) {
      return response.json({ challenge: body.challenge });
    }

    const eventType = "header" in body ? body.header?.event_type : undefined;
    if (eventType === "card.action.trigger") {
      const dedupKey = createDedupKey(body as FeishuEventBody);
      if (dedupKey) {
        const now = Date.now();
        if (runtime.webhookDedupStore.has(dedupKey, now)) {
          const result: DuplicateResult = {
            ok: true,
            ignored: true,
            reason: `Duplicate Feishu delivery ignored: ${dedupKey}`,
          };
          return response.json(result);
        }
        runtime.webhookDedupStore.remember(dedupKey, now + dedupTtlMs, now);
      }

      const actionValue = parseCardActionValue((body as FeishuEventBody).event?.action?.value);
      if (!actionValue || actionValue.kind !== "task-decision") {
        const result: FeishuWebhookActionResult = {
          kind: "task-decision",
          accepted: false,
          reason: "Unsupported card callback payload",
        };
        return response.json({
          ok: true,
          result,
          ...callbackToast("warning", "暂不支持这个卡片操作"),
        });
      }

      if (!actionValue.taskId) {
        const result: FeishuWebhookActionResult = {
          kind: "task-decision",
          accepted: false,
          reason: "Missing taskId in card callback payload",
        };
        return response.json({
          ok: true,
          result,
          ...callbackToast("error", "缺少任务 ID，无法处理该操作"),
        });
      }

      const decisionResult = await runtime.taskStore.resolveTaskDecision(
        actionValue.taskId,
        {
          optionId: actionValue.optionId,
          optionLabel: actionValue.optionLabel,
          freeText: actionValue.freeText,
          detail: actionValue.detail,
          progress: actionValue.progress,
        },
        {
          idempotentIfNotWaiting: true,
        }
      );

      if (!decisionResult.ok) {
        const result: FeishuWebhookActionResult = {
          kind: "task-decision",
          taskId: actionValue.taskId,
          accepted: false,
          reason: decisionResult.error,
        };
        return response.json({
          ok: true,
          result,
          ...callbackToast("error", decisionResult.error),
        });
      }

      if (decisionResult.alreadyResolved) {
        const result: FeishuWebhookActionResult = {
          kind: "task-decision",
          taskId: actionValue.taskId,
          accepted: true,
          alreadyResolved: true,
          decision: decisionResult.decision,
        };
        return response.json({
          ok: true,
          result,
          ...callbackToast(
            "info",
            describeTaskDecisionAlreadyProcessed(
              decisionResult.task,
              decisionResult.decision
            )
          ),
        });
      }

      const result: FeishuWebhookActionResult = {
        kind: "task-decision",
        taskId: actionValue.taskId,
        accepted: true,
        decision: decisionResult.decision,
      };
      return response.json({
        ok: true,
        result,
        ...callbackToast(
          "success",
          resolveDecisionToastContent(
            decisionResult.task.title,
            decisionResult.decision
          )
        ),
      });
    }

    if (eventType !== "im.message.receive_v1") {
      return response.json({
        ok: true,
        ignored: true,
        reason: `Unsupported event type: ${eventType || "unknown"}`,
      });
    }

    const dedupKey = createDedupKey(body as FeishuEventBody);
    if (dedupKey) {
      const now = Date.now();
      if (runtime.webhookDedupStore.has(dedupKey, now)) {
        const result: DuplicateResult = {
          ok: true,
          ignored: true,
          reason: `Duplicate Feishu delivery ignored: ${dedupKey}`,
        };
        return response.json(result);
      }
      runtime.webhookDedupStore.remember(dedupKey, now + dedupTtlMs, now);
    }

    const event = (body as FeishuEventBody).event;
    const message = event?.message;
    const text = parseTextContent(message?.content);

    if (!isComplexRequest(text)) {
      const result: PassThroughResult = {
        kind: "pass-through",
        reason:
          "Message does not look like a complex request that should enter task mode.",
      };
      return response.json({ ok: true, result });
    }

    const outcome = await startComplexFeishuTask(
      runtime.taskStore,
      runtime.bridge,
      runtime.dispatcher,
      runtime.workflowTracker,
      {
        text,
        chatId: message?.chat_id || "unknown-chat",
        requestId: message?.message_id,
        replyToMessageId: message?.message_id,
        rootMessageId: message?.message_id,
        receiveDetail: "Task accepted from Feishu webhook",
        understandDetail: "Understanding request context",
      }
    );

    if (!outcome.ok) {
      return response.status(502).json({
        ok: false,
        taskId: outcome.taskId,
        error: outcome.error,
        detail: outcome.detail,
      });
    }

    return response.json({ ok: true, result: outcome.result });
  });
}
