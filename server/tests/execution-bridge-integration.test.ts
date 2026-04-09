/**
 * Integration test: mock 模式完整桥接流程
 *
 * Verifies the end-to-end flow:
 *   ExecutionBridge detects executable content → ExecutionPlanBuilder builds plan
 *   → ExecutorClient dispatches (mocked) → Mission state updates → Event flow mapping
 *
 * Requirements: 1.1, 2.1, 3.1, 4.3, 7.1
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ExecutionBridge,
  type ExecutionBridgeOptions,
  type BridgeResult,
} from "../core/execution-bridge.js";
import { mapExecutorEventToAction } from "../core/executor-event-mapper.js";
import type { CreateExecutorJobResponse } from "../../shared/executor/api.js";

// ─── Mock MissionRuntime ────────────────────────────────────────────────────

function createMockMissionRuntime() {
  return {
    createTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listTaskEvents: vi.fn(),
    patchMissionExecution: vi.fn(),
    patchEnrichment: vi.fn(),
    markMissionRunning: vi.fn(),
    updateMissionStage: vi.fn(),
    logMission: vi.fn(),
    waitOnMission: vi.fn(),
    finishMission: vi.fn(),
    failMission: vi.fn(),
    resumeMissionFromDecision: vi.fn(),
    recoverInterruptedMissions: vi.fn(),
    emitDecisionSubmitted: vi.fn(),
  };
}

// ─── Fake fetch that simulates lobster-executor ─────────────────────────────

function createFakeExecutorFetch(jobId = "job-integration-001") {
  const calls: { url: string; init: RequestInit }[] = [];

  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url.toString();
    calls.push({ url: urlStr, init: init ?? {} });

    // Health check endpoint
    if (urlStr.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create job endpoint
    if (urlStr.endsWith("/api/executor/jobs")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const response: CreateExecutorJobResponse = {
        ok: true,
        accepted: true,
        requestId: body.requestId ?? "req-test",
        missionId: body.missionId ?? "mission-test",
        jobId,
        receivedAt: new Date().toISOString(),
      };
      return new Response(JSON.stringify(response), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  };

  return { fakeFetch: fakeFetch as typeof fetch, calls };
}

// ─── Helper: create bridge with fake executor ───────────────────────────────

function createIntegrationBridge(overrides?: {
  executionMode?: "mock" | "real";
  jobId?: string;
}) {
  const mockRuntime = createMockMissionRuntime();
  const { fakeFetch, calls } = createFakeExecutorFetch(overrides?.jobId ?? "job-int-001");

  const options: ExecutionBridgeOptions = {
    missionRuntime: mockRuntime as any,
    executorBaseUrl: "http://localhost:9800",
    callbackUrl: "http://localhost:3000/api/executor/events",
    executionMode: overrides?.executionMode ?? "mock",
    defaultImage: "node:20-slim",
    retryCount: 1,
  };

  // Patch the ExecutorClient's fetch by creating the bridge, then replacing
  // the internal client's fetch. We access it via the private field.
  const bridge = new ExecutionBridge(options);
  // Replace the internal ExecutorClient's fetch with our fake
  const client = (bridge as any).executorClient;
  (client as any).fetchImpl = fakeFetch;

  return { bridge, mockRuntime, calls };
}

// ─── Deliverables ───────────────────────────────────────────────────────────

const EXECUTABLE_DELIVERABLE = [
  "Here is the implementation:\n\n```python\nimport pytest\n\ndef test_add():\n    assert 1 + 1 == 2\n```\n\nRun with: pytest tests/",
];

const NON_EXECUTABLE_DELIVERABLE = [
  "The analysis shows that the system is performing within expected parameters. No code changes needed.",
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Integration: mock 模式完整桥接流程", () => {
  describe("Req 1.1 — ExecutionBridge detects executable content", () => {
    it("detects executable content in deliverables with code blocks + script keywords", () => {
      const { bridge } = createIntegrationBridge();
      const result = bridge.detectExecutable(EXECUTABLE_DELIVERABLE);
      expect(result.executable).toBe(true);
      expect(result.reason).toBeTruthy();
    });

    it("skips non-executable deliverables", () => {
      const { bridge } = createIntegrationBridge();
      const result = bridge.detectExecutable(NON_EXECUTABLE_DELIVERABLE);
      expect(result.executable).toBe(false);
    });
  });

  describe("Req 2.1 — ExecutionPlanBuilder creates a valid plan", () => {
    it("bridge() builds a plan with correct missionId and sourceText", async () => {
      const { bridge, calls } = createIntegrationBridge();

      const result = await bridge.bridge("mission-int-1", EXECUTABLE_DELIVERABLE);

      expect(result.triggered).toBe(true);
      // The plan was dispatched — verify the job request sent to the executor
      const createJobCall = calls.find((c) => c.url.endsWith("/api/executor/jobs"));
      expect(createJobCall).toBeDefined();

      const jobRequest = JSON.parse(createJobCall!.init.body as string);
      expect(jobRequest.plan.missionId).toBe("mission-int-1");
      expect(jobRequest.plan.sourceText).toContain("pytest");
      expect(jobRequest.plan.objective).toBeTruthy();
      expect(jobRequest.plan.mode).toBe("auto");
    });
  });

  describe("Req 3.1 — ExecutorClient receives the dispatch call", () => {
    it("dispatches to the executor and receives accepted response", async () => {
      const { bridge, calls } = createIntegrationBridge({ jobId: "job-dispatch-test" });

      const result = await bridge.bridge("mission-dispatch-1", EXECUTABLE_DELIVERABLE);

      expect(result.triggered).toBe(true);
      expect(result.jobId).toBe("job-dispatch-test");
      expect(result.requestId).toBeTruthy();

      // Verify health check + create job calls were made
      const healthCall = calls.find((c) => c.url.endsWith("/health"));
      const jobCall = calls.find((c) => c.url.endsWith("/api/executor/jobs"));
      expect(healthCall).toBeDefined();
      expect(jobCall).toBeDefined();
    });
  });

  describe("Req 7.1 — Mock mode payload has runner.kind === 'mock'", () => {
    it("injects mock runner config into the job payload", async () => {
      const { bridge, calls } = createIntegrationBridge({ executionMode: "mock" });

      await bridge.bridge("mission-mock-1", EXECUTABLE_DELIVERABLE);

      const createJobCall = calls.find((c) => c.url.endsWith("/api/executor/jobs"));
      expect(createJobCall).toBeDefined();

      const jobRequest = JSON.parse(createJobCall!.init.body as string);
      const firstJob = jobRequest.plan.jobs[0];
      expect(firstJob).toBeDefined();
      expect(firstJob.payload.runner).toBeDefined();
      expect(firstJob.payload.runner.kind).toBe("mock");
      expect(firstJob.payload.runner.outcome).toBe("success");
      expect(firstJob.payload.runner.steps).toBe(3);
    });

    it("injects real mode payload when executionMode is 'real'", async () => {
      const { bridge, calls } = createIntegrationBridge({ executionMode: "real" });

      await bridge.bridge("mission-real-1", EXECUTABLE_DELIVERABLE);

      const createJobCall = calls.find((c) => c.url.endsWith("/api/executor/jobs"));
      const jobRequest = JSON.parse(createJobCall!.init.body as string);
      const firstJob = jobRequest.plan.jobs[0];
      expect(firstJob.payload.aiEnabled).toBe(true);
      expect(firstJob.payload.aiTaskType).toBe("text-generation");
      expect(firstJob.payload.image).toBeUndefined();
      expect(firstJob.payload.command).toBeDefined();
      expect(Array.isArray(firstJob.payload.command)).toBe(true);
      expect(firstJob.payload.command).toHaveLength(0);
      expect(firstJob.payload.env).toMatchObject({
        MISSION_ID: "mission-real-1",
      });
      expect(typeof firstJob.payload.env.TASK_CONTENT).toBe("string");
      expect(firstJob.payload.env.TASK_CONTENT).toContain("pytest");
    });
  });

  describe("Mission state updates after successful dispatch", () => {
    it("updates mission executor context with jobId and requestId", async () => {
      const { bridge, mockRuntime } = createIntegrationBridge({ jobId: "job-state-001" });

      const result = await bridge.bridge("mission-state-1", EXECUTABLE_DELIVERABLE);

      expect(result.triggered).toBe(true);

      // Verify patchMissionExecution was called with executor context
      expect(mockRuntime.patchMissionExecution).toHaveBeenCalledWith(
        "mission-state-1",
        expect.objectContaining({
          executor: expect.objectContaining({
            name: "lobster",
            jobId: "job-state-001",
            status: "queued",
            baseUrl: "http://localhost:9800",
            lastEventType: "job.accepted",
          }),
        }),
      );

      // Verify requestId is present in the executor context
      const patchCall = mockRuntime.patchMissionExecution.mock.calls[0][1];
      expect(patchCall.executor.requestId).toBeTruthy();
    });

    it("advances mission to execute stage at 60% progress", async () => {
      const { bridge, mockRuntime } = createIntegrationBridge();

      await bridge.bridge("mission-progress-1", EXECUTABLE_DELIVERABLE);

      // Should have called markMissionRunning for execute stage
      const executeCalls = mockRuntime.markMissionRunning.mock.calls.filter(
        (call: any[]) => call[1] === "execute",
      );
      expect(executeCalls.length).toBeGreaterThanOrEqual(1);
      const executeCall = executeCalls[executeCalls.length - 1];
      expect(executeCall[0]).toBe("mission-progress-1");
      expect(executeCall[3]).toBe(60); // progress
    });

    it("transitions through provision → execute stages", async () => {
      const { bridge, mockRuntime } = createIntegrationBridge();

      await bridge.bridge("mission-stages-1", EXECUTABLE_DELIVERABLE);

      // Verify provision stage was set first
      const provisionCalls = mockRuntime.markMissionRunning.mock.calls.filter(
        (call: any[]) => call[1] === "provision",
      );
      expect(provisionCalls.length).toBeGreaterThanOrEqual(1);

      // Then execute stage
      const executeCalls = mockRuntime.markMissionRunning.mock.calls.filter(
        (call: any[]) => call[1] === "execute",
      );
      expect(executeCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Req 4.3 — Event flow mapping: job.completed → mission done", () => {
    it("maps job.completed event to done action", () => {
      const result = mapExecutorEventToAction({
        type: "job.completed",
        status: "completed",
        summary: "All tests passed",
      });
      expect(result.action).toBe("done");
      expect((result as any).summary).toBe("All tests passed");
    });

    it("maps job.started event to running action", () => {
      const result = mapExecutorEventToAction({
        type: "job.started",
        status: "running",
        progress: 10,
      });
      expect(result.action).toBe("running");
      expect((result as any).progress).toBe(10);
    });

    it("maps job.failed event to failed action", () => {
      const result = mapExecutorEventToAction({
        type: "job.failed",
        status: "failed",
        message: "Container OOM killed",
      });
      expect(result.action).toBe("failed");
      expect((result as any).error).toBe("Container OOM killed");
    });

    it("maps job.progress event with clamped progress", () => {
      const result = mapExecutorEventToAction({
        type: "job.progress",
        progress: 150, // exceeds 100
      });
      expect(result.action).toBe("progress");
      expect((result as any).progress).toBe(100);
    });

    it("event mapping is consistent for mock and real mode events", () => {
      // The same event structure should produce the same mapping regardless of source
      const mockEvent = { type: "job.completed" as const, status: "completed", summary: "Mock done" };
      const realEvent = { type: "job.completed" as const, status: "completed", summary: "Real done" };

      const mockResult = mapExecutorEventToAction(mockEvent);
      const realResult = mapExecutorEventToAction(realEvent);

      expect(mockResult.action).toBe("done");
      expect(realResult.action).toBe("done");
    });
  });

  describe("Full end-to-end flow: detection → plan → dispatch → state update", () => {
    it("completes the full mock bridge flow without errors", async () => {
      const { bridge, mockRuntime, calls } = createIntegrationBridge({
        executionMode: "mock",
        jobId: "job-e2e-001",
      });

      // Step 1: Bridge with executable deliverables
      const result = await bridge.bridge("mission-e2e-1", EXECUTABLE_DELIVERABLE);

      // Step 2: Verify detection triggered
      expect(result.triggered).toBe(true);
      expect(result.jobId).toBe("job-e2e-001");

      // Step 3: Verify plan was built and dispatched
      const jobCall = calls.find((c) => c.url.endsWith("/api/executor/jobs"));
      expect(jobCall).toBeDefined();
      const jobRequest = JSON.parse(jobCall!.init.body as string);
      expect(jobRequest.plan.missionId).toBe("mission-e2e-1");
      expect(jobRequest.plan.jobs[0].payload.runner.kind).toBe("mock");

      // Step 4: Verify callback URL in the request
      expect(jobRequest.callback.eventsUrl).toBe(
        "http://localhost:3000/api/executor/events",
      );

      // Step 5: Verify mission state was updated
      expect(mockRuntime.patchMissionExecution).toHaveBeenCalledTimes(1);
      expect(mockRuntime.markMissionRunning).toHaveBeenCalled();

      // Step 6: Simulate event flow — job.completed arrives
      const completedMapping = mapExecutorEventToAction({
        type: "job.completed",
        status: "completed",
        summary: "Mock execution completed successfully",
      });
      expect(completedMapping.action).toBe("done");

      // In real flow, the /api/executor/events handler would call:
      // missionRuntime.finishMission(missionId, summary)
      // We verify the mapping is correct, which is what drives that call.
    });

    it("does not dispatch when deliverables are non-executable", async () => {
      const { bridge, mockRuntime, calls } = createIntegrationBridge();

      const result = await bridge.bridge("mission-skip-1", NON_EXECUTABLE_DELIVERABLE);

      expect(result.triggered).toBe(false);
      // No executor calls should have been made
      const jobCalls = calls.filter((c) => c.url.endsWith("/api/executor/jobs"));
      expect(jobCalls).toHaveLength(0);
      // No mission state updates
      expect(mockRuntime.patchMissionExecution).not.toHaveBeenCalled();
    });
  });
});
