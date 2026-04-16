import { describe, expect, it, vi } from "vitest";
import {
  FeishuProgressBridge,
  type FeishuOutboundMessage,
} from "../feishu/bridge.js";
import type { FeishuTaskRecord } from "../feishu/task-store.js";

function makeTask(partial: Partial<FeishuTaskRecord>): FeishuTaskRecord {
  return {
    id: "task_123",
    kind: "chat",
    title: "Analyze repository and report progress",
    status: "running",
    progress: 10,
    currentStageKey: "understand",
    stages: [
      { key: "receive", label: "接收请求", status: "done" },
      {
        key: "understand",
        label: "理解问题",
        status: "running",
        detail: "Understanding",
      },
      { key: "planning", label: "规划执行", status: "pending" },
      { key: "execution", label: "执行处理", status: "pending" },
      { key: "finalize", label: "整理答复", status: "pending" },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [{ type: "created", message: "Task created", time: Date.now() }],
    ...partial,
  };
}

describe("FeishuProgressBridge", () => {
  it("sends ack on the first task update", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge(
      {
        send: async message => {
          sent.push(message);
          return { messageId: `om_${sent.length}` };
        },
      },
      { baseTaskUrl: "https://demo.example.com" }
    );
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 12 }));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("task-ack");
    expect(sent[0]?.text).toContain("任务已开始");
    expect(sent[0]?.link).toBe("https://demo.example.com/tasks/task_123");
    expect(bridge.getTaskBinding("task_123")?.firstMessageId).toBe("om_1");
  });

  it("throttles low-signal log updates", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge(
      {
        send: async message => {
          sent.push(message);
        },
      },
      { progressThrottlePercent: 20 }
    );
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        progress: 15,
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          {
            type: "log",
            message: "Minor update",
            progress: 15,
            time: Date.now(),
          },
        ],
      })
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("task-ack");
  });

  it("sends waiting updates with decision options and reply context", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge({
      send: async message => {
        sent.push(message);
        return { messageId: `om_${sent.length}` };
      },
    });
    bridge.bindTask("task_123", {
      chatId: "oc_123",
      source: "feishu",
      requestId: "om_user_1",
      replyToMessageId: "om_user_1",
      rootMessageId: "om_user_1",
    });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        status: "waiting",
        progress: 68,
        waitingFor: "Need product direction",
        decision: {
          prompt: "请选择下一步",
          options: [
            { id: "1", label: "继续分析" },
            { id: "2", label: "只出报告" },
          ],
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          {
            type: "waiting",
            message: "Need product direction",
            time: Date.now(),
          },
        ],
      })
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]?.kind).toBe("task-waiting");
    expect(sent[1]?.decision?.options).toHaveLength(2);
    expect(sent[1]?.text).toContain("请选择下一步");
    expect(sent[0]?.target.replyToMessageId).toBe("om_user_1");
    expect(sent[1]?.target.replyToMessageId).toBe("om_1");
    expect(sent[1]?.target.rootMessageId).toBe("om_user_1");
  });

  it("sends completion and failure terminal updates", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge({
      send: async message => {
        sent.push(message);
        return { messageId: `om_${sent.length}` };
      },
    });
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        status: "done",
        progress: 100,
        summary: "Everything finished",
        currentStageKey: "finalize",
        stages: [
          { key: "receive", label: "接收请求", status: "done" },
          { key: "understand", label: "理解问题", status: "done" },
          { key: "planning", label: "规划执行", status: "done" },
          { key: "execution", label: "执行处理", status: "done" },
          { key: "finalize", label: "整理答复", status: "done" },
        ],
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          { type: "done", message: "Everything finished", time: Date.now() },
        ],
      })
    );

    const secondBridge = new FeishuProgressBridge({
      send: async message => {
        sent.push(message);
        return { messageId: `om_${sent.length}` };
      },
    });
    secondBridge.bindTask("task_456", { chatId: "oc_456", source: "feishu" });
    await secondBridge.handleTaskUpdate(
      makeTask({
        id: "task_456",
        progress: 10,
      })
    );
    await secondBridge.handleTaskUpdate(
      makeTask({
        id: "task_456",
        status: "failed",
        progress: 90,
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          {
            type: "failed",
            message: "Pipeline failed because of bad config",
            level: "error",
            time: Date.now(),
          },
        ],
      })
    );

    expect(sent.map(message => message.kind)).toContain("task-complete");
    expect(sent.map(message => message.kind)).toContain("task-failed");
  });

  it("renders escalate decision with red/danger buttons and red card template", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge(
      {
        send: async message => {
          sent.push(message);
          return { messageId: `om_${sent.length}` };
        },
      },
      { messageFormat: "card" }
    );
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        status: "waiting",
        progress: 50,
        waitingFor: "Escalation needed",
        decision: {
          prompt: "紧急升级确认",
          type: "escalate",
          options: [
            { id: "1", label: "确认升级" },
            { id: "2", label: "取消" },
          ],
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          { type: "waiting", message: "Escalation needed", time: Date.now() },
        ],
      })
    );

    const waitingMsg = sent.find(m => m.kind === "task-waiting");
    expect(waitingMsg).toBeDefined();
    expect(waitingMsg!.card).toBeDefined();
    expect(waitingMsg!.card!.header.template).toBe("red");

    const buttons = waitingMsg!.card!.body.elements.filter(
      (el: Record<string, unknown>) => el.tag === "button" && el.behaviors
    );
    // All escalate buttons should be "danger"
    for (const btn of buttons) {
      if ((btn as any).behaviors?.[0]?.type === "callback") {
        expect((btn as any).type).toBe("danger");
      }
    }

    // Check the prompt has the 🔴 prefix
    const promptDiv = waitingMsg!.card!.body.elements.find(
      (el: Record<string, unknown>) =>
        el.tag === "div" && (el.text as any)?.content?.includes("待确认")
    );
    expect((promptDiv as any).text.content).toContain("🔴");
  });

  it("renders approve/reject decision with primary/danger button types", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge(
      {
        send: async message => {
          sent.push(message);
          return { messageId: `om_${sent.length}` };
        },
      },
      { messageFormat: "card" }
    );
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        status: "waiting",
        progress: 60,
        waitingFor: "Approval needed",
        decision: {
          prompt: "请审批执行计划",
          type: "approve",
          options: [
            { id: "approve", label: "批准" },
            { id: "reject", label: "拒绝" },
          ],
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          { type: "waiting", message: "Approval needed", time: Date.now() },
        ],
      })
    );

    const waitingMsg = sent.find(m => m.kind === "task-waiting");
    expect(waitingMsg!.card).toBeDefined();
    // approve type should NOT override to red template
    expect(waitingMsg!.card!.header.template).toBe("orange");

    const callbackButtons = waitingMsg!.card!.body.elements.filter(
      (el: Record<string, unknown>) =>
        el.tag === "button" && (el as any).behaviors?.[0]?.type === "callback"
    );
    expect(callbackButtons).toHaveLength(2);
    expect((callbackButtons[0] as any).type).toBe("primary");
    expect((callbackButtons[1] as any).type).toBe("danger");
  });

  it("uses option.label as button text instead of id.label format", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge(
      {
        send: async message => {
          sent.push(message);
          return { messageId: `om_${sent.length}` };
        },
      },
      { messageFormat: "card" }
    );
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        status: "waiting",
        progress: 50,
        waitingFor: "Choice needed",
        decision: {
          prompt: "选择方向",
          options: [
            { id: "opt-a", label: "方案 A" },
            { id: "opt-b", label: "方案 B" },
          ],
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          { type: "waiting", message: "Choice needed", time: Date.now() },
        ],
      })
    );

    const waitingMsg = sent.find(m => m.kind === "task-waiting");
    const callbackButtons = waitingMsg!.card!.body.elements.filter(
      (el: Record<string, unknown>) =>
        el.tag === "button" && (el as any).behaviors?.[0]?.type === "callback"
    );
    // Button text should be just the label, not "id. label"
    expect((callbackButtons[0] as any).text.content).toBe("方案 A");
    expect((callbackButtons[1] as any).text.content).toBe("方案 B");
  });

  it("sends decision-resolved update with resolvedDecision when transitioning from waiting to running", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge({
      send: async message => {
        sent.push(message);
        return { messageId: `om_${sent.length}` };
      },
    });
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    // 1. ack
    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    // 2. waiting
    await bridge.handleTaskUpdate(
      makeTask({
        status: "waiting",
        progress: 50,
        waitingFor: "Need approval",
        decision: {
          prompt: "请审批",
          options: [
            { id: "1", label: "批准" },
            { id: "2", label: "拒绝" },
          ],
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          { type: "waiting", message: "Need approval", time: Date.now() },
        ],
      })
    );
    // 3. decision resolved → running
    await bridge.handleTaskUpdate(
      makeTask({
        status: "running",
        progress: 55,
        lastResolvedDecision: {
          optionId: "1",
          optionLabel: "批准",
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          {
            type: "decision",
            message: "Decision received: 批准",
            time: Date.now(),
          },
        ],
      })
    );

    expect(sent).toHaveLength(3);
    const resolvedMsg = sent[2];
    expect(resolvedMsg.kind).toBe("task-progress");
    expect(resolvedMsg.text).toContain("任务已决策");
    expect(resolvedMsg.text).toContain("批准");
    expect(resolvedMsg.text).toContain("决策时间");
    expect(resolvedMsg.resolvedDecision).toEqual({
      optionId: "1",
      optionLabel: "批准",
    });
  });

  it("renders severity=danger option as danger button regardless of decision type", async () => {
    const sent: FeishuOutboundMessage[] = [];
    const bridge = new FeishuProgressBridge(
      {
        send: async message => {
          sent.push(message);
          return { messageId: `om_${sent.length}` };
        },
      },
      { messageFormat: "card" }
    );
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    await bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    await bridge.handleTaskUpdate(
      makeTask({
        status: "waiting",
        progress: 50,
        waitingFor: "Risk check",
        decision: {
          prompt: "风险确认",
          type: "custom-action",
          options: [
            { id: "1", label: "接受风险", severity: "danger" },
            { id: "2", label: "缓解" },
          ],
        },
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          { type: "waiting", message: "Risk check", time: Date.now() },
        ],
      })
    );

    const waitingMsg = sent.find(m => m.kind === "task-waiting");
    const callbackButtons = waitingMsg!.card!.body.elements.filter(
      (el: Record<string, unknown>) =>
        el.tag === "button" && (el as any).behaviors?.[0]?.type === "callback"
    );
    expect((callbackButtons[0] as any).type).toBe("danger");
    expect((callbackButtons[1] as any).type).toBe("default");
  });

  it("serializes progress delivery for the same task", async () => {
    vi.useFakeTimers();
    const sent: Array<{ kind: string; progress: number }> = [];
    const bridge = new FeishuProgressBridge({
      send: async message => {
        const delay =
          message.progress === 10 ? 30 : message.progress === 18 ? 20 : 10;
        await new Promise(resolve => setTimeout(resolve, delay));
        sent.push({ kind: message.kind, progress: message.progress });
        return { messageId: `om_${sent.length}` };
      },
    });
    bridge.bindTask("task_123", { chatId: "oc_123", source: "feishu" });

    const first = bridge.handleTaskUpdate(makeTask({ progress: 10 }));
    const second = bridge.handleTaskUpdate(
      makeTask({
        progress: 18,
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          {
            type: "progress",
            message: "Classified request",
            progress: 18,
            time: Date.now(),
          },
        ],
      })
    );
    const third = bridge.handleTaskUpdate(
      makeTask({
        progress: 30,
        events: [
          { type: "created", message: "Task created", time: Date.now() },
          {
            type: "progress",
            message: "Gathering context",
            progress: 30,
            time: Date.now(),
          },
        ],
      })
    );

    await vi.runAllTimersAsync();
    await Promise.all([first, second, third]);

    expect(sent).toEqual([
      { kind: "task-ack", progress: 10 },
      { kind: "task-progress", progress: 18 },
      { kind: "task-progress", progress: 30 },
    ]);
    vi.useRealTimers();
  });
});
