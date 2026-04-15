import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useAppStore } from "@/lib/store";
import type { MissionTaskDetail, MissionTaskSummary } from "@/lib/tasks-store";

import { MissionWallTaskPanel } from "../MissionWallTaskPanel";

function makeMission(
  overrides?: Partial<MissionTaskSummary>
): MissionTaskSummary {
  return {
    id: "mission-1",
    title: "Wall Monitor Mission",
    kind: "chat",
    sourceText: "Monitor task",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 46,
    currentStageKey: "execute",
    currentStageLabel: "Run execution",
    summary: "Mission summary",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    departmentLabels: [],
    taskCount: 4,
    completedTaskCount: 1,
    messageCount: 0,
    activeAgentCount: 3,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: "All systems nominal",
    ...overrides,
  };
}

function makeDetail(
  overrides?: Partial<MissionTaskDetail>
): MissionTaskDetail {
  return {
    ...makeMission(),
    workflow: {
      id: "workflow-1",
      directive: "Monitor task",
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

describe("MissionWallTaskPanel", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "en-US" });
  });

  it("renders a stable standby wall monitor when mission is missing", () => {
    const markup = renderToStaticMarkup(
      <MissionWallTaskPanel mission={null} detail={null} />
    );

    expect(markup).toContain("Mission Control");
    expect(markup).toContain("MC");
    expect(markup).toContain("0%");
  });

  it("renders mission title, stage, and progress for the active task", () => {
    const mission = makeMission();
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <MissionWallTaskPanel mission={mission} detail={detail} />
    );

    expect(markup).toContain("Wall Monitor Mission");
    expect(markup).toContain("Run execution");
    expect(markup).toContain("46%");
    expect(markup).toContain("MC");
  });
});
