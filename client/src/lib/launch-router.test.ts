import { describe, expect, it } from "vitest";

import type { WorkflowInputAttachment } from "@shared/workflow-input";

import { evaluateLaunchRoute } from "./launch-router";

function makeAttachment(
  overrides?: Partial<WorkflowInputAttachment>
): WorkflowInputAttachment {
  return {
    id: "attachment-1",
    name: "brief.md",
    mimeType: "text/markdown",
    size: 128,
    content: "# brief",
    excerpt: "# brief",
    excerptStatus: "parsed",
    ...overrides,
  };
}

describe("launch-router", () => {
  it("routes a complete text-only brief to the mission path", () => {
    const decision = evaluateLaunchRoute({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(decision.kind).toBe("mission");
    expect(decision.needsClarification).toBe(false);
    expect(decision.reasons).toContain("complete_task_brief");
  });

  it("routes underspecified input to the clarification path", () => {
    const decision = evaluateLaunchRoute({
      text: "帮我推进这个任务",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(decision.kind).toBe("clarify");
    expect(decision.needsClarification).toBe(true);
    expect(decision.reasons).toContain("command_too_short");
  });

  it("routes attachment-heavy input to the workflow path", () => {
    const decision = evaluateLaunchRoute({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [makeAttachment()],
    });

    expect(decision.kind).toBe("workflow");
    expect(decision.needsClarification).toBe(false);
    expect(decision.reasons).toContain("attachments_present");
    expect(decision.reasons).toContain("attachment_context_requested");
  });

  it("requires a runtime upgrade when the request needs real execution in frontend mode", () => {
    const decision = evaluateLaunchRoute({
      text: "在沙盒里打开浏览器验证支付页面，抓日志并输出测试结果和回滚建议。",
      runtimeMode: "frontend",
      attachments: [],
    });

    expect(decision.kind).toBe("upgrade-required");
    expect(decision.requiresAdvancedRuntime).toBe(true);
    expect(decision.reasons).toContain("advanced_runtime_required");
  });
});

