import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  DecomposedMission,
  MissionDecomposition,
} from "../../../shared/nl-command/contracts.js";
import type {
  ILLMProvider,
  LLMGenerateResult,
  LLMMessage,
  LLMGenerateOptions,
} from "../../../shared/llm/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { TaskDecomposer } from "../../core/nl-command/task-decomposer.js";
import { CyclicDependencyError } from "../../core/nl-command/topo-sort.js";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_task_decomposer__/nl-audit.json"
);

// ─── Mock LLM Provider ───

function createMockLLMProvider(): ILLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    generate: vi.fn(
      async (
        _messages: LLMMessage[],
        _options?: LLMGenerateOptions
      ): Promise<LLMGenerateResult> => {
        callIndex++;
        // First call: generate tasks; Second call: identify dependencies
        if (callIndex % 2 === 1) {
          return {
            content: JSON.stringify({
              tasks: [
                {
                  taskId: "task-1",
                  title: "Design API schema",
                  description:
                    "Design the REST API schema for the payment module",
                  objectives: [
                    "Define endpoints",
                    "Define request/response types",
                  ],
                  constraints: [
                    { type: "quality", description: "RESTful design" },
                  ],
                  estimatedDuration: 60,
                  estimatedCost: 100,
                  requiredSkills: ["api-design", "typescript"],
                  priority: "high",
                },
                {
                  taskId: "task-2",
                  title: "Implement payment service",
                  description: "Implement the core payment processing service",
                  objectives: ["Process payments", "Handle refunds"],
                  constraints: [],
                  estimatedDuration: 120,
                  estimatedCost: 200,
                  requiredSkills: ["backend", "payment-integration"],
                  priority: "high",
                },
                {
                  taskId: "task-3",
                  title: "Write integration tests",
                  description:
                    "Write integration tests for the payment service",
                  objectives: ["Test payment flow", "Test error handling"],
                  constraints: [],
                  estimatedDuration: 90,
                  estimatedCost: 150,
                  requiredSkills: ["testing"],
                  priority: "medium",
                },
              ],
            }),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            latencyMs: 50,
            model: "mock",
            provider: "mock",
          };
        } else {
          return {
            content: JSON.stringify({
              dependencies: [
                {
                  fromTaskId: "task-2",
                  toTaskId: "task-1",
                  type: "depends_on",
                  description: "Service needs API schema",
                },
                {
                  fromTaskId: "task-3",
                  toTaskId: "task-2",
                  type: "blocks",
                  description: "Tests need service implementation",
                },
              ],
            }),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            latencyMs: 50,
            model: "mock",
            provider: "mock",
          };
        }
      }
    ),
    streamGenerate: async function* () {
      yield "";
    },
    healthCheck: async () => ({
      healthy: true,
      latencyMs: 10,
      provider: "mock",
    }),
    isTemporaryError: () => false,
  };
}

function makeMission(
  overrides: Partial<DecomposedMission> = {}
): DecomposedMission {
  return {
    missionId: overrides.missionId ?? "mission-1",
    title: overrides.title ?? "Refactor payment module",
    description:
      overrides.description ??
      "Refactor the payment module for better architecture",
    objectives: overrides.objectives ?? ["Improve architecture"],
    constraints: overrides.constraints ?? [],
    estimatedDuration: overrides.estimatedDuration ?? 300,
    estimatedCost: overrides.estimatedCost ?? 500,
    priority: overrides.priority ?? "high",
  };
}

function makeContext(mission?: DecomposedMission): MissionDecomposition {
  const m = mission ?? makeMission();
  return {
    decompositionId: "decomp-1",
    commandId: "cmd-1",
    missions: [m],
    dependencies: [],
    executionOrder: [[m.missionId]],
    totalEstimatedDuration: m.estimatedDuration,
    totalEstimatedCost: m.estimatedCost,
  };
}

describe("TaskDecomposer", () => {
  let auditTrail: AuditTrail;
  let decomposer: TaskDecomposer;
  let mockProvider: ILLMProvider;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    mockProvider = createMockLLMProvider();
    decomposer = new TaskDecomposer({
      llmProvider: mockProvider,
      model: "mock-model",
      auditTrail,
    });
  });

  describe("decompose()", () => {
    it("should return a valid TaskDecomposition with tasks, dependencies, and execution order", async () => {
      const mission = makeMission();
      const context = makeContext(mission);
      const result = await decomposer.decompose(mission, context);

      expect(result.decompositionId).toMatch(/^task-decomp-/);
      expect(result.missionId).toBe("mission-1");
      expect(result.tasks).toHaveLength(3);
      expect(result.dependencies).toHaveLength(2);
      expect(result.executionOrder.length).toBeGreaterThan(0);
    });

    it("should generate tasks with all required fields (Req 4.3)", async () => {
      const mission = makeMission();
      const result = await decomposer.decompose(mission, makeContext(mission));

      for (const task of result.tasks) {
        expect(task.taskId).toBeTruthy();
        expect(task.title).toBeTruthy();
        expect(task.description).toBeDefined();
        expect(Array.isArray(task.objectives)).toBe(true);
        expect(Array.isArray(task.constraints)).toBe(true);
        expect(typeof task.estimatedDuration).toBe("number");
        expect(typeof task.estimatedCost).toBe("number");
        expect(Array.isArray(task.requiredSkills)).toBe(true);
        expect(["critical", "high", "medium", "low"]).toContain(task.priority);
      }
    });

    it("should produce a valid topological execution order (Req 4.5)", async () => {
      const mission = makeMission();
      const result = await decomposer.decompose(mission, makeContext(mission));

      // Flatten execution order to get position of each task
      const positionMap = new Map<string, number>();
      result.executionOrder.forEach((group, groupIdx) => {
        for (const taskId of group) {
          positionMap.set(taskId, groupIdx);
        }
      });

      // For every dependency, the "to" task (prerequisite) must be in an earlier or same group
      for (const dep of result.dependencies) {
        const fromPos = positionMap.get(dep.fromTaskId)!;
        const toPos = positionMap.get(dep.toTaskId)!;
        expect(toPos).toBeLessThanOrEqual(fromPos);
      }
    });

    it("should call LLM twice: once for tasks, once for dependencies", async () => {
      const mission = makeMission();
      await decomposer.decompose(mission, makeContext(mission));

      expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    });

    it("should record a success audit entry (Req 4.6)", async () => {
      const mission = makeMission();
      await decomposer.decompose(mission, makeContext(mission));

      const entries = await auditTrail.query({
        operationType: "decomposition_completed",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("mission-1");
      expect(entries[0].result).toBe("success");
      expect(entries[0].content).toContain("3 tasks");
    });

    it("should throw and record failure audit on cyclic dependencies", async () => {
      const cyclicProvider: ILLMProvider = {
        name: "cyclic-mock",
        generate: vi.fn(async () => {
          // Return tasks first, then cyclic dependencies
          if ((cyclicProvider.generate as any).mock.calls.length <= 1) {
            return {
              content: JSON.stringify({
                tasks: [
                  {
                    taskId: "t-a",
                    title: "A",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 30,
                    estimatedCost: 10,
                    requiredSkills: [],
                    priority: "medium",
                  },
                  {
                    taskId: "t-b",
                    title: "B",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 30,
                    estimatedCost: 10,
                    requiredSkills: [],
                    priority: "medium",
                  },
                ],
              }),
              usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
              },
              latencyMs: 50,
              model: "mock",
              provider: "mock",
            };
          }
          return {
            content: JSON.stringify({
              dependencies: [
                { fromTaskId: "t-a", toTaskId: "t-b", type: "blocks" },
                { fromTaskId: "t-b", toTaskId: "t-a", type: "blocks" },
              ],
            }),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            latencyMs: 50,
            model: "mock",
            provider: "mock",
          };
        }),
        streamGenerate: async function* () {
          yield "";
        },
        healthCheck: async () => ({
          healthy: true,
          latencyMs: 10,
          provider: "mock",
        }),
        isTemporaryError: () => false,
      };

      const cyclicDecomposer = new TaskDecomposer({
        llmProvider: cyclicProvider,
        model: "mock",
        auditTrail,
      });

      await expect(
        cyclicDecomposer.decompose(makeMission(), makeContext())
      ).rejects.toThrow(CyclicDependencyError);

      const entries = await auditTrail.query({
        operationType: "decomposition_completed",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe("failure");
      expect(entries[0].content).toContain("cyclic dependency");
    });

    it("should throw when LLM returns empty task list", async () => {
      const emptyProvider: ILLMProvider = {
        name: "empty-mock",
        generate: vi.fn(async () => ({
          content: JSON.stringify({ tasks: [] }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          latencyMs: 50,
          model: "mock",
          provider: "mock",
        })),
        streamGenerate: async function* () {
          yield "";
        },
        healthCheck: async () => ({
          healthy: true,
          latencyMs: 10,
          provider: "mock",
        }),
        isTemporaryError: () => false,
      };

      const emptyDecomposer = new TaskDecomposer({
        llmProvider: emptyProvider,
        model: "mock",
        auditTrail,
      });

      await expect(
        emptyDecomposer.decompose(makeMission(), makeContext())
      ).rejects.toThrow("LLM returned empty or invalid task list");
    });

    it("should skip dependencies with invalid task IDs", async () => {
      let callIdx = 0;
      const invalidDepProvider: ILLMProvider = {
        name: "invalid-dep-mock",
        generate: vi.fn(async () => {
          callIdx++;
          if (callIdx === 1) {
            return {
              content: JSON.stringify({
                tasks: [
                  {
                    taskId: "task-x",
                    title: "X",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 30,
                    estimatedCost: 10,
                    requiredSkills: [],
                    priority: "medium",
                  },
                  {
                    taskId: "task-y",
                    title: "Y",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 30,
                    estimatedCost: 10,
                    requiredSkills: [],
                    priority: "medium",
                  },
                ],
              }),
              usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
              },
              latencyMs: 50,
              model: "mock",
              provider: "mock",
            };
          }
          return {
            content: JSON.stringify({
              dependencies: [
                {
                  fromTaskId: "task-x",
                  toTaskId: "task-nonexistent",
                  type: "blocks",
                },
                { fromTaskId: "task-x", toTaskId: "task-x", type: "blocks" }, // self-reference
                {
                  fromTaskId: "task-y",
                  toTaskId: "task-x",
                  type: "depends_on",
                },
              ],
            }),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            latencyMs: 50,
            model: "mock",
            provider: "mock",
          };
        }),
        streamGenerate: async function* () {
          yield "";
        },
        healthCheck: async () => ({
          healthy: true,
          latencyMs: 10,
          provider: "mock",
        }),
        isTemporaryError: () => false,
      };

      const d = new TaskDecomposer({
        llmProvider: invalidDepProvider,
        model: "mock",
        auditTrail,
      });
      const result = await d.decompose(makeMission(), makeContext());

      // Only the valid dependency (task-y → task-x) should remain
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].fromTaskId).toBe("task-y");
      expect(result.dependencies[0].toTaskId).toBe("task-x");
    });

    it("should return no dependencies for a single task", async () => {
      let callIdx = 0;
      const singleTaskProvider: ILLMProvider = {
        name: "single-mock",
        generate: vi.fn(async () => {
          callIdx++;
          return {
            content: JSON.stringify({
              tasks: [
                {
                  taskId: "task-only",
                  title: "Only task",
                  description: "",
                  objectives: [],
                  constraints: [],
                  estimatedDuration: 60,
                  estimatedCost: 50,
                  requiredSkills: [],
                  priority: "medium",
                },
              ],
            }),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            latencyMs: 50,
            model: "mock",
            provider: "mock",
          };
        }),
        streamGenerate: async function* () {
          yield "";
        },
        healthCheck: async () => ({
          healthy: true,
          latencyMs: 10,
          provider: "mock",
        }),
        isTemporaryError: () => false,
      };

      const d = new TaskDecomposer({
        llmProvider: singleTaskProvider,
        model: "mock",
        auditTrail,
      });
      const result = await d.decompose(makeMission(), makeContext());

      // Only 1 LLM call (tasks), no dependency call needed
      expect(singleTaskProvider.generate).toHaveBeenCalledTimes(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.dependencies).toHaveLength(0);
      expect(result.executionOrder).toEqual([["task-only"]]);
    });
  });
});
