// Feature: nl-command-center, Property 3: audit chain recording invariant
// **Validates: Requirements 1.4, 2.6, 3.6, 4.6, 7.6, 8.6, 10.5, 12.5, 17.4**

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AuditEntry,
  ClarificationQuestion,
  NLExecutionPlan,
  StrategicCommand,
  CommandAnalysis,
} from '../../../shared/nl-command/contracts.js';
import type {
  ILLMProvider,
  LLMGenerateResult,
  LLMMessage,
  LLMGenerateOptions,
} from '../../../shared/llm/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { CommandAnalyzer } from '../../core/nl-command/command-analyzer.js';
import { ClarificationDialogManager } from '../../core/nl-command/clarification-dialog.js';
import { PlanApproval } from '../../core/nl-command/plan-approval.js';
import { CommentManager } from '../../core/nl-command/comment-manager.js';
import { AlertEngine } from '../../core/nl-command/alert-engine.js';
import { PermissionGuard } from '../../core/nl-command/permission-guard.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  '../../../data/__test_audit_integration_prop__/nl-audit.json',
);

// --- Mock LLM Provider ---

function createMockLLMProvider(): ILLMProvider {
  return {
    name: 'mock',
    generate: vi.fn(
      async (_messages: LLMMessage[], _options?: LLMGenerateOptions): Promise<LLMGenerateResult> => {
        return {
          content: JSON.stringify({
            intent: 'test intent',
            entities: [{ name: 'test-entity', type: 'module' }],
            constraints: [{ type: 'quality', description: 'high quality' }],
            objectives: ['Test objective'],
            risks: [],
            assumptions: ['Test assumption'],
            confidence: 0.8,
            needsClarification: false,
          }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 50,
          model: 'mock',
          provider: 'mock',
        };
      },
    ),
    streamGenerate: async function* () {
      yield '';
    },
    healthCheck: async () => ({ healthy: true, latencyMs: 10, provider: 'mock' }),
    isTemporaryError: () => false,
  };
}

// --- Helpers ---

function makeCommand(overrides: Partial<StrategicCommand> = {}): StrategicCommand {
  return {
    commandId: overrides.commandId ?? `cmd-${Date.now()}`,
    commandText: overrides.commandText ?? 'Refactor the payment module',
    userId: overrides.userId ?? 'user-1',
    timestamp: overrides.timestamp ?? Date.now(),
    status: overrides.status ?? 'analyzing',
    constraints: overrides.constraints ?? [],
    objectives: overrides.objectives ?? ['Improve architecture'],
    priority: overrides.priority ?? 'high',
  };
}

function makeAnalysis(): CommandAnalysis {
  return {
    intent: 'refactor payment module',
    entities: [{ name: 'payment-module', type: 'module' }],
    constraints: [{ type: 'quality', description: 'zero downtime' }],
    objectives: ['Improve architecture'],
    risks: [],
    assumptions: ['Module is monolithic'],
    confidence: 0.8,
    needsClarification: false,
  };
}

function makePlan(planId = 'plan-1'): NLExecutionPlan {
  return {
    planId,
    commandId: 'cmd-1',
    status: 'pending_approval',
    missions: [],
    tasks: [],
    timeline: { startDate: '', endDate: '', criticalPath: [], milestones: [], entries: [] },
    resourceAllocation: { entries: [], totalAgents: 0, peakConcurrency: 0 },
    riskAssessment: { risks: [], overallRiskLevel: 'low' },
    costBudget: {
      totalBudget: 0,
      missionCosts: {},
      taskCosts: {},
      agentCosts: {},
      modelCosts: {},
      currency: 'CNY',
    },
    contingencyPlan: { alternatives: [], degradationStrategies: [], rollbackPlan: '' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// --- Generators ---

const operatorArb = fc.stringMatching(/^[a-z]{3,10}$/);
const commandIdArb = fc.uuid().map((u) => `cmd-${u.slice(0, 8)}`);
const entityIdArb = fc.uuid().map((u) => `entity-${u.slice(0, 8)}`);
const commentContentArb = fc
  .string({ minLength: 3, maxLength: 50 })
  .filter((s) => s.trim().length >= 3 && /^[\x20-\x7E]+$/.test(s));

// --- Validation helper ---

function validateAuditEntry(entry: AuditEntry, expectedOpType: string): void {
  expect(typeof entry.operator).toBe('string');
  expect(entry.operator.length).toBeGreaterThan(0);
  expect(entry.operationType).toBe(expectedOpType);
  expect(typeof entry.content).toBe('string');
  expect(entry.content.length).toBeGreaterThan(0);
  expect(typeof entry.timestamp).toBe('number');
  expect(entry.timestamp).toBeGreaterThan(0);
  expect(['success', 'failure']).toContain(entry.result);
}

// --- Tests ---

describe('Property 3: audit chain recording invariant', () => {
  let auditTrail: AuditTrail;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('command analysis SHALL produce exactly one audit entry with operationType command_analyzed', async () => {
    await fc.assert(
      fc.asyncProperty(operatorArb, commandIdArb, async (operator, commandId) => {
        // Fresh audit trail per run
        const dir = dirname(TEST_AUDIT_PATH);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        const trail = new AuditTrail(TEST_AUDIT_PATH);

        const analyzer = new CommandAnalyzer({
          llmProvider: createMockLLMProvider(),
          model: 'mock-model',
          auditTrail: trail,
        });

        const command = makeCommand({ commandId, userId: operator });
        await analyzer.analyze(command);

        const entries = await trail.query({ operationType: 'command_analyzed' });
        expect(entries).toHaveLength(1);
        validateAuditEntry(entries[0], 'command_analyzed');
        expect(entries[0].operator).toBe(operator);
        expect(entries[0].entityId).toBe(commandId);
      }),
      { numRuns: 20 },
    );
  });

  it('clarification dialog creation SHALL produce exactly one audit entry with operationType clarification_question', async () => {
    await fc.assert(
      fc.asyncProperty(commandIdArb, async (commandId) => {
        const dir = dirname(TEST_AUDIT_PATH);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        const trail = new AuditTrail(TEST_AUDIT_PATH);

        const manager = new ClarificationDialogManager({ auditTrail: trail });

        const questions: ClarificationQuestion[] = [
          { questionId: 'q-1', text: 'What deployment strategy?', type: 'free_text' },
        ];

        await manager.createDialog(commandId, questions);

        const entries = await trail.query({ operationType: 'clarification_question' });
        expect(entries).toHaveLength(1);
        validateAuditEntry(entries[0], 'clarification_question');
        expect(entries[0].entityId).toBe(commandId);
      }),
      { numRuns: 20 },
    );
  });

  it('approval submission SHALL produce audit entries with operationType approval_submitted or approval_completed', async () => {
    await fc.assert(
      fc.asyncProperty(operatorArb, async (operator) => {
        const dir = dirname(TEST_AUDIT_PATH);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        const trail = new AuditTrail(TEST_AUDIT_PATH);

        const approval = new PlanApproval({ auditTrail: trail });
        const plan = makePlan();
        const req = await approval.createApprovalRequest(plan, [operator]);

        // Count entries before submission
        const beforeEntries = await trail.query({});
        const beforeCount = beforeEntries.length;

        await approval.submitApproval(req.requestId, operator, 'approved');

        const afterEntries = await trail.query({});
        // At least one new entry from the submission
        expect(afterEntries.length).toBeGreaterThan(beforeCount);

        // Find the submission entry (approval_submitted or approval_completed)
        const submissionEntries = afterEntries.filter(
          (e) =>
            (e.operationType === 'approval_submitted' ||
              e.operationType === 'approval_completed') &&
            e.timestamp >= (beforeEntries[0]?.timestamp ?? 0),
        );
        // The createApprovalRequest also records one, plus the submitApproval
        expect(submissionEntries.length).toBeGreaterThanOrEqual(1);

        const latestSubmission = submissionEntries[0]; // descending order, most recent first
        validateAuditEntry(
          latestSubmission,
          latestSubmission.operationType,
        );
        expect(latestSubmission.operator).toBe(operator);
      }),
      { numRuns: 20 },
    );
  });

  it('comment creation SHALL produce exactly one audit entry with operationType comment_created', async () => {
    await fc.assert(
      fc.asyncProperty(operatorArb, entityIdArb, commentContentArb, async (operator, entityId, content) => {
        const dir = dirname(TEST_AUDIT_PATH);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        const trail = new AuditTrail(TEST_AUDIT_PATH);

        const permissionGuard = new PermissionGuard();
        const commentManager = new CommentManager({
          auditTrail: trail,
          permissionGuard,
        });

        // Use 'admin' role to ensure permission passes
        await commentManager.addComment(entityId, 'command', operator, content, 'admin');

        const entries = await trail.query({ operationType: 'comment_created' });
        expect(entries).toHaveLength(1);
        validateAuditEntry(entries[0], 'comment_created');
        expect(entries[0].operator).toBe(operator);
      }),
      { numRuns: 20 },
    );
  });

  it('alert triggering SHALL produce exactly one audit entry with operationType alert_triggered', async () => {
    await fc.assert(
      fc.asyncProperty(entityIdArb, async (entityId) => {
        const dir = dirname(TEST_AUDIT_PATH);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        const trail = new AuditTrail(TEST_AUDIT_PATH);

        const alertEngine = new AlertEngine({ auditTrail: trail });

        alertEngine.registerRule({
          ruleId: 'rule-1',
          type: 'COST_EXCEEDED',
          condition: { metric: 'cost', operator: 'gt', threshold: 100 },
          priority: 'warning',
          enabled: true,
        });

        await alertEngine.evaluate({
          metrics: { cost: 200 },
          entityId,
          entityType: 'plan',
        });

        const entries = await trail.query({ operationType: 'alert_triggered' });
        expect(entries).toHaveLength(1);
        validateAuditEntry(entries[0], 'alert_triggered');
        expect(entries[0].operator).toBe('system');
        expect(entries[0].entityId).toBe(entityId);
      }),
      { numRuns: 20 },
    );
  });
});
