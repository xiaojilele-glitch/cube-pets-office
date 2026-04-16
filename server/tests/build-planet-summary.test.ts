import { describe, expect, it, vi } from "vitest";

// Mock client-only modules so we can import from tasks-store in a node environment
vi.mock("zustand", () => ({ create: () => () => ({}) }));
vi.mock("socket.io-client", () => ({ io: () => ({}) }));
vi.mock("../../client/src/lib/store", () => ({
  useAppStore: { getState: () => ({ runtimeMode: "frontend" }) },
}));
vi.mock("../../client/src/lib/workflow-store", () => ({
  useWorkflowStore: { getState: () => ({}) },
}));
vi.mock("../../client/src/lib/runtime/local-runtime-client", () => ({
  localRuntime: {},
}));
vi.mock("../../client/src/lib/mission-client", () => ({
  createMission: vi.fn(),
  getMission: vi.fn(),
  listMissionEvents: vi.fn(),
  listMissions: vi.fn(),
  submitMissionDecision: vi.fn(),
}));

import { buildPlanetSummaryRecord } from "../../client/src/lib/tasks-store";
import type {
  MissionPlanetOverviewItem,
  MissionRecord,
} from "../../shared/mission/contracts";

function makePlanet(
  overrides: Partial<MissionPlanetOverviewItem> = {}
): MissionPlanetOverviewItem {
  return {
    id: "planet_1",
    title: "Test Planet",
    sourceText: "Build something",
    summary: "In progress",
    kind: "chat",
    status: "running",
    progress: 50,
    complexity: 3,
    radius: 45,
    position: { x: 0, y: 0 },
    createdAt: 1000,
    updatedAt: 2000,
    currentStageKey: "execute",
    currentStageLabel: "Run execution",
    waitingFor: undefined,
    taskUrl: "/tasks/planet_1",
    tags: ["Engineering", "Design"],
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "planet_1",
    kind: "chat",
    title: "Test Planet",
    sourceText: "Build something",
    status: "running",
    progress: 50,
    currentStageKey: "execute",
    stages: [
      { key: "receive", label: "Receive task", status: "done" },
      { key: "execute", label: "Run execution", status: "running" },
      { key: "finalize", label: "Finalize mission", status: "pending" },
    ],
    summary: "In progress",
    createdAt: 1000,
    updatedAt: 2000,
    events: [],
    ...overrides,
  };
}

describe("buildPlanetSummaryRecord", () => {
  it("maps basic fields from planet overview", () => {
    const planet = makePlanet();
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.id).toBe("planet_1");
    expect(summary.title).toBe("Test Planet");
    expect(summary.kind).toBe("chat");
    expect(summary.sourceText).toBe("Build something");
    expect(summary.status).toBe("running");
    expect(summary.progress).toBe(50);
    expect(summary.createdAt).toBe(1000);
    expect(summary.updatedAt).toBe(2000);
    expect(summary.currentStageKey).toBe("execute");
    expect(summary.currentStageLabel).toBe("Run execution");
  });

  it("maps planet.tags to departmentLabels", () => {
    const planet = makePlanet({ tags: ["Engineering", "Design", "QA"] });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.departmentLabels).toEqual(["Engineering", "Design", "QA"]);
  });

  it("falls back to capitalized kind when tags are empty", () => {
    const planet = makePlanet({ tags: [], kind: "code_review" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.departmentLabels).toEqual(["Code review"]);
  });

  it("returns empty departmentLabels when tags empty and no kind", () => {
    const planet = makePlanet({ tags: [], kind: "" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.departmentLabels).toEqual([]);
  });

  it("derives taskCount from mission.workPackages", () => {
    const planet = makePlanet();
    const mission = makeMission({
      workPackages: [
        { id: "wp1", title: "T1", stageKey: "execute", status: "running" },
        { id: "wp2", title: "T2", stageKey: "execute", status: "passed" },
        { id: "wp3", title: "T3", stageKey: "execute", status: "verified" },
      ],
    });
    const summary = buildPlanetSummaryRecord(planet, mission);

    expect(summary.taskCount).toBe(3);
    expect(summary.completedTaskCount).toBe(2); // passed + verified
  });

  it("derives messageCount from mission.messageLog", () => {
    const planet = makePlanet();
    const mission = makeMission({
      messageLog: [
        { sender: "alice", content: "Hello", time: 100 },
        { sender: "bob", content: "Hi", time: 200 },
      ],
    });
    const summary = buildPlanetSummaryRecord(planet, mission);

    expect(summary.messageCount).toBe(2);
  });

  it("defaults taskCount, completedTaskCount, messageCount to 0 without mission", () => {
    const planet = makePlanet();
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.taskCount).toBe(0);
    expect(summary.completedTaskCount).toBe(0);
    expect(summary.messageCount).toBe(0);
  });

  it('maps "archived" planet status to "done" mission status', () => {
    const planet = makePlanet({ status: "archived" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.status).toBe("done");
    expect(summary.workflowStatus).toBe("completed");
  });

  it("maps waitingFor from planet", () => {
    const planet = makePlanet({ waitingFor: "user approval" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.waitingFor).toBe("user approval");
  });

  it("maps completedAt from planet", () => {
    const planet = makePlanet({ completedAt: 3000 });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.completedAt).toBe(3000);
  });

  it("returns null completedAt when planet has none", () => {
    const planet = makePlanet({ completedAt: undefined });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.completedAt).toBeNull();
  });

  it("clamps progress to 0-100 range", () => {
    expect(
      buildPlanetSummaryRecord(makePlanet({ progress: 150 })).progress
    ).toBe(100);
    expect(
      buildPlanetSummaryRecord(makePlanet({ progress: -10 })).progress
    ).toBe(0);
  });

  it("uses planet summary text when no mission provided", () => {
    const planet = makePlanet({ summary: "Custom summary text" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.summary).toBe("Custom summary text");
  });

  it("derives attachmentCount from mission artifacts", () => {
    const planet = makePlanet();
    const mission = makeMission({
      artifacts: [
        { kind: "file", name: "report.pdf" },
        { kind: "url", name: "link" },
      ],
    });
    const summary = buildPlanetSummaryRecord(planet, mission);

    expect(summary.attachmentCount).toBe(2);
  });

  it("defaults attachmentCount to 0 without mission", () => {
    const summary = buildPlanetSummaryRecord(makePlanet());
    expect(summary.attachmentCount).toBe(0);
  });

  it("sets hasWarnings when mission has error events", () => {
    const planet = makePlanet();
    const mission = makeMission({
      events: [
        {
          type: "log",
          message: "Something went wrong",
          level: "warn",
          time: 1500,
        },
      ],
    });
    const summary = buildPlanetSummaryRecord(planet, mission);

    expect(summary.hasWarnings).toBe(true);
  });

  it('uses "Untitled mission" when title is empty', () => {
    const planet = makePlanet({ title: "" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.title).toBe("Untitled mission");
  });

  it("uses planet.title as sourceText fallback", () => {
    const planet = makePlanet({ sourceText: undefined });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.sourceText).toBe(planet.title);
  });

  it("derives lastSignal from latest event message", () => {
    const planet = makePlanet();
    const mission = makeMission({
      events: [
        { type: "log", message: "Step 1 done", time: 1100 },
        { type: "log", message: "Step 2 in progress", time: 1200 },
      ],
    });
    const summary = buildPlanetSummaryRecord(planet, mission);

    expect(summary.lastSignal).toBe("Step 2 in progress");
  });

  it("falls back lastSignal to currentStageLabel when no events or messages", () => {
    const planet = makePlanet({ currentStageLabel: "Run execution" });
    const summary = buildPlanetSummaryRecord(planet);

    expect(summary.lastSignal).toBe("Run execution");
  });
});
