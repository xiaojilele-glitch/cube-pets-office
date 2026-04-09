import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionRecord } from "@shared/mission/contracts";

const mockGetMission = vi.fn();

vi.mock("./mission-client", () => ({
  createMission: vi.fn(),
  getMission: (...args: unknown[]) => mockGetMission(...args),
  getPlanet: vi.fn(),
  getPlanetInterior: vi.fn(),
  listMissionEvents: vi.fn(),
  listMissions: vi.fn(),
  listPlanets: vi.fn(),
  submitMissionDecision: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock("./sandbox-store", () => ({
  useSandboxStore: {
    getState: () => ({
      initSocket: vi.fn(),
    }),
  },
}));

vi.mock("./store", () => ({
  useAppStore: Object.assign(
    () => ({}),
    {
      getState: () => ({ runtimeMode: "advanced" }),
      subscribe: vi.fn(),
    }
  ),
}));

const { buildMissionArtifacts, patchMissionRecordInStore } = await import(
  "./tasks-store"
);

function makeMission(
  id: string,
  overrides?: Partial<MissionRecord>
): MissionRecord {
  const now = Date.now();

  return {
    id,
    kind: "chat",
    title: "Artifact mission",
    sourceText: "Inspect generated artifacts",
    status: "running",
    progress: 55,
    currentStageKey: "execute",
    stages: [
      { key: "receive", label: "Receive", status: "done", startedAt: now - 5000 },
      { key: "execute", label: "Execute", status: "running", startedAt: now - 2000 },
    ],
    createdAt: now - 10000,
    updatedAt: now,
    events: [],
    artifacts: [],
    ...overrides,
  };
}

describe("tasks-store artifact helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds download and preview urls for mission artifacts", () => {
    const mission = makeMission("mission-1", {
      artifacts: [
        {
          kind: "url",
          name: "Dashboard",
          url: "https://example.com/dashboard",
        },
        {
          kind: "file",
          name: "result.json",
          path: "artifacts/result.json",
        },
      ],
    });

    const artifacts = buildMissionArtifacts(mission);

    expect(artifacts[0]).toMatchObject({
      title: "Dashboard",
      downloadKind: "external",
      href: "https://example.com/dashboard",
      downloadUrl: "/api/tasks/mission-1/artifacts/0/download",
      previewUrl: "/api/tasks/mission-1/artifacts/0/preview",
    });
    expect(artifacts[1]).toMatchObject({
      title: "result.json",
      downloadKind: "server",
      href: "/api/tasks/mission-1/artifacts/1/download",
      downloadUrl: "/api/tasks/mission-1/artifacts/1/download",
      previewUrl: "/api/tasks/mission-1/artifacts/1/preview",
      format: "json",
    });
  });

  it("rebuilds detail artifacts when a mission record patch arrives", async () => {
    const mission = makeMission("mission-2", {
      artifacts: [
        {
          kind: "log",
          name: "run.log",
          path: "logs/run.log",
          description: "Executor log",
        },
      ],
    });
    mockGetMission.mockResolvedValue({ ok: true, task: mission });

    const storeState = {
      ready: false,
      loading: true,
      error: "stale",
      selectedTaskId: mission.id,
      tasks: [] as any[],
      detailsById: {} as Record<string, any>,
    };
    const set = (partial: any) => {
      const resolved =
        typeof partial === "function" ? partial(storeState) : partial;
      Object.assign(storeState, resolved);
    };
    const get = () => storeState;

    await patchMissionRecordInStore(mission.id, set, get);

    expect(mockGetMission).toHaveBeenCalledWith(mission.id);
    expect(storeState.error).toBeNull();
    expect(storeState.ready).toBe(true);
    expect(storeState.selectedTaskId).toBe(mission.id);
    expect(storeState.tasks[0].attachmentCount).toBe(1);
    expect(storeState.detailsById[mission.id].artifacts[0]).toMatchObject({
      title: "run.log",
      downloadUrl: `/api/tasks/${mission.id}/artifacts/0/download`,
      previewUrl: `/api/tasks/${mission.id}/artifacts/0/preview`,
      format: "log",
    });
  });
});
