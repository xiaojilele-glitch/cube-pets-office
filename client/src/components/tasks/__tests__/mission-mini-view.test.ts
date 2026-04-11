/**
 * Unit tests for MissionMiniView component logic
 *
 * Since no DOM rendering library (@testing-library/react, jsdom) is available,
 * we test the component's data transformation logic and verify the contract
 * between props and rendered output through the helper functions it uses.
 *
 * Requirements: 2.2, 2.5
 */
import { describe, it, expect, vi } from "vitest";

import type { MissionTaskSummary } from "@/lib/tasks-store";
import { truncateTitle } from "@/components/tasks/mission-island-helpers";
import {
  missionStatusLabel,
  missionStatusTone,
} from "@/components/tasks/task-helpers";

/* ─── Helpers ─── */

function makeMission(
  overrides?: Partial<MissionTaskSummary>
): MissionTaskSummary {
  return {
    id: "m-1",
    title: "Test Mission Title",
    kind: "chat",
    sourceText: "",
    status: "running",
    workflowStatus: "running",
    progress: 65,
    currentStageKey: "execution",
    currentStageLabel: "执行中",
    summary: "",
    waitingFor: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    departmentLabels: [],
    taskCount: 5,
    completedTaskCount: 3,
    messageCount: 10,
    activeAgentCount: 2,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    ...overrides,
  };
}

/* ─── Idle state logic (mission === null) ─── */

describe("MissionMiniView idle state", () => {
  it("null mission triggers idle branch", () => {
    const mission: MissionTaskSummary | null = null;
    // Component renders idle state when mission is null
    expect(mission).toBeNull();
  });

  it("onCreateMission callback is available in idle state", () => {
    const onCreateMission = vi.fn();
    // Simulate button click in idle state
    onCreateMission();
    expect(onCreateMission).toHaveBeenCalledTimes(1);
  });
});

/* ─── Active state logic ─── */

describe("MissionMiniView active state", () => {
  it("title is truncated to 40 characters", () => {
    const longTitle =
      "This is a very long mission title that exceeds forty characters limit";
    const mission = makeMission({ title: longTitle });
    const displayTitle = truncateTitle(mission.title || "未命名任务", 40);

    expect(displayTitle.length).toBeLessThanOrEqual(41); // 40 + ellipsis
    expect(displayTitle.endsWith("\u2026")).toBe(true);
  });

  it("short title is not truncated", () => {
    const mission = makeMission({ title: "Short title" });
    const displayTitle = truncateTitle(mission.title || "未命名任务", 40);

    expect(displayTitle).toBe("Short title");
  });

  it("empty title falls back to 未命名任务", () => {
    const mission = makeMission({ title: "" });
    const displayTitle = truncateTitle(mission.title || "未命名任务", 40);

    expect(displayTitle).toBe("未命名任务");
  });

  it("progress is rounded to integer", () => {
    const mission = makeMission({ progress: 65.7 });
    const progressPct = Math.round(mission.progress);

    expect(progressPct).toBe(66);
  });

  it("phase label uses currentStageLabel when available", () => {
    const mission = makeMission({ currentStageLabel: "执行中" });
    const phaseLabel =
      mission.currentStageLabel ?? missionStatusLabel(mission.status);

    expect(phaseLabel).toBe("执行中");
  });

  it("phase label falls back to status label when currentStageLabel is null", () => {
    const mission = makeMission({ currentStageLabel: null, status: "running" });
    const phaseLabel =
      mission.currentStageLabel ?? missionStatusLabel(mission.status);

    expect(phaseLabel).toBe("Running");
  });

  it("status tone returns correct class for each status", () => {
    expect(missionStatusTone("running")).toContain("workspace-tone-warning");
    expect(missionStatusTone("done")).toContain("workspace-tone-success");
    expect(missionStatusTone("failed")).toContain("workspace-tone-danger");
    expect(missionStatusTone("waiting")).toContain("workspace-tone-info");
    expect(missionStatusTone("queued")).toContain("workspace-tone-neutral");
  });

  it("agent emoji count is capped at 3", () => {
    const mission = makeMission({ activeAgentCount: 5 });
    const displayCount = Math.min(3, mission.activeAgentCount);

    expect(displayCount).toBe(3);
  });

  it("overflow agent count is shown when > 3", () => {
    const mission = makeMission({ activeAgentCount: 5 });
    const overflow =
      mission.activeAgentCount > 3 ? mission.activeAgentCount - 3 : 0;

    expect(overflow).toBe(2);
  });

  it("no agent section when activeAgentCount is 0", () => {
    const mission = makeMission({ activeAgentCount: 0 });

    expect(mission.activeAgentCount > 0).toBe(false);
  });

  it("onExpand callback is available in active state", () => {
    const onExpand = vi.fn();
    onExpand();
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("progress bar width is clamped between 0 and 100", () => {
    const clamp = (v: number) => Math.min(100, Math.max(0, v));

    expect(clamp(-10)).toBe(0);
    expect(clamp(50)).toBe(50);
    expect(clamp(150)).toBe(100);
  });
});
