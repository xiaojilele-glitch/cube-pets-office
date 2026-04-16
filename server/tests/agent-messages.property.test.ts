import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  RuntimeAgentConfig,
  VisionContext,
  AgentInvokeOptions,
} from "../../shared/runtime-agent.js";
import {
  composeAgentMessages,
  RuntimeAgent,
} from "../../shared/runtime-agent.js";
import type {
  MemoryRepository,
  LLMMessage,
  LLMCallOptions,
  LLMProvider,
  RuntimeEventEmitter,
} from "../../shared/workflow-runtime.js";

/* ─── Mock MemoryRepository ─── */

const mockMemoryRepo: MemoryRepository = {
  buildPromptContext: () => [],
  appendLLMExchange: () => {},
  appendMessageLog: () => {},
  materializeWorkflowMemories: () => {},
  getSoulText: (_id, fallback) => fallback || "You are an AI agent.",
  appendLearnedBehaviors: () => "",
};

/* ─── Arbitraries ─── */

const arbRole = fc.constantFrom("ceo", "manager", "worker") as fc.Arbitrary<
  "ceo" | "manager" | "worker"
>;

const arbRuntimeAgentConfig: fc.Arbitrary<RuntimeAgentConfig> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  department: fc.string({ minLength: 1, maxLength: 20 }),
  role: arbRole,
  managerId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: null,
  }),
  model: fc.string({ minLength: 1, maxLength: 30 }),
  soulMd: fc.string({ minLength: 1, maxLength: 100 }),
});

const arbVisionContext: fc.Arbitrary<VisionContext> = fc.record({
  imageName: fc.string({ minLength: 1, maxLength: 50 }),
  visualDescription: fc.string({ minLength: 1, maxLength: 200 }),
});

const arbPrompt = fc.string({ minLength: 1, maxLength: 200 });
const arbContextItem = fc.string({ minLength: 1, maxLength: 100 });

/* ─── Property 9: Agent 消息序列中视觉上下文的注入与排序 ─── */
/* **Validates: Requirements 5.1, 5.2** */

describe("Feature: multi-modal-vision, Property 9: Agent 消息序列中视觉上下文的注入与排序", () => {
  it("all vision contexts appear as user messages with correct content format", () => {
    fc.assert(
      fc.property(
        arbRuntimeAgentConfig,
        arbPrompt,
        fc.array(arbContextItem, { maxLength: 5 }),
        fc.array(arbVisionContext, { minLength: 1, maxLength: 5 }),
        (config, prompt, context, visionContexts) => {
          const options: AgentInvokeOptions = { visionContexts };
          const messages = composeAgentMessages(
            config,
            prompt,
            mockMemoryRepo,
            context,
            options
          );

          for (const vc of visionContexts) {
            const expected = `[Vision Analysis] ${vc.imageName}\n${vc.visualDescription}`;
            const found = messages.find(
              m => m.role === "user" && m.content === expected
            );
            expect(found).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the last message is always the user prompt", () => {
    fc.assert(
      fc.property(
        arbRuntimeAgentConfig,
        arbPrompt,
        fc.array(arbContextItem, { maxLength: 5 }),
        fc.array(arbVisionContext, { minLength: 1, maxLength: 5 }),
        (config, prompt, context, visionContexts) => {
          const options: AgentInvokeOptions = { visionContexts };
          const messages = composeAgentMessages(
            config,
            prompt,
            mockMemoryRepo,
            context,
            options
          );

          const lastMessage = messages[messages.length - 1];
          expect(lastMessage.role).toBe("user");
          expect(lastMessage.content).toBe(prompt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all vision context messages appear before the user prompt message", () => {
    fc.assert(
      fc.property(
        arbRuntimeAgentConfig,
        arbPrompt,
        fc.array(arbContextItem, { maxLength: 5 }),
        fc.array(arbVisionContext, { minLength: 1, maxLength: 5 }),
        (config, prompt, context, visionContexts) => {
          const options: AgentInvokeOptions = { visionContexts };
          const messages = composeAgentMessages(
            config,
            prompt,
            mockMemoryRepo,
            context,
            options
          );

          const lastIndex = messages.length - 1; // user prompt index

          for (const vc of visionContexts) {
            const expected = `[Vision Analysis] ${vc.imageName}\n${vc.visualDescription}`;
            const vcIndex = messages.findIndex(
              m => m.role === "user" && m.content === expected
            );
            expect(vcIndex).toBeGreaterThan(-1);
            expect(vcIndex).toBeLessThan(lastIndex);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the number of vision context messages equals the number of visionContexts provided", () => {
    fc.assert(
      fc.property(
        arbRuntimeAgentConfig,
        arbPrompt,
        fc.array(arbContextItem, { maxLength: 5 }),
        fc.array(arbVisionContext, { minLength: 1, maxLength: 5 }),
        (config, prompt, context, visionContexts) => {
          const options: AgentInvokeOptions = { visionContexts };
          const messages = composeAgentMessages(
            config,
            prompt,
            mockMemoryRepo,
            context,
            options
          );

          const visionMessages = messages.filter(
            m =>
              m.role === "user" &&
              typeof m.content === "string" &&
              m.content.startsWith("[Vision Analysis] ")
          );
          expect(visionMessages).toHaveLength(visionContexts.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Helpers for Property 10 ─── */

function createCapturingProvider() {
  let capturedOptions: LLMCallOptions | undefined;
  const provider: LLMProvider = {
    async call(_messages: LLMMessage[], options?: LLMCallOptions) {
      capturedOptions = options;
      return { content: "mock response" };
    },
    async callJson<T>(_messages: LLMMessage[], options?: LLMCallOptions) {
      capturedOptions = options;
      return {} as T;
    },
  };
  return { provider, getCapturedOptions: () => capturedOptions };
}

const mockEmitter: RuntimeEventEmitter = { emit: () => {} };

/* ─── Property 10: 视觉上下文触发 maxTokens 增加 ─── */
/* **Validates: Requirements 5.3** */

describe("Feature: multi-modal-vision, Property 10: 视觉上下文触发 maxTokens 增加", () => {
  it("maxTokens is increased by 1000 when visionContexts are present", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRuntimeAgentConfig,
        arbPrompt,
        fc.array(arbVisionContext, { minLength: 1, maxLength: 5 }),
        async (config, prompt, visionContexts) => {
          const { provider, getCapturedOptions } = createCapturingProvider();
          const agent = new RuntimeAgent(config, {
            memoryRepo: mockMemoryRepo,
            llmProvider: provider,
            eventEmitter: mockEmitter,
          });

          await agent.invoke(prompt, [], { visionContexts });

          const opts = getCapturedOptions();
          expect(opts).toBeDefined();
          expect(opts!.maxTokens).toBe(4000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("maxTokens is base value (3000) when no visionContexts are provided", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRuntimeAgentConfig,
        arbPrompt,
        async (config, prompt) => {
          const { provider, getCapturedOptions } = createCapturingProvider();
          const agent = new RuntimeAgent(config, {
            memoryRepo: mockMemoryRepo,
            llmProvider: provider,
            eventEmitter: mockEmitter,
          });

          await agent.invoke(prompt, [], {});

          const opts = getCapturedOptions();
          expect(opts).toBeDefined();
          expect(opts!.maxTokens).toBe(3000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("maxTokens difference between with and without visionContexts is exactly 1000", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRuntimeAgentConfig,
        arbPrompt,
        fc.array(arbVisionContext, { minLength: 1, maxLength: 5 }),
        async (config, prompt, visionContexts) => {
          const capWithVision = createCapturingProvider();
          const agentWithVision = new RuntimeAgent(config, {
            memoryRepo: mockMemoryRepo,
            llmProvider: capWithVision.provider,
            eventEmitter: mockEmitter,
          });
          await agentWithVision.invoke(prompt, [], { visionContexts });

          const capWithout = createCapturingProvider();
          const agentWithout = new RuntimeAgent(config, {
            memoryRepo: mockMemoryRepo,
            llmProvider: capWithout.provider,
            eventEmitter: mockEmitter,
          });
          await agentWithout.invoke(prompt, [], {});

          const withVisionTokens =
            capWithVision.getCapturedOptions()!.maxTokens!;
          const withoutVisionTokens =
            capWithout.getCapturedOptions()!.maxTokens!;
          expect(withVisionTokens - withoutVisionTokens).toBe(1000);
        }
      ),
      { numRuns: 100 }
    );
  });
});
