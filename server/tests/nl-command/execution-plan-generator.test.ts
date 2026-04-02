import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  DecomposedMission,
  DecomposedTask,
  FinalizedCommand,
  MissionDecomposition,
  NLExecutionPlan,
  TaskDecomposition,
} from '../../../shared/nl-command/contracts.js';
import type { ILLMProvider, LLMGenerateResult, LLMMessage, LLMGenerateOptions } from '../../../shared/llm/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { ExecutionPlanGenerator } from '../../core/nl-command/execution-plan-generator.js';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_exec_plan_gen__/nl-audit.json');

// ─── Mock LLM Provider ───

function createMockLLMProvider(): ILLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    generate: vi.fn(async (_messages: LLMMessage[], _options?: LLMGenerateOptions): Promise<LLMGenerateResult> => {
      callIndex++;
      // First call: risk assessment; Second call: contingency plan
      if (callIndex % 2 === 1) {
        return {
          content: JSON.stringify({
            risks: [
              { id: 'risk-1', description: 'Integration complexity', level: 'medium', probability: 0.4, impact: 0.6, mitigation: 'Incremental integration' },
              { id: 'risk-2', description: 'Timeline pressure', level: 'high', probability: 0.5, impact: 0.7, mitigation: 'Add buffer time' },
            ],
            overallRiskLevel: 'medium',
          }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 50,
          model: 'mock',
          provider: 'mock',
        };
      } else {
        return {
          content: JSON.stringify({
            alternatives: [
              { id: 'alt-1', description: 'Reduce scope', trigger: 'Timeline exceeded by 50%', action: 'Cut non-critical tasks', estimatedImpact: 'Medium' },
            ],
            degradationStrategies: ['Reduce scope to critical missions only'],
            rollbackPlan: 'Revert to previous stable state',
          }),
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          latencyMs: 50,
          model: 'mock',
          provider: 'mock',
        };
      }
    }),
    streamGenerate: async function* () { yield ''; },
    healthCheck: async () => ({ healthy: true, latencyMs: 10, provider: 'mock' }),
    isTemporaryError: () => false,
  };
}

// ─── Test data factories ───

function makeCommand(overrides: Partial<FinalizedCommand> = {}): FinalizedCommand {
  return {
    commandId: overrides.commandId ?? 'cmd-1',
    originalText: overrides.originalText ?? 'Refactor payment module',
    refinedText: overrides.refinedText ?? 'Refactor payment module with zero downtime',
    analysis: overrides.analysis ?? {
      intent: 'refactor',
      entities: [{ name: 'payment', type: 'module' }],
      constraints: [{ type: 'quality', description: 'zero downtime' }],
      objectives: ['Improve architecture'],
      risks: [{ id: 'r-existing', description: 'Existing risk', level: 'low', probability: 0.2, impact: 0.3, mitigation: 'Monitor' }],
      assumptions: ['Team available'],
      confidence: 0.9,
      needsClarification: false,
    },
    finalizedAt: Date.now(),
  };
}

function makeMission(id: string, cost: number, duration: number): DecomposedMission {
  return {
    missionId: id,
    title: `Mission ${id}`,
    description: `Description for ${id}`,
    objectives: ['Objective 1'],
    constraints: [],
    estimatedDuration: duration,
    estimatedCost: cost,
    priority: 'high',
  };
}

function makeTask(id: string, cost: number, duration: number, skills: string[] = []): DecomposedTask {
  return {
    taskId: id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    objectives: ['Objective 1'],
    constraints: [],
    estimatedDuration: duration,
    estimatedCost: cost,
    requiredSkills: skills.length > 0 ? skills : ['general'],
    priority: 'medium',
  };
}

function makeDecomposition(missions: DecomposedMission[]): MissionDecomposition {
  return {
    decompositionId: 'decomp-1',
    commandId: 'cmd-1',
    missions,
    dependencies: missions.length > 1
      ? [{ fromMissionId: missions[1].missionId, toMissionId: missions[0].missionId, type: 'depends_on' as const }]
      : [],
    executionOrder: missions.length > 1
      ? [[missions[0].missionId], [missions[1].missionId]]
      : [missions.map((m) => m.missionId)],
    totalEstimatedDuration: missions.reduce((s, m) => s + m.estimatedDuration, 0),
    totalEstimatedCost: missions.reduce((s, m) => s + m.estimatedCost, 0),
  };
}

function makeTaskDecomposition(missionId: string, tasks: DecomposedTask[]): TaskDecomposition {
  return {
    decompositionId: `td-${missionId}`,
    missionId,
    tasks,
    dependencies: tasks.length > 1
      ? [{ fromTaskId: tasks[1].taskId, toTaskId: tasks[0].taskId, type: 'depends_on' as const }]
      : [],
    executionOrder: tasks.length > 1
      ? [[tasks[0].taskId], [tasks[1].taskId]]
      : [tasks.map((t) => t.taskId)],
  };
}

// ─── Tests ───

describe('ExecutionPlanGenerator', () => {
  let auditTrail: AuditTrail;
  let generator: ExecutionPlanGenerator;
  let mockProvider: ILLMProvider;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    mockProvider = createMockLLMProvider();
    generator = new ExecutionPlanGenerator({
      llmProvider: mockProvider,
      model: 'mock-model',
      auditTrail,
    });
  });

  describe('generate()', () => {
    it('should return a valid NLExecutionPlan with all required fields (Req 5.1)', async () => {
      const missions = [makeMission('m-1', 200, 60), makeMission('m-2', 300, 90)];
      const tasks = [makeTask('t-1', 100, 30, ['backend']), makeTask('t-2', 100, 30, ['frontend'])];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);

      expect(plan.planId).toMatch(/^plan-/);
      expect(plan.commandId).toBe('cmd-1');
      expect(plan.status).toBe('draft');
      expect(plan.missions).toHaveLength(2);
      expect(plan.tasks).toHaveLength(2);
      expect(plan.timeline).toBeDefined();
      expect(plan.resourceAllocation).toBeDefined();
      expect(plan.riskAssessment).toBeDefined();
      expect(plan.costBudget).toBeDefined();
      expect(plan.contingencyPlan).toBeDefined();
      expect(plan.createdAt).toBeGreaterThan(0);
      expect(plan.updatedAt).toBeGreaterThan(0);
    });

    it('should compute timeline with entries for missions and tasks (Req 5.2)', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30), makeTask('t-2', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);

      expect(plan.timeline.entries.length).toBeGreaterThan(0);
      expect(plan.timeline.startDate).toBeTruthy();
      expect(plan.timeline.endDate).toBeTruthy();

      // Each entry should have valid timing
      for (const entry of plan.timeline.entries) {
        expect(entry.entityId).toBeTruthy();
        expect(entry.endTime).toBeGreaterThanOrEqual(entry.startTime);
        expect(entry.duration).toBeGreaterThan(0);
        expect(typeof entry.isCriticalPath).toBe('boolean');
      }
    });

    it('should build resource allocation from task skills (Req 5.3)', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [
        makeTask('t-1', 50, 30, ['backend', 'typescript']),
        makeTask('t-2', 50, 30, ['frontend', 'react']),
      ];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);

      expect(plan.resourceAllocation.entries).toHaveLength(2);
      expect(plan.resourceAllocation.totalAgents).toBeGreaterThan(0);
      expect(plan.resourceAllocation.peakConcurrency).toBeGreaterThan(0);

      for (const entry of plan.resourceAllocation.entries) {
        expect(entry.taskId).toBeTruthy();
        expect(entry.agentType).toBeTruthy();
        expect(entry.requiredSkills.length).toBeGreaterThan(0);
      }
    });

    it('should call LLM for risk assessment (Req 5.4)', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);

      expect(plan.riskAssessment.risks.length).toBeGreaterThan(0);
      expect(plan.riskAssessment.overallRiskLevel).toBeTruthy();
      // LLM called at least once for risk assessment
      expect(mockProvider.generate).toHaveBeenCalled();
    });

    it('should enforce Property 8: totalBudget = sum of missionCosts (Req 5.5)', async () => {
      const missions = [makeMission('m-1', 200, 60), makeMission('m-2', 300, 90)];
      const tasks = [makeTask('t-1', 100, 30), makeTask('t-2', 200, 60)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);

      const sumMissionCosts = Object.values(plan.costBudget.missionCosts).reduce((s, c) => s + c, 0);
      expect(plan.costBudget.totalBudget).toBe(sumMissionCosts);
      expect(plan.costBudget.totalBudget).toBe(500); // 200 + 300
      expect(plan.costBudget.currency).toBe('CNY');
    });

    it('should generate contingency plan (Req 5.6)', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);

      expect(plan.contingencyPlan).toBeDefined();
      expect(Array.isArray(plan.contingencyPlan.alternatives)).toBe(true);
      expect(Array.isArray(plan.contingencyPlan.degradationStrategies)).toBe(true);
      expect(plan.contingencyPlan.rollbackPlan).toBeTruthy();
    });

    it('should record audit entry on plan generation', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      await generator.generate(command, decomposition, taskDecomps);

      const entries = await auditTrail.query({ operationType: 'plan_generated' });
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe('success');
      expect(entries[0].entityType).toBe('plan');
    });

    it('should handle empty task decompositions gracefully', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);

      const plan = await generator.generate(command, decomposition, []);

      expect(plan.tasks).toHaveLength(0);
      expect(plan.missions).toHaveLength(1);
      expect(plan.costBudget.totalBudget).toBe(100);
    });
  });

  describe('computeCriticalPath()', () => {
    it('should return critical path IDs and total duration', async () => {
      const missions = [makeMission('m-1', 100, 60), makeMission('m-2', 200, 120)];
      const tasks = [makeTask('t-1', 50, 30), makeTask('t-2', 50, 60)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);
      const result = generator.computeCriticalPath(plan);

      expect(result.criticalPathIds.length).toBeGreaterThan(0);
      expect(result.totalDuration).toBeGreaterThan(0);
    });

    it('should mark isCriticalPath on timeline entries', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30), makeTask('t-2', 50, 60)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);
      const result = generator.computeCriticalPath(plan);

      const cpSet = new Set(result.criticalPathIds);
      for (const entry of plan.timeline.entries) {
        if (cpSet.has(entry.entityId)) {
          expect(entry.isCriticalPath).toBe(true);
        }
      }
    });
  });

  describe('adjustPlan()', () => {
    it('should update plan fields and updatedAt timestamp', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);
      const originalUpdatedAt = plan.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      const adjusted = await generator.adjustPlan(plan, {
        reason: 'Budget increase',
        changes: { status: 'approved' as const },
      });

      expect(adjusted.status).toBe('approved');
      expect(adjusted.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it('should record audit entry for adjustment', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);
      await generator.adjustPlan(plan, {
        reason: 'Timeline extension',
        changes: {},
      });

      const entries = await auditTrail.query({ operationType: 'adjustment_applied' });
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toContain('Timeline extension');
    });

    it('should not overwrite planId or commandId', async () => {
      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await generator.generate(command, decomposition, taskDecomps);
      const adjusted = await generator.adjustPlan(plan, {
        reason: 'Attempted ID change',
        changes: { planId: 'hacked', commandId: 'hacked' },
      });

      expect(adjusted.planId).toBe(plan.planId);
      expect(adjusted.commandId).toBe(plan.commandId);
    });
  });

  describe('LLM fallback behavior', () => {
    it('should use fallback risk assessment when LLM fails', async () => {
      const failProvider: ILLMProvider = {
        name: 'fail-mock',
        generate: vi.fn(async () => { throw new Error('LLM unavailable'); }),
        streamGenerate: async function* () { yield ''; },
        healthCheck: async () => ({ healthy: false, provider: 'fail-mock' }),
        isTemporaryError: () => false,
      };

      const failGenerator = new ExecutionPlanGenerator({
        llmProvider: failProvider,
        model: 'mock',
        auditTrail,
      });

      const missions = [makeMission('m-1', 100, 60)];
      const tasks = [makeTask('t-1', 50, 30)];
      const command = makeCommand();
      const decomposition = makeDecomposition(missions);
      const taskDecomps = [makeTaskDecomposition('m-1', tasks)];

      const plan = await failGenerator.generate(command, decomposition, taskDecomps);

      // Should still produce a valid plan with fallback values
      expect(plan.riskAssessment.risks.length).toBeGreaterThan(0);
      expect(plan.riskAssessment.overallRiskLevel).toBe('medium');
      expect(plan.contingencyPlan.rollbackPlan).toBeTruthy();
    });
  });
});
