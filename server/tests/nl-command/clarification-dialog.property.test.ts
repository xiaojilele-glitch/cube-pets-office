// Feature: nl-command-center, Property 4: clarification dialog accepts both answer types
// Feature: nl-command-center, Property 5: clarification updates analysis and finalizes
// **Validates: Requirements 2.3, 2.4, 2.5**

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ClarificationAnswer,
  ClarificationQuestion,
  CommandAnalysis,
  StrategicCommand,
} from '../../../shared/nl-command/contracts.js';
import type { ILLMProvider, LLMGenerateResult, LLMMessage, LLMGenerateOptions } from '../../../shared/llm/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { ClarificationDialogManager } from '../../core/nl-command/clarification-dialog.js';
import { CommandAnalyzer } from '../../core/nl-command/command-analyzer.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_clarification_prop__/nl-audit.json');

// --- Generators ---

const questionTypeArb: fc.Arbitrary<'free_text' | 'single_choice' | 'multi_choice'> =
  fc.constantFrom('free_text', 'single_choice', 'multi_choice');

const optionArb = fc.string({ minLength: 2, maxLength: 10 }).filter((s) => s.trim().length >= 2);

const clarificationQuestionArb: fc.Arbitrary<ClarificationQuestion> = fc
  .tuple(
    fc.uuid().map((u) => `q-${u.slice(0, 8)}`),
    fc.string({ minLength: 5, maxLength: 40 }).filter((s) => s.trim().length >= 5),
    questionTypeArb,
    fc.array(optionArb, { minLength: 2, maxLength: 5 }),
  )
  .map(([questionId, text, type, options]) => ({
    questionId, text, type,
    ...(type !== 'free_text' ? { options } : {}),
  }));

const questionsArb: fc.Arbitrary<ClarificationQuestion[]> = fc
  .array(clarificationQuestionArb, { minLength: 1, maxLength: 5 })
  .map((qs) => {
    const seen = new Set<string>();
    return qs.filter((q) => { if (seen.has(q.questionId)) return false; seen.add(q.questionId); return true; });
  })
  .filter((qs) => qs.length >= 1);

const commandIdArb = fc.uuid().map((u) => `cmd-${u.slice(0, 8)}`);

// --- Mock LLM Provider ---

function createMockLLMProvider(confidenceIncrease = 0.1): ILLMProvider {
  return {
    name: 'mock',
    generate: vi.fn(async (messages: LLMMessage[], _options?: LLMGenerateOptions): Promise<LLMGenerateResult> => {
      const lastMsg = messages[messages.length - 1];
      const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';

      if (content.includes('Clarification answer')) {
        const confMatch = content.match(/"confidence":\s*([\d.]+)/);
        const currentConf = confMatch ? parseFloat(confMatch[1]) : 0.5;
        const newConf = Math.min(1, currentConf + confidenceIncrease);
        return {
          content: JSON.stringify({
            intent: 'updated intent', entities: [{ name: 'module-a', type: 'module' }],
            constraints: [{ type: 'quality', description: 'high quality' }],
            objectives: ['Updated objective'], risks: [], assumptions: ['Updated assumption'],
            confidence: newConf, needsClarification: newConf < 0.9,
          }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 50, model: 'mock', provider: 'mock',
        };
      }

      if (content.includes('Produce a refined command')) {
        return {
          content: JSON.stringify({ refinedText: 'Refined: ' + content.slice(0, 30), clarificationSummary: 'Clarification completed' }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 50, model: 'mock', provider: 'mock',
        };
      }

      return {
        content: JSON.stringify({
          intent: 'test intent', entities: [{ name: 'test-entity', type: 'module' }],
          constraints: [], objectives: ['Test objective'], risks: [], assumptions: [],
          confidence: 0.6, needsClarification: true,
        }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 50, model: 'mock', provider: 'mock',
      };
    }),
    streamGenerate: async function* () { yield ''; },
    healthCheck: async () => ({ healthy: true, latencyMs: 10, provider: 'mock' }),
    isTemporaryError: () => false,
  };
}

function makeCommand(commandId: string): StrategicCommand {
  return {
    commandId, commandText: 'Refactor the payment module with zero downtime',
    userId: 'user-1', timestamp: Date.now(), status: 'clarifying',
    constraints: [], objectives: [], priority: 'high',
  };
}

function makeAnalysis(confidence = 0.5): CommandAnalysis {
  return {
    intent: 'refactor payment module', entities: [{ name: 'payment-module', type: 'module' }],
    constraints: [{ type: 'quality', description: 'zero downtime' }],
    objectives: ['Improve architecture'], risks: [], assumptions: ['Module is monolithic'],
    confidence, needsClarification: true, clarificationTopics: ['deployment strategy'],
  };
}

// --- Tests ---

describe('Property 4: clarification dialog accepts both answer types', () => {
  let auditTrail: AuditTrail;
  let manager: ClarificationDialogManager;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    manager = new ClarificationDialogManager({ auditTrail });
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('SHALL accept free-text ClarificationAnswer and store it in answers array', () => {
    fc.assert(
      fc.asyncProperty(commandIdArb, questionsArb, async (commandId, questions) => {
        const dialog = await manager.createDialog(commandId, questions);
        const q = questions[0];
        const answer: ClarificationAnswer = { questionId: q.questionId, text: 'This is a free-text answer', timestamp: Date.now() };
        const updated = await manager.addAnswer(dialog.dialogId, answer);
        const stored = updated.answers.find((a) => a.questionId === q.questionId);
        expect(stored).toBeDefined();
        expect(stored!.text).toBe('This is a free-text answer');
        expect(stored!.selectedOptions).toBeUndefined();
      }),
      { numRuns: 20 },
    );
  });

  it('SHALL accept selection-based ClarificationAnswer and store it in answers array', () => {
    fc.assert(
      fc.asyncProperty(commandIdArb, questionsArb, async (commandId, questions) => {
        const q = questions[0];
        const options = q.options ?? ['option-a', 'option-b'];
        const answer: ClarificationAnswer = { questionId: q.questionId, text: options[0], selectedOptions: [options[0]], timestamp: Date.now() };
        const dialog = await manager.createDialog(commandId, questions);
        const updated = await manager.addAnswer(dialog.dialogId, answer);
        const stored = updated.answers.find((a) => a.questionId === q.questionId);
        expect(stored).toBeDefined();
        expect(stored!.selectedOptions).toBeDefined();
        expect(stored!.selectedOptions!.length).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('SHALL store both free-text and selection-based answers in the same dialog', () => {
    fc.assert(
      fc.asyncProperty(commandIdArb, questionsArb.filter((qs) => qs.length >= 2), async (commandId, questions) => {
        const dialog = await manager.createDialog(commandId, questions);
        await manager.addAnswer(dialog.dialogId, { questionId: questions[0].questionId, text: 'Free text response', timestamp: Date.now() });
        await manager.addAnswer(dialog.dialogId, { questionId: questions[1].questionId, text: 'selected option', selectedOptions: ['selected option'], timestamp: Date.now() });
        expect(dialog.answers).toHaveLength(2);
        const freeStored = dialog.answers.find((a) => a.questionId === questions[0].questionId);
        const selStored = dialog.answers.find((a) => a.questionId === questions[1].questionId);
        expect(freeStored).toBeDefined();
        expect(freeStored!.selectedOptions).toBeUndefined();
        expect(selStored).toBeDefined();
        expect(selStored!.selectedOptions).toEqual(['selected option']);
      }),
      { numRuns: 20 },
    );
  });
});

describe('Property 5: clarification updates analysis and finalizes', () => {
  let auditTrail: AuditTrail;
  let manager: ClarificationDialogManager;
  let analyzer: CommandAnalyzer;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    manager = new ClarificationDialogManager({ auditTrail });
    const mockProvider = createMockLLMProvider(0.15);
    analyzer = new CommandAnalyzer({ llmProvider: mockProvider, model: 'mock-model', auditTrail });
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('after each ClarificationAnswer, Command_Analysis SHALL be updated', () => {
    fc.assert(
      fc.asyncProperty(commandIdArb, questionsArb, async (commandId, questions) => {
        const command = makeCommand(commandId);
        const initialAnalysis = makeAnalysis(0.5);
        await manager.createDialog(commandId, questions);
        const answer: ClarificationAnswer = { questionId: questions[0].questionId, text: 'Clarification response', timestamp: Date.now() };
        const updatedAnalysis = await analyzer.updateAnalysis(command, initialAnalysis, answer);
        const changed = updatedAnalysis.confidence !== initialAnalysis.confidence ||
          updatedAnalysis.intent !== initialAnalysis.intent ||
          updatedAnalysis.entities.length !== initialAnalysis.entities.length;
        expect(changed).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('after all clarification rounds complete, a FinalizedCommand SHALL be produced', () => {
    fc.assert(
      fc.asyncProperty(commandIdArb, questionsArb, async (commandId, questions) => {
        // Fresh manager per iteration to avoid cross-iteration state
        const freshManager = new ClarificationDialogManager({ auditTrail });
        const command = makeCommand(commandId);
        let currentAnalysis = makeAnalysis(0.5);
        const dialog = await freshManager.createDialog(commandId, questions);
        for (const q of questions) {
          const answer: ClarificationAnswer = { questionId: q.questionId, text: 'Answer for ' + q.questionId, selectedOptions: q.options ? [q.options[0]] : undefined, timestamp: Date.now() };
          await freshManager.addAnswer(dialog.dialogId, answer);
          currentAnalysis = await analyzer.updateAnalysis(command, currentAnalysis, answer);
        }
        expect(freshManager.isComplete(dialog)).toBe(true);
        const finalized = await analyzer.finalize(command, currentAnalysis);
        expect(finalized.commandId).toBe(commandId);
        expect(finalized.originalText).toBe(command.commandText);
        expect(typeof finalized.refinedText).toBe('string');
        expect(finalized.refinedText.length).toBeGreaterThan(0);
        expect(finalized.analysis).toBeDefined();
        expect(typeof finalized.analysis.confidence).toBe('number');
        expect(finalized.finalizedAt).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('confidence SHALL generally increase after clarification answers', () => {
    fc.assert(
      fc.asyncProperty(commandIdArb, questionsArb, async (commandId, questions) => {
        const command = makeCommand(commandId);
        let currentAnalysis = makeAnalysis(0.4);
        const initialConfidence = currentAnalysis.confidence;
        for (const q of questions) {
          const answer: ClarificationAnswer = { questionId: q.questionId, text: 'Detailed clarification', timestamp: Date.now() };
          currentAnalysis = await analyzer.updateAnalysis(command, currentAnalysis, answer);
        }
        expect(currentAnalysis.confidence).toBeGreaterThan(initialConfidence);
      }),
      { numRuns: 20 },
    );
  });
});
