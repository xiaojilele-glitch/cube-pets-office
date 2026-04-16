/**
 * Unit tests for SnapshotScheduler integration in browser-runtime.ts
 *
 * Verifies that createBrowserRuntime creates a scheduler, exposes it via
 * getSnapshotScheduler(), and that the lifecycle helpers (onMissionStatusChange,
 * onMissionStageChange) correctly start/stop/trigger the scheduler.
 *
 * Requirements: 1.1, 1.2, 1.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───

// Mock the snapshot-scheduler module so we can spy on the created scheduler
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockTriggerImmediate = vi.fn().mockResolvedValue(undefined);
const mockIsRunning = vi.fn().mockReturnValue(false);

vi.mock("../lib/snapshot-scheduler", () => ({
  createSnapshotScheduler: vi.fn(() => ({
    start: mockStart,
    stop: mockStop,
    triggerImmediate: mockTriggerImmediate,
    isRunning: mockIsRunning,
  })),
}));

// Mock snapshot-serializer and browser-runtime-storage (transitive deps)
vi.mock("../lib/snapshot-serializer", () => ({
  serializeSnapshot: vi.fn(),
}));
vi.mock("../lib/browser-runtime-storage", () => ({
  saveSnapshot: vi.fn(),
  pruneSnapshots: vi.fn(),
  getAIConfigSnapshot: vi.fn().mockResolvedValue(null),
  persistAIConfig: vi.fn(),
}));

// Mock recovery-detector module
const mockDetectRecoveryCandidate = vi.fn();
vi.mock("../lib/recovery-detector", () => ({
  detectRecoveryCandidate: (...args: any[]) =>
    mockDetectRecoveryCandidate(...args),
}));

// Mock shared modules used by BrowserRuntime internals
vi.mock("@shared/runtime-agent", () => ({
  RuntimeAgent: class {
    constructor() {}
  },
}));
vi.mock("@shared/workflow-kernel", () => ({
  WorkflowKernel: class {
    constructor() {}
  },
}));
vi.mock("@shared/message-bus-rules", () => ({
  WORKFLOW_STAGE_SET: new Set(),
  validateHierarchy: () => true,
  validateStageRoute: () => true,
}));

import { createSnapshotScheduler } from "../lib/snapshot-scheduler";
import {
  createBrowserRuntime,
  getSnapshotScheduler,
  onMissionStatusChange,
  onMissionStageChange,
  checkForRecovery,
} from "./browser-runtime";

// ─── Helpers ───

function makeLLMProvider(): any {
  return {
    chat: vi.fn().mockResolvedValue({ content: "" }),
  };
}

function makeAgents(): any[] {
  return [
    {
      id: "agent-1",
      name: "Test Agent",
      role: "worker",
      department: "engineering",
      managerId: null,
      soul_md: "",
    },
  ];
}

// ─── Setup ───

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up globalThis accessors between tests
  delete (globalThis as any).__snapshotZustandAccessor;
  delete (globalThis as any).__snapshotRegisterMissionProvider;
});

// ─── Tests ───

describe("browser-runtime snapshot integration", () => {
  it("should create a SnapshotScheduler when createBrowserRuntime is called", () => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });

    expect(createSnapshotScheduler).toHaveBeenCalledTimes(1);
    expect(createSnapshotScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 30_000,
        collectState: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it("should expose the scheduler via getSnapshotScheduler()", () => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });

    const scheduler = getSnapshotScheduler();
    expect(scheduler).not.toBeNull();
    expect(scheduler!.start).toBeDefined();
    expect(scheduler!.stop).toBeDefined();
    expect(scheduler!.triggerImmediate).toBeDefined();
    expect(scheduler!.isRunning).toBeDefined();
  });

  it("should not break the existing WorkflowRuntime return value", () => {
    const runtime = createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });

    // All standard WorkflowRuntime fields should still be present
    expect(runtime.workflowRepo).toBeDefined();
    expect(runtime.memoryRepo).toBeDefined();
    expect(runtime.reportRepo).toBeDefined();
    expect(runtime.eventEmitter).toBeDefined();
    expect(runtime.llmProvider).toBeDefined();
    expect(runtime.agentDirectory).toBeDefined();
    expect(runtime.messageBus).toBeDefined();
    expect(runtime.evolutionService).toBeDefined();
  });
});

describe("onMissionStatusChange", () => {
  beforeEach(() => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });
  });

  it("should start scheduler when mission status is 'running'", () => {
    onMissionStatusChange("m-1", "running");
    expect(mockStart).toHaveBeenCalledWith("m-1");
  });

  it("should start scheduler when mission status is 'waiting'", () => {
    onMissionStatusChange("m-2", "waiting");
    expect(mockStart).toHaveBeenCalledWith("m-2");
  });

  it("should stop scheduler when mission status is 'done'", () => {
    onMissionStatusChange("m-1", "done");
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("should stop scheduler when mission status is 'failed'", () => {
    onMissionStatusChange("m-1", "failed");
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("should not start or stop for 'queued' status", () => {
    onMissionStatusChange("m-1", "queued");
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
  });
});

describe("onMissionStageChange", () => {
  beforeEach(() => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });
  });

  it("should trigger an immediate snapshot", () => {
    onMissionStageChange();
    expect(mockTriggerImmediate).toHaveBeenCalledTimes(1);
  });
});

describe("collectState function", () => {
  it("should produce a valid SnapshotPayload with defaults when no mission provider is set", () => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });

    // Extract the collectState function that was passed to createSnapshotScheduler
    const mockedCreate = vi.mocked(createSnapshotScheduler);
    const collectState = mockedCreate.mock.calls[0][0].collectState;

    const payload = collectState();

    // Should have all required SnapshotPayload fields
    expect(payload.mission).toBeDefined();
    expect(payload.mission.id).toBe("");
    expect(payload.mission.status).toBe("queued");
    expect(payload.agentMemories).toEqual(expect.any(Array));
    expect(payload.sceneLayout).toEqual({
      cameraPosition: [0, 8, 12],
      cameraTarget: [0, 0, 0],
      selectedPet: null,
    });
    expect(payload.decisionHistory).toEqual(expect.any(Array));
    expect(payload.attachmentIndex).toEqual(expect.any(Array));
    expect(payload.zustandSlice).toEqual({
      runtimeMode: "frontend",
      aiConfig: expect.anything(),
      chatMessages: [],
    });
  });

  it("should use the registered mission provider when available", () => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });

    // Register a mission provider via globalThis
    const fakeMission = {
      id: "m-test",
      kind: "test",
      title: "Test Mission",
      status: "running" as const,
      progress: 42,
      stages: [],
      createdAt: 1000,
      updatedAt: 2000,
      events: [],
      artifacts: [
        { kind: "file" as const, name: "report.pdf", path: "/tmp/report.pdf" },
      ],
    };

    const registerProvider = (globalThis as any)
      .__snapshotRegisterMissionProvider;
    expect(registerProvider).toBeDefined();
    registerProvider(() => fakeMission);

    const mockedCreate = vi.mocked(createSnapshotScheduler);
    const collectState = mockedCreate.mock.calls[0][0].collectState;
    const payload = collectState();

    expect(payload.mission.id).toBe("m-test");
    expect(payload.mission.title).toBe("Test Mission");
    expect(payload.mission.status).toBe("running");
    expect(payload.attachmentIndex).toHaveLength(1);
    expect(payload.attachmentIndex[0].name).toBe("report.pdf");
  });

  it("should use the Zustand accessor when registered", () => {
    createBrowserRuntime({
      agents: makeAgents(),
      llmProvider: makeLLMProvider(),
    });

    // Register a Zustand accessor
    (globalThis as any).__snapshotZustandAccessor = () => ({
      runtimeMode: "advanced",
      aiConfig: { mode: "server_proxy", source: "server_env" },
      chatMessages: [{ role: "user", content: "hello", timestamp: 123 }],
    });

    const mockedCreate = vi.mocked(createSnapshotScheduler);
    const collectState = mockedCreate.mock.calls[0][0].collectState;
    const payload = collectState();

    expect(payload.zustandSlice.runtimeMode).toBe("advanced");
    expect(payload.zustandSlice.aiConfig.mode).toBe("server_proxy");
    expect(payload.zustandSlice.chatMessages).toHaveLength(1);
  });
});

// ─── checkForRecovery tests (Requirements 6.1, 6.2, 6.3) ───

function makeRecoveryCandidate(overrides: Record<string, any> = {}) {
  return {
    snapshot: {
      id: "snap-1",
      missionId: "m-1",
      version: 1,
      checksum: "abc123",
      createdAt: Date.now(),
      missionTitle: "Test Mission",
      missionProgress: 50,
      missionStatus: "running" as const,
      payload: {} as any,
    },
    isValid: true,
    ...overrides,
  };
}

describe("checkForRecovery", () => {
  beforeEach(() => {
    mockDetectRecoveryCandidate.mockReset();
  });

  it("should return null when no recovery candidate exists", async () => {
    mockDetectRecoveryCandidate.mockResolvedValue(null);

    const result = await checkForRecovery("frontend");
    expect(result).toBeNull();
    expect(mockDetectRecoveryCandidate).toHaveBeenCalledTimes(1);
  });

  it("should return the candidate in frontend mode", async () => {
    const candidate = makeRecoveryCandidate();
    mockDetectRecoveryCandidate.mockResolvedValue(candidate);

    const result = await checkForRecovery("frontend");
    expect(result).toBe(candidate);
  });

  it("should return the local candidate in advanced mode (server not yet implemented)", async () => {
    const candidate = makeRecoveryCandidate();
    mockDetectRecoveryCandidate.mockResolvedValue(candidate);

    const result = await checkForRecovery("advanced");
    expect(result).toBe(candidate);
    // Still calls local detection as fallback
    expect(mockDetectRecoveryCandidate).toHaveBeenCalledTimes(1);
  });

  it("should return null in advanced mode when no local candidate exists", async () => {
    mockDetectRecoveryCandidate.mockResolvedValue(null);

    const result = await checkForRecovery("advanced");
    expect(result).toBeNull();
  });

  it("should return invalid candidate with checksum_mismatch reason", async () => {
    const candidate = makeRecoveryCandidate({
      isValid: false,
      invalidReason: "checksum_mismatch",
    });
    mockDetectRecoveryCandidate.mockResolvedValue(candidate);

    const result = await checkForRecovery("frontend");
    expect(result).toBe(candidate);
    expect(result!.isValid).toBe(false);
    expect(result!.invalidReason).toBe("checksum_mismatch");
  });

  it("should return invalid candidate with version_incompatible reason", async () => {
    const candidate = makeRecoveryCandidate({
      isValid: false,
      invalidReason: "version_incompatible",
    });
    mockDetectRecoveryCandidate.mockResolvedValue(candidate);

    const result = await checkForRecovery("advanced");
    expect(result).toBe(candidate);
    expect(result!.isValid).toBe(false);
    expect(result!.invalidReason).toBe("version_incompatible");
  });
});
