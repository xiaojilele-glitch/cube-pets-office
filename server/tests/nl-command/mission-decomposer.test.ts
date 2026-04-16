import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  FinalizedCommand,
  CommandAnalysis,
} from "../../../shared/nl-command/contracts.js";
import type {
  ILLMProvider,
  LLMGenerateResult,
  LLMMessage,
  LLMGenerateOptions,
} from "../../../shared/llm/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { MissionDecomposer } from "../../core/nl-command/mission-decomposer.js";
import { CyclicDependencyError } from "../../core/nl-command/topo-sort.js";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_mission_decomposer__/nl-audit.json"
);

// ─── Helpers ───

function makeAnalysis(
  overrides: Partial<CommandAnalysis> = {}
): CommandAnalysis {
  return {
    intent: overrides.intent ?? "Refactor payment module with zero downtime",
    entities: overrides.entities ?? [{ name: "payment", type: "module" }],
    constraints: overrides.constraints ?? [
      { type: "quality", description: "zero downtime" },
    ],
    objectives: overrides.objectives ?? [
      "Improve architecture",
      "Reduce latency",
    ],
    risks: overrides.risks ?? [],
    assumptions: overrides.assumptions ?? [],
    confidence: overrides.confidence ?? 0.9,
    needsClarification: overrides.needsClarification ?? false,
  };
}

function makeCommand(
  overrides: Partial<FinalizedCommand> = {}
): FinalizedCommand {
  return {
    commandId: overrides.commandId ?? "cmd-test-1",
    originalText: overrides.originalText ?? "Refactor payment module",
    refinedText:
      overrides.refinedText ?? "Refactor payment module with zero downtime",
    analysis: overrides.analysis ?? makeAnalysis(),
    finalizedAt: overrides.finalizedAt ?? Date.now(),
  };
}

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
        // First call: generate missions; Second call: identify dependencies
        if (callIndex % 2 === 1) {
          return {
            content: JSON.stringify({
              missions: [
                {
                  missionId: "mission-1",
                  title: "Design new architecture",
                  description: "Design the new payment module architecture",
                  objectives: [
                    "Define service boundaries",
                    "Design API contracts",
                  ],
                  constraints: [
                    { type: "quality", description: "zero downtime" },
                  ],
                  estimatedDuration: 120,
                  estimatedCost: 200,
                  priority: "high",
                },
                {
                  missionId: "mission-2",
                  title: "Implement core services",
                  description: "Implement the core payment processing services",
                  objectives: [
                    "Implement payment flow",
                    "Implement refund flow",
                  ],
                  constraints: [],
                  estimatedDuration: 240,
                  estimatedCost: 500,
                  priority: "high",
                },
                {
                  missionId: "mission-3",
                  title: "Migration and testing",
                  description: "Migrate data and run integration tests",
                  objectives: ["Data migration", "Integration testing"],
                  constraints: [],
                  estimatedDuration: 180,
                  estimatedCost: 300,
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
                  fromMissionId: "mission-2",
                  toMissionId: "mission-1",
                  type: "depends_on",
                  description: "Implementation needs architecture",
                },
                {
                  fromMissionId: "mission-3",
                  toMissionId: "mission-2",
                  type: "blocks",
                  description: "Testing needs implementation",
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

// ─── Tests ───

describe("MissionDecomposer", () => {
  let auditTrail: AuditTrail;
  let decomposer: MissionDecomposer;
  let mockProvider: ILLMProvider;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    mockProvider = createMockLLMProvider();
    decomposer = new MissionDecomposer({
      llmProvider: mockProvider,
      model: "mock-model",
      auditTrail,
    });
  });

  describe("decompose()", () => {
    it("should return a valid MissionDecomposition with missions, dependencies, and executionOrder (Req 3.2)", async () => {
      const result = await decomposer.decompose(makeCommand());

      expect(result.decompositionId).toMatch(/^decomp-/);
      expect(result.commandId).toBe("cmd-test-1");
      expect(result.missions).toHaveLength(3);
      expect(result.dependencies).toHaveLength(2);
      expect(result.executionOrder.length).toBeGreaterThan(0);
      expect(typeof result.totalEstimatedDuration).toBe("number");
      expect(typeof result.totalEstimatedCost).toBe("number");
    });

    it("should generate missions with all required fields (Req 3.2, 3.3)", async () => {
      const result = await decomposer.decompose(makeCommand());

      for (const mission of result.missions) {
        expect(mission.missionId).toBeTruthy();
        expect(mission.title).toBeTruthy();
        expect(mission.description).toBeDefined();
        expect(Array.isArray(mission.objectives)).toBe(true);
        expect(Array.isArray(mission.constraints)).toBe(true);
        expect(typeof mission.estimatedDuration).toBe("number");
        expect(typeof mission.estimatedCost).toBe("number");
        expect(["critical", "high", "medium", "low"]).toContain(
          mission.priority
        );
      }
    });

    it("should identify dependency relationships between missions (Req 3.4)", async () => {
      const result = await decomposer.decompose(makeCommand());

      expect(result.dependencies).toHaveLength(2);
      const dep1 = result.dependencies.find(
        d => d.fromMissionId === "mission-2"
      );
      expect(dep1).toBeDefined();
      expect(dep1!.toMissionId).toBe("mission-1");
      expect(dep1!.type).toBe("depends_on");

      const dep2 = result.dependencies.find(
        d => d.fromMissionId === "mission-3"
      );
      expect(dep2).toBeDefined();
      expect(dep2!.toMissionId).toBe("mission-2");
      expect(dep2!.type).toBe("blocks");
    });

    it("should produce a valid topological execution order (Req 3.5)", async () => {
      const result = await decomposer.decompose(makeCommand());

      // Flatten execution order to get position of each mission
      const positionMap = new Map<string, number>();
      result.executionOrder.forEach((group, groupIdx) => {
        for (const missionId of group) {
          positionMap.set(missionId, groupIdx);
        }
      });

      // For every dependency, the "to" mission (prerequisite) must be in an earlier or same group
      for (const dep of result.dependencies) {
        if (dep.type === "blocks" || dep.type === "depends_on") {
          const fromPos = positionMap.get(dep.fromMissionId)!;
          const toPos = positionMap.get(dep.toMissionId)!;
          expect(toPos).toBeLessThanOrEqual(fromPos);
        }
      }
    });

    it("should call LLM twice: once for missions, once for dependencies", async () => {
      await decomposer.decompose(makeCommand());
      expect(mockProvider.generate).toHaveBeenCalledTimes(2);
    });

    it("should compute correct totalEstimatedDuration and totalEstimatedCost", async () => {
      const result = await decomposer.decompose(makeCommand());
      // 120 + 240 + 180 = 540
      expect(result.totalEstimatedDuration).toBe(540);
      // 200 + 500 + 300 = 1000
      expect(result.totalEstimatedCost).toBe(1000);
    });

    it("should record a success audit entry (Req 3.6)", async () => {
      await decomposer.decompose(makeCommand());

      const entries = await auditTrail.query({
        operationType: "decomposition_completed",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("cmd-test-1");
      expect(entries[0].result).toBe("success");
      expect(entries[0].content).toContain("3 missions");
    });

    it("should throw CyclicDependencyError and record failure audit on cyclic dependencies (Req 3.4)", async () => {
      const cyclicProvider: ILLMProvider = {
        name: "cyclic-mock",
        generate: vi.fn(async () => {
          if ((cyclicProvider.generate as any).mock.calls.length <= 1) {
            return {
              content: JSON.stringify({
                missions: [
                  {
                    missionId: "m-a",
                    title: "A",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 60,
                    estimatedCost: 100,
                    priority: "medium",
                  },
                  {
                    missionId: "m-b",
                    title: "B",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 60,
                    estimatedCost: 100,
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
                { fromMissionId: "m-a", toMissionId: "m-b", type: "blocks" },
                { fromMissionId: "m-b", toMissionId: "m-a", type: "blocks" },
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

      const cyclicDecomposer = new MissionDecomposer({
        llmProvider: cyclicProvider,
        model: "mock",
        auditTrail,
      });

      await expect(cyclicDecomposer.decompose(makeCommand())).rejects.toThrow(
        CyclicDependencyError
      );

      const entries = await auditTrail.query({
        operationType: "decomposition_completed",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe("failure");
      expect(entries[0].content).toContain("cyclic dependency");
    });

    it("should throw when LLM returns empty mission list", async () => {
      const emptyProvider: ILLMProvider = {
        name: "empty-mock",
        generate: vi.fn(async () => ({
          content: JSON.stringify({ missions: [] }),
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

      const emptyDecomposer = new MissionDecomposer({
        llmProvider: emptyProvider,
        model: "mock",
        auditTrail,
      });

      await expect(emptyDecomposer.decompose(makeCommand())).rejects.toThrow(
        "LLM returned empty or invalid mission list"
      );
    });

    it("should skip dependencies with invalid mission IDs", async () => {
      let callIdx = 0;
      const invalidDepProvider: ILLMProvider = {
        name: "invalid-dep-mock",
        generate: vi.fn(async () => {
          callIdx++;
          if (callIdx === 1) {
            return {
              content: JSON.stringify({
                missions: [
                  {
                    missionId: "mx",
                    title: "X",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 30,
                    estimatedCost: 10,
                    priority: "medium",
                  },
                  {
                    missionId: "my",
                    title: "Y",
                    description: "",
                    objectives: [],
                    constraints: [],
                    estimatedDuration: 30,
                    estimatedCost: 10,
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
                  fromMissionId: "mx",
                  toMissionId: "nonexistent",
                  type: "blocks",
                },
                { fromMissionId: "mx", toMissionId: "mx", type: "blocks" }, // self-reference
                { fromMissionId: "my", toMissionId: "mx", type: "depends_on" },
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

      const d = new MissionDecomposer({
        llmProvider: invalidDepProvider,
        model: "mock",
        auditTrail,
      });
      const result = await d.decompose(makeCommand());

      // Only the valid dependency (my -> mx) should remain
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].fromMissionId).toBe("my");
      expect(result.dependencies[0].toMissionId).toBe("mx");
    });

    it("should return no dependencies for a single mission", async () => {
      let callIdx = 0;
      const singleProvider: ILLMProvider = {
        name: "single-mock",
        generate: vi.fn(async () => {
          callIdx++;
          return {
            content: JSON.stringify({
              missions: [
                {
                  missionId: "solo",
                  title: "Solo mission",
                  description: "",
                  objectives: [],
                  constraints: [],
                  estimatedDuration: 60,
                  estimatedCost: 50,
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

      const d = new MissionDecomposer({
        llmProvider: singleProvider,
        model: "mock",
        auditTrail,
      });
      const result = await d.decompose(makeCommand());

      // Only 1 LLM call (missions), no dependency call needed for single mission
      expect(singleProvider.generate).toHaveBeenCalledTimes(1);
      expect(result.missions).toHaveLength(1);
      expect(result.dependencies).toHaveLength(0);
      expect(result.executionOrder).toEqual([["solo"]]);
    });
  });

  describe("generateOrganization()", () => {
    it("should trigger organization generation callback (Req 14.1)", async () => {
      const orgCallback = vi.fn(
        async (_missionId: string, _complexity: number) => ({
          kind: "workflow_organization" as const,
          version: 1 as const,
          workflowId: "wf-1",
          directive: "test",
          generatedAt: new Date().toISOString(),
          source: "llm" as const,
          taskProfile: "test",
          reasoning: "test",
          rootNodeId: "root",
          rootAgentId: "agent-1",
          departments: [],
          nodes: [],
        })
      );

      const decomposerWithOrg = new MissionDecomposer({
        llmProvider: mockProvider,
        model: "mock-model",
        auditTrail,
        onOrganizationNeeded: orgCallback,
      });

      const result = await decomposerWithOrg.generateOrganization(
        "mission-1",
        5
      );

      expect(orgCallback).toHaveBeenCalledWith("mission-1", 5);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("workflow_organization");
    });

    it("should return null when no organization callback is configured", async () => {
      const result = await decomposer.generateOrganization("mission-1", 5);
      expect(result).toBeNull();
    });
  });

  describe("onMissionCreated callback", () => {
    it("should invoke onMissionCreated for each decomposed mission", async () => {
      const onCreated = vi.fn(async () => {});

      const decomposerWithCallback = new MissionDecomposer({
        llmProvider: mockProvider,
        model: "mock-model",
        auditTrail,
        onMissionCreated: onCreated,
      });

      await decomposerWithCallback.decompose(makeCommand());

      expect(onCreated).toHaveBeenCalledTimes(3);
      expect(onCreated.mock.calls[0][0].missionId).toBe("mission-1");
      expect(onCreated.mock.calls[1][0].missionId).toBe("mission-2");
      expect(onCreated.mock.calls[2][0].missionId).toBe("mission-3");
    });
  });
});
