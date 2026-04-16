import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  CommandAnalysis,
  ClarificationAnswer,
  StrategicCommand,
} from "../../../shared/nl-command/contracts.js";
import type {
  ILLMProvider,
  LLMGenerateResult,
  LLMMessage,
  LLMGenerateOptions,
} from "../../../shared/llm/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { CommandAnalyzer } from "../../core/nl-command/command-analyzer.js";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_cmd_analyzer__/nl-audit.json"
);

// ─── Mock LLM Provider ───

function createMockLLMProvider(
  responseMap?: Record<string, string>
): ILLMProvider {
  return {
    name: "mock",
    generate: vi.fn(
      async (
        messages: LLMMessage[],
        options?: LLMGenerateOptions
      ): Promise<LLMGenerateResult> => {
        const lastMsg = messages[messages.length - 1];
        const content =
          typeof lastMsg.content === "string" ? lastMsg.content : "";

        // Default analysis response
        if (responseMap) {
          for (const [key, val] of Object.entries(responseMap)) {
            if (content.includes(key)) {
              return {
                content: val,
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
          }
        }

        return {
          content: JSON.stringify({
            intent: "refactor payment module",
            entities: [
              {
                name: "payment-module",
                type: "module",
                description: "Payment processing module",
              },
            ],
            constraints: [{ type: "quality", description: "zero downtime" }],
            objectives: ["Improve payment module architecture"],
            risks: [
              {
                id: "r-1",
                description: "Service disruption",
                level: "medium",
                probability: 0.3,
                impact: 0.7,
                mitigation: "Blue-green deployment",
              },
            ],
            assumptions: ["Current payment module is monolithic"],
            confidence: 0.85,
            needsClarification: false,
          }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 50,
          model: "mock",
          provider: "mock",
        };
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

function makeCommand(
  overrides: Partial<StrategicCommand> = {}
): StrategicCommand {
  return {
    commandId: overrides.commandId ?? "cmd-1",
    commandText:
      overrides.commandText ?? "Refactor the payment module with zero downtime",
    userId: overrides.userId ?? "user-1",
    timestamp: overrides.timestamp ?? Date.now(),
    status: overrides.status ?? "analyzing",
    constraints: overrides.constraints ?? [],
    objectives: overrides.objectives ?? [],
    priority: overrides.priority ?? "high",
    timeframe: overrides.timeframe,
  };
}

function makeAnalysis(
  overrides: Partial<CommandAnalysis> = {}
): CommandAnalysis {
  return {
    intent: overrides.intent ?? "refactor payment module",
    entities: overrides.entities ?? [
      { name: "payment-module", type: "module" },
    ],
    constraints: overrides.constraints ?? [
      { type: "quality", description: "zero downtime" },
    ],
    objectives: overrides.objectives ?? ["Improve architecture"],
    risks: overrides.risks ?? [],
    assumptions: overrides.assumptions ?? ["Module is monolithic"],
    confidence: overrides.confidence ?? 0.7,
    needsClarification: overrides.needsClarification ?? true,
    clarificationTopics: overrides.clarificationTopics ?? [
      "deployment strategy",
    ],
  };
}

describe("CommandAnalyzer", () => {
  let auditTrail: AuditTrail;
  let analyzer: CommandAnalyzer;
  let mockProvider: ILLMProvider;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    mockProvider = createMockLLMProvider();
    analyzer = new CommandAnalyzer({
      llmProvider: mockProvider,
      model: "mock-model",
      auditTrail,
    });
  });

  describe("analyze()", () => {
    it("should return a valid CommandAnalysis from LLM response", async () => {
      const command = makeCommand();
      const analysis = await analyzer.analyze(command);

      expect(analysis.intent).toBe("refactor payment module");
      expect(analysis.entities).toHaveLength(1);
      expect(analysis.entities[0].name).toBe("payment-module");
      expect(analysis.constraints).toHaveLength(1);
      expect(analysis.objectives).toHaveLength(1);
      expect(analysis.confidence).toBe(0.85);
      expect(analysis.needsClarification).toBe(false);
    });

    it("should call LLM with correct messages structure", async () => {
      const command = makeCommand();
      await analyzer.analyze(command);

      expect(mockProvider.generate).toHaveBeenCalledTimes(1);
      const callArgs = (mockProvider.generate as any).mock.calls[0];
      const messages = callArgs[0] as LLMMessage[];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
      expect(callArgs[1]).toMatchObject({ jsonMode: true });
    });

    it("should record audit entry after analysis", async () => {
      const command = makeCommand();
      await analyzer.analyze(command);

      const entries = await auditTrail.query({
        operationType: "command_analyzed",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("cmd-1");
      expect(entries[0].result).toBe("success");
    });

    it("should return fallback analysis when LLM returns invalid JSON", async () => {
      const badProvider = createMockLLMProvider();
      (badProvider.generate as any).mockResolvedValue({
        content: "This is not JSON at all",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });
      const badAnalyzer = new CommandAnalyzer({
        llmProvider: badProvider,
        model: "mock-model",
        auditTrail,
      });

      const analysis = await badAnalyzer.analyze(makeCommand());
      expect(analysis.intent).toBe("unknown");
      expect(analysis.confidence).toBe(0);
      expect(analysis.needsClarification).toBe(true);
    });

    it("should clamp confidence to [0, 1]", async () => {
      const provider = createMockLLMProvider();
      (provider.generate as any).mockResolvedValue({
        content: JSON.stringify({
          intent: "test",
          entities: [],
          constraints: [],
          objectives: [],
          risks: [],
          assumptions: [],
          confidence: 1.5,
          needsClarification: false,
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });
      const a = new CommandAnalyzer({
        llmProvider: provider,
        model: "mock",
        auditTrail,
      });
      const analysis = await a.analyze(makeCommand());
      expect(analysis.confidence).toBe(1);
    });
  });

  describe("generateClarificationQuestions()", () => {
    it("should return clarification questions from LLM", async () => {
      const questionsResponse = JSON.stringify({
        questions: [
          {
            questionId: "q-1",
            text: "Which payment gateway?",
            type: "single_choice",
            options: ["Stripe", "PayPal"],
            context: "Need to know target",
          },
          {
            questionId: "q-2",
            text: "What is the timeline?",
            type: "free_text",
          },
        ],
      });
      (mockProvider.generate as any).mockResolvedValueOnce({
        content: questionsResponse,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });

      const command = makeCommand();
      const analysis = makeAnalysis();
      const questions = await analyzer.generateClarificationQuestions(
        command,
        analysis
      );

      expect(questions).toHaveLength(2);
      expect(questions[0].questionId).toBe("q-1");
      expect(questions[0].type).toBe("single_choice");
      expect(questions[0].options).toEqual(["Stripe", "PayPal"]);
      expect(questions[1].type).toBe("free_text");
    });

    it("should record audit entry for clarification questions", async () => {
      const command = makeCommand();
      const analysis = makeAnalysis();
      await analyzer.generateClarificationQuestions(command, analysis);

      const entries = await auditTrail.query({
        operationType: "clarification_question",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("cmd-1");
    });

    it("should return empty array when LLM returns invalid response", async () => {
      (mockProvider.generate as any).mockResolvedValueOnce({
        content: "not json",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });

      const questions = await analyzer.generateClarificationQuestions(
        makeCommand(),
        makeAnalysis()
      );
      expect(questions).toEqual([]);
    });
  });

  describe("updateAnalysis()", () => {
    it("should return updated analysis with higher confidence", async () => {
      const updatedResponse = JSON.stringify({
        intent: "refactor payment module with Stripe",
        entities: [
          { name: "payment-module", type: "module" },
          { name: "Stripe", type: "service" },
        ],
        constraints: [{ type: "quality", description: "zero downtime" }],
        objectives: ["Migrate to Stripe gateway"],
        risks: [],
        assumptions: [],
        confidence: 0.95,
        needsClarification: false,
      });
      (mockProvider.generate as any).mockResolvedValueOnce({
        content: updatedResponse,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });

      const answer: ClarificationAnswer = {
        questionId: "q-1",
        text: "We use Stripe",
        selectedOptions: ["Stripe"],
        timestamp: Date.now(),
      };

      const updated = await analyzer.updateAnalysis(
        makeCommand(),
        makeAnalysis(),
        answer
      );
      expect(updated.confidence).toBe(0.95);
      expect(updated.needsClarification).toBe(false);
      expect(updated.entities).toHaveLength(2);
    });

    it("should record audit entry for clarification answer", async () => {
      const answer: ClarificationAnswer = {
        questionId: "q-1",
        text: "Stripe",
        timestamp: Date.now(),
      };
      await analyzer.updateAnalysis(makeCommand(), makeAnalysis(), answer);

      const entries = await auditTrail.query({
        operationType: "clarification_answer",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata?.questionId).toBe("q-1");
    });
  });

  describe("finalize()", () => {
    it("should produce a FinalizedCommand with refined text", async () => {
      const finalizeResponse = JSON.stringify({
        refinedText:
          "Refactor the payment module to use Stripe with zero downtime deployment",
        clarificationSummary:
          "Confirmed Stripe as payment gateway, zero downtime required",
      });
      (mockProvider.generate as any).mockResolvedValueOnce({
        content: finalizeResponse,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });

      const command = makeCommand();
      const analysis = makeAnalysis({
        confidence: 0.95,
        needsClarification: false,
      });
      const finalized = await analyzer.finalize(command, analysis);

      expect(finalized.commandId).toBe("cmd-1");
      expect(finalized.originalText).toBe(command.commandText);
      expect(finalized.refinedText).toContain("Stripe");
      expect(finalized.analysis).toBe(analysis);
      expect(finalized.clarificationSummary).toBeDefined();
      expect(finalized.finalizedAt).toBeGreaterThan(0);
    });

    it("should use original text as fallback when LLM returns invalid JSON", async () => {
      (mockProvider.generate as any).mockResolvedValueOnce({
        content: "invalid",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        latencyMs: 50,
        model: "mock",
        provider: "mock",
      });

      const command = makeCommand();
      const finalized = await analyzer.finalize(command, makeAnalysis());
      expect(finalized.refinedText).toBe(command.commandText);
    });

    it("should record audit entry for finalization", async () => {
      const command = makeCommand();
      await analyzer.finalize(command, makeAnalysis());

      const entries = await auditTrail.query({
        operationType: "command_finalized",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("cmd-1");
    });
  });

  describe("retry logic", () => {
    it("should retry on temporary errors and succeed", async () => {
      let callCount = 0;
      const retryProvider: ILLMProvider = {
        name: "retry-mock",
        generate: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error("rate limit");
          }
          return {
            content: JSON.stringify({
              intent: "test",
              entities: [],
              constraints: [],
              objectives: [],
              risks: [],
              assumptions: [],
              confidence: 0.8,
              needsClarification: false,
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
        isTemporaryError: () => true,
      };

      const retryAnalyzer = new CommandAnalyzer({
        llmProvider: retryProvider,
        model: "mock",
        auditTrail,
      });

      const analysis = await retryAnalyzer.analyze(makeCommand());
      expect(analysis.intent).toBe("test");
      expect(retryProvider.generate).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retries exhausted", async () => {
      const failProvider: ILLMProvider = {
        name: "fail-mock",
        generate: vi.fn(async () => {
          throw new Error("always fails");
        }),
        streamGenerate: async function* () {
          yield "";
        },
        healthCheck: async () => ({ healthy: false, provider: "mock" }),
        isTemporaryError: () => true,
      };

      const failAnalyzer = new CommandAnalyzer({
        llmProvider: failProvider,
        model: "mock",
        auditTrail,
      });

      await expect(failAnalyzer.analyze(makeCommand())).rejects.toThrow(
        "always fails"
      );
      // 1 initial + 2 retries = 3 calls
      expect(failProvider.generate).toHaveBeenCalledTimes(3);
    });

    it("should not retry on non-temporary errors", async () => {
      const noRetryProvider: ILLMProvider = {
        name: "no-retry-mock",
        generate: vi.fn(async () => {
          throw new Error("auth error");
        }),
        streamGenerate: async function* () {
          yield "";
        },
        healthCheck: async () => ({ healthy: false, provider: "mock" }),
        isTemporaryError: () => false,
      };

      const noRetryAnalyzer = new CommandAnalyzer({
        llmProvider: noRetryProvider,
        model: "mock",
        auditTrail,
      });

      await expect(noRetryAnalyzer.analyze(makeCommand())).rejects.toThrow(
        "auth error"
      );
      expect(noRetryProvider.generate).toHaveBeenCalledTimes(1);
    });
  });
});
