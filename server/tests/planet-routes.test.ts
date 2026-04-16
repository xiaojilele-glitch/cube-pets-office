import { describe, expect, it } from "vitest";

import type {
  MissionRecord,
  MissionStage,
} from "../../shared/mission/contracts.js";
import {
  missionToPlanetOverview,
  buildPlanetInteriorStages,
  buildPlanetInteriorAgents,
} from "../routes/planets.js";

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "mission_test_1",
    kind: "chat",
    title: "Test Mission",
    sourceText: "Build something cool",
    topicId: "thread_1",
    status: "running",
    progress: 50,
    currentStageKey: "execute",
    stages: [
      { key: "receive", label: "Receive task", status: "done" },
      { key: "understand", label: "Understand request", status: "done" },
      { key: "plan", label: "Build execution plan", status: "done" },
      { key: "execute", label: "Run execution", status: "running" },
      { key: "finalize", label: "Finalize mission", status: "pending" },
    ],
    summary: "Making progress",
    waitingFor: undefined,
    createdAt: 1000,
    updatedAt: 2000,
    completedAt: undefined,
    events: [],
    ...overrides,
  };
}

describe("missionToPlanetOverview", () => {
  it("maps basic fields from MissionRecord", () => {
    const mission = makeMission();
    const planet = missionToPlanetOverview(mission);

    expect(planet.id).toBe("mission_test_1");
    expect(planet.title).toBe("Test Mission");
    expect(planet.sourceText).toBe("Build something cool");
    expect(planet.summary).toBe("Making progress");
    expect(planet.kind).toBe("chat");
    expect(planet.status).toBe("running");
    expect(planet.progress).toBe(50);
    expect(planet.createdAt).toBe(1000);
    expect(planet.updatedAt).toBe(2000);
    expect(planet.completedAt).toBeUndefined();
  });

  it("computes complexity from stage count", () => {
    const mission = makeMission();
    const planet = missionToPlanetOverview(mission);

    expect(planet.complexity).toBe(5);
  });

  it("computes radius as 30 + stageCount * 5", () => {
    const mission = makeMission();
    const planet = missionToPlanetOverview(mission);

    // 5 stages → 30 + 5*5 = 55
    expect(planet.radius).toBe(55);
  });

  it("sets position to { x: 0, y: 0 }", () => {
    const planet = missionToPlanetOverview(makeMission());
    expect(planet.position).toEqual({ x: 0, y: 0 });
  });

  it("resolves currentStageLabel from stages array", () => {
    const planet = missionToPlanetOverview(
      makeMission({ currentStageKey: "execute" })
    );
    expect(planet.currentStageKey).toBe("execute");
    expect(planet.currentStageLabel).toBe("Run execution");
  });

  it("returns undefined currentStageLabel when currentStageKey is missing", () => {
    const planet = missionToPlanetOverview(
      makeMission({ currentStageKey: undefined })
    );
    expect(planet.currentStageLabel).toBeUndefined();
  });

  it("returns undefined currentStageLabel when key does not match any stage", () => {
    const planet = missionToPlanetOverview(
      makeMission({ currentStageKey: "nonexistent" })
    );
    expect(planet.currentStageLabel).toBeUndefined();
  });

  it("builds taskUrl from mission id", () => {
    const planet = missionToPlanetOverview(makeMission());
    expect(planet.taskUrl).toBe("/tasks/mission_test_1");
  });

  it("extracts tags from organization departments", () => {
    const planet = missionToPlanetOverview(
      makeMission({
        organization: {
          departments: [
            { key: "eng", label: "Engineering" },
            { key: "design", label: "Design" },
          ],
          agentCount: 4,
        },
      })
    );

    expect(planet.tags).toEqual(["Engineering", "Design"]);
  });

  it("returns empty tags when organization is undefined", () => {
    const planet = missionToPlanetOverview(
      makeMission({ organization: undefined })
    );
    expect(planet.tags).toEqual([]);
  });

  it("handles zero stages correctly", () => {
    const planet = missionToPlanetOverview(makeMission({ stages: [] }));
    expect(planet.complexity).toBe(0);
    expect(planet.radius).toBe(30);
  });

  it("passes through waitingFor field", () => {
    const planet = missionToPlanetOverview(
      makeMission({ waitingFor: "user approval" })
    );
    expect(planet.waitingFor).toBe("user approval");
  });

  it("passes through completedAt when present", () => {
    const planet = missionToPlanetOverview(makeMission({ completedAt: 3000 }));
    expect(planet.completedAt).toBe(3000);
  });
});

describe("buildPlanetInteriorStages", () => {
  function makeStages(count: number): MissionStage[] {
    return Array.from({ length: count }, (_, i) => ({
      key: `stage_${i}`,
      label: `Stage ${i}`,
      status: "pending" as const,
    }));
  }

  it("returns empty array for empty stages", () => {
    expect(buildPlanetInteriorStages([])).toEqual([]);
  });

  it("single stage covers full 360 degrees", () => {
    const result = buildPlanetInteriorStages(makeStages(1));
    expect(result).toHaveLength(1);
    expect(result[0].arcStart).toBe(0);
    expect(result[0].arcEnd).toBe(360);
    expect(result[0].midAngle).toBe(180);
  });

  it("evenly distributes arcs for multiple stages", () => {
    const result = buildPlanetInteriorStages(makeStages(4));
    expect(result).toHaveLength(4);

    // Each arc = 360/4 = 90
    expect(result[0].arcStart).toBe(0);
    expect(result[0].arcEnd).toBe(90);
    expect(result[1].arcStart).toBe(90);
    expect(result[1].arcEnd).toBe(180);
    expect(result[2].arcStart).toBe(180);
    expect(result[2].arcEnd).toBe(270);
    expect(result[3].arcStart).toBe(270);
    expect(result[3].arcEnd).toBe(360);
  });

  it("first stage arcStart is 0 and last stage arcEnd is 360", () => {
    const result = buildPlanetInteriorStages(makeStages(7));
    expect(result[0].arcStart).toBe(0);
    expect(result[result.length - 1].arcEnd).toBeCloseTo(360);
  });

  it("has no gaps between consecutive stages", () => {
    const result = buildPlanetInteriorStages(makeStages(6));
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].arcEnd).toBeCloseTo(result[i + 1].arcStart);
    }
  });

  it("computes midAngle as average of arcStart and arcEnd", () => {
    const result = buildPlanetInteriorStages(makeStages(3));
    for (const stage of result) {
      expect(stage.midAngle).toBe((stage.arcStart + stage.arcEnd) / 2);
    }
  });

  it("maps progress=100 for done, 50 for running, 0 for pending/failed", () => {
    const stages: MissionStage[] = [
      { key: "a", label: "A", status: "done" },
      { key: "b", label: "B", status: "running" },
      { key: "c", label: "C", status: "pending" },
      { key: "d", label: "D", status: "failed" },
    ];
    const result = buildPlanetInteriorStages(stages);
    expect(result[0].progress).toBe(100);
    expect(result[1].progress).toBe(50);
    expect(result[2].progress).toBe(0);
    expect(result[3].progress).toBe(0);
  });

  it("preserves key, label, detail, startedAt, completedAt from source stages", () => {
    const stages: MissionStage[] = [
      {
        key: "recv",
        label: "Receive",
        status: "done",
        detail: "All good",
        startedAt: 100,
        completedAt: 200,
      },
    ];
    const result = buildPlanetInteriorStages(stages);
    expect(result[0].key).toBe("recv");
    expect(result[0].label).toBe("Receive");
    expect(result[0].detail).toBe("All good");
    expect(result[0].startedAt).toBe(100);
    expect(result[0].completedAt).toBe(200);
  });
});

describe("buildPlanetInteriorAgents", () => {
  const stages = buildPlanetInteriorStages([
    { key: "receive", label: "Receive task", status: "done" },
    { key: "execute", label: "Run execution", status: "running" },
    { key: "finalize", label: "Finalize mission", status: "pending" },
  ]);

  it("always includes mission-core agent", () => {
    const mission = makeMission({ workPackages: undefined });
    const agents = buildPlanetInteriorAgents(mission, stages);

    expect(agents.length).toBeGreaterThanOrEqual(1);
    const core = agents.find(a => a.id === "mission-core");
    expect(core).toBeDefined();
    expect(core!.role).toBe("orchestrator");
    expect(core!.sprite).toBe("cube-brain");
  });

  it("returns only mission-core when no workPackages", () => {
    const mission = makeMission({ workPackages: undefined });
    const agents = buildPlanetInteriorAgents(mission, stages);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("mission-core");
  });

  it("infers worker agents from workPackages assignees", () => {
    const mission = makeMission({
      workPackages: [
        {
          id: "wp1",
          title: "Task A",
          assignee: "alice",
          stageKey: "execute",
          status: "running",
          deliverable: "Build UI",
        },
        {
          id: "wp2",
          title: "Task B",
          assignee: "bob",
          stageKey: "receive",
          status: "passed",
          score: 90,
        },
      ],
    });
    const agents = buildPlanetInteriorAgents(mission, stages);

    const alice = agents.find(a => a.id === "alice");
    expect(alice).toBeDefined();
    expect(alice!.role).toBe("worker");
    expect(alice!.status).toBe("working");
    expect(alice!.currentAction).toBe("Build UI");

    const bob = agents.find(a => a.id === "bob");
    expect(bob).toBeDefined();
    expect(bob!.status).toBe("done");
    expect(bob!.progress).toBe(90);
  });

  it("skips workPackages without assignee", () => {
    const mission = makeMission({
      workPackages: [
        {
          id: "wp1",
          title: "Unassigned",
          stageKey: "execute",
          status: "pending",
        },
      ],
    });
    const agents = buildPlanetInteriorAgents(mission, stages);
    // Only mission-core
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("mission-core");
  });

  it("prefers running package as active for multi-package assignee", () => {
    const mission = makeMission({
      workPackages: [
        {
          id: "wp1",
          title: "Done task",
          assignee: "alice",
          stageKey: "receive",
          status: "passed",
        },
        {
          id: "wp2",
          title: "Active task",
          assignee: "alice",
          stageKey: "execute",
          status: "running",
          deliverable: "Coding",
        },
      ],
    });
    const agents = buildPlanetInteriorAgents(mission, stages);
    const alice = agents.find(a => a.id === "alice");
    expect(alice!.status).toBe("working");
    expect(alice!.stageKey).toBe("execute");
    expect(alice!.currentAction).toBe("Coding");
  });

  it("maps mission-core status from mission status", () => {
    const runningAgents = buildPlanetInteriorAgents(
      makeMission({ status: "running" }),
      stages
    );
    expect(runningAgents.find(a => a.id === "mission-core")!.status).toBe(
      "thinking"
    );

    const doneAgents = buildPlanetInteriorAgents(
      makeMission({ status: "done" }),
      stages
    );
    expect(doneAgents.find(a => a.id === "mission-core")!.status).toBe("done");

    const failedAgents = buildPlanetInteriorAgents(
      makeMission({ status: "failed" }),
      stages
    );
    expect(failedAgents.find(a => a.id === "mission-core")!.status).toBe(
      "error"
    );

    const queuedAgents = buildPlanetInteriorAgents(
      makeMission({ status: "queued" }),
      stages
    );
    expect(queuedAgents.find(a => a.id === "mission-core")!.status).toBe(
      "idle"
    );
  });

  it("maps all workPackage statuses correctly", () => {
    const statuses: Array<{
      wpStatus: "pending" | "running" | "passed" | "failed" | "verified";
      expected: string;
    }> = [
      { wpStatus: "pending", expected: "idle" },
      { wpStatus: "running", expected: "working" },
      { wpStatus: "passed", expected: "done" },
      { wpStatus: "failed", expected: "error" },
      { wpStatus: "verified", expected: "done" },
    ];
    for (const { wpStatus, expected } of statuses) {
      const mission = makeMission({
        workPackages: [
          {
            id: "wp1",
            title: "T",
            assignee: "agent1",
            stageKey: "execute",
            status: wpStatus,
          },
        ],
      });
      const agents = buildPlanetInteriorAgents(mission, stages);
      const worker = agents.find(a => a.id === "agent1");
      expect(worker!.status).toBe(expected);
    }
  });

  it("assigns angles within stage arc boundaries", () => {
    const mission = makeMission({
      currentStageKey: "execute",
      workPackages: [
        {
          id: "wp1",
          title: "T1",
          assignee: "a1",
          stageKey: "execute",
          status: "running",
        },
        {
          id: "wp2",
          title: "T2",
          assignee: "a2",
          stageKey: "execute",
          status: "running",
        },
      ],
    });
    const agents = buildPlanetInteriorAgents(mission, stages);
    const executeStage = stages.find(s => s.key === "execute")!;

    for (const agent of agents.filter(a => a.stageKey === "execute")) {
      expect(agent.angle).toBeGreaterThan(executeStage.arcStart);
      expect(agent.angle).toBeLessThan(executeStage.arcEnd);
    }
  });

  it("all agent angles are in [0, 360)", () => {
    const mission = makeMission({
      workPackages: [
        {
          id: "wp1",
          title: "T1",
          assignee: "a1",
          stageKey: "receive",
          status: "running",
        },
        {
          id: "wp2",
          title: "T2",
          assignee: "a2",
          stageKey: "execute",
          status: "pending",
        },
        {
          id: "wp3",
          title: "T3",
          assignee: "a3",
          stageKey: "finalize",
          status: "passed",
        },
      ],
    });
    const agents = buildPlanetInteriorAgents(mission, stages);
    for (const agent of agents) {
      expect(agent.angle).toBeGreaterThanOrEqual(0);
      expect(agent.angle).toBeLessThan(360);
    }
  });

  it("uses stageKey fallback label when stage not found in interiorStages", () => {
    const mission = makeMission({
      workPackages: [
        {
          id: "wp1",
          title: "T",
          assignee: "ghost",
          stageKey: "unknown_stage",
          status: "running",
        },
      ],
    });
    const agents = buildPlanetInteriorAgents(mission, stages);
    const ghost = agents.find(a => a.id === "ghost");
    expect(ghost!.stageLabel).toBe("unknown_stage");
  });

  it('mission-core uses "receive" as default stageKey when currentStageKey is undefined', () => {
    const mission = makeMission({ currentStageKey: undefined });
    const agents = buildPlanetInteriorAgents(mission, stages);
    const core = agents.find(a => a.id === "mission-core");
    expect(core!.stageKey).toBe("receive");
    expect(core!.stageLabel).toBe("Receive task");
  });
});

/* ─── Route-level tests for GET /api/planets ─── */

import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach } from "vitest";
import { createPlanetRouter } from "../routes/planets.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";

describe("GET /api/planets", () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });

    const app = express();
    app.use(express.json());
    app.use("/api/planets", createPlanetRouter(runtime));

    server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(err => (err ? reject(err) : resolve()));
    });
    server = null;
  });

  it("returns empty planets array when no missions exist", async () => {
    const response = await fetch(`${baseUrl}/api/planets`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.planets).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it("returns planet overviews for existing missions", async () => {
    runtime.createTask({
      kind: "chat",
      title: "Planet A",
      stageLabels: [{ key: "receive", label: "Receive task" }],
    });
    runtime.createTask({
      kind: "chat",
      title: "Planet B",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
      ],
    });

    const response = await fetch(`${baseUrl}/api/planets`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.planets).toHaveLength(2);
    expect(body.planets[0].title).toBeDefined();
    expect(body.planets[1].title).toBeDefined();
  });

  it("respects limit query parameter", async () => {
    for (let i = 0; i < 5; i++) {
      runtime.createTask({
        kind: "chat",
        title: `Planet ${i}`,
        stageLabels: [{ key: "receive", label: "Receive task" }],
      });
    }

    const response = await fetch(`${baseUrl}/api/planets?limit=3`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.planets.length).toBeLessThanOrEqual(3);
  });

  it("uses default limit for invalid limit parameter", async () => {
    runtime.createTask({
      kind: "chat",
      title: "Planet X",
      stageLabels: [{ key: "receive", label: "Receive task" }],
    });

    const response = await fetch(`${baseUrl}/api/planets?limit=abc`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.planets).toHaveLength(1);
  });

  it("planet overview contains expected fields", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Field check",
      sourceText: "Testing fields",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
      ],
    });

    const response = await fetch(`${baseUrl}/api/planets`);
    const body = await response.json();

    expect(response.status).toBe(200);
    const planet = body.planets[0];
    expect(planet.id).toBe(task.id);
    expect(planet.title).toBe("Field check");
    expect(planet.sourceText).toBe("Testing fields");
    expect(planet.status).toBe("queued");
    expect(planet.complexity).toBe(2);
    expect(planet.radius).toBe(40);
    expect(planet.taskUrl).toBe(`/tasks/${task.id}`);
    expect(planet.tags).toEqual([]);
  });
});

/* ─── Route-level tests for GET /api/planets/:id ─── */

describe("GET /api/planets/:id", () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });

    const app = express();
    app.use(express.json());
    app.use("/api/planets", createPlanetRouter(runtime));

    server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(err => (err ? reject(err) : resolve()));
    });
    server = null;
  });

  it("returns planet overview and task for an existing mission", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Planet detail test",
      sourceText: "Testing the detail endpoint",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
      ],
    });

    const response = await fetch(`${baseUrl}/api/planets/${task.id}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.planet).toMatchObject({
      id: task.id,
      title: "Planet detail test",
      sourceText: "Testing the detail endpoint",
      status: "queued",
      complexity: 2,
      radius: 40, // 30 + 2*5
      taskUrl: `/tasks/${task.id}`,
    });
    expect(body.task).toMatchObject({
      id: task.id,
      title: "Planet detail test",
      status: "queued",
    });
  });

  it("returns 404 for a non-existent mission id", async () => {
    const response = await fetch(`${baseUrl}/api/planets/mission_nonexistent`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Planet not found" });
  });

  it("returns updated planet data after mission progresses", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Progress test",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
      ],
    });
    runtime.markMissionRunning(task.id, "receive", "Started", 25);

    const response = await fetch(`${baseUrl}/api/planets/${task.id}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.planet.status).toBe("running");
    expect(body.planet.progress).toBe(25);
    expect(body.task.status).toBe("running");
  });
});

/* ─── Route-level tests for GET /api/planets/:id/interior ─── */

describe("GET /api/planets/:id/interior", () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });

    const app = express();
    app.use(express.json());
    app.use("/api/planets", createPlanetRouter(runtime));

    server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(err => (err ? reject(err) : resolve()));
    });
    server = null;
  });

  it("returns interior data with stages, agents, events, summary, waitingFor", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Interior test",
      sourceText: "Testing interior endpoint",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
        { key: "finalize", label: "Finalize mission" },
      ],
    });
    runtime.markMissionRunning(task.id, "receive", "Started", 10);

    const response = await fetch(`${baseUrl}/api/planets/${task.id}/interior`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);

    // planet overview is included
    expect(body.planet).toMatchObject({
      id: task.id,
      title: "Interior test",
      status: "running",
    });

    // interior data structure
    const interior = body.interior;
    expect(interior).toBeDefined();
    expect(interior.stages).toHaveLength(3);
    expect(interior.agents).toBeDefined();
    expect(Array.isArray(interior.events)).toBe(true);

    // stages have arc geometry
    expect(interior.stages[0].arcStart).toBe(0);
    expect(interior.stages[0].arcEnd).toBe(120);
    expect(interior.stages[2].arcEnd).toBe(360);

    // mission-core agent is always present
    const coreAgent = interior.agents.find(
      (a: { id: string }) => a.id === "mission-core"
    );
    expect(coreAgent).toBeDefined();
    expect(coreAgent.role).toBe("orchestrator");
  });

  it("returns 404 for a non-existent mission id", async () => {
    const response = await fetch(
      `${baseUrl}/api/planets/nonexistent_id/interior`
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Planet not found" });
  });

  it("includes events from mission runtime", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Events test",
      stageLabels: [{ key: "receive", label: "Receive task" }],
    });
    runtime.logMission(task.id, "Step 1 complete", "info", 30);
    runtime.logMission(task.id, "Step 2 in progress", "info", 60);

    const response = await fetch(`${baseUrl}/api/planets/${task.id}/interior`);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Should have events: created + 2 log entries
    expect(body.interior.events.length).toBeGreaterThanOrEqual(2);
  });

  it("includes summary and waitingFor from mission", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Summary test",
      stageLabels: [{ key: "receive", label: "Receive task" }],
    });
    runtime.waitOnMission(task.id, "user approval", "Need confirmation", 50);

    const response = await fetch(`${baseUrl}/api/planets/${task.id}/interior`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.interior.waitingFor).toBe("user approval");
  });

  it("does not break the existing /:id endpoint", async () => {
    const task = runtime.createTask({
      kind: "chat",
      title: "Coexistence test",
      stageLabels: [{ key: "receive", label: "Receive task" }],
    });

    // /:id still works
    const overviewRes = await fetch(`${baseUrl}/api/planets/${task.id}`);
    const overviewBody = await overviewRes.json();
    expect(overviewRes.status).toBe(200);
    expect(overviewBody.ok).toBe(true);
    expect(overviewBody.planet.id).toBe(task.id);
    expect(overviewBody.task).toBeDefined();

    // /:id/interior also works
    const interiorRes = await fetch(
      `${baseUrl}/api/planets/${task.id}/interior`
    );
    const interiorBody = await interiorRes.json();
    expect(interiorRes.status).toBe(200);
    expect(interiorBody.ok).toBe(true);
    expect(interiorBody.interior).toBeDefined();
  });
});
