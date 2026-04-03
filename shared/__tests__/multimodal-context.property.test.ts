import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { VisionContext, MultimodalContext } from '../runtime-agent.js';
import {
  composeAgentMessages,
  RuntimeAgentConfig,
  AgentInvokeOptions,
} from '../runtime-agent.js';
import type { MemoryRepository, LLMMessage } from '../workflow-runtime.js';

/* ─── Arbitraries ─── */

const visionContextArb: fc.Arbitrary<VisionContext> = fc.record({
  imageName: fc.string({ minLength: 0 }),
  visualDescription: fc.string({ minLength: 0 }),
});

const multimodalContextArb: fc.Arbitrary<MultimodalContext> = fc.record({
  visionContexts: fc.option(fc.array(visionContextArb, { minLength: 0, maxLength: 5 }), { nil: undefined }),
  voiceTranscript: fc.option(fc.string(), { nil: undefined }),
  voiceLanguage: fc.option(fc.string(), { nil: undefined }),
});

/* ─── Tests ─── */

// Feature: multi-modal-agent, Property 4: MultimodalContext 序列化 round-trip
describe('Property 4: MultimodalContext 序列化 round-trip', () => {
  it('JSON.stringify then JSON.parse should produce a deeply equal result for any valid MultimodalContext', () => {
    // **Validates: Requirements 5.4**
    fc.assert(
      fc.property(multimodalContextArb, (ctx: MultimodalContext) => {
        const serialized = JSON.stringify(ctx);
        const deserialized = JSON.parse(serialized) as MultimodalContext;
        expect(deserialized).toEqual(ctx);
      }),
      { numRuns: 200 },
    );
  });
});

/* ─── Mocks for composeAgentMessages ─── */

const mockConfig: RuntimeAgentConfig = {
  id: 'test-agent',
  name: 'Test Agent',
  department: 'test',
  role: 'worker',
  managerId: null,
  model: 'test-model',
  soulMd: 'Test soul',
};

const mockMemoryRepo: MemoryRepository = {
  buildPromptContext: () => [],
  appendLLMExchange: () => {},
  appendMessageLog: () => {},
  materializeWorkflowMemories: () => {},
  getSoulText: (_id: string, fallback?: string) => fallback || '',
  appendLearnedBehaviors: () => '',
};

/* ─── Property 2 ─── */

// Feature: multi-modal-agent, Property 2: 语音转录文本注入格式
describe('Property 2: 语音转录文本注入格式', () => {
  it('should inject voiceTranscript as a "[Voice Input] " prefixed user message for any non-empty transcript', () => {
    // **Validates: Requirements 5.2**
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // non-empty voiceTranscript
        fc.string(),                   // arbitrary user prompt
        (voiceTranscript: string, prompt: string) => {
          const options: AgentInvokeOptions = {
            multimodalContext: { voiceTranscript },
          };

          const messages: LLMMessage[] = composeAgentMessages(
            mockConfig,
            prompt,
            mockMemoryRepo,
            [],
            options,
          );

          // Find the "[Voice Input]" message
          const voiceMsg = messages.find(
            (m) =>
              m.role === 'user' &&
              typeof m.content === 'string' &&
              m.content.startsWith('[Voice Input] '),
          );

          // Must exist
          expect(voiceMsg).toBeDefined();

          // Content must be exactly "[Voice Input] " + the full transcript
          expect((voiceMsg as LLMMessage).content).toBe(
            `[Voice Input] ${voiceTranscript}`,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* ─── Property 3 ─── */

// Feature: multi-modal-agent, Property 3: 多模态消息序列排序
describe('Property 3: 多模态消息序列排序', () => {
  it('should order all [Vision Analysis] messages before [Voice Input] before user prompt for any multimodal context', () => {
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(
        fc.array(visionContextArb, { minLength: 1, maxLength: 5 }),  // non-empty visionContexts
        fc.string({ minLength: 1 }),                                  // non-empty voiceTranscript
        fc.string(),                                                  // arbitrary user prompt
        (visionContexts: VisionContext[], voiceTranscript: string, prompt: string) => {
          const options: AgentInvokeOptions = {
            multimodalContext: { visionContexts, voiceTranscript },
          };

          const messages: LLMMessage[] = composeAgentMessages(
            mockConfig,
            prompt,
            mockMemoryRepo,
            [],
            options,
          );

          // Collect indices of [Vision Analysis] messages
          const visionIndices: number[] = [];
          let voiceIndex = -1;
          let promptIndex = -1;

          for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (
              m.role === 'user' &&
              typeof m.content === 'string' &&
              m.content.startsWith('[Vision Analysis] ')
            ) {
              visionIndices.push(i);
            } else if (
              m.role === 'user' &&
              typeof m.content === 'string' &&
              m.content.startsWith('[Voice Input] ')
            ) {
              voiceIndex = i;
            }
          }

          // The last message should be the user prompt
          promptIndex = messages.length - 1;

          // All vision indices must exist (one per visionContext)
          expect(visionIndices).toHaveLength(visionContexts.length);

          // Voice message must exist
          expect(voiceIndex).toBeGreaterThan(-1);

          // max(vision indices) < voiceIndex < promptIndex
          const maxVisionIndex = Math.max(...visionIndices);
          expect(maxVisionIndex).toBeLessThan(voiceIndex);
          expect(voiceIndex).toBeLessThan(promptIndex);
        },
      ),
      { numRuns: 200 },
    );
  });
});

