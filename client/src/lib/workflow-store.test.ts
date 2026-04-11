import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetWorkflowsSnapshot = vi.fn();
const mockPersistWorkflows = vi.fn();

vi.mock("./browser-runtime-storage", () => ({
  getAgentsSnapshot: vi.fn(async () => []),
  getHeartbeatReportsSnapshot: vi.fn(async () => []),
  getHeartbeatStatusesSnapshot: vi.fn(async () => []),
  getMemorySearchSnapshot: vi.fn(async () => null),
  getRecentMemorySnapshot: vi.fn(async () => null),
  getWorkflowDetailSnapshot: vi.fn(async () => null),
  getWorkflowsSnapshot: (...args: any[]) => mockGetWorkflowsSnapshot(...args),
  persistAgents: vi.fn(async () => {}),
  persistHeartbeatReports: vi.fn(async () => {}),
  persistHeartbeatStatuses: vi.fn(async () => {}),
  persistMemorySearch: vi.fn(async () => {}),
  persistRecentMemory: vi.fn(async () => {}),
  persistWorkflowDetail: vi.fn(async () => {}),
  persistWorkflows: (...args: any[]) => mockPersistWorkflows(...args),
}));

vi.mock("./runtime/local-event-bus", () => ({
  runtimeEventBus: {
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("./runtime/local-runtime-client", () => ({
  localRuntime: {
    ensureStarted: vi.fn(async () => {}),
    getSnapshot: vi.fn(async () => ({
      agents: [],
      agentStatuses: {},
      workflows: [],
      heartbeatStatuses: [],
      heartbeatReports: [],
      stages: [],
    })),
    getAgents: vi.fn(async () => ({ agents: [] })),
    getStages: vi.fn(async () => ({ stages: [] })),
    listWorkflows: vi.fn(async () => ({ workflows: [] })),
    getWorkflowDetail: vi.fn(async () => ({
      workflow: null,
      tasks: [],
      messages: [],
      report: null,
    })),
    getAgentRecentMemory: vi.fn(async () => ({ entries: [] })),
    searchAgentMemory: vi.fn(async () => ({ memories: [] })),
    getHeartbeatStatuses: vi.fn(async () => ({ statuses: [] })),
    getHeartbeatReports: vi.fn(async () => ({ reports: [] })),
    runHeartbeat: vi.fn(async () => {}),
    submitDirective: vi.fn(async () => ({ workflowId: "wf-local" })),
    downloadWorkflowReport: vi.fn(async () => ({
      filename: "workflow.md",
      mimeType: "text/markdown",
      content: "# ok",
    })),
    downloadHeartbeatReport: vi.fn(async () => ({
      filename: "heartbeat.md",
      mimeType: "text/markdown",
      content: "# ok",
    })),
  },
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));

describe("workflow-store advanced fallback handling", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { useAppStore } = await import("./store");
    useAppStore.setState({ runtimeMode: "advanced" });

    const { useWorkflowStore } = await import("./workflow-store");
    useWorkflowStore.setState({
      socket: null,
      connected: false,
      agents: [],
      agentsError: null,
      agentStatuses: {},
      currentWorkflowId: null,
      workflows: [],
      workflowsError: null,
      currentWorkflow: null,
      workflowDetailError: null,
      tasks: [],
      messages: [],
      agentMemoryRecent: [],
      agentMemorySearchResults: [],
      memoryError: null,
      heartbeatStatuses: [],
      heartbeatReports: [],
      heartbeatError: null,
      stages: [],
      isWorkflowPanelOpen: false,
      activeView: "directive",
      isSubmitting: false,
      submitError: null,
      lastSubmittedInputSignature: null,
      lastSubmittedAt: null,
      isMemoryLoading: false,
      isHeartbeatLoading: false,
      runningHeartbeatAgentId: null,
      selectedMemoryAgentId: null,
      memoryQuery: "",
      eventLog: [],
    });
  });

  it("falls back to cached workflows when the advanced API returns HTML", async () => {
    const cachedWorkflow = {
      id: "wf-cached",
      directive: "Use cached workflow",
      status: "running",
      current_stage: "execution",
      created_at: "2026-04-11T00:00:00.000Z",
    };
    mockGetWorkflowsSnapshot.mockResolvedValue([cachedWorkflow]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>fallback</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      })
    );

    const { useWorkflowStore } = await import("./workflow-store");
    await useWorkflowStore.getState().fetchWorkflows();

    const state = useWorkflowStore.getState();
    expect(state.workflows).toEqual([cachedWorkflow]);
    expect(state.workflowsError?.source).toBe("html-fallback");
    expect(state.workflowsError?.message).not.toContain("Unexpected token");
  });

  it("stores a structured submit error instead of surfacing a parser failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html><body>fallback</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      })
    );

    const { useWorkflowStore } = await import("./workflow-store");
    await expect(
      useWorkflowStore.getState().submitDirective({
        directive: "Start the mission",
      })
    ).resolves.toBeNull();

    const state = useWorkflowStore.getState();
    expect(state.submitError?.source).toBe("html-fallback");
    expect(state.submitError?.message).not.toContain("Unexpected token");
  });
});
