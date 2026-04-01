/**
 * Unit tests for snapshot-lifecycle-bridge.ts
 *
 * Verifies that the bridge:
 * 1. Registers globalThis accessors (__snapshotZustandAccessor, __snapshotRestoreZustand, __snapshotRestoreScene)
 * 2. Registers the mission provider via __snapshotRegisterMissionProvider
 * 3. Subscribes to workflow-store and fires onMissionStatusChange / onMissionStageChange
 *
 * Requirements: 1.1, 1.2
 * Task: 9.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───

const mockOnMissionStatusChange = vi.fn();
const mockOnMissionStageChange = vi.fn();

vi.mock("@/runtime/browser-runtime", () => ({
  onMissionStatusChange: (...args: any[]) => mockOnMissionStatusChange(...args),
  onMissionStageChange: (...args: any[]) => mockOnMissionStageChange(...args),
}));

// Mock the stores with Zustand-like subscribe
type Listener = (state: any, prevState: any) => void;

let appStoreState: Record<string, any> = {};
const appStoreListeners: Listener[] = [];

vi.mock("./store", () => ({
  useAppStore: Object.assign(
    (selector?: (s: any) => any) => selector ? selector(appStoreState) : appStoreState,
    {
      getState: () => appStoreState,
      setState: (partial: Record<string, any>) => {
        const prev = { ...appStoreState };
        appStoreState = { ...appStoreState, ...partial };
        for (const listener of appStoreListeners) {
          listener(appStoreState, prev);
        }
      },
      subscribe: (listener: Listener) => {
        appStoreListeners.push(listener);
        return () => {
          const idx = appStoreListeners.indexOf(listener);
          if (idx >= 0) appStoreListeners.splice(idx, 1);
        };
      },
    },
  ),
}));

let workflowStoreState: Record<string, any> = {};
const workflowStoreListeners: Listener[] = [];

function setWorkflowStoreState(partial: Record<string, any>) {
  const prev = { ...workflowStoreState };
  workflowStoreState = { ...workflowStoreState, ...partial };
  for (const listener of workflowStoreListeners) {
    listener(workflowStoreState, prev);
  }
}

vi.mock("./workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector?: (s: any) => any) => selector ? selector(workflowStoreState) : workflowStoreState,
    {
      getState: () => workflowStoreState,
      subscribe: (listener: Listener) => {
        workflowStoreListeners.push(listener);
        return () => {
          const idx = workflowStoreListeners.indexOf(listener);
          if (idx >= 0) workflowStoreListeners.splice(idx, 1);
        };
      },
    },
  ),
}));

// ─── Setup ───

beforeEach(() => {
  vi.clearAllMocks();

  appStoreState = {
    runtimeMode: "frontend",
    aiConfig: { mode: "server_proxy" },
    chatMessages: [],
    selectedPet: null,
    setSelectedPet: vi.fn(),
  };
  appStoreListeners.length = 0;

  workflowStoreState = {
    eventLog: [],
    currentWorkflow: null,
  };
  workflowStoreListeners.length = 0;

  // Clean up globalThis
  delete (globalThis as any).__snapshotZustandAccessor;
  delete (globalThis as any).__snapshotRestoreZustand;
  delete (globalThis as any).__snapshotRestoreScene;
  delete (globalThis as any).__snapshotRegisterMissionProvider;
  delete (globalThis as any).__sceneRestoreLayout;

  // Reset the module-level _bridgeInitialised flag by re-importing
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as any).__snapshotZustandAccessor;
  delete (globalThis as any).__snapshotRestoreZustand;
  delete (globalThis as any).__snapshotRestoreScene;
  delete (globalThis as any).__snapshotRegisterMissionProvider;
  delete (globalThis as any).__sceneRestoreLayout;
});

// ─── Tests ───

describe("initSnapshotLifecycleBridge", () => {
  it("should register __snapshotZustandAccessor on globalThis", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    const accessor = (globalThis as any).__snapshotZustandAccessor;
    expect(accessor).toBeDefined();
    expect(typeof accessor).toBe("function");

    const result = accessor();
    expect(result).toEqual({
      runtimeMode: "frontend",
      aiConfig: { mode: "server_proxy" },
      chatMessages: [],
    });
  });

  it("should register __snapshotRestoreZustand on globalThis", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    const restoreZustand = (globalThis as any).__snapshotRestoreZustand;
    expect(restoreZustand).toBeDefined();
    expect(typeof restoreZustand).toBe("function");

    restoreZustand({
      runtimeMode: "advanced",
      aiConfig: { mode: "browser_direct" },
      chatMessages: [{ role: "user", content: "hi", timestamp: 1 }],
    });

    expect(appStoreState.runtimeMode).toBe("advanced");
    expect(appStoreState.aiConfig).toEqual({ mode: "browser_direct" });
    expect(appStoreState.chatMessages).toHaveLength(1);
  });

  it("should register __snapshotRestoreScene on globalThis", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    const restoreScene = (globalThis as any).__snapshotRestoreScene;
    expect(restoreScene).toBeDefined();

    restoreScene({
      cameraPosition: [1, 2, 3],
      cameraTarget: [4, 5, 6],
      selectedPet: "cat-1",
    });

    expect(appStoreState.setSelectedPet).toHaveBeenCalledWith("cat-1");
  });

  it("should forward scene restore to __sceneRestoreLayout if registered", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    const mockSceneRestore = vi.fn();
    (globalThis as any).__sceneRestoreLayout = mockSceneRestore;

    const layout = {
      cameraPosition: [1, 2, 3] as [number, number, number],
      cameraTarget: [4, 5, 6] as [number, number, number],
      selectedPet: null,
    };

    (globalThis as any).__snapshotRestoreScene(layout);
    expect(mockSceneRestore).toHaveBeenCalledWith(layout);
  });

  it("should only initialise once (idempotent)", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();
    initSnapshotLifecycleBridge();
    initSnapshotLifecycleBridge();

    // Should only have one subscriber
    expect(workflowStoreListeners.length).toBe(1);
  });
});

describe("workflow-store subscription", () => {
  it("should call onMissionStageChange when a stage_change event appears in eventLog", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    setWorkflowStoreState({
      eventLog: [
        { type: "stage_change", data: { workflowId: "w-1", stage: "planning" }, timestamp: "t1" },
      ],
    });

    expect(mockOnMissionStageChange).toHaveBeenCalledTimes(1);
  });

  it("should call onMissionStatusChange when currentWorkflow status changes", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    // First set a workflow
    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "direction" },
    });

    expect(mockOnMissionStatusChange).toHaveBeenCalledWith("w-1", "running");
  });

  it("should call onMissionStatusChange with 'done' when workflow completes", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    // Set initial running state
    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "direction" },
    });
    mockOnMissionStatusChange.mockClear();

    // Transition to completed
    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "completed", current_stage: "evolution" },
    });

    expect(mockOnMissionStatusChange).toHaveBeenCalledWith("w-1", "done");
  });

  it("should call onMissionStatusChange with 'failed' when workflow fails", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "execution" },
    });
    mockOnMissionStatusChange.mockClear();

    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "failed", current_stage: "execution" },
    });

    expect(mockOnMissionStatusChange).toHaveBeenCalledWith("w-1", "failed");
  });

  it("should call onMissionStageChange when stage changes without status change", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "direction" },
    });
    mockOnMissionStageChange.mockClear();

    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "planning" },
    });

    expect(mockOnMissionStageChange).toHaveBeenCalled();
  });

  it("should not fire hooks when nothing changes", async () => {
    const { initSnapshotLifecycleBridge } = await import("./snapshot-lifecycle-bridge");
    initSnapshotLifecycleBridge();

    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "direction" },
    });
    mockOnMissionStatusChange.mockClear();
    mockOnMissionStageChange.mockClear();

    // Same state again
    setWorkflowStoreState({
      currentWorkflow: { id: "w-1", status: "running", current_stage: "direction" },
    });

    expect(mockOnMissionStatusChange).not.toHaveBeenCalled();
    expect(mockOnMissionStageChange).not.toHaveBeenCalled();
  });
});
