/**
 * Unit tests for DemoStoreAdapter — Store integration layer
 *
 * Tests cover:
 * - initializeDemoMission creates a MissionRecord with kind="demo"
 * - Demo mission is set as the currently selected task
 * - Demo store is activated after initialization
 * - cleanup restores selectedTaskId to pre-demo value
 * - cleanup removes demo records from tasks list
 * - cleanup resets demo-store
 *
 * **Validates: Requirements 4.3, 4.4, 4.5**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DemoDataBundle } from "@shared/demo/contracts";
import type { MissionTaskSummary } from "@/lib/tasks-store";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let mockTasksState: {
  selectedTaskId: string | null;
  tasks: MissionTaskSummary[];
  selectTask: (id: string | null) => void;
  createMission: (input: {
    title?: string;
    sourceText?: string;
    kind?: string;
    topicId?: string;
  }) => Promise<string | null>;
};

/** Track the kind passed to createMission for assertion */
let lastCreateMissionKind: string | undefined;

function resetMockTasksState(
  initialSelectedTaskId: string | null,
  initialTasks: MissionTaskSummary[],
) {
  lastCreateMissionKind = undefined;
  mockTasksState = {
    selectedTaskId: initialSelectedTaskId,
    tasks: [...initialTasks],
    selectTask: (id: string | null) => {
      mockTasksState.selectedTaskId = id;
    },
    createMission: async (input) => {
      lastCreateMissionKind = input.kind;
      const newId = "demo-task-001";
      const newTask: MissionTaskSummary = {
        id: newId,
        title: input.title ?? "Demo",
        kind: input.kind ?? "general",
        sourceText: input.sourceText ?? "",
        status: "running",
        workflowStatus: "running",
        progress: 0,
        currentStageKey: null,
        currentStageLabel: null,
        summary: "",
        waitingFor: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        startedAt: Date.now(),
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
      };
      mockTasksState.tasks.push(newTask);
      return newId;
    },
  };
}

vi.mock("@/lib/tasks-store", () => ({
  useTasksStore: {
    getState: () => mockTasksState,
    setState: (partial: Record<string, unknown>) => {
      if ("tasks" in partial && Array.isArray(partial.tasks)) {
        mockTasksState.tasks = partial.tasks;
      }
      if ("selectedTaskId" in partial) {
        mockTasksState.selectedTaskId = partial.selectedTaskId as string | null;
      }
    },
  },
}));

vi.mock("@/lib/runtime/local-event-bus", () => ({
  runtimeEventBus: { emit: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import adapter AFTER mocks are set up
// ---------------------------------------------------------------------------

import { DemoStoreAdapter } from "../store-adapter";
import { useDemoStore } from "@/lib/demo-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSummary(
  overrides: Partial<MissionTaskSummary> = {},
): MissionTaskSummary {
  return {
    id: overrides.id ?? "existing-task-1",
    title: overrides.title ?? "Existing task",
    kind: overrides.kind ?? "general",
    sourceText: "",
    status: "done",
    workflowStatus: "completed",
    progress: 100,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
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
  };
}

function makeBundle(): DemoDataBundle {
  return {
    version: 1,
    meta: {
      id: "unit-test",
      title: "Unit Test Demo",
      description: "A demo for unit testing",
      createdAt: new Date().toISOString(),
      totalDurationMs: 1000,
      locale: "en-US",
    },
    timeline: [],
    workflow: {} as any,
    organization: {} as any,
    agents: [],
    tasks: [],
    messages: [],
    finalReport: {} as any,
    evolutionPatches: [],
    capabilities: [],
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockTasksState(null, []);
  useDemoStore.getState().reset();
});

afterEach(() => {
  useDemoStore.getState().reset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DemoStoreAdapter — initializeDemoMission", () => {
  it("creates a MissionRecord with kind='demo'", async () => {
    const adapter = new DemoStoreAdapter(makeBundle());
    await adapter.initializeDemoMission();

    expect(lastCreateMissionKind).toBe("demo");
  });

  it("sets the demo mission as the currently selected task", async () => {
    resetMockTasksState("prev-task-id", []);
    const adapter = new DemoStoreAdapter(makeBundle());
    await adapter.initializeDemoMission();

    expect(mockTasksState.selectedTaskId).toBe("demo-task-001");
  });

  it("activates the demo store", async () => {
    const adapter = new DemoStoreAdapter(makeBundle());
    await adapter.initializeDemoMission();

    expect(useDemoStore.getState().isActive).toBe(true);
  });
});

describe("DemoStoreAdapter — cleanup", () => {
  it("restores selectedTaskId to the pre-demo value", async () => {
    resetMockTasksState("original-task-42", [
      makeSummary({ id: "original-task-42", kind: "general" }),
    ]);

    const adapter = new DemoStoreAdapter(makeBundle());
    await adapter.initializeDemoMission();

    // selectedTaskId should now point to the demo task
    expect(mockTasksState.selectedTaskId).toBe("demo-task-001");

    adapter.cleanup();

    expect(mockTasksState.selectedTaskId).toBe("original-task-42");
  });

  it("removes all tasks with kind='demo' from the tasks list", async () => {
    const existingTask = makeSummary({ id: "real-task-1", kind: "research" });
    resetMockTasksState(null, [existingTask]);

    const adapter = new DemoStoreAdapter(makeBundle());
    await adapter.initializeDemoMission();

    // A demo task should now exist in the list
    expect(mockTasksState.tasks.some((t) => t.kind === "demo")).toBe(true);

    adapter.cleanup();

    // No demo tasks should remain
    const demoTasks = mockTasksState.tasks.filter((t) => t.kind === "demo");
    expect(demoTasks).toHaveLength(0);

    // The original non-demo task should still be present
    expect(mockTasksState.tasks.some((t) => t.id === "real-task-1")).toBe(true);
  });

  it("resets the demo store (isActive becomes false)", async () => {
    const adapter = new DemoStoreAdapter(makeBundle());
    await adapter.initializeDemoMission();

    expect(useDemoStore.getState().isActive).toBe(true);

    adapter.cleanup();

    expect(useDemoStore.getState().isActive).toBe(false);
  });
});
