import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionRecord } from "@shared/mission/contracts";

const mockGetMission = vi.fn();
const mockCancelMission = vi.fn();
const mockSubmitMissionOperatorAction = vi.fn();

vi.mock("./mission-client", () => ({
  cancelMission: (...args: unknown[]) => mockCancelMission(...args),
  createMission: vi.fn(),
  getMission: (...args: unknown[]) => mockGetMission(...args),
  getPlanet: vi.fn(),
  getPlanetInterior: vi.fn(),
  listMissionEvents: vi.fn(),
  listMissions: vi.fn(),
  listPlanets: vi.fn(),
  submitMissionOperatorAction: (...args: unknown[]) =>
    mockSubmitMissionOperatorAction(...args),
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
const { useTasksStore } = await import("./tasks-store");

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
    operatorState: "active",
    operatorActions: [],
    attempt: 1,
    ...overrides,
  };
}

describe("tasks-store artifact helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({
      ready: true,
      loading: false,
      error: null,
      selectedTaskId: null,
      tasks: [],
      detailsById: {},
      decisionNotes: {},
      cancellingMissionIds: {},
      operatorActionLoadingByMissionId: {},
      lastDecisionLaunch: null,
    });
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

  it("writes back the cancelled mission detail after cancelMission resolves", async () => {
    const cancelledAt = Date.now();
    const cancelledMission = makeMission("mission-cancelled", {
      status: "cancelled",
      summary: "Stopped by the operator",
      cancelReason: "Stopped by the operator",
      cancelledAt,
      cancelledBy: "ui-user",
      completedAt: cancelledAt,
      events: [
        {
          type: "cancelled",
          message: "Stopped by the operator",
          level: "warn",
          source: "user",
          time: cancelledAt,
        },
      ],
    });

    mockCancelMission.mockImplementation(async () => {
      expect(useTasksStore.getState().cancellingMissionIds[cancelledMission.id]).toBe(
        true
      );

      return {
        ok: true,
        task: cancelledMission,
      };
    });

    const result = await useTasksStore.getState().cancelMission(cancelledMission.id, {
      reason: "Stopped by the operator",
      requestedBy: "ui-user",
      source: "user",
    });

    const state = useTasksStore.getState();
    expect(result).toBe(cancelledMission.id);
    expect(mockCancelMission).toHaveBeenCalledWith(cancelledMission.id, {
      reason: "Stopped by the operator",
      requestedBy: "ui-user",
      source: "user",
    });
    expect(state.cancellingMissionIds[cancelledMission.id]).toBe(false);
    expect(state.tasks[0]).toMatchObject({
      id: cancelledMission.id,
      status: "cancelled",
      workflowStatus: "completed_with_errors",
      summary: "Stopped by the operator",
    });
    expect(state.detailsById[cancelledMission.id]).toMatchObject({
      id: cancelledMission.id,
      status: "cancelled",
      summary: "Stopped by the operator",
    });
  });

  it("writes back operator state after submitOperatorAction resolves", async () => {
    const blockedAt = Date.now();
    const blockedMission = makeMission("mission-blocked", {
      status: "running",
      operatorState: "blocked",
      blocker: {
        reason: "Waiting for credential",
        createdAt: blockedAt,
        createdBy: "ui-user",
      },
      operatorActions: [
        {
          id: "action-1",
          action: "mark-blocked",
          requestedBy: "ui-user",
          reason: "Waiting for credential",
          createdAt: blockedAt,
          result: "completed",
          detail: "Mission is blocked pending manual follow-up.",
        },
      ],
    });

    mockSubmitMissionOperatorAction.mockImplementation(async () => {
      expect(
        useTasksStore.getState().operatorActionLoadingByMissionId[blockedMission.id]?.[
          "mark-blocked"
        ]
      ).toBe(true);

      return {
        ok: true,
        action: blockedMission.operatorActions?.[0],
        task: blockedMission,
      };
    });

    const result = await useTasksStore.getState().submitOperatorAction(
      blockedMission.id,
      {
        action: "mark-blocked",
        reason: "Waiting for credential",
        requestedBy: "ui-user",
      }
    );

    const state = useTasksStore.getState();
    expect(result).toBe(blockedMission.id);
    expect(mockSubmitMissionOperatorAction).toHaveBeenCalledWith(
      blockedMission.id,
      {
        action: "mark-blocked",
        reason: "Waiting for credential",
        requestedBy: "ui-user",
      }
    );
    expect(
      state.operatorActionLoadingByMissionId[blockedMission.id]?.["mark-blocked"]
    ).toBe(false);
    expect(state.tasks[0]).toMatchObject({
      id: blockedMission.id,
      operatorState: "blocked",
      attempt: 1,
    });
    expect(state.detailsById[blockedMission.id]).toMatchObject({
      id: blockedMission.id,
      operatorState: "blocked",
      blocker: {
        reason: "Waiting for credential",
      },
    });
  });
});
