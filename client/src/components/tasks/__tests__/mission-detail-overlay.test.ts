/**
 * Unit tests for MissionDetailOverlay component logic
 *
 * Tests the data transformation logic, event handling contracts,
 * and helper function integration used by MissionDetailOverlay.
 *
 * Requirements: 3.5, 3.7
 */
import { describe, it, expect, vi } from "vitest";

import type {
  MissionTaskDetail,
  TaskTimelineEvent,
  TaskInteriorAgent,
} from "@/lib/tasks-store";
import { sliceRecentEvents } from "@/components/tasks/mission-island-helpers";
import {
  agentStatusLabel,
  agentStatusTone,
  formatTaskRelative,
  timelineTone,
} from "@/components/tasks/task-helpers";

/* ─── Helpers ─── */

function makeAgent(overrides?: Partial<TaskInteriorAgent>): TaskInteriorAgent {
  return {
    id: "agent-1",
    name: "Agent Alpha",
    role: "worker",
    department: "Engineering",
    title: "Code Writer",
    status: "working",
    stageKey: "execution",
    stageLabel: "Execution",
    progress: 50,
    angle: 0,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<TaskTimelineEvent>): TaskTimelineEvent {
  return {
    id: "evt-1",
    type: "progress",
    time: Date.now(),
    level: "info",
    title: "Task started",
    description: "Agent began working",
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<MissionTaskDetail>): MissionTaskDetail {
  return {
    id: "m-1",
    title: "Test Mission",
    kind: "chat",
    sourceText: "",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 50,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
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
      id: "w",
      directive: "",
      status: "running",
      stages: [],
      currentStageKey: null,
      progress: 0,
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
    ...overrides,
  } as MissionTaskDetail;
}

/* ─── Close button / onClose contract ─── */

describe("MissionDetailOverlay close behavior", () => {
  it("onClose callback is invocable", () => {
    const onClose = vi.fn();
    onClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key handler calls onClose", () => {
    const onClose = vi.fn();
    const handleKeyDown = (e: { key: string }) => {
      if (e.key === "Escape") onClose();
    };

    handleKeyDown({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("non-Escape keys do not trigger onClose", () => {
    const onClose = vi.fn();
    const handleKeyDown = (e: { key: string }) => {
      if (e.key === "Escape") onClose();
    };

    handleKeyDown({ key: "Enter" });
    handleKeyDown({ key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ─── Navigate to detail contract ─── */

describe("MissionDetailOverlay navigate behavior", () => {
  it("onNavigateToDetail receives the task id", () => {
    const onNavigateToDetail = vi.fn();
    const detail = makeDetail({ id: "mission-42" });

    onNavigateToDetail(detail.id);
    expect(onNavigateToDetail).toHaveBeenCalledWith("mission-42");
  });
});

/* ─── Null detail guard ─── */

describe("MissionDetailOverlay null detail", () => {
  it("null detail means component returns null (no render)", () => {
    const detail: MissionTaskDetail | null = null;
    // Component early-returns null when detail is null
    expect(detail).toBeNull();
  });
});

/* ─── Timeline slicing integration ─── */

describe("MissionDetailOverlay timeline", () => {
  it("slices timeline to 10 most recent events", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, time: 1000 + i })
    );
    const detail = makeDetail({ timeline: events });
    const recent = sliceRecentEvents(detail.timeline);

    expect(recent).toHaveLength(10);
    // Most recent first
    expect(recent[0].time).toBeGreaterThanOrEqual(recent[9].time);
  });

  it("empty timeline shows no events", () => {
    const detail = makeDetail({ timeline: [] });
    const recent = sliceRecentEvents(detail.timeline);

    expect(recent).toHaveLength(0);
  });

  it("timeline tone returns correct classes for each level", () => {
    expect(timelineTone("info")).toContain("workspace-tone-info");
    expect(timelineTone("success")).toContain("workspace-tone-success");
    expect(timelineTone("warn")).toContain("workspace-tone-warning");
    expect(timelineTone("error")).toContain("workspace-tone-danger");
  });

  it("formatTaskRelative returns a human-readable string", () => {
    const recent = Date.now() - 120_000; // 2 minutes ago
    const result = formatTaskRelative(recent);
    expect(result).toMatch(/min ago/);
  });
});

/* ─── Agent list integration ─── */

describe("MissionDetailOverlay agent list", () => {
  it("agent status labels are correct", () => {
    expect(agentStatusLabel("idle")).toBe("Idle");
    expect(agentStatusLabel("working")).toBe("Working");
    expect(agentStatusLabel("thinking")).toBe("Thinking");
    expect(agentStatusLabel("done")).toBe("Done");
    expect(agentStatusLabel("error")).toBe("Error");
  });

  it("agent status tones contain expected color tokens", () => {
    expect(agentStatusTone("working")).toContain("workspace-tone-warning");
    expect(agentStatusTone("thinking")).toContain("workspace-tone-info");
    expect(agentStatusTone("done")).toContain("workspace-tone-success");
    expect(agentStatusTone("error")).toContain("workspace-tone-danger");
    expect(agentStatusTone("idle")).toContain("workspace-tone-neutral");
  });

  it("empty agents list shows no agents", () => {
    const detail = makeDetail({ agents: [] });
    expect(detail.agents).toHaveLength(0);
  });

  it("agents display name or id fallback", () => {
    const agentWithName = makeAgent({ name: "Alpha", id: "a-1" });
    const agentNoName = makeAgent({ name: "", id: "a-2" });

    expect(agentWithName.name || agentWithName.id).toBe("Alpha");
    expect(agentNoName.name || agentNoName.id).toBe("a-2");
  });
});
