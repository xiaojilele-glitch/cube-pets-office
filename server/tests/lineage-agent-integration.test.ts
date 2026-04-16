/**
 * Agent 框架血缘集成测试
 * 覆盖 Task 9.1 ~ 9.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RuntimeAgent,
  setLineageCollector,
  getLineageCollector,
  type LineageCollectorLike,
  type RuntimeAgentConfig,
  type RuntimeAgentDependencies,
  type LineageTrackOptions,
} from "../../shared/runtime-agent.js";
import type {
  RecordTransformationInput,
  RecordSourceInput,
  RecordDecisionInput,
} from "../../shared/lineage/contracts.js";
import {
  MissionRuntime,
  setMissionLineageCollector,
} from "../tasks/mission-runtime.js";
import {
  submitMissionDecision,
  setDecisionLineageCollector,
} from "../tasks/mission-decision.js";
import { MissionStore } from "../tasks/mission-store.js";

// ─── Mock Helpers ──────────────────────────────────────────────────────────

function createMockCollector(): LineageCollectorLike & {
  transformations: RecordTransformationInput[];
  sources: RecordSourceInput[];
  decisions: RecordDecisionInput[];
} {
  const transformations: RecordTransformationInput[] = [];
  const sources: RecordSourceInput[] = [];
  const decisions: RecordDecisionInput[] = [];
  let counter = 0;

  return {
    transformations,
    sources,
    decisions,
    recordTransformation(input: RecordTransformationInput): string {
      transformations.push(input);
      return `lineage_t_${++counter}`;
    },
    recordSource(input: RecordSourceInput): string {
      sources.push(input);
      return `lineage_s_${++counter}`;
    },
    recordDecision(input: RecordDecisionInput): string {
      decisions.push(input);
      return `lineage_d_${++counter}`;
    },
  };
}

function createMockAgentDeps(): RuntimeAgentDependencies {
  return {
    memoryRepo: {
      buildPromptContext: () => [],
      appendLLMExchange: () => {},
      appendMessageLog: () => {},
      materializeWorkflowMemories: () => {},
      getSoulText: (_id: string, fallback: string) => fallback,
      appendLearnedBehaviors: () => {},
    },
    llmProvider: {
      call: async () => ({ content: "mock response" }),
      callJson: async () => ({ result: true }),
    },
    eventEmitter: {
      emit: () => {},
    },
  };
}

function createMockConfig(
  overrides?: Partial<RuntimeAgentConfig>
): RuntimeAgentConfig {
  return {
    id: "agent-test-1",
    name: "Test Agent",
    department: "engineering",
    role: "worker",
    managerId: null,
    model: "gpt-4",
    soulMd: "You are a test agent.",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("RuntimeAgent.lineageTracked()", () => {
  let agent: RuntimeAgent;

  beforeEach(() => {
    agent = new RuntimeAgent(createMockConfig(), createMockAgentDeps());
    setLineageCollector(null);
  });

  afterEach(() => {
    setLineageCollector(null);
  });

  it("should execute fn and return result when no collector is set (no-op)", async () => {
    const result = await agent.lineageTracked(async () => "hello");
    expect(result).toBe("hello");
    expect(getLineageCollector()).toBeNull();
  });

  it("should execute fn and record transformation when collector is set", async () => {
    const collector = createMockCollector();
    setLineageCollector(collector);

    const result = await agent.lineageTracked(async () => 42);
    expect(result).toBe(42);
    // Should have recorded at least one transformation (before) and one (after success)
    expect(collector.transformations.length).toBeGreaterThanOrEqual(1);
    expect(collector.transformations[0].agentId).toBe("agent-test-1");
  });

  it("should support custom operation and metadata (AC-9.3)", async () => {
    const collector = createMockCollector();
    setLineageCollector(collector);

    const opts: LineageTrackOptions = {
      operation: "ml_inference",
      metadata: { model_version: "v2", threshold: 0.8 },
    };

    await agent.lineageTracked(async () => "result", opts);

    expect(collector.transformations[0].operation).toBe("ml_inference");
    expect(collector.transformations[0].parameters).toEqual({
      model_version: "v2",
      threshold: 0.8,
    });
  });

  it("should record execution time on success (AC-9.2)", async () => {
    const collector = createMockCollector();
    setLineageCollector(collector);

    await agent.lineageTracked(async () => {
      // Small delay to ensure measurable time
      await new Promise(r => setTimeout(r, 10));
      return "done";
    });

    // The second transformation records execution time
    const successRecord = collector.transformations.find(
      t =>
        t.metadata &&
        (t.metadata as Record<string, unknown>).status === "success"
    );
    expect(successRecord).toBeDefined();
    expect(successRecord!.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should record error info when fn throws (AC-9.2)", async () => {
    const collector = createMockCollector();
    setLineageCollector(collector);

    await expect(
      agent.lineageTracked(async () => {
        throw new Error("test failure");
      })
    ).rejects.toThrow("test failure");

    const errorRecord = collector.transformations.find(
      t =>
        t.metadata && (t.metadata as Record<string, unknown>).status === "error"
    );
    expect(errorRecord).toBeDefined();
    expect((errorRecord!.metadata as Record<string, unknown>).error).toBe(
      "test failure"
    );
  });

  it("should never throw due to collector failure (AC-9.4)", async () => {
    const failingCollector: LineageCollectorLike = {
      recordTransformation() {
        throw new Error("collector exploded");
      },
    };
    setLineageCollector(failingCollector);

    // Should still execute fn and return result
    const result = await agent.lineageTracked(async () => "safe");
    expect(result).toBe("safe");
  });

  it("should propagate fn error even when collector fails (AC-9.4)", async () => {
    const failingCollector: LineageCollectorLike = {
      recordTransformation() {
        throw new Error("collector exploded");
      },
    };
    setLineageCollector(failingCollector);

    await expect(
      agent.lineageTracked(async () => {
        throw new Error("business error");
      })
    ).rejects.toThrow("business error");
  });
});

describe("MissionRuntime lineage hooks (Task 9.4)", () => {
  let collector: ReturnType<typeof createMockCollector>;

  beforeEach(() => {
    collector = createMockCollector();
    setMissionLineageCollector(collector);
  });

  afterEach(() => {
    setMissionLineageCollector(null);
  });

  it("should record source lineage when createTask is called", () => {
    const runtime = new MissionRuntime({
      store: createInMemoryMissionStore(),
    });

    const task = runtime.createTask({
      kind: "chat",
      title: "Test Mission",
    });

    expect(collector.sources.length).toBe(1);
    expect(collector.sources[0].sourceId).toBe(task.id);
    expect(collector.sources[0].sourceName).toBe("Test Mission");
    expect(collector.sources[0].context?.missionId).toBe(task.id);
  });

  it("should record decision lineage when finishMission is called", () => {
    const runtime = new MissionRuntime({
      store: createInMemoryMissionStore(),
    });

    const task = runtime.createTask({
      kind: "chat",
      title: "Finish Test",
    });

    runtime.finishMission(task.id, "All done");

    expect(collector.decisions.length).toBe(1);
    expect(collector.decisions[0].decisionId).toBe(task.id);
    expect(collector.decisions[0].result).toBe("done");
    expect(collector.decisions[0].context?.missionId).toBe(task.id);
  });

  it("should not fail createTask when collector throws", () => {
    setMissionLineageCollector({
      recordTransformation() {
        throw new Error("boom");
      },
      recordSource() {
        throw new Error("boom");
      },
      recordDecision() {
        throw new Error("boom");
      },
    });

    const runtime = new MissionRuntime({
      store: createInMemoryMissionStore(),
    });

    const task = runtime.createTask({
      kind: "chat",
      title: "Safe Mission",
    });

    expect(task).toBeDefined();
    expect(task.title).toBe("Safe Mission");
  });

  it("should work without collector (no-op)", () => {
    setMissionLineageCollector(null);

    const runtime = new MissionRuntime({
      store: createInMemoryMissionStore(),
    });

    const task = runtime.createTask({
      kind: "chat",
      title: "No Collector",
    });

    expect(task).toBeDefined();
  });
});

describe("submitMissionDecision lineage hook (Task 9.5)", () => {
  let collector: ReturnType<typeof createMockCollector>;

  beforeEach(() => {
    collector = createMockCollector();
    setDecisionLineageCollector(collector);
  });

  afterEach(() => {
    setDecisionLineageCollector(null);
  });

  it("should record decision lineage after successful submission", () => {
    const mockRuntime = createMockDecisionRuntime();

    const result = submitMissionDecision(mockRuntime, "task-1", {
      optionId: "opt-a",
      freeText: undefined,
    });

    expect(result.ok).toBe(true);
    expect(collector.decisions.length).toBe(1);
    expect(collector.decisions[0].result).toBe("opt-a");
    expect(collector.decisions[0].context?.missionId).toBe("task-1");
  });

  it("should not record lineage on failed submission", () => {
    const mockRuntime = createMockDecisionRuntime();

    const result = submitMissionDecision(mockRuntime, "nonexistent", {
      optionId: "opt-a",
    });

    expect(result.ok).toBe(false);
    expect(collector.decisions.length).toBe(0);
  });

  it("should not fail submission when collector throws", () => {
    setDecisionLineageCollector({
      recordTransformation() {
        throw new Error("boom");
      },
      recordDecision() {
        throw new Error("boom");
      },
    });

    const mockRuntime = createMockDecisionRuntime();

    const result = submitMissionDecision(mockRuntime, "task-1", {
      optionId: "opt-a",
    });

    expect(result.ok).toBe(true);
  });
});

// ─── Test Helpers ──────────────────────────────────────────────────────────

function createInMemoryMissionStore() {
  return new MissionStore(null);
}

function createMockDecisionRuntime() {
  const tasks = new Map<string, any>();

  // Create a waiting task with a decision prompt
  tasks.set("task-1", {
    id: "task-1",
    status: "waiting",
    progress: 50,
    decision: {
      decisionId: "dec-1",
      type: "custom-action",
      prompt: "Choose an option",
      options: [
        { id: "opt-a", label: "Option A" },
        { id: "opt-b", label: "Option B" },
      ],
      allowFreeText: false,
    },
    decisionHistory: [],
    events: [],
    stages: [],
  });

  return {
    getTask(id: string) {
      return tasks.get(id);
    },
    resumeMissionFromDecision(
      id: string,
      submission: { detail: string; progress?: number }
    ) {
      const task = tasks.get(id);
      if (!task) return undefined;
      task.status = "running";
      task.waitingFor = undefined;
      task.decision = undefined;
      if (submission.progress !== undefined)
        task.progress = submission.progress;
      return task;
    },
  };
}
