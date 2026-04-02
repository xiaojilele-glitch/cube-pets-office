/**
 * Unit tests for hydratePlanetTaskData() in tasks-store.ts
 *
 * Verifies that the planet-native hydration function:
 * 1. Calls listPlanets() and listMissions() in parallel
 * 2. Builds summaries using buildPlanetSummaryRecord()
 * 3. Fetches interior data for the selected task via getPlanetInterior()
 * 4. Falls back to local computation when getPlanetInterior() fails
 * 5. Updates the Zustand store state correctly
 *
 * Requirements: 4.2, 4.3, 4.5
 * Task: 7.5
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  MissionPlanetOverviewItem,
  MissionPlanetInteriorData,
  MissionRecord,
  MissionEvent,
} from "@shared/mission/contracts";
import type {
  ListMissionPlanetsResponse,
  ListMissionsResponse,
  GetMissionPlanetInteriorResponse,
} from "@shared/mission/api";

// ─── Mocks ───

const mockListPlanets = vi.fn<() => Promise<ListMissionPlanetsResponse>>();
const mockListMissions = vi.fn<() => Promise<ListMissionsResponse>>();
const mockGetPlanetInterior = vi.fn<() => Promise<GetMissionPlanetInteriorResponse>>();

vi.mock("./mission-client", () => ({
  listPlanets: (...args: any[]) => mockListPlanets(...args),
  listMissions: (...args: any[]) => mockListMissions(...args),
  getMission: vi.fn(),
  getPlanet: vi.fn(),
  getPlanetInterior: (...args: any[]) => mockGetPlanetInterior(...args),
  listMissionEvents: vi.fn(),
  createMission: vi.fn(),
  submitMissionDecision: vi.fn(),
}));

// Mock socket.io-client
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// Mock workflow-store
vi.mock("./workflow-store", () => ({
  useWorkflowStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        connected: true,
        workflows: [],
        stages: [],
        agents: [],
        eventLog: [],
        initSocket: vi.fn(),
        fetchStages: vi.fn(),
        fetchAgents: vi.fn(),
        fetchWorkflows: vi.fn(),
      }),
      subscribe: vi.fn(),
    }
  ),
}));

// Mock app store
vi.mock("./store", () => ({
  useAppStore: Object.assign(
    () => ({}),
    {
      getState: () => ({ runtimeMode: "advanced" }),
      subscribe: vi.fn(),
    }
  ),
}));

// Mock local runtime
vi.mock("./runtime/local-runtime-client", () => ({
  localRuntime: {
    getWorkflowDetail: vi.fn(),
  },
}));

// ─── Test Fixtures ───

const now = Date.now();

function makeMission(id: string, overrides?: Partial<MissionRecord>): MissionRecord {
  return {
    id,
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    kind: "general",
    status: "running",
    progress: 50,
    stages: [
      { key: "receive", label: "Receive", status: "done" },
      { key: "planning", label: "Planning", status: "running" },
      { key: "execution", label: "Execution", status: "pending" },
    ],
    events: [],
    artifacts: [],
    createdAt: now - 10000,
    updatedAt: now,
    ...overrides,
  } as MissionRecord;
}

function makePlanet(id: string, overrides?: Partial<MissionPlanetOverviewItem>): MissionPlanetOverviewItem {
  return {
    id,
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    kind: "general",
    status: "running",
    progress: 50,
    complexity: 3,
    radius: 45,
    position: { x: 0, y: 0 },
    createdAt: now - 10000,
    updatedAt: now,
    currentStageKey: "planning",
    currentStageLabel: "Planning",
    tags: ["Engineering"],
    taskUrl: `/tasks/${id}`,
    ...overrides,
  };
}

function makeInterior(): MissionPlanetInteriorData {
  return {
    stages: [
      { key: "receive", label: "Receive", status: "done", progress: 100, arcStart: 0, arcEnd: 120, midAngle: 60 },
      { key: "planning", label: "Planning", status: "running", progress: 50, arcStart: 120, arcEnd: 240, midAngle: 180 },
      { key: "execution", label: "Execution", status: "pending", progress: 0, arcStart: 240, arcEnd: 360, midAngle: 300 },
    ],
    agents: [
      { id: "mission-core", name: "Mission Core", role: "orchestrator", sprite: "cube-brain", status: "working", stageKey: "planning", stageLabel: "Planning", angle: 180 },
    ],
    events: [],
  };
}

// ─── Import the function under test (after mocks) ───

const { hydratePlanetTaskData } = await import("./tasks-store");

describe("hydratePlanetTaskData", () => {
  let storeState: Record<string, any>;
  let set: (partial: any) => void;
  let get: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      ready: false,
      loading: true,
      error: null,
      selectedTaskId: null,
      tasks: [],
      detailsById: {},
    };
    set = (partial: any) => {
      const resolved = typeof partial === "function" ? partial(storeState) : partial;
      Object.assign(storeState, resolved);
    };
    get = () => storeState;
  });

  it("should call listPlanets and listMissions", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockRejectedValue(new Error("not selected"));

    await hydratePlanetTaskData(set, get);

    expect(mockListPlanets).toHaveBeenCalledWith(200);
    expect(mockListMissions).toHaveBeenCalledWith(200);
  });

  it("should set store to ready with summaries and details", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    await hydratePlanetTaskData(set, get);

    expect(storeState.ready).toBe(true);
    expect(storeState.loading).toBe(false);
    expect(storeState.error).toBeNull();
    expect(storeState.tasks).toHaveLength(1);
    expect(storeState.tasks[0].id).toBe("m1");
    expect(storeState.detailsById).toHaveProperty("m1");
  });

  it("should fetch interior for the selected task", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");
    const interior = makeInterior();

    storeState.selectedTaskId = "m1";

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockResolvedValue({
      ok: true,
      planet,
      interior,
    });

    await hydratePlanetTaskData(set, get);

    expect(mockGetPlanetInterior).toHaveBeenCalledWith("m1");
    expect(storeState.selectedTaskId).toBe("m1");
    expect(storeState.detailsById.m1).toBeDefined();
    expect(storeState.detailsById.m1.stages).toHaveLength(3);
    expect(storeState.detailsById.m1.agents).toHaveLength(1);
  });

  it("should fall back to local computation when getPlanetInterior fails", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    storeState.selectedTaskId = "m1";

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockRejectedValue(new Error("Network error"));

    await hydratePlanetTaskData(set, get);

    // Should still produce a valid detail via local computation
    expect(storeState.detailsById.m1).toBeDefined();
    expect(storeState.detailsById.m1.stages.length).toBeGreaterThan(0);
    expect(storeState.ready).toBe(true);
  });

  it("should handle multiple planets and only fetch interior for selected", async () => {
    const planet1 = makePlanet("m1", { updatedAt: now - 5000 });
    const planet2 = makePlanet("m2", { updatedAt: now });
    const mission1 = makeMission("m1", { updatedAt: now - 5000 });
    const mission2 = makeMission("m2", { updatedAt: now });

    storeState.selectedTaskId = "m2";

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet1, planet2], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission1, mission2] });
    mockGetPlanetInterior.mockResolvedValue({
      ok: true,
      planet: planet2,
      interior: makeInterior(),
    });

    await hydratePlanetTaskData(set, get);

    // Only m2 should trigger getPlanetInterior
    expect(mockGetPlanetInterior).toHaveBeenCalledTimes(1);
    expect(mockGetPlanetInterior).toHaveBeenCalledWith("m2");

    expect(storeState.tasks).toHaveLength(2);
    expect(storeState.detailsById).toHaveProperty("m1");
    expect(storeState.detailsById).toHaveProperty("m2");
  });

  it("should handle empty planet list", async () => {
    mockListPlanets.mockResolvedValue({ ok: true, planets: [], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [] });

    await hydratePlanetTaskData(set, get);

    expect(storeState.ready).toBe(true);
    expect(storeState.tasks).toHaveLength(0);
    expect(storeState.detailsById).toEqual({});
    expect(storeState.selectedTaskId).toBeNull();
  });

  it("should skip planets without matching mission records", async () => {
    const planet = makePlanet("m1");
    // No matching mission in listMissions response
    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [] });

    await hydratePlanetTaskData(set, get);

    // Summary is still built (buildPlanetSummaryRecord accepts undefined mission)
    expect(storeState.tasks).toHaveLength(1);
    // But detail is skipped because mission is required for buildLocalPlanetDetail
    expect(storeState.detailsById).not.toHaveProperty("m1");
  });

  it("should use preferredTaskId for selection", async () => {
    const planet = makePlanet("m1");
    const mission = makeMission("m1");

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });
    mockGetPlanetInterior.mockResolvedValue({
      ok: true,
      planet,
      interior: makeInterior(),
    });

    await hydratePlanetTaskData(set, get, { preferredTaskId: "m1" });

    expect(storeState.selectedTaskId).toBe("m1");
    expect(mockGetPlanetInterior).toHaveBeenCalledWith("m1");
  });

  it("should sort summaries by updatedAt descending", async () => {
    const planet1 = makePlanet("m1", { updatedAt: now - 5000 });
    const planet2 = makePlanet("m2", { updatedAt: now });
    const mission1 = makeMission("m1", { updatedAt: now - 5000 });
    const mission2 = makeMission("m2", { updatedAt: now });

    mockListPlanets.mockResolvedValue({ ok: true, planets: [planet1, planet2], edges: [] });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission1, mission2] });

    await hydratePlanetTaskData(set, get);

    expect(storeState.tasks[0].id).toBe("m2");
    expect(storeState.tasks[1].id).toBe("m1");
  });
});
