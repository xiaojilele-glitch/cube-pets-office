import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NLExecutionPlan, ExecutionMetrics } from '../../../shared/nl-command/contracts.js';
import type { ILLMProvider, LLMGenerateResult, LLMMessage } from '../../../shared/llm/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import {
  DecisionSupportEngine,
  type CostOptimizationSuggestion,
  type ResourceAdjustmentSuggestion,
} from '../../core/nl-command/decision-support.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_decision_support__/nl-audit.json');

function cleanup() {
  const dir = dirname(TEST_AUDIT_PATH);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Minimal mock LLM provider. */
function makeMockProvider(responseContent: string): ILLMProvider {
  return {
    name: 'mock',
    generate: vi.fn().mockResolvedValue({
      content: responseContent,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 50,
      model: 'mock-model',
      provider: 'mock',
    } satisfies LLMGenerateResult),
    streamGenerate: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, provider: 'mock' }),
  };
}

/** Build a minimal NLExecutionPlan for testing. */
function makePlan(overrides: Partial<NLExecutionPlan> = {}): NLExecutionPlan {
  return {
    planId: overrides.planId ?? 'plan-1',
    commandId: 'cmd-1',
    status: 'completed',
    missions: overrides.missions ?? [
      {
        missionId: 'm1', title: 'Mission 1', description: 'desc',
        objectives: ['obj1'], constraints: [], estimatedDuration: 60, estimatedCost: 100, priority: 'medium',
      },
    ],
    tasks: overrides.tasks ?? [
      {
        taskId: 't1', title: 'Task 1', description: 'desc',
        objectives: ['obj1'], constraints: [], estimatedDuration: 30, estimatedCost: 50,
        requiredSkills: ['ts'], priority: 'medium',
      },
      {
        taskId: 't2', title: 'Task 2', description: 'desc',
        objectives: ['obj2'], constraints: [], estimatedDuration: 30, estimatedCost: 50,
        requiredSkills: ['ts'], priority: 'medium',
      },
    ],
    timeline: overrides.timeline ?? {
      startDate: '2026-01-01', endDate: '2026-01-02',
      criticalPath: ['t1', 't2'],
      milestones: [],
      entries: [
        { entityId: 't1', entityType: 'task', startTime: 0, endTime: 30, duration: 30, isCriticalPath: true },
        { entityId: 't2', entityType: 'task', startTime: 30, endTime: 60, duration: 30, isCriticalPath: true },
      ],
    },
    resourceAllocation: { entries: [], totalAgents: 2, peakConcurrency: 1 },
    riskAssessment: {
      risks: [{ id: 'r1', description: 'fallback risk', level: 'medium', probability: 0.5, impact: 0.5, mitigation: 'monitor' }],
      overallRiskLevel: 'medium',
    },
    costBudget: {
      totalBudget: 100, missionCosts: { m1: 100 },
      taskCosts: overrides.costBudget?.taskCosts ?? { t1: 50, t2: 50 },
      agentCosts: {}, modelCosts: {}, currency: 'USD',
    },
    contingencyPlan: { alternatives: [], degradationStrategies: [], rollbackPlan: 'rollback' },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

describe('DecisionSupportEngine', () => {
  let auditTrail: AuditTrail;
  let engine: DecisionSupportEngine;

  beforeEach(() => {
    cleanup();
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
  });

  afterEach(() => { cleanup(); });

  describe('analyzeRisks()', () => {
    it('should return risk assessment from LLM response', async () => {
      const llmResponse = JSON.stringify({
        risks: [
          { id: 'risk-1', description: 'Tight deadline', level: 'high', probability: 0.7, impact: 0.8, mitigation: 'Add buffer' },
        ],
        overallRiskLevel: 'high',
      });
      const provider = makeMockProvider(llmResponse);
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const result = await engine.analyzeRisks(makePlan());

      expect(result.overallRiskLevel).toBe('high');
      expect(result.risks).toHaveLength(1);
      expect(result.risks[0].description).toBe('Tight deadline');
      expect(result.risks[0].level).toBe('high');
      expect(result.risks[0].probability).toBe(0.7);
      expect(result.risks[0].mitigation).toBe('Add buffer');
    });

    it('should fallback to plan risk assessment when LLM returns invalid JSON', async () => {
      const provider = makeMockProvider('not valid json at all');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const plan = makePlan();
      const result = await engine.analyzeRisks(plan);

      expect(result.overallRiskLevel).toBe(plan.riskAssessment.overallRiskLevel);
      expect(result.risks).toEqual(plan.riskAssessment.risks);
    });

    it('should call LLM with correct messages', async () => {
      const provider = makeMockProvider(JSON.stringify({
        risks: [], overallRiskLevel: 'low',
      }));
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test-model', auditTrail });

      await engine.analyzeRisks(makePlan());

      expect(provider.generate).toHaveBeenCalledTimes(1);
      const callArgs = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1]).toMatchObject({ model: 'test-model', jsonMode: true });
    });
  });

  describe('suggestCostOptimization()', () => {
    it('should return cost suggestions from LLM', async () => {
      const llmResponse = JSON.stringify({
        suggestions: [
          { title: 'Use cheaper model', description: 'Switch to GPT-3.5', estimatedImpact: 'Save 30%' },
          { title: 'Batch tasks', description: 'Combine similar tasks', estimatedImpact: 'Save 10%' },
        ],
      });
      const provider = makeMockProvider(llmResponse);
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const result = await engine.suggestCostOptimization(makePlan());

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('cost');
      expect(result[0].title).toBe('Use cheaper model');
      expect(result[0].suggestionId).toBeTruthy();
      expect(result[1].title).toBe('Batch tasks');
    });

    it('should return empty array when LLM returns invalid JSON', async () => {
      const provider = makeMockProvider('garbage');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const result = await engine.suggestCostOptimization(makePlan());
      expect(result).toEqual([]);
    });
  });

  describe('suggestResourceAdjustment()', () => {
    it('should return resource suggestions from LLM', async () => {
      const llmResponse = JSON.stringify({
        suggestions: [
          { title: 'Add agent', description: 'Add one more TS agent', estimatedImpact: 'Reduce duration by 20%' },
        ],
      });
      const provider = makeMockProvider(llmResponse);
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const result = await engine.suggestResourceAdjustment(makePlan());

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('resource');
      expect(result[0].title).toBe('Add agent');
      expect(result[0].suggestionId).toBeTruthy();
    });

    it('should return empty array when LLM returns invalid JSON', async () => {
      const provider = makeMockProvider('not json');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const result = await engine.suggestResourceAdjustment(makePlan());
      expect(result).toEqual([]);
    });
  });

  describe('collectExecutionData()', () => {
    it('should compute correct deviation metrics (Property 21)', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      // Plan: plannedDuration = 30 + 30 = 60 (sum of entry durations), plannedCost = 100 (totalBudget)
      // Actual duration = maxEnd - minStart = 60 - 0 = 60
      // Actual cost = sum of taskCosts = 50 + 50 = 100
      const plan = makePlan();
      const metrics = await engine.collectExecutionData(plan);

      expect(metrics.planId).toBe('plan-1');
      expect(metrics.plannedDuration).toBe(60); // sum of entry durations
      expect(metrics.plannedCost).toBe(100);     // totalBudget
      expect(metrics.actualDuration).toBe(60);   // maxEnd - minStart
      expect(metrics.actualCost).toBe(100);      // sum of taskCosts

      // durationDeviation = (60 - 60) / 60 = 0
      expect(metrics.durationDeviation).toBe(0);
      // costDeviation = (100 - 100) / 100 = 0
      expect(metrics.costDeviation).toBe(0);
      expect(metrics.completedAt).toBeGreaterThan(0);
    });

    it('should compute positive deviation when actual exceeds planned', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      // Actual duration: maxEnd(90) - minStart(0) = 90, planned duration: 30+30=60
      // Actual cost: 70+80 = 150, planned cost: 100
      const plan = makePlan({
        timeline: {
          startDate: '2026-01-01', endDate: '2026-01-02',
          criticalPath: ['t1', 't2'], milestones: [],
          entries: [
            { entityId: 't1', entityType: 'task', startTime: 0, endTime: 45, duration: 30, isCriticalPath: true },
            { entityId: 't2', entityType: 'task', startTime: 45, endTime: 90, duration: 30, isCriticalPath: true },
          ],
        },
        costBudget: {
          totalBudget: 100, missionCosts: { m1: 100 },
          taskCosts: { t1: 70, t2: 80 },
          agentCosts: {}, modelCosts: {}, currency: 'USD',
        },
      });

      const metrics = await engine.collectExecutionData(plan);

      // durationDeviation = (90 - 60) / 60 = 0.5
      expect(metrics.durationDeviation).toBeCloseTo(0.5);
      // costDeviation = (150 - 100) / 100 = 0.5
      expect(metrics.costDeviation).toBeCloseTo(0.5);
    });

    it('should handle zero planned duration gracefully', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const plan = makePlan({
        timeline: {
          startDate: '2026-01-01', endDate: '2026-01-01',
          criticalPath: [], milestones: [], entries: [],
        },
      });

      const metrics = await engine.collectExecutionData(plan);
      expect(metrics.durationDeviation).toBe(0);
      expect(metrics.actualDuration).toBe(0);
    });

    it('should store metrics in memory', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      expect(engine.getMetrics()).toHaveLength(0);

      await engine.collectExecutionData(makePlan({ planId: 'p1' }));
      await engine.collectExecutionData(makePlan({ planId: 'p2' }));

      expect(engine.getMetrics()).toHaveLength(2);
      expect(engine.getMetrics()[0].planId).toBe('p1');
      expect(engine.getMetrics()[1].planId).toBe('p2');
    });

    it('should record audit entry', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      await engine.collectExecutionData(makePlan());

      const entries = await auditTrail.query({ operationType: 'report_generated' });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].content).toContain('plan-1');
    });
  });

  describe('generateOptimizationReport()', () => {
    it('should return default report when no metrics collected', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const report = await engine.generateOptimizationReport();

      expect(report.reportId).toBeTruthy();
      expect(report.durationAccuracy).toBe(1);
      expect(report.costAccuracy).toBe(1);
      expect(report.decompositionQuality).toBe(1);
      expect(report.recommendations).toHaveLength(1);
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('should aggregate metrics into report', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      // Collect two plans with known deviations
      await engine.collectExecutionData(makePlan({ planId: 'p1' }));
      await engine.collectExecutionData(makePlan({ planId: 'p2' }));

      const report = await engine.generateOptimizationReport();

      expect(report.reportId).toBeTruthy();
      expect(report.period.start).toBeGreaterThan(0);
      expect(report.period.end).toBeGreaterThanOrEqual(report.period.start);
      expect(report.durationAccuracy).toBeGreaterThanOrEqual(0);
      expect(report.durationAccuracy).toBeLessThanOrEqual(1);
      expect(report.costAccuracy).toBeGreaterThanOrEqual(0);
      expect(report.costAccuracy).toBeLessThanOrEqual(1);
      expect(report.decompositionQuality).toBeGreaterThanOrEqual(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('should flag poor duration accuracy in recommendations', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      // Create a plan where actual duration is much larger than planned
      const plan = makePlan({
        planId: 'p-slow',
        timeline: {
          startDate: '2026-01-01', endDate: '2026-01-02',
          criticalPath: ['t1'], milestones: [],
          entries: [
            { entityId: 't1', entityType: 'task', startTime: 0, endTime: 200, duration: 30, isCriticalPath: true },
          ],
        },
        costBudget: {
          totalBudget: 100, missionCosts: { m1: 100 },
          taskCosts: { t1: 300 },
          agentCosts: {}, modelCosts: {}, currency: 'USD',
        },
      });

      await engine.collectExecutionData(plan);
      const report = await engine.generateOptimizationReport();

      // With large deviations, accuracy should be low and recommendations should mention it
      expect(report.durationAccuracy).toBeLessThan(0.7);
      expect(report.recommendations.some((r) => r.toLowerCase().includes('duration'))).toBe(true);
    });

    it('should record audit entry for report generation', async () => {
      const provider = makeMockProvider('{}');
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      await engine.collectExecutionData(makePlan());
      await engine.generateOptimizationReport();

      const entries = await auditTrail.query({ operationType: 'report_generated' });
      expect(entries.length).toBeGreaterThanOrEqual(2); // one from collectExecutionData, one from report
    });
  });

  describe('LLM retry behavior', () => {
    it('should retry on temporary errors', async () => {
      let callCount = 0;
      const provider: ILLMProvider = {
        name: 'mock',
        generate: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 1) {
            throw new Error('rate limited');
          }
          return {
            content: JSON.stringify({ risks: [], overallRiskLevel: 'low' }),
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            latencyMs: 50, model: 'mock', provider: 'mock',
          };
        }),
        streamGenerate: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, provider: 'mock' }),
        isTemporaryError: () => true,
      };
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      const result = await engine.analyzeRisks(makePlan());
      expect(result.overallRiskLevel).toBe('low');
      expect(callCount).toBe(2);
    });

    it('should throw after max retries exhausted', async () => {
      const provider: ILLMProvider = {
        name: 'mock',
        generate: vi.fn().mockRejectedValue(new Error('always fails')),
        streamGenerate: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, provider: 'mock' }),
        isTemporaryError: () => true,
      };
      engine = new DecisionSupportEngine({ llmProvider: provider, model: 'test', auditTrail });

      await expect(engine.analyzeRisks(makePlan())).rejects.toThrow('always fails');
      // 1 initial + 2 retries = 3 calls
      expect(provider.generate).toHaveBeenCalledTimes(3);
    });
  });
});
