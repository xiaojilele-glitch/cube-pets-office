import type { Router } from "express";
import { createFeishuRelayAuth } from "./relay-auth.js";
import { isComplexRequest, startComplexFeishuTask } from "./task-start.js";
import type { FeishuBridgeRuntime } from "./runtime.js";
import { parseInvitation } from "../core/guest-invitation-parser.js";

interface FeishuRelayBody {
  chatId?: string;
  text?: string;
  requestId?: string;
  messageId?: string;
  threadId?: string;
  replyToMessageId?: string;
  rootMessageId?: string;
  senderId?: string;
  senderName?: string;
  finalAnswerSource?: "opencroc" | "openclaw";
}

interface FeishuRelayEventBody {
  taskId?: string;
  type?: "progress" | "waiting" | "done" | "failed" | "decision";
  stageKey?: string;
  stageLabel?: string;
  detail?: string;
  progress?: number;
  summary?: string;
  waitingFor?: string;
  optionId?: string;
  optionLabel?: string;
  freeText?: string;
}

export function registerFeishuRelayRoutes(
  router: Router,
  runtime: FeishuBridgeRuntime
): void {
  const relayAuth = createFeishuRelayAuth(runtime.config);

  router.post("/relay", async (request, response) => {
    if (!relayAuth.verifyRequest(request, response, "/api/feishu/relay"))
      return;

    const body = (request.body || {}) as FeishuRelayBody;
    const chatId = body.chatId?.trim();
    const text = body.text?.trim() || "";
    const requestId = body.requestId?.trim() || body.messageId?.trim();
    const replyToMessageId = body.replyToMessageId?.trim() || requestId;
    const rootMessageId = body.rootMessageId?.trim() || requestId;
    const finalAnswerSource =
      body.finalAnswerSource === "openclaw" ? "openclaw" : "opencroc";

    if (!chatId) {
      return response.status(400).json({
        ok: false,
        handled: false,
        error: "chatId is required",
      });
    }

    // Detect @GuestName invitation pattern in relayed messages (Requirements 3.3)
    const invitation = text ? parseInvitation(text) : null;
    if (invitation) {
      return response.json({
        ok: true,
        handled: true,
        invitation: {
          guestName: invitation.guestName,
          skills: invitation.skills,
          context: invitation.context,
          source: "feishu" as const,
        },
      });
    }

    const shouldStartTask =
      finalAnswerSource === "openclaw" || isComplexRequest(text);
    if (!shouldStartTask) {
      return response.json({
        ok: true,
        handled: false,
        reason:
          "Message does not look like a complex request that should enter task mode.",
      });
    }

    const outcome = await startComplexFeishuTask(
      runtime.taskStore,
      runtime.bridge,
      runtime.dispatcher,
      runtime.workflowTracker,
      {
        text,
        chatId,
        threadId: body.threadId?.trim(),
        requestId,
        replyToMessageId,
        rootMessageId,
        receiveDetail: "Task accepted from relay request",
        understandDetail: "Understanding relayed request context",
        autoDispatch: finalAnswerSource !== "openclaw",
        suppressFinalSummary: finalAnswerSource === "openclaw",
      }
    );

    if (!outcome.ok) {
      return response.status(502).json({
        ok: false,
        handled: false,
        taskId: outcome.taskId,
        error: outcome.error,
        detail: outcome.detail,
      });
    }

    return response.json({
      ok: true,
      handled: finalAnswerSource !== "openclaw",
      taskId: outcome.result.taskId,
      trackFinal: finalAnswerSource === "openclaw",
      dispatch: outcome.result.dispatch,
      suggestedExecution: outcome.result.suggestedExecution,
    });
  });

  router.post("/relay/event", async (request, response) => {
    if (!relayAuth.verifyRequest(request, response, "/api/feishu/relay/event"))
      return;

    const body = (request.body || {}) as FeishuRelayEventBody;
    const taskId = body.taskId?.trim();
    if (!taskId) {
      return response
        .status(400)
        .json({ ok: false, error: "taskId is required" });
    }

    const task = runtime.taskStore.getTask(taskId);
    if (!task) {
      return response.status(404).json({ ok: false, error: "Task not found" });
    }

    if (body.type === "progress") {
      if (!body.stageKey?.trim()) {
        return response.status(400).json({
          ok: false,
          error: "stageKey is required for progress updates",
        });
      }
      const updated = await runtime.taskStore.markTaskRunning(taskId, {
        stageKey: body.stageKey.trim(),
        stageLabel: body.stageLabel?.trim(),
        detail: body.detail?.trim() || "Relay is processing the request",
        progress:
          typeof body.progress === "number" ? body.progress : task.progress,
      });
      return response.json({ ok: true, task: updated });
    }

    if (body.type === "waiting") {
      const updated = await runtime.taskStore.waitOnTask(taskId, {
        waitingFor: body.waitingFor?.trim() || "Need user decision",
        detail: body.detail?.trim() || "Waiting for user confirmation",
        progress:
          typeof body.progress === "number" ? body.progress : task.progress,
        stageKey: body.stageKey?.trim() || task.currentStageKey || "execution",
        stageLabel: body.stageLabel?.trim(),
        decision: {
          prompt: body.detail?.trim() || "请选择下一步",
          options: [],
        },
      });
      return response.json({ ok: true, task: updated });
    }

    if (body.type === "done") {
      const updated = await runtime.taskStore.completeTask(taskId, {
        summary:
          body.summary?.trim() || body.detail?.trim() || "Task completed",
        detail: body.detail?.trim() || "Relay reported completion",
        progress: 100,
        stageKey: body.stageKey?.trim() || "finalize",
        stageLabel: body.stageLabel?.trim() || "整理答复",
      });
      return response.json({ ok: true, task: updated });
    }

    if (body.type === "failed") {
      const updated = await runtime.taskStore.failTask(taskId, {
        detail: body.detail?.trim() || "Relay reported failure",
        progress:
          typeof body.progress === "number" ? body.progress : task.progress,
        stageKey: body.stageKey?.trim() || task.currentStageKey || "finalize",
        stageLabel: body.stageLabel?.trim(),
      });
      return response.json({ ok: true, task: updated });
    }

    if (body.type === "decision") {
      const result = await runtime.taskStore.resolveTaskDecision(
        taskId,
        {
          optionId: body.optionId,
          optionLabel: body.optionLabel,
          freeText: body.freeText,
          detail: body.detail,
          progress: body.progress,
        },
        {
          idempotentIfNotWaiting: true,
        }
      );

      if (!result.ok) {
        return response
          .status(result.statusCode)
          .json({ ok: false, error: result.error });
      }

      return response.json({
        ok: true,
        alreadyResolved: result.alreadyResolved === true,
        decision: result.decision,
        task: result.task,
      });
    }

    return response
      .status(400)
      .json({ ok: false, error: "Unsupported relay event type" });
  });
}
