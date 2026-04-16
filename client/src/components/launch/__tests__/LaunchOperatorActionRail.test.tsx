import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  missionOperatorActionLabel,
  missionOperatorStateLabel,
} from "@/components/tasks/task-helpers";
import type { MissionTaskDetail } from "@/lib/tasks-store";
import { useAppStore } from "@/lib/store";
import type { MissionOperatorActionRecord } from "@shared/mission/contracts";

import { LaunchOperatorActionRail } from "../LaunchOperatorActionRail";

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

describe("LaunchOperatorActionRail", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "zh-CN" });
  });

  it("shows operator state, latest action summary, and available actions", () => {
    const detail = makeDetail({
      latestOperatorAction: makeOperatorAction({
        action: "pause",
        reason: "Need to inspect the run",
      }),
    });

    const markup = renderToStaticMarkup(
      <LaunchOperatorActionRail detail={detail} loadingByAction={{}} />
    );

    expect(markup).toContain(missionOperatorStateLabel("active", "zh-CN"));
    expect(markup).toContain(missionOperatorActionLabel("pause", "zh-CN"));
    expect(markup).toContain(
      missionOperatorActionLabel("mark-blocked", "zh-CN")
    );
    expect(markup).toContain(missionOperatorActionLabel("terminate", "zh-CN"));
    expect(markup).toContain("Need to inspect the run");
  });

  it("switches the primary control for blocked missions", () => {
    const detail = makeDetail({
      status: "waiting",
      operatorState: "blocked",
      blocker: {
        reason: "Waiting for PM sign-off",
        createdAt: Date.now(),
        createdBy: "operator",
      },
      latestOperatorAction: makeOperatorAction({
        action: "mark-blocked",
        reason: "Waiting for PM sign-off",
      }),
    });

    const markup = renderToStaticMarkup(
      <LaunchOperatorActionRail detail={detail} loadingByAction={{}} />
    );

    expect(markup).toContain(missionOperatorStateLabel("blocked", "zh-CN"));
    expect(markup).toContain(missionOperatorActionLabel("resume", "zh-CN"));
    expect(markup).toContain(missionOperatorActionLabel("retry", "zh-CN"));
    expect(markup).toContain("Waiting for PM sign-off");
  });
});
