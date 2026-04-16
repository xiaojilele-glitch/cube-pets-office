/**
 * End-to-end integration test: Mission → /api/planets → tasks-store output
 * Validates: Requirements 1.1, 1.2, 2.1, 4.2
 */
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock client-only modules for tasks-store import
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

import {
  buildPlanetSummaryRecord,
  buildPlanetDetailRecord,
} from "../../client/src/lib/tasks-store";
import { createPlanetRouter } from "../routes/planets.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";
import type {
  MissionPlanetOverviewItem,
  MissionPlanetInteriorData,
} from "../../shared/mission/contracts.js";

describe("E2E: Mission → /api/planets → tasks-store", () => {
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

  it("creates a mission, fetches via /api/planets, and produces valid MissionTaskSummary", async () => {
    // 1. Create mission via runtime
    const task = runtime.createTask({
      kind: "chat",
      title: "E2E Integration Test",
      sourceText: "Testing the full pipeline",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "understand", label: "Understand request" },
        { key: "execute", label: "Run execution" },
      ],
    });
    runtime.markMissionRunning(task.id, "receive", "Started processing", 15);

    // 2. Fetch via /api/planets
    const listRes = await fetch(`${baseUrl}/api/planets`);
    const listBody = await listRes.json();

    expect(listRes.status).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(listBody.planets).toHaveLength(1);

    const planet: MissionPlanetOverviewItem = listBody.planets[0];
    expect(planet.id).toBe(task.id);
    expect(planet.title).toBe("E2E Integration Test");
    expect(planet.status).toBe("running");

    // 3. Feed planet into buildPlanetSummaryRecord
    const mission = runtime.getTask(task.id)!;
    const summary = buildPlanetSummaryRecord(planet, mission);

    expect(summary.id).toBe(task.id);
    expect(summary.title).toBe("E2E Integration Test");
    expect(summary.status).toBe("running");
    expect(summary.progress).toBe(15);
    expect(summary.kind).toBe("chat");
    expect(typeof summary.taskCount).toBe("number");
    expect(typeof summary.messageCount).toBe("number");
  });

  it("creates a mission with enrichment, fetches interior, and produces valid MissionTaskDetail", async () => {
    // 1. Create and enrich mission
    const task = runtime.createTask({
      kind: "chat",
      title: "Detail E2E Test",
      sourceText: "Testing detail pipeline",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
        { key: "finalize", label: "Finalize mission" },
      ],
    });
    runtime.markMissionRunning(task.id, "receive", "Started", 10);
    runtime.logMission(task.id, "Processing step 1", "info", 30);

    // Enrich with organization and workPackages
    runtime.patchEnrichment(task.id, {
      organization: {
        departments: [
          { key: "eng", label: "Engineering" },
          { key: "qa", label: "QA" },
        ],
        agentCount: 3,
      },
      workPackages: [
        {
          id: "wp1",
          title: "Build UI",
          assignee: "alice",
          stageKey: "execute",
          status: "running",
          deliverable: "Dashboard",
        },
        {
          id: "wp2",
          title: "Write tests",
          assignee: "bob",
          stageKey: "execute",
          status: "passed",
          score: 95,
        },
      ],
      messageLog: [
        { sender: "alice", content: "Starting UI work", time: 1500 },
        { sender: "bob", content: "Tests complete", time: 1600 },
      ],
    });

    // 2. Fetch planet overview
    const overviewRes = await fetch(`${baseUrl}/api/planets/${task.id}`);
    const overviewBody = await overviewRes.json();
    expect(overviewRes.status).toBe(200);
    const planet: MissionPlanetOverviewItem = overviewBody.planet;
    expect(planet.tags).toEqual(["Engineering", "QA"]);

    // 3. Fetch interior
    const interiorRes = await fetch(
      `${baseUrl}/api/planets/${task.id}/interior`
    );
    const interiorBody = await interiorRes.json();
    expect(interiorRes.status).toBe(200);

    const interior: MissionPlanetInteriorData = interiorBody.interior;
    expect(interior.stages).toHaveLength(3);
    expect(interior.agents.length).toBeGreaterThanOrEqual(1);

    // 4. Feed into buildPlanetDetailRecord
    const mission = runtime.getTask(task.id)!;
    const detail = buildPlanetDetailRecord(planet, interior, mission);

    // Verify detail structure
    expect(detail.id).toBe(task.id);
    expect(detail.title).toBe("Detail E2E Test");
    expect(detail.stages).toHaveLength(3);
    expect(detail.stages[0].arcStart).toBe(0);
    expect(detail.stages[2].arcEnd).toBe(360);
    expect(detail.agents.length).toBeGreaterThanOrEqual(1);
    expect(detail.agents.find(a => a.id === "mission-core")).toBeDefined();
    expect(detail.timeline.length).toBeGreaterThan(0);
    expect(detail.departmentLabels).toEqual(["Engineering", "QA"]);
    expect(detail.taskCount).toBe(2);
    expect(detail.completedTaskCount).toBe(1); // bob's wp is 'passed'
    expect(detail.messageCount).toBe(2);
  });

  it("handles mission lifecycle: create → progress → complete → verify via planets API", async () => {
    // Create
    const task = runtime.createTask({
      kind: "chat",
      title: "Lifecycle test",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "execute", label: "Run execution" },
      ],
    });

    // Progress
    runtime.markMissionRunning(task.id, "receive", "Started", 20);
    runtime.markMissionRunning(task.id, "execute", "Executing", 60);

    // Verify running state via API
    let res = await fetch(`${baseUrl}/api/planets/${task.id}`);
    let body = await res.json();
    expect(body.planet.status).toBe("running");
    expect(body.planet.progress).toBe(60);

    // Complete
    runtime.finishMission(task.id, "All done");

    // Verify completed state via API
    res = await fetch(`${baseUrl}/api/planets/${task.id}`);
    body = await res.json();
    expect(body.planet.status).toBe("done");
    expect(body.planet.progress).toBe(100);

    // Verify summary output
    const planet: MissionPlanetOverviewItem = body.planet;
    const mission = runtime.getTask(task.id)!;
    const summary = buildPlanetSummaryRecord(planet, mission);
    expect(summary.status).toBe("done");
    expect(summary.progress).toBe(100);
  });

  it("multiple missions appear in list and each can be fetched individually", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = runtime.createTask({
        kind: "chat",
        title: `Mission ${i}`,
        stageLabels: [{ key: "receive", label: "Receive task" }],
      });
      ids.push(t.id);
    }

    // List all
    const listRes = await fetch(`${baseUrl}/api/planets`);
    const listBody = await listRes.json();
    expect(listBody.planets).toHaveLength(3);

    // Each individual fetch works
    for (const id of ids) {
      const res = await fetch(`${baseUrl}/api/planets/${id}`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.planet.id).toBe(id);
    }
  });
});
