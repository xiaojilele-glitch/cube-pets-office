// Feature: nl-command-center, Property 19: template save/load round-trip consistency
// **Validates: Requirements 19.3, 19.4**

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';

import type {
  NLExecutionPlan,
  DecomposedMission,
  DecomposedTask,
  CommandPriority,
  CommandConstraint,
  IdentifiedRisk,
  TimelineEntry,
  ResourceEntry,
  ContingencyAlternative,
  TimelineMilestone,
} from '../../../shared/nl-command/contracts.js';
import { TemplateManager } from '../../core/nl-command/template-manager.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_TPL_PATH = resolve(__test_dirname, '../../../data/__test_tpl_prop__/nl-templates.json');

function cleanup() {
  const dir = dirname(TEST_TPL_PATH);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// --- Generators ---

const priorityArb: fc.Arbitrary<CommandPriority> = fc.constantFrom('critical', 'high', 'medium', 'low');
const nonEmptyStr = fc.string({ minLength: 1, maxLength: 50 });

const constraintArb: fc.Arbitrary<CommandConstraint> = fc.record({
  type: fc.constantFrom('budget' as const, 'time' as const, 'quality' as const, 'resource' as const, 'custom' as const),
  description: nonEmptyStr,
  value: fc.option(nonEmptyStr, { nil: undefined }),
  unit: fc.option(nonEmptyStr, { nil: undefined }),
});

const riskLevelArb = fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const);

const riskArb: fc.Arbitrary<IdentifiedRisk> = fc.record({
  id: fc.uuid(),
  description: nonEmptyStr,
  level: riskLevelArb,
  probability: fc.double({ min: 0, max: 1, noNaN: true }),
  impact: fc.double({ min: 0, max: 1, noNaN: true }),
  mitigation: nonEmptyStr,
  contingency: fc.option(nonEmptyStr, { nil: undefined }),
  relatedEntityId: fc.option(fc.uuid(), { nil: undefined }),
});

const missionArb: fc.Arbitrary<DecomposedMission> = fc.record({
  missionId: fc.uuid(),
  title: nonEmptyStr,
  description: nonEmptyStr,
  objectives: fc.array(nonEmptyStr, { minLength: 1, maxLength: 3 }),
  constraints: fc.array(constraintArb, { minLength: 0, maxLength: 2 }),
  estimatedDuration: fc.double({ min: 1, max: 10000, noNaN: true }),
  estimatedCost: fc.double({ min: 0, max: 100000, noNaN: true }),
  priority: priorityArb,
});

const taskArb: fc.Arbitrary<DecomposedTask> = fc.record({
  taskId: fc.uuid(),
  title: nonEmptyStr,
  description: nonEmptyStr,
  objectives: fc.array(nonEmptyStr, { minLength: 1, maxLength: 3 }),
  constraints: fc.array(constraintArb, { minLength: 0, maxLength: 2 }),
  estimatedDuration: fc.double({ min: 1, max: 10000, noNaN: true }),
  estimatedCost: fc.double({ min: 0, max: 100000, noNaN: true }),
  requiredSkills: fc.array(nonEmptyStr, { minLength: 1, maxLength: 3 }),
  priority: priorityArb,
});

/** Build a random NLExecutionPlan with deterministic structure. */
const planArb: fc.Arbitrary<NLExecutionPlan> = fc
  .record({
    missions: fc.array(missionArb, { minLength: 1, maxLength: 4 }),
    tasks: fc.array(taskArb, { minLength: 1, maxLength: 6 }),
    risks: fc.array(riskArb, { minLength: 0, maxLength: 3 }),
    overallRiskLevel: riskLevelArb,
    planStatus: fc.constantFrom(
      'draft' as const, 'pending_approval' as const, 'approved' as const,
      'executing' as const, 'completed' as const, 'failed' as const,
    ),
    planId: fc.uuid(),
    commandId: fc.uuid(),
  })
  .map(({ missions, tasks, risks, overallRiskLevel, planStatus, planId, commandId }) => {
    const totalBudget = missions.reduce((s, m) => s + m.estimatedCost, 0) || 100;
    const missionCosts: Record<string, number> = {};
    for (const m of missions) missionCosts[m.missionId] = m.estimatedCost;
    const taskCosts: Record<string, number> = {};
    for (const t of tasks) taskCosts[t.taskId] = t.estimatedCost;

    const entries: TimelineEntry[] = [
      ...missions.map((m, i) => ({
        entityId: m.missionId, entityType: 'mission' as const,
        startTime: i * 60, endTime: (i + 1) * 60, duration: 60, isCriticalPath: i === 0,
      })),
      ...tasks.map((t, i) => ({
        entityId: t.taskId, entityType: 'task' as const,
        startTime: i * 30, endTime: (i + 1) * 30, duration: 30, isCriticalPath: i === 0,
      })),
    ];

    const plan: NLExecutionPlan = {
      planId,
      commandId,
      status: planStatus,
      missions,
      tasks,
      timeline: {
        startDate: '2026-01-01', endDate: '2026-12-31',
        criticalPath: entries.filter((e) => e.isCriticalPath).map((e) => e.entityId),
        milestones: [] as TimelineMilestone[],
        entries,
      },
      resourceAllocation: { entries: [] as ResourceEntry[], totalAgents: 1, peakConcurrency: 1 },
      riskAssessment: { risks, overallRiskLevel },
      costBudget: {
        totalBudget, missionCosts, taskCosts,
        agentCosts: { 'agent-default': totalBudget * 0.4 },
        modelCosts: { 'gpt-4': totalBudget * 0.6 },
        currency: 'USD',
      },
      contingencyPlan: {
        alternatives: [] as ContingencyAlternative[],
        degradationStrategies: ['reduce scope'],
        rollbackPlan: 'revert',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return plan;
  });

// --- Tests ---

describe('Property 19: template save/load round-trip consistency', () => {
  let manager: TemplateManager;

  beforeEach(() => {
    cleanup();
    manager = new TemplateManager(TEST_TPL_PATH);
  });

  afterEach(() => { cleanup(); });

  it('loading a saved template SHALL produce a plan structure equivalent to the original (excluding planId, commandId, status, timestamps)', () => {
    fc.assert(
      fc.property(planArb, nonEmptyStr, nonEmptyStr, nonEmptyStr, (plan, name, desc, user) => {
        const saved = manager.save(plan, name, desc, user);
        const loaded = manager.load(saved.templateId);

        expect(loaded).toBeDefined();
        expect(loaded!.templateId).toBe(saved.templateId);

        // The stored plan should NOT contain excluded fields
        const storedPlan = loaded!.plan as Record<string, unknown>;
        expect(storedPlan).not.toHaveProperty('planId');
        expect(storedPlan).not.toHaveProperty('commandId');
        expect(storedPlan).not.toHaveProperty('status');
        expect(storedPlan).not.toHaveProperty('createdAt');
        expect(storedPlan).not.toHaveProperty('updatedAt');

        // Core plan structure should be equivalent
        expect(loaded!.plan.missions).toEqual(plan.missions);
        expect(loaded!.plan.tasks).toEqual(plan.tasks);
        expect(loaded!.plan.timeline).toEqual(plan.timeline);
        expect(loaded!.plan.resourceAllocation).toEqual(plan.resourceAllocation);
        expect(loaded!.plan.riskAssessment).toEqual(plan.riskAssessment);
        expect(loaded!.plan.costBudget).toEqual(plan.costBudget);
        expect(loaded!.plan.contingencyPlan).toEqual(plan.contingencyPlan);
      }),
      { numRuns: 20 },
    );
  });

  it('updating a template SHALL increment the version number', () => {
    fc.assert(
      fc.property(
        planArb, planArb, nonEmptyStr, nonEmptyStr, nonEmptyStr, nonEmptyStr,
        (plan1, plan2, name, desc1, desc2, user) => {
          const saved = manager.save(plan1, name, desc1, user);
          expect(saved.version).toBe(1);

          const updated = manager.update(saved.templateId, plan2, desc2, user);
          expect(updated.version).toBe(2);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('updating a template SHALL preserve the previous version in the versions array', () => {
    fc.assert(
      fc.property(
        planArb, planArb, nonEmptyStr, nonEmptyStr, nonEmptyStr, nonEmptyStr, nonEmptyStr,
        (plan1, plan2, name, desc1, desc2, user1, user2) => {
          const saved = manager.save(plan1, name, desc1, user1);
          const updated = manager.update(saved.templateId, plan2, desc2, user2);

          // versions array should have both entries
          expect(updated.versions).toHaveLength(2);
          expect(updated.versions[0].version).toBe(1);
          expect(updated.versions[0].createdBy).toBe(user1);
          expect(updated.versions[1].version).toBe(2);
          expect(updated.versions[1].createdBy).toBe(user2);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('multiple sequential updates SHALL increment version monotonically and preserve all versions', () => {
    fc.assert(
      fc.property(
        planArb, planArb, planArb, nonEmptyStr, nonEmptyStr,
        (plan1, plan2, plan3, name, user) => {
          const v1 = manager.save(plan1, name, 'v1', user);
          const v2 = manager.update(v1.templateId, plan2, 'v2', user);
          const v3 = manager.update(v1.templateId, plan3, 'v3', user);

          expect(v3.version).toBe(3);
          expect(v3.versions).toHaveLength(3);
          expect(v3.versions.map((v) => v.version)).toEqual([1, 2, 3]);

          // Latest plan content should match plan3
          expect(v3.plan.missions).toEqual(plan3.missions);
          expect(v3.plan.tasks).toEqual(plan3.tasks);
        },
      ),
      { numRuns: 20 },
    );
  });
});
