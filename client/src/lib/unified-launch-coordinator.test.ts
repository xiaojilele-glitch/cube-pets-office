import { beforeEach, describe, expect, it, vi } from "vitest";

const selectTask = vi.fn();
const createMission = vi.fn();
const submitTaskHubCommand = vi.fn();
const submitTaskHubClarification = vi.fn();
const submitDirective = vi.fn();

vi.mock("./tasks-store", () => ({
  useTasksStore: {
    getState: () => ({
      selectTask,
      createMission,
    }),
  },
}));

vi.mock("./nl-command-store", () => ({
  useNLCommandStore: {
    getState: () => ({
      submitTaskHubCommand,
      submitTaskHubClarification,
    }),
  },
}));

vi.mock("./workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      submitDirective,
    }),
  },
}));

describe("unified-launch-coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses the mission after a mission-path launch succeeds", async () => {
    submitTaskHubCommand.mockResolvedValue({
      commandId: "cmd-1",
      commandText: "整理支付模块任务",
      missionId: "mission-1",
      relatedMissionIds: ["mission-1"],
      autoSelectedMissionId: "mission-1",
      status: "created",
      createdAt: Date.now(),
    });

    const { submitUnifiedLaunch } =
      await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(result).toMatchObject({
      route: "mission",
      missionId: "mission-1",
      status: "created",
    });
    expect(selectTask).toHaveBeenCalledWith("mission-1");
    expect(submitTaskHubCommand).toHaveBeenCalledTimes(1);
  });

  it("focuses the mission after a workflow-path launch returns missionId", async () => {
    submitDirective.mockResolvedValue({
      workflowId: "wf-1",
      missionId: "mission-2",
      deduped: false,
    });

    const { submitUnifiedLaunch } =
      await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [
        {
          id: "attachment-1",
          name: "brief.md",
          mimeType: "text/markdown",
          size: 128,
          content: "# brief",
          excerpt: "# brief",
          excerptStatus: "parsed",
        },
      ],
    });

    expect(result).toMatchObject({
      route: "workflow",
      workflowId: "wf-1",
      missionId: "mission-2",
    });
    expect(selectTask).toHaveBeenCalledWith("mission-2");
    expect(submitDirective).toHaveBeenCalledTimes(1);
  });

  it("keeps focus stable in deduped workflow launches", async () => {
    submitDirective.mockResolvedValue({
      workflowId: "wf-deduped",
      missionId: "mission-deduped",
      deduped: true,
    });

    const { submitUnifiedLaunch } =
      await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [
        {
          id: "attachment-1",
          name: "brief.md",
          mimeType: "text/markdown",
          size: 128,
          content: "# brief",
          excerpt: "# brief",
          excerptStatus: "parsed",
        },
      ],
    });

    expect(result).toMatchObject({
      route: "workflow",
      workflowId: "wf-deduped",
      missionId: "mission-deduped",
      deduped: true,
    });
    expect(selectTask).toHaveBeenCalledWith("mission-deduped");
  });

  it("does not submit launch requests before runtime upgrade is completed", async () => {
    const { submitUnifiedLaunch } =
      await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "打开浏览器检查生产页面，抓日志并给出回滚方案、验收标准和本周时间安排。",
      runtimeMode: "frontend",
      attachments: [],
    });

    expect(result).toMatchObject({
      route: "upgrade-required",
      upgraded: false,
    });
    expect(submitTaskHubCommand).not.toHaveBeenCalled();
    expect(submitDirective).not.toHaveBeenCalled();
    expect(selectTask).not.toHaveBeenCalled();
  });

  it("focuses the mission after clarification submission resolves creation", async () => {
    submitTaskHubClarification.mockResolvedValue({
      commandId: "cmd-clarify-1",
      commandText: "整理支付模块任务",
      missionId: "mission-clarified",
      relatedMissionIds: ["mission-clarified"],
      autoSelectedMissionId: "mission-clarified",
      status: "created",
      createdAt: Date.now(),
    });

    const { submitUnifiedClarification } =
      await import("./unified-launch-coordinator");
    const result = await submitUnifiedClarification({
      commandId: "cmd-clarify-1",
      answer: {
        questionId: "timeline",
        text: "本周内完成，并提供验收标准与回滚方案。",
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      route: "mission",
      missionId: "mission-clarified",
      status: "created",
    });
    expect(submitTaskHubClarification).toHaveBeenCalledTimes(1);
    expect(selectTask).toHaveBeenCalledWith("mission-clarified");
  });
});
