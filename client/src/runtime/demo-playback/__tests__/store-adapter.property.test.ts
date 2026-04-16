/**
 * Property-based tests for DemoStoreAdapter — Store integration layer
 *
 * Property 4: Demo 退出恢复 Store 状态
 * For any initial Mission_Store state (selectedTaskId and tasks list),
 * entering Demo mode then exiting SHALL restore selectedTaskId to its
 * pre-demo value, and the tasks list SHALL NOT contain any kind="demo" records.
 *
 * **Validates: Requirements 4.5**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type { DemoDataBundle } from "@shared/demo/contracts";
import type { MissionTaskSummary } from "@/lib/tasks-store";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

/**
 * In-memory mock state for tasks-store.
 * Each test run resets this via beforeEach / the property body.
 */
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

function resetMockTasksState(
  initialSelectedTaskId: string | null,
  initialTasks: MissionTaskSummary[]
) {
  mockTasksState = {
    selectedTaskId: initialSelectedTaskId,
    tasks: [...initialTasks],
    selectTask: (id: string | null) => {
      mockTasksState.selectedTaskId = id;
    },
    createMission: async input => {
      const newId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Generate a random task ID (string | null) */
const arbTaskId: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 16 }).filter(s => s.trim().length > 0)
);

/** Generate a minimal MissionTaskSummary with a given kind */
function makeSummary(
  overrides: Partial<MissionTaskSummary> = {}
): MissionTaskSummary {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? "Test task",
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

const arbNonDemoTask: fc.Arbitrary<MissionTaskSummary> = fc
  .record({
    id: fc
      .string({ minLength: 1, maxLength: 12 })
      .filter(s => s.trim().length > 0),
    kind: fc.constantFrom("general", "research", "analysis", "strategy"),
  })
  .map(({ id, kind }) => makeSummary({ id, kind }));

const arbTasksList: fc.Arbitrary<MissionTaskSummary[]> = fc.array(
  arbNonDemoTask,
  {
    minLength: 0,
    maxLength: 5,
  }
);

/** Build a minimal DemoDataBundle (adapter only reads meta fields) */
function makeBundle(): DemoDataBundle {
  return {
    version: 1,
    meta: {
      id: "prop-test",
      title: "Property Test Demo",
      description: "test",
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
// Property 4: Demo 退出恢复 Store 状态
// **Validates: Requirements 4.5**
// ---------------------------------------------------------------------------

describe("Property 4: Demo 退出恢复 Store 状态", () => {
  it("after initializeDemoMission() then cleanup(), selectedTaskId is restored and no demo tasks remain", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTaskId,
        arbTasksList,
        async (initialTaskId, initialTasks) => {
          // --- Arrange: set up initial store state ---
          resetMockTasksState(initialTaskId, initialTasks);
          useDemoStore.getState().reset();

          const originalSelectedTaskId = initialTaskId;
          const originalNonDemoKinds = initialTasks.map(t => t.kind);

          // --- Act: enter demo mode then exit ---
          const adapter = new DemoStoreAdapter(makeBundle());
          await adapter.initializeDemoMission();

          // Verify demo mode was activated
          expect(useDemoStore.getState().isActive).toBe(true);

          // Now cleanup
          adapter.cleanup();

          // --- Assert: Property invariants ---
          const finalState = mockTasksState;

          // 1. selectedTaskId is restored to its pre-demo value
          expect(finalState.selectedTaskId).toBe(originalSelectedTaskId);

          // 2. No kind="demo" tasks remain in the tasks list
          const demoTasks = finalState.tasks.filter(t => t.kind === "demo");
          expect(demoTasks).toHaveLength(0);

          // 3. All original non-demo tasks are still present
          const remainingNonDemoKinds = finalState.tasks
            .filter(t => t.kind !== "demo")
            .map(t => t.kind);
          expect(remainingNonDemoKinds).toEqual(originalNonDemoKinds);

          // 4. demo-store is reset
          expect(useDemoStore.getState().isActive).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
