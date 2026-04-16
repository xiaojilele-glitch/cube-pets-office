import { describe, expect, it } from "vitest";

import type { WorkflowInfo } from "@/lib/runtime/types";
import type { MissionTaskSummary } from "@/lib/tasks-store";

import {
  getSceneStageColor,
  getSceneStageRoute,
  getSceneStageSignal,
} from "./scene-stage-flow";

function makeMissionTask(
  id: string,
  overrides: Partial<MissionTaskSummary> = {}
): MissionTaskSummary {
  return {
    id,
    title: `Mission ${id}`,
    kind: "general",
    sourceText: "source",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 54,
    currentStageKey: "execution",
    currentStageLabel: "Run execution",
    summary: "Mission is in motion.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: 10,
    updatedAt: 20,
    startedAt: 12,
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
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<WorkflowInfo> = {}): WorkflowInfo {
  return {
    id: "wf-1",
    directive: "Create the next workflow pass",
    status: "running",
    current_stage: "review",
    departments_involved: [],
    started_at: "2026-04-11T10:00:00.000Z",
    completed_at: null,
    results: {},
    created_at: "2026-04-11T09:50:00.000Z",
    ...overrides,
  };
}

describe("scene-stage-flow config", () => {
  it("resolves workflow and mission stage aliases to stable routes", () => {
    expect(getSceneStageRoute("execution")?.zones).toEqual([
      "podA",
      "podB",
      "podC",
    ]);
    expect(getSceneStageRoute("execute")?.semantic).toBe("execution");
    expect(getSceneStageRoute("finalize")?.semantic).toBe("summary");
  });

  it("uses the selected active mission before workflow fallback", () => {
    const selectedMission = makeMissionTask("mission-2", {
      status: "waiting",
      currentStageKey: "verify",
      currentStageLabel: "Validate output",
      summary: "Waiting for a final validation pass.",
    });
    const runningMission = makeMissionTask("mission-1", {
      currentStageKey: "execution",
    });

    const signal = getSceneStageSignal({
      locale: "en-US",
      tasks: [runningMission, selectedMission],
      selectedTaskId: "mission-2",
      currentWorkflow: makeWorkflow({ current_stage: "review" }),
    });

    expect(signal?.source).toBe("mission");
    expect(signal?.stageKey).toBe("verify");
    expect(signal?.zones).toEqual(["podC", "podD", "mission"]);
  });

  it("falls back to the current workflow when no active mission exists", () => {
    const signal = getSceneStageSignal({
      locale: "zh-CN",
      tasks: [
        makeMissionTask("mission-done", {
          status: "done",
          currentStageKey: "summary",
        }),
      ],
      selectedTaskId: null,
      currentWorkflow: makeWorkflow({
        current_stage: "planning",
        status: "running",
      }),
    });

    expect(signal?.source).toBe("workflow");
    expect(signal?.stageKey).toBe("planning");
    expect(signal?.stageLabel).toBe("\u4efb\u52a1\u89c4\u5212");
  });

  it("returns null when nothing active is running", () => {
    const signal = getSceneStageSignal({
      locale: "en-US",
      tasks: [makeMissionTask("mission-done", { status: "done" })],
      selectedTaskId: null,
      currentWorkflow: makeWorkflow({
        status: "completed",
        current_stage: "summary",
      }),
    });

    expect(signal).toBeNull();
  });

  it("shares semantic colors across native and workflow stage variants", () => {
    expect(getSceneStageColor("execution")).toBe(getSceneStageColor("execute"));
    expect(getSceneStageColor("meta_audit")).not.toBe("#C98257");
  });
});
