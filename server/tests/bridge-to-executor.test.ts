/**
 * Unit tests for WorkflowEngine.bridgeToExecutor private method.
 *
 * Tests the integration point between WorkflowEngine and ExecutionBridge:
 * - Triggers bridge when tasks have executable deliverables
 * - Skips bridge when no deliverables or only text
 * - Catches bridge errors, records workflow issue, and continues pipeline
 *
 * Requirements: 1.1, 1.2, 6.4
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorkflowEngine } from "../core/workflow-engine.js";
import type { WorkflowRuntime } from "../../shared/workflow-runtime.js";
import type { ExecutionBridge, BridgeResult } from "../core/execution-bridge.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockWorkflowRepo(tasks: any[] = [], workflow: any = undefined) {
  return {
    createWorkflow: vi.fn(),
    getWorkflow: vi.fn().mockReturnValue(workflow ?? {
      id: "wf-1",
      directive: "test",
      status: "running",
      current_stage: "execution",
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: { input: {} },
      created_at: new Date().toISOString(),
    }),
    getWorkflows: vi.fn().mockReturnValue([]),
    findWorkflowByDirective: vi.fn(),
    updateWorkflow: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    getAgent: vi.fn(),
    getAgentsByRole: vi.fn().mockReturnValue([]),
    getAgentsByDepartment: vi.fn().mockReturnValue([]),
    getTasksByWorkflow: vi.fn().mockReturnValue(tasks),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    getMessagesByWorkflow: vi.fn().mockReturnValue([]),
    createEvolutionLog: vi.fn(),
    getScoresForWorkflow: vi.fn().mockReturnValue([]),
  };
}

function createMockRuntime(repo: ReturnType<typeof createMockWorkflowRepo>, overrides?: Partial<WorkflowRuntime>): WorkflowRuntime {
  return {
    workflowRepo: repo as any,
    memoryRepo: { materializeWorkflowMemories: vi.fn() } as any,
    reportRepo: { buildDepartmentReport: vi.fn(), saveDepartmentReport: vi.fn(), saveFinalWorkflowReport: vi.fn() } as any,
    eventEmitter: { emit: vi.fn() } as any,
    llmProvider: { isTemporarilyUnavailable: vi.fn().mockReturnValue(false) } as any,
    agentDirectory: new Map() as any,
    messageBus: { send: vi.fn(), getInbox: vi.fn().mockResolvedValue([]) } as any,
    evolutionService: { evolveWorkflow: vi.fn() } as any,
    resolveMissionId: vi.fn().mockReturnValue("mission-1"),
    ...overrides,
  } as WorkflowRuntime;
}

function makeTask(overrides: Partial<any> = {}): any {
  return {
    id: 1,
    workflow_id: "wf-1",
    worker_id: "agent-1",
    manager_id: "manager-1",
    department: "engineering",
    description: "Build feature",
    deliverable: null,
    deliverable_v2: null,
    deliverable_v3: null,
    score_accuracy: null,
    score_completeness: null,
    score_actionability: null,
    score_format: null,
    total_score: null,
    manager_feedback: null,
    meta_audit_feedback: null,
    verify_result: null,
    version: 1,
    status: "submitted",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockBridge(result?: Partial<BridgeResult>): ExecutionBridge {
  return {
    detectExecutable: vi.fn(),
    bridge: vi.fn().mockResolvedValue({
      triggered: true,
      reason: "executable content detected",
      jobId: "job-123",
      requestId: "req-456",
      ...result,
    }),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WorkflowEngine.bridgeToExecutor", () => {
  let engine: WorkflowEngine;
  let repo: ReturnType<typeof createMockWorkflowRepo>;
  let runtime: WorkflowRuntime;
  let mockBridge: ExecutionBridge;

  beforeEach(() => {
    repo = createMockWorkflowRepo();
    runtime = createMockRuntime(repo);
    engine = new WorkflowEngine(runtime);
    mockBridge = createMockBridge();
    engine.executionBridge = mockBridge;
  });

  // ── Requirement 1.1: executable deliverables trigger bridge ──

  it("calls bridge() with deliverables when tasks have executable content", async () => {
    const codeDeliverable = "```python\nprint('hello')\n```\npython script.py";
    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: codeDeliverable }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).toHaveBeenCalledWith(
      "mission-1",
      [codeDeliverable],
      expect.objectContaining({ workflowId: "wf-1" }),
    );
  });

  it("passes all task deliverables to bridge()", async () => {
    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ id: 1, deliverable: "deliverable-A" }),
      makeTask({ id: 2, deliverable: "deliverable-B" }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).toHaveBeenCalledWith(
      "mission-1",
      ["deliverable-A", "deliverable-B"],
      expect.any(Object),
    );
  });

  it("prefers deliverable_v3 > v2 > v1 (bestDeliverable logic)", async () => {
    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "v1", deliverable_v2: "v2", deliverable_v3: "v3" }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).toHaveBeenCalledWith(
      "mission-1",
      ["v3"],
      expect.any(Object),
    );
  });

  // ── Requirement 1.2: skip bridge when no executable deliverables ──

  it("skips bridge when tasks have no deliverables", async () => {
    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: null }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).not.toHaveBeenCalled();
  });

  it("skips bridge when all deliverables are '(no deliverable)'", async () => {
    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "(no deliverable)" }),
    ]);

    // bestDeliverable returns "(no deliverable)" for null fields,
    // and the filter removes those
    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).not.toHaveBeenCalled();
  });

  it("skips bridge when there are no tasks at all", async () => {
    repo.getTasksByWorkflow.mockReturnValue([]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).not.toHaveBeenCalled();
  });

  it("skips bridge when executionBridge is not set", async () => {
    engine.executionBridge = undefined;

    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "some code" }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    // No error thrown, just silently returns
    expect(repo.getTasksByWorkflow).not.toHaveBeenCalled();
  });

  it("skips bridge when resolveMissionId returns undefined", async () => {
    (runtime.resolveMissionId as any).mockReturnValue(undefined);

    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "some code" }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).not.toHaveBeenCalled();
  });

  // ── Requirement 6.4: bridge failure records issue and continues ──

  it("records workflow issue when bridge() throws and does not rethrow", async () => {
    const errorBridge = createMockBridge();
    (errorBridge.bridge as any).mockRejectedValue(new Error("Docker connection refused"));
    engine.executionBridge = errorBridge;

    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "some code" }),
    ]);

    // Should NOT throw
    await (engine as any).bridgeToExecutor("wf-1");

    // Should record a workflow issue
    expect(repo.updateWorkflow).toHaveBeenCalledWith(
      "wf-1",
      expect.objectContaining({
        results: expect.objectContaining({
          workflow_issues: expect.arrayContaining([
            expect.objectContaining({
              stage: "execution",
              scope: "workflow",
              severity: "warning",
              message: expect.stringContaining("Docker connection refused"),
            }),
          ]),
        }),
      }),
    );
  });

  it("records workflow issue with non-Error thrown values", async () => {
    const errorBridge = createMockBridge();
    (errorBridge.bridge as any).mockRejectedValue("string error");
    engine.executionBridge = errorBridge;

    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "some code" }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(repo.updateWorkflow).toHaveBeenCalledWith(
      "wf-1",
      expect.objectContaining({
        results: expect.objectContaining({
          workflow_issues: expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining("string error"),
            }),
          ]),
        }),
      }),
    );
  });

  it("does not block pipeline after bridge failure", async () => {
    const errorBridge = createMockBridge();
    (errorBridge.bridge as any).mockRejectedValue(new Error("timeout"));
    engine.executionBridge = errorBridge;

    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "code" }),
    ]);

    // The method should resolve (not reject), allowing the pipeline to continue
    const result = await (engine as any).bridgeToExecutor("wf-1");
    expect(result).toBeUndefined();
  });

  // ── Metadata forwarding ──

  it("includes workflow input metadata in bridge call", async () => {
    const workflowWithInput = {
      id: "wf-1",
      directive: "test",
      status: "running",
      current_stage: "execution",
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: { input: { requiresExecution: true, customField: "value" } },
      created_at: new Date().toISOString(),
    };
    repo.getWorkflow.mockReturnValue(workflowWithInput);
    repo.getTasksByWorkflow.mockReturnValue([
      makeTask({ deliverable: "code" }),
    ]);

    await (engine as any).bridgeToExecutor("wf-1");

    expect(mockBridge.bridge).toHaveBeenCalledWith(
      "mission-1",
      ["code"],
      expect.objectContaining({
        workflowId: "wf-1",
        requiresExecution: true,
        customField: "value",
      }),
    );
  });
});
