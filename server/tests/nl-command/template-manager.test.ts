import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NLExecutionPlan } from '../../../shared/nl-command/contracts.js';
import { TemplateManager } from '../../core/nl-command/template-manager.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_TEMPLATE_PATH = resolve(__test_dirname, '../../../data/__test_nl_templates__/nl-templates.json');

function makePlan(overrides: Partial<NLExecutionPlan> = {}): NLExecutionPlan {
  return {
    planId: overrides.planId ?? 'plan-1',
    commandId: overrides.commandId ?? 'cmd-1',
    status: overrides.status ?? 'draft',
    missions: overrides.missions ?? [
      {
        missionId: 'm1',
        title: 'Mission 1',
        description: 'First mission',
        objectives: ['obj1'],
        constraints: [],
        estimatedDuration: 60,
        estimatedCost: 100,
        priority: 'high',
      },
    ],
    tasks: overrides.tasks ?? [
      {
        taskId: 't1',
        title: 'Task 1',
        description: 'First task',
        objectives: ['obj1'],
        constraints: [],
        estimatedDuration: 30,
        estimatedCost: 50,
        requiredSkills: ['coding'],
        priority: 'medium',
      },
    ],
    timeline: overrides.timeline ?? {
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      criticalPath: ['m1'],
      milestones: [{ id: 'ms1', label: 'Start', date: '2026-01-01', entityId: 'm1' }],
      entries: [
        { entityId: 'm1', entityType: 'mission', startTime: 0, endTime: 60, duration: 60, isCriticalPath: true },
      ],
    },
    resourceAllocation: overrides.resourceAllocation ?? {
      entries: [{ taskId: 't1', agentType: 'coder', agentCount: 1, requiredSkills: ['coding'], startTime: 0, endTime: 30 }],
      totalAgents: 1,
      peakConcurrency: 1,
    },
    riskAssessment: overrides.riskAssessment ?? {
      risks: [{ id: 'r1', description: 'Delay risk', level: 'low', probability: 0.2, impact: 0.3, mitigation: 'Buffer time' }],
      overallRiskLevel: 'low',
    },
    costBudget: overrides.costBudget ?? {
      totalBudget: 100,
      missionCosts: { m1: 100 },
      taskCosts: { t1: 50 },
      agentCosts: { coder: 80 },
      modelCosts: { 'gpt-4': 20 },
      currency: 'USD',
    },
    contingencyPlan: overrides.contingencyPlan ?? {
      alternatives: [{ id: 'alt1', description: 'Fallback', trigger: 'delay > 2d', action: 'Add resources', estimatedImpact: 'minor' }],
      degradationStrategies: ['Reduce scope'],
      rollbackPlan: 'Revert to previous version',
    },
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: overrides.updatedAt ?? 1000,
  };
}

describe('TemplateManager', () => {
  let manager: TemplateManager;

  beforeEach(() => {
    const dir = dirname(TEST_TEMPLATE_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    manager = new TemplateManager(TEST_TEMPLATE_PATH);
  });

  afterEach(() => {
    const dir = dirname(TEST_TEMPLATE_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('save()', () => {
    it('should save a plan as a template with correct fields', () => {
      const plan = makePlan();
      const template = manager.save(plan, 'My Template', 'A test template', 'user-1');

      expect(template.templateId).toBeTruthy();
      expect(template.name).toBe('My Template');
      expect(template.description).toBe('A test template');
      expect(template.createdBy).toBe('user-1');
      expect(template.version).toBe(1);
      expect(template.versions).toHaveLength(1);
      expect(template.versions[0].version).toBe(1);
      expect(template.versions[0].createdBy).toBe('user-1');
    });

    it('should strip planId, commandId, status, createdAt, updatedAt from the stored plan', () => {
      const plan = makePlan({ planId: 'p-123', commandId: 'c-456', status: 'approved', createdAt: 9999, updatedAt: 8888 });
      const template = manager.save(plan, 'Stripped', 'desc', 'user-1');

      const storedPlan = template.plan as Record<string, unknown>;
      expect(storedPlan).not.toHaveProperty('planId');
      expect(storedPlan).not.toHaveProperty('commandId');
      expect(storedPlan).not.toHaveProperty('status');
      expect(storedPlan).not.toHaveProperty('createdAt');
      expect(storedPlan).not.toHaveProperty('updatedAt');
    });

    it('should preserve plan core structure (missions, tasks, timeline, etc.)', () => {
      const plan = makePlan();
      const template = manager.save(plan, 'Core', 'desc', 'user-1');

      expect(template.plan.missions).toEqual(plan.missions);
      expect(template.plan.tasks).toEqual(plan.tasks);
      expect(template.plan.timeline).toEqual(plan.timeline);
      expect(template.plan.resourceAllocation).toEqual(plan.resourceAllocation);
      expect(template.plan.riskAssessment).toEqual(plan.riskAssessment);
      expect(template.plan.costBudget).toEqual(plan.costBudget);
      expect(template.plan.contingencyPlan).toEqual(plan.contingencyPlan);
    });
  });

  describe('load() by templateId', () => {
    it('should load a saved template by ID', () => {
      const plan = makePlan();
      const saved = manager.save(plan, 'Loadable', 'desc', 'user-1');

      const loaded = manager.load(saved.templateId);
      expect(loaded).toBeDefined();
      expect(loaded!.templateId).toBe(saved.templateId);
      expect(loaded!.plan).toEqual(saved.plan);
    });

    it('should return undefined for non-existent templateId', () => {
      const loaded = manager.load('nonexistent-id');
      expect(loaded).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('should return all templates when no filter', () => {
      manager.save(makePlan(), 'T1', 'd1', 'alice');
      manager.save(makePlan(), 'T2', 'd2', 'bob');

      const all = manager.list();
      expect(all).toHaveLength(2);
    });

    it('should filter by createdBy', () => {
      manager.save(makePlan(), 'T1', 'd1', 'alice');
      manager.save(makePlan(), 'T2', 'd2', 'bob');
      manager.save(makePlan(), 'T3', 'd3', 'alice');

      const aliceTemplates = manager.list('alice');
      expect(aliceTemplates).toHaveLength(2);
      expect(aliceTemplates.every((t) => t.createdBy === 'alice')).toBe(true);
    });

    it('should return empty array when no templates match', () => {
      manager.save(makePlan(), 'T1', 'd1', 'alice');
      const result = manager.list('nonexistent');
      expect(result).toHaveLength(0);
    });

    it('should return empty array when no templates exist', () => {
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe('update()', () => {
    it('should increment version number', () => {
      const saved = manager.save(makePlan(), 'T1', 'v1 desc', 'user-1');
      expect(saved.version).toBe(1);

      const updated = manager.update(saved.templateId, makePlan({ planId: 'p-new' }), 'v2 desc', 'user-2');
      expect(updated.version).toBe(2);
    });

    it('should preserve previous version in versions array', () => {
      const saved = manager.save(makePlan(), 'T1', 'v1 desc', 'user-1');
      const updated = manager.update(saved.templateId, makePlan(), 'v2 desc', 'user-2');

      expect(updated.versions).toHaveLength(2);
      expect(updated.versions[0].version).toBe(1);
      expect(updated.versions[0].createdBy).toBe('user-1');
      expect(updated.versions[1].version).toBe(2);
      expect(updated.versions[1].createdBy).toBe('user-2');
    });

    it('should update the plan content', () => {
      const plan1 = makePlan({ missions: [{ missionId: 'm-old', title: 'Old', description: 'old', objectives: [], constraints: [], estimatedDuration: 10, estimatedCost: 10, priority: 'low' }] });
      const saved = manager.save(plan1, 'T1', 'v1', 'user-1');

      const plan2 = makePlan({ missions: [{ missionId: 'm-new', title: 'New', description: 'new', objectives: [], constraints: [], estimatedDuration: 20, estimatedCost: 20, priority: 'high' }] });
      const updated = manager.update(saved.templateId, plan2, 'v2', 'user-2');

      expect(updated.plan.missions[0].missionId).toBe('m-new');
    });

    it('should update description', () => {
      const saved = manager.save(makePlan(), 'T1', 'old desc', 'user-1');
      const updated = manager.update(saved.templateId, makePlan(), 'new desc', 'user-2');
      expect(updated.description).toBe('new desc');
    });

    it('should update updatedAt timestamp', () => {
      const saved = manager.save(makePlan(), 'T1', 'desc', 'user-1');
      const updated = manager.update(saved.templateId, makePlan(), 'desc2', 'user-2');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(saved.updatedAt);
    });

    it('should throw for non-existent templateId', () => {
      expect(() => manager.update('nonexistent', makePlan(), 'desc', 'user-1')).toThrow('Template not found');
    });

    it('should support multiple sequential updates', () => {
      const saved = manager.save(makePlan(), 'T1', 'v1', 'user-1');
      const v2 = manager.update(saved.templateId, makePlan(), 'v2', 'user-2');
      const v3 = manager.update(saved.templateId, makePlan(), 'v3', 'user-3');

      expect(v3.version).toBe(3);
      expect(v3.versions).toHaveLength(3);
      expect(v3.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    });
  });

  describe('persistence', () => {
    it('should persist templates across instances', () => {
      const saved = manager.save(makePlan(), 'Persistent', 'desc', 'user-1');

      const manager2 = new TemplateManager(TEST_TEMPLATE_PATH);
      const loaded = manager2.load(saved.templateId);
      expect(loaded).toBeDefined();
      expect(loaded!.name).toBe('Persistent');
      expect(loaded!.plan).toEqual(saved.plan);
    });

    it('should persist updates across instances', () => {
      const saved = manager.save(makePlan(), 'T1', 'v1', 'user-1');
      manager.update(saved.templateId, makePlan(), 'v2', 'user-2');

      const manager2 = new TemplateManager(TEST_TEMPLATE_PATH);
      const loaded = manager2.load(saved.templateId);
      expect(loaded!.version).toBe(2);
      expect(loaded!.versions).toHaveLength(2);
    });
  });
});
