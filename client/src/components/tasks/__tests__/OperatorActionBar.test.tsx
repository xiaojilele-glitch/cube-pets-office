import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MissionTaskDetail } from "@/lib/tasks-store";
import { useAppStore } from "@/lib/store";
import type { MissionOperatorActionRecord } from "@shared/mission/contracts";

import {
  OperatorActionBar,
  operatorActionRequiresConfirmation,
  operatorActionRequiresReason,
  resolvePrimaryOperatorAction,
} from "../OperatorActionBar";

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

function makeDetail(overrides?: Partial<MissionTaskDetail>): MissionTaskDetail {
  return {
    id: "mission-1",
    title: "Mission Control Test",
    kind: "chat",
    sourceText: "Test mission",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 48,
    currentStageKey: "execute",
    currentStageLabel: "Run execution",
    summary: "Mission is running.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    departmentLabels: [],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 0,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    workflow: {
      id: "workflow-1",
      directive: "Test mission",
      status: "running",
      current_stage: "execute",
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date().toISOString(),
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
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    ...overrides,
  };
}

function renderBar(detail: MissionTaskDetail): string {
  return renderToStaticMarkup(
    <OperatorActionBar detail={detail} loadingByAction={{}} />
  );
}

describe("OperatorActionBar", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "zh-CN" });
  });

  it("shows pause, mark blocked, and terminate for active running missions", () => {
    const markup = renderBar(makeDetail());

    expect(markup).toContain("任务操作");
    expect(markup).toContain("暂停");
    expect(markup).toContain("标记阻塞");
    expect(markup).toContain("终止");
    expect(markup).not.toContain("恢复");
    expect(markup).not.toContain("重试");
  });

  it("shows blocker context and retry/resume controls for blocked missions", () => {
    const markup = renderBar(
      makeDetail({
        status: "waiting",
        operatorState: "blocked",
        attempt: 3,
        blocker: {
          reason: "Waiting for PM sign-off",
          createdAt: Date.now(),
          createdBy: "operator",
        },
        latestOperatorAction: makeOperatorAction({
          action: "mark-blocked",
          reason: "Waiting for PM sign-off",
        }),
      })
    );

    expect(markup).toContain("已阻塞");
    expect(markup).toContain("第 3 次尝试");
    expect(markup).toContain("当前阻塞");
    expect(markup).toContain("Waiting for PM sign-off");
    expect(markup).toContain("恢复");
    expect(markup).toContain("重试");
    expect(markup).toContain("终止");
  });

  it("shows paused state and resume action", () => {
    const markup = renderBar(
      makeDetail({
        operatorState: "paused",
        latestOperatorAction: makeOperatorAction({
          action: "pause",
          reason: "Need to inspect the current run",
        }),
      })
    );

    expect(markup).toContain("已暂停");
    expect(markup).toContain("恢复");
    expect(markup).not.toContain("标记阻塞");
  });

  it("derives a single primary operator action for the first screen", () => {
    expect(resolvePrimaryOperatorAction(makeDetail())).toBe("pause");
    expect(
      resolvePrimaryOperatorAction(
        makeDetail({
          status: "waiting",
          operatorState: "blocked",
          blocker: {
            reason: "Need PM sign-off",
            createdAt: Date.now(),
            createdBy: "ops-user",
          },
        })
      )
    ).toBe("resume");
  });

  it("exports interaction requirements for blocker reason and terminate confirmation", () => {
    expect(operatorActionRequiresReason("mark-blocked")).toBe(true);
    expect(operatorActionRequiresReason("pause")).toBe(false);
    expect(operatorActionRequiresConfirmation("terminate")).toBe(true);
    expect(operatorActionRequiresConfirmation("retry")).toBe(false);
  });
});
