import type {
  FeishuResolvedDecision,
  FeishuTaskDecisionPrompt,
  FeishuTaskEvent,
  FeishuTaskRecord,
  FeishuTaskStatus,
} from "./task-store.js";

export interface FeishuBridgeConfig {
  enabled?: boolean;
  baseTaskUrl?: string;
  progressThrottlePercent?: number;
  relaySecret?: string;
  relayMaxSkewSeconds?: number;
  relayNonceTtlSeconds?: number;
  webhookVerificationToken?: string;
  webhookEncryptKey?: string;
  webhookMaxSkewSeconds?: number;
  webhookDedupTtlSeconds?: number;
  deliveryMaxRetries?: number;
  deliveryRetryBaseMs?: number;
  deliveryRetryMaxMs?: number;
  appId?: string;
  appSecret?: string;
  tenantAccessToken?: string;
  apiBaseUrl?: string;
  mode?: "mock" | "live";
  messageFormat?: "text" | "card" | "card-live";
  finalSummaryMode?: "none" | "complete" | "failed" | "both";
  webhookDedupFilePath?: string;
}

export interface FeishuTaskTarget {
  chatId: string;
  threadId?: string;
  requestId?: string;
  replyToMessageId?: string;
  rootMessageId?: string;
  source?: "feishu";
  suppressFinalSummary?: boolean;
}

export interface FeishuCardPayload {
  schema: "2.0";
  config?: {
    wide_screen_mode?: boolean;
    update_multi?: boolean;
  };
  header: {
    title: { tag: "plain_text"; content: string };
    template?:
      | "blue"
      | "wathet"
      | "turquoise"
      | "green"
      | "yellow"
      | "orange"
      | "red"
      | "grey"
      | "indigo"
      | "purple";
  };
  body: {
    elements: Array<Record<string, unknown>>;
  };
}

export interface FeishuOutboundMessage {
  kind: "task-ack" | "task-progress" | "task-waiting" | "task-complete" | "task-failed";
  target: FeishuTaskTarget;
  taskId: string;
  text: string;
  progress: number;
  status: FeishuTaskStatus;
  stage?: string;
  detail?: string;
  summary?: string;
  link?: string;
  decision?: FeishuTaskDecisionPrompt;
  resolvedDecision?: FeishuResolvedDecision;
  card?: FeishuCardPayload;
  presentation?: "auto" | "text" | "card";
}

export interface FeishuDeliveryReceipt {
  messageId?: string;
  rootId?: string;
  threadId?: string;
}

export interface FeishuBridgeDelivery {
  send(message: FeishuOutboundMessage): Promise<FeishuDeliveryReceipt | void>;
  update?(
    messageId: string,
    message: FeishuOutboundMessage
  ): Promise<FeishuDeliveryReceipt | void>;
}

export interface FeishuTaskRequest {
  title: string;
  target: FeishuTaskTarget;
  kind?: string;
  initialProgress?: number;
  stage?: string;
  detail?: string;
  link?: string;
}

export interface FeishuTaskRequestAck {
  ok: true;
  taskId: string;
  message: FeishuOutboundMessage;
}

interface TaskSubscription {
  target: FeishuTaskTarget;
  lastProgressSent: number;
  lastEventType?: FeishuTaskEvent["type"];
  ackSent: boolean;
  firstMessageId?: string;
  lastMessageId?: string;
  rootId?: string;
  threadId?: string;
  replyToMessageId?: string;
  finalSummarySentFor?: "task-complete" | "task-failed";
}

type DeliveryQueue = Promise<void>;

function formatTaskLink(baseTaskUrl: string | undefined, taskId: string): string | undefined {
  if (!baseTaskUrl) return undefined;
  return `${baseTaskUrl.replace(/\/$/, "")}/tasks/${taskId}`;
}

function formatStage(task: FeishuTaskRecord): string | undefined {
  const current = task.stages.find(stage => stage.key === task.currentStageKey);
  return current?.label;
}

function formatAckText(task: FeishuTaskRecord, link?: string): string {
  return [
    `任务已开始：${task.title}`,
    `进度：${task.progress}%`,
    formatStage(task) ? `当前阶段：${formatStage(task)}` : undefined,
    link ? `详情：${link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatProgressText(task: FeishuTaskRecord, link?: string): string {
  const latest = task.events[task.events.length - 1];
  return [
    `任务进度更新：${task.title}`,
    `进度：${task.progress}%`,
    formatStage(task) ? `当前阶段：${formatStage(task)}` : undefined,
    latest?.message ? `状态：${latest.message}` : undefined,
    link ? `详情：${link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDecision(decision: FeishuTaskDecisionPrompt | undefined): string | undefined {
  if (!decision || decision.options.length === 0) return undefined;
  const lines = [decision.prompt];
  for (const option of decision.options) {
    lines.push(
      `${option.id}. ${option.label}${option.description ? ` - ${option.description}` : ""}`
    );
  }
  return lines.join("\n");
}

function formatDecisionResolvedText(task: FeishuTaskRecord, link?: string): string {
  const resolved = task.lastResolvedDecision;
  const choice = resolved?.optionLabel || resolved?.freeText || resolved?.optionId || "已确认";
  const time = new Date(task.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return [
    `任务已决策：${task.title}`,
    `选择结果：${choice}`,
    `决策时间：${time}`,
    link ? `详情：${link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatWaitingFallbackHint(link?: string): string | undefined {
  if (!link) return undefined;
  return "如果飞书按钮无响应，请打开详情页继续确认。";
}

function formatWaitingText(task: FeishuTaskRecord, link?: string): string {
  const latest = task.events[task.events.length - 1];
  return [
    `任务等待确认：${task.title}`,
    `当前状态：${latest?.message || task.waitingFor || "等待用户输入"}`,
    formatDecision(task.decision),
    formatWaitingFallbackHint(link),
    link ? `详情：${link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCompleteText(task: FeishuTaskRecord, link?: string): string {
  return [
    `任务已完成：${task.title}`,
    task.summary,
    link ? `详情：${link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFailedText(task: FeishuTaskRecord, link?: string): string {
  const latest = [...task.events]
    .reverse()
    .find(event => event.type === "failed" || event.level === "error");
  return [
    `任务执行失败：${task.title}`,
    latest?.message ? `原因：${latest.message}` : undefined,
    link ? `详情：${link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRequestAckText(request: FeishuTaskRequest, taskId: string): string {
  return [
    `已收到复杂请求：${request.title}`,
    `taskId：${taskId}`,
    request.stage ? `当前阶段：${request.stage}` : undefined,
    request.detail ? `状态：${request.detail}` : undefined,
    request.link ? `详情：${request.link}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function progressBar(progress: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(progress / 10)));
  return `${"■".repeat(filled)}${"□".repeat(10 - filled)} ${progress}%`;
}

function cardTemplateForStatus(status: FeishuTaskStatus): FeishuCardPayload["header"]["template"] {
  switch (status) {
    case "done":
      return "green";
    case "failed":
      return "red";
    case "waiting":
      return "orange";
    case "running":
      return "blue";
    default:
      return "wathet";
  }
}

function createDecisionButtonValue(
  taskId: string,
  decision: FeishuResolvedDecision
): Record<string, unknown> {
  return {
    kind: "task-decision",
    taskId,
    optionId: decision.optionId,
    optionLabel: decision.optionLabel,
    freeText: decision.freeText,
  };
}

function resolveDecisionButtonType(
  decisionType: string | undefined,
  option: { id: string; label: string; severity?: string },
  index: number
): "primary" | "danger" | "default" {
  const dt = decisionType ?? "custom-action";

  // severity takes highest priority when present
  if (option.severity === "danger") return "danger";

  if (dt === "escalate") return "danger";

  if (dt === "approve" || dt === "reject") {
    // First option = approve (green/primary), second = reject (danger)
    return index === 0 ? "primary" : "danger";
  }

  return index === 0 ? "primary" : "default";
}

function resolveCardTemplateForDecision(
  decisionType: string | undefined,
  baseTemplate: FeishuCardPayload["header"]["template"]
): FeishuCardPayload["header"]["template"] {
  if (decisionType === "escalate") return "red";
  return baseTemplate;
}

function createTaskCard(message: FeishuOutboundMessage): FeishuCardPayload {
  const decisionType = message.decision?.type;

  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**任务 ID**：${message.taskId}\n**进度**：${progressBar(message.progress)}`,
      },
    },
  ];

  if (message.stage || message.detail) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: [
          message.stage ? `**当前阶段**：${message.stage}` : undefined,
          message.detail ? `**状态**：${message.detail}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
  }

  if (message.decision?.options?.length) {
    const priorityPrefix = decisionType === "escalate" ? "🔴 " : "";
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `${priorityPrefix}**待确认**：${message.decision.prompt}\n${message.decision.options
          .map(
            option =>
              `${option.id}. ${option.label}${option.description ? ` - ${option.description}` : ""}`
          )
          .join("\n")}`,
      },
    });

    message.decision.options.forEach((option, index) => {
      elements.push({
        tag: "button",
        text: {
          tag: "plain_text",
          content: option.label,
        },
        type: resolveDecisionButtonType(decisionType, option, index),
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: createDecisionButtonValue(message.taskId, {
              optionId: option.id,
              optionLabel: option.label,
            }),
          },
        ],
      });
    });
  }

  const waitingFallbackHint =
    message.kind === "task-waiting" ? formatWaitingFallbackHint(message.link) : undefined;
  if (waitingFallbackHint) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**兜底方式**：${waitingFallbackHint}`,
      },
    });
  }

  if (message.resolvedDecision) {
    const resolved = message.resolvedDecision;
    const choice = resolved.optionLabel || resolved.freeText || resolved.optionId || "已确认";
    const time = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `✅ **已决策**：${choice}\n**决策时间**：${time}`,
      },
    });
  }

  if (message.summary) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**结果摘要**\n${message.summary}`,
      },
    });
  }

  if (message.link) {
    elements.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "查看任务详情",
      },
      type: "primary",
      width: "fill",
      behaviors: [
        {
          type: "open_url",
          default_url: message.link,
          pc_url: message.link,
          ios_url: message.link,
          android_url: message.link,
        },
      ],
    });
  }

  const baseTemplate = cardTemplateForStatus(message.status);

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content:
          message.kind === "task-ack"
            ? `任务已开始：${message.taskId}`
            : message.kind === "task-waiting"
              ? `任务等待确认：${message.taskId}`
              : message.kind === "task-complete"
                ? `任务已完成：${message.taskId}`
                : message.kind === "task-failed"
                  ? `任务执行失败：${message.taskId}`
                  : `任务进度更新：${message.taskId}`,
      },
      template: resolveCardTemplateForDecision(decisionType, baseTemplate),
    },
    body: {
      elements,
    },
  };
}

export class FeishuProgressBridge {
  private readonly delivery: FeishuBridgeDelivery;
  private readonly config: Required<Pick<FeishuBridgeConfig, "progressThrottlePercent">> &
    Omit<FeishuBridgeConfig, "progressThrottlePercent">;
  private readonly subscriptions = new Map<string, TaskSubscription>();
  private readonly deliveryQueues = new Map<string, DeliveryQueue>();

  constructor(delivery: FeishuBridgeDelivery, config: FeishuBridgeConfig = {}) {
    this.delivery = delivery;
    this.config = {
      enabled: config.enabled ?? true,
      baseTaskUrl: config.baseTaskUrl,
      progressThrottlePercent: config.progressThrottlePercent ?? 15,
      relaySecret: config.relaySecret,
      relayMaxSkewSeconds: config.relayMaxSkewSeconds,
      relayNonceTtlSeconds: config.relayNonceTtlSeconds,
      webhookVerificationToken: config.webhookVerificationToken,
      webhookEncryptKey: config.webhookEncryptKey,
      webhookMaxSkewSeconds: config.webhookMaxSkewSeconds,
      webhookDedupTtlSeconds: config.webhookDedupTtlSeconds,
      deliveryMaxRetries: config.deliveryMaxRetries,
      deliveryRetryBaseMs: config.deliveryRetryBaseMs,
      deliveryRetryMaxMs: config.deliveryRetryMaxMs,
      appId: config.appId,
      appSecret: config.appSecret,
      tenantAccessToken: config.tenantAccessToken,
      apiBaseUrl: config.apiBaseUrl,
      mode: config.mode,
      messageFormat: config.messageFormat,
      finalSummaryMode: config.finalSummaryMode,
      webhookDedupFilePath: config.webhookDedupFilePath,
    };
  }

  bindTask(taskId: string, target: FeishuTaskTarget): void {
    this.subscriptions.set(taskId, {
      target,
      lastProgressSent: -1,
      ackSent: false,
      threadId: target.threadId,
      rootId: target.rootMessageId,
      replyToMessageId: target.replyToMessageId ?? target.requestId,
    });
  }

  unbindTask(taskId: string): void {
    this.subscriptions.delete(taskId);
    this.deliveryQueues.delete(taskId);
  }

  getTaskBinding(
    taskId: string
  ):
    | {
        target: FeishuTaskTarget;
        firstMessageId?: string;
        lastMessageId?: string;
        rootId?: string;
        threadId?: string;
        replyToMessageId?: string;
      }
    | undefined {
    const subscription = this.subscriptions.get(taskId);
    if (!subscription) return undefined;
    return {
      target: subscription.target,
      firstMessageId: subscription.firstMessageId,
      lastMessageId: subscription.lastMessageId,
      rootId: subscription.rootId,
      threadId: subscription.threadId,
      replyToMessageId: subscription.replyToMessageId,
    };
  }

  createRequestAck(taskId: string, request: FeishuTaskRequest): FeishuTaskRequestAck {
    const link = request.link ?? formatTaskLink(this.config.baseTaskUrl, taskId);
    const message: FeishuOutboundMessage = {
      kind: "task-ack",
      target: request.target,
      taskId,
      text: formatRequestAckText({ ...request, link }, taskId),
      progress: request.initialProgress ?? 0,
      status: "queued",
      stage: request.stage,
      detail: request.detail,
      link,
    };
    if (this.usesCardRendering(message)) {
      message.card = createTaskCard(message);
    }
    return {
      ok: true,
      taskId,
      message,
    };
  }

  async handleTaskUpdate(task: FeishuTaskRecord): Promise<void> {
    return this.enqueueDelivery(task.id, async () => {
      if (!this.config.enabled) return;
      const subscription = this.subscriptions.get(task.id);
      if (!subscription) return;

      const link = formatTaskLink(this.config.baseTaskUrl, task.id);
      const latest = task.events[task.events.length - 1];
      const stage = formatStage(task);

      if (task.status === "queued" && latest?.type === "created") {
        return;
      }

      if (!subscription.ackSent) {
        subscription.ackSent = true;
        subscription.lastProgressSent = task.progress;
        await this.sendAndTrack(task.id, {
          kind: "task-ack",
          target: subscription.target,
          taskId: task.id,
          text: formatAckText(task, link),
          progress: task.progress,
          status: task.status,
          stage,
          detail: latest?.message,
          link,
        });
        return;
      }

      if (task.status === "waiting") {
        subscription.lastEventType = "waiting";
        await this.sendAndTrack(task.id, {
          kind: "task-waiting",
          target: subscription.target,
          taskId: task.id,
          text: formatWaitingText(task, link),
          progress: task.progress,
          status: task.status,
          stage,
          detail: latest?.message,
          link,
          decision: task.decision,
        });
        return;
      }

      if (task.status === "done") {
        subscription.lastEventType = "done";
        const completeMessage: FeishuOutboundMessage = {
          kind: "task-complete",
          target: subscription.target,
          taskId: task.id,
          text: formatCompleteText(task, link),
          progress: task.progress,
          status: task.status,
          stage,
          detail: this.resolveTerminalCardDetail("task-complete", latest?.message),
          summary: task.summary,
          link,
        };
        await this.sendAndTrack(task.id, completeMessage);
        await this.sendFinalSummaryIfNeeded(task.id, completeMessage);
        return;
      }

      if (task.status === "failed") {
        subscription.lastEventType = "failed";
        const failedMessage: FeishuOutboundMessage = {
          kind: "task-failed",
          target: subscription.target,
          taskId: task.id,
          text: formatFailedText(task, link),
          progress: task.progress,
          status: task.status,
          stage,
          detail: this.resolveTerminalCardDetail("task-failed", latest?.message),
          link,
        };
        await this.sendAndTrack(task.id, failedMessage);
        await this.sendFinalSummaryIfNeeded(task.id, failedMessage);
        return;
      }

      const delta = task.progress - subscription.lastProgressSent;
      if (delta < this.config.progressThrottlePercent && latest?.type === "log") {
        return;
      }

      // Detect decision-resolved transition: was waiting, now running with a resolved decision
      if (
        subscription.lastEventType === "waiting" &&
        task.status === "running" &&
        task.lastResolvedDecision
      ) {
        subscription.lastEventType = latest?.type;
        subscription.lastProgressSent = task.progress;
        await this.sendAndTrack(task.id, {
          kind: "task-progress",
          target: subscription.target,
          taskId: task.id,
          text: formatDecisionResolvedText(task, link),
          progress: task.progress,
          status: task.status,
          stage,
          detail: latest?.message,
          link,
          resolvedDecision: task.lastResolvedDecision,
        });
        return;
      }

      subscription.lastProgressSent = task.progress;
      subscription.lastEventType = latest?.type;
      await this.sendAndTrack(task.id, {
        kind: "task-progress",
        target: subscription.target,
        taskId: task.id,
        text: formatProgressText(task, link),
        progress: task.progress,
        status: task.status,
        stage,
        detail: latest?.message,
        link,
      });
    });
  }

  private usesCardRendering(message: FeishuOutboundMessage): boolean {
    if (message.presentation === "text") return false;
    if (message.presentation === "card") return true;
    if (this.config.messageFormat === "card-live") return true;
    if (this.config.messageFormat !== "card") return false;
    return message.kind !== "task-progress";
  }

  private usesLiveCardUpdates(): boolean {
    return this.config.messageFormat === "card-live";
  }

  private resolveFinalSummaryMode(): "none" | "complete" | "failed" | "both" {
    if (this.config.finalSummaryMode) return this.config.finalSummaryMode;
    return this.usesLiveCardUpdates() ? "both" : "none";
  }

  private shouldSendFinalSummary(kind: FeishuOutboundMessage["kind"]): boolean {
    const mode = this.resolveFinalSummaryMode();
    if (mode === "none") return false;
    if (mode === "both") return kind === "task-complete" || kind === "task-failed";
    if (mode === "complete") return kind === "task-complete";
    return kind === "task-failed";
  }

  private resolveTerminalCardDetail(
    kind: "task-complete" | "task-failed",
    fallback: string | undefined
  ): string | undefined {
    if (!this.usesLiveCardUpdates()) return fallback;
    return kind === "task-complete"
      ? "任务已完成，最终答案已单独发送"
      : "任务执行失败，错误摘要已单独发送";
  }

  private enqueueDelivery(taskId: string, deliver: () => Promise<void>): Promise<void> {
    const previous = this.deliveryQueues.get(taskId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(deliver);
    const tracked = next.finally(() => {
      if (this.deliveryQueues.get(taskId) === tracked) {
        this.deliveryQueues.delete(taskId);
      }
    });
    this.deliveryQueues.set(taskId, tracked);
    return tracked;
  }

  private withReplyContext(taskId: string, message: FeishuOutboundMessage): FeishuOutboundMessage {
    const subscription = this.subscriptions.get(taskId);
    if (!subscription) return message;

    const replyToMessageId = subscription.firstMessageId ?? subscription.replyToMessageId;
    const rootMessageId =
      subscription.rootId ?? subscription.firstMessageId ?? subscription.target.rootMessageId;
    return {
      ...message,
      target: {
        ...message.target,
        threadId: subscription.threadId ?? message.target.threadId,
        replyToMessageId,
        rootMessageId,
      },
    };
  }

  private withMessageFormat(message: FeishuOutboundMessage): FeishuOutboundMessage {
    if (!this.usesCardRendering(message)) {
      return {
        ...message,
        card: undefined,
      };
    }
    const cardMessage = this.usesLiveCardUpdates()
      ? {
          ...message,
          summary: undefined,
        }
      : message;
    return {
      ...cardMessage,
      card: cardMessage.card ?? createTaskCard(cardMessage),
    };
  }

  private async sendAndTrack(taskId: string, message: FeishuOutboundMessage): Promise<void> {
    const formatted = this.withMessageFormat(message);
    const subscription = this.subscriptions.get(taskId);

    if (
      subscription &&
      this.usesLiveCardUpdates() &&
      formatted.card &&
      subscription.firstMessageId &&
      this.delivery.update
    ) {
      await this.delivery.update(subscription.firstMessageId, formatted);
      subscription.lastMessageId = subscription.firstMessageId;
      return;
    }

    const receipt = await this.delivery.send(this.withReplyContext(taskId, formatted));
    if (!subscription || !receipt) return;
    subscription.firstMessageId ??= receipt.messageId;
    subscription.lastMessageId = receipt.messageId ?? subscription.lastMessageId;
    subscription.rootId = receipt.rootId ?? subscription.rootId ?? subscription.firstMessageId;
    subscription.threadId = receipt.threadId ?? subscription.threadId;
    subscription.replyToMessageId = subscription.firstMessageId ?? subscription.replyToMessageId;
  }

  private async sendFinalSummaryIfNeeded(
    taskId: string,
    message: FeishuOutboundMessage
  ): Promise<void> {
    const subscription = this.subscriptions.get(taskId);
    if (!subscription) return;
    if (subscription.target.suppressFinalSummary) return;
    if (!this.shouldSendFinalSummary(message.kind)) return;
    const finalKind =
      message.kind === "task-complete" || message.kind === "task-failed"
        ? message.kind
        : null;
    if (!finalKind) return;
    if (subscription.finalSummarySentFor === finalKind) return;

    subscription.finalSummarySentFor = finalKind;
    const receipt = await this.delivery.send(
      this.withReplyContext(taskId, {
        ...message,
        card: undefined,
        presentation: "text",
      })
    );
    if (!receipt) return;
    subscription.lastMessageId = receipt.messageId ?? subscription.lastMessageId;
    subscription.rootId = receipt.rootId ?? subscription.rootId;
    subscription.threadId = receipt.threadId ?? subscription.threadId;
  }
}
