import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MissionTaskDetail } from "@/lib/tasks-store";
import { useAppStore } from "@/lib/store";
import type {
  MissionDecision,
  MissionOperatorActionRecord,
} from "@shared/mission/contracts";

import { TaskOperationsHero } from "../TaskOperationsHero";

function makeOperatorAction(
  overrides?: Partial<MissionOperatorActionRecord>
): MissionOperatorActionRecord {
  return {
    id: "action-1",
    action: "pause",
    createdAt: Date.now(),
    result: "completed",
    ...overrides,
  };
}

function makeDecision(overrides?: Partial<MissionDecision>): MissionDecision {
  return {
    prompt: "Approve the next release step?",
    options: [
      {
        id: "approve",
        label: "Approve",
        description: "Continue the mission",
      },
    ],
    allowFreeText: true,
    placeholder: "Add optional approval detail",
    decisionId: "decision-1",
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<MissionTaskDetail>): MissionTaskDetail {
  return {
    id: "mission-1",
    title: "Ship the artifact bundle",
    kind: "analysis",
    sourceText: "Review the runtime output and deliver the final artifacts.",
    status: "waiting",
    operatorState: "active",
    workflowStatus: "running",
    progress: 62,
    currentStageKey: "finalize",
    currentStageLabel: "Await approval",
    summary: "The runtime has produced a candidate artifact bundle.",
    waitingFor: "Approve the release handoff so the mission can continue.",
    blocker: null,
    attempt: 2,
    latestOperatorAction: null,
    createdAt: Date.now() - 300_000,
    updatedAt: Date.now() - 45_000,
    startedAt: Date.now() - 240_000,
    completedAt: null,
    departmentLabels: ["Engineering", "QA"],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 0,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: "Waiting for operator approval before publishing artifacts.",
    workflow: {
      id: "workflow-1",
      directive: "Review the runtime output and deliver the final artifacts.",
      status: "running",
      current_stage: "finalize",
      departments_involved: ["Engineering", "QA"],
      started_at: new Date(Date.now() - 240_000).toISOString(),
      completed_at: null,
      results: null,
      created_at: new Date(Date.now() - 300_000).toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [],
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [
      {
        id: "approve",
        label: "Approve",
        description: "Publish the current artifact bundle.",
        prompt: "Approve the final artifact bundle.",
        tone: "primary",
        action: "mission",
      },
    ],
    decisionPrompt: "Approve the final artifact bundle.",
    decisionPlaceholder: "Add optional approval notes",
    decisionAllowsFreeText: true,
    decision: makeDecision(),
    instanceInfo: [],
    logSummary: [],
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    executor: {
      name: "lobster",
      jobId: "job-1",
      status: "waiting",
    },
    instance: {
      image: "workspace-runner:latest",
    },
    ...overrides,
  };
}

function renderHero(detail: MissionTaskDetail): string {
  return renderToStaticMarkup(
    <TaskOperationsHero detail={detail} loadingByAction={{}} />
  );
}

describe("TaskOperationsHero", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "zh-CN" });
  });

  it("renders the first-screen modules in the expected order for waiting missions", () => {
    const markup = renderHero(makeDetail());

    expect(markup).toContain("建议优先操作");
    expect(markup).toContain("任务操作");
    expect(markup).toContain("当前负责人");
    expect(markup).toContain("阻塞 / 等待");
    expect(markup).toContain("下一步动作");
    expect(markup).toContain("执行阶段 / 运行态");
    expect(markup).toContain("需要用户决策");
    expect(markup).toContain("提交待处理决策");

    expect(markup.indexOf("任务操作")).toBeLessThan(
      markup.indexOf("当前负责人")
    );
    expect(markup.indexOf("当前负责人")).toBeLessThan(
      markup.indexOf("阻塞 / 等待")
    );
    expect(markup.indexOf("阻塞 / 等待")).toBeLessThan(
      markup.indexOf("下一步动作")
    );
    expect(markup.indexOf("下一步动作")).toBeLessThan(
      markup.indexOf("执行阶段 / 运行态")
    );
  });

  it("shows blocker detail in the summary cards without duplicating the action-bar blocker banner", () => {
    const markup = renderHero(
      makeDetail({
        operatorState: "blocked",
        decision: null,
        decisionPresets: [],
        decisionPrompt: null,
        waitingFor: "Still waiting on release approval.",
        blocker: {
          reason: "Need PM sign-off before publishing.",
          createdAt: Date.now() - 180_000,
          createdBy: "ops-user",
        },
        latestOperatorAction: makeOperatorAction({
          action: "mark-blocked",
          requestedBy: "ops-user",
          reason: "Need PM sign-off before publishing.",
        }),
      })
    );

    expect(markup).toContain("已阻塞");
    expect(markup).toContain("Need PM sign-off before publishing.");
    expect(markup).toContain("ops-user");
    expect(markup).not.toContain("当前阻塞");
  });
});
