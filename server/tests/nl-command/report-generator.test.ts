import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NLExecutionPlan } from '../../../shared/nl-command/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { ReportGenerator } from '../../core/nl-command/report-generator.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_report_gen__/nl-audit.json');

function cleanup() {
  const dir = dirname(TEST_AUDIT_PATH);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Build a minimal NLExecutionPlan for testing. */
function makePlan(overrides: Partial<NLExecutionPlan> = {}): NLExecutionPlan {
  return {
    planId: overrides.planId ?? 'plan-1',
    commandId: 'cmd-1',
    status: overrides.status ?? 'completed',
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
      criticalPath: ['t1', 't2'], milestones: [],
      entries: [
        { entityId: 't1', entityType: 'task', startTime: 0, endTime: 30, duration: 30, isCriticalPath: true },
        { entityId: 't2', entityType: 'task', startTime: 30, endTime: 60, duration: 30, isCriticalPath: true },
      ],
    },
    resourceAllocation: { entries: [], totalAgents: 2, peakConcurrency: 1 },
    riskAssessment: {
      risks: [{ id: 'r1', description: 'Tight deadline', level: 'high', probability: 0.7, impact: 0.8, mitigation: 'Add buffer' }],
      overallRiskLevel: 'high',
    },
    costBudget: {
      totalBudget: 100,
      missionCosts: { m1: 100 },
      taskCosts: overrides.costBudget?.taskCosts ?? { t1: 50, t2: 50 },
      agentCosts: { 'agent-a': 40 },
      modelCosts: { 'gpt-4': 60 },
      currency: 'USD',
    },
    contingencyPlan: { alternatives: [], degradationStrategies: [], rollbackPlan: 'rollback' },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}


describe('ReportGenerator', () => {
  let auditTrail: AuditTrail;
  let generator: ReportGenerator;

  beforeEach(() => {
    cleanup();
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    generator = new ReportGenerator({ auditTrail });
  });

  afterEach(() => { cleanup(); });

  // ─── generate() ───

  describe('generate()', () => {
    it('should produce a report with non-empty summary, progressAnalysis, costAnalysis, riskAnalysis (Property 22)', () => {
      const report = generator.generate(makePlan());

      expect(report.reportId).toBeTruthy();
      expect(report.planId).toBe('plan-1');
      expect(report.summary.length).toBeGreaterThan(0);
      expect(report.progressAnalysis).toBeDefined();
      expect(report.costAnalysis).toBeDefined();
      expect(report.riskAnalysis).toBeDefined();
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('should compute correct progress for a completed plan', () => {
      const report = generator.generate(makePlan({ status: 'completed' }));

      expect(report.progressAnalysis.totalMissions).toBe(1);
      expect(report.progressAnalysis.completedMissions).toBe(1);
      expect(report.progressAnalysis.totalTasks).toBe(2);
      expect(report.progressAnalysis.completedTasks).toBe(2);
      expect(report.progressAnalysis.overallProgress).toBe(1);
    });

    it('should compute zero progress for a draft plan', () => {
      const report = generator.generate(makePlan({ status: 'draft' }));

      expect(report.progressAnalysis.completedMissions).toBe(0);
      expect(report.progressAnalysis.completedTasks).toBe(0);
      expect(report.progressAnalysis.overallProgress).toBe(0);
    });

    it('should compute cost analysis with Property 23 invariant: variance = actualCost - plannedCost', () => {
      const plan = makePlan({
        costBudget: {
          totalBudget: 100,
          missionCosts: { m1: 100 },
          taskCosts: { t1: 70, t2: 80 }, // actual = 150
          agentCosts: {}, modelCosts: {}, currency: 'USD',
        },
      });
      const report = generator.generate(plan);
      const cost = report.costAnalysis;

      expect(cost.plannedCost).toBe(100);
      expect(cost.actualCost).toBe(150);
      // Property 23: variance = actualCost - plannedCost
      expect(cost.variance).toBe(150 - 100);
      // Property 23: variancePercentage = variance / plannedCost * 100
      expect(cost.variancePercentage).toBe((50 / 100) * 100);
    });

    it('should handle zero planned cost without division error', () => {
      const plan: NLExecutionPlan = {
        ...makePlan(),
        costBudget: {
          totalBudget: 0,
          missionCosts: {},
          taskCosts: {},
          agentCosts: {}, modelCosts: {}, currency: 'USD',
        },
      };
      const report = generator.generate(plan);

      expect(report.costAnalysis.plannedCost).toBe(0);
      expect(report.costAnalysis.actualCost).toBe(0);
      expect(report.costAnalysis.variance).toBe(0);
      expect(report.costAnalysis.variancePercentage).toBe(0);
    });

    it('should extract risk analysis from plan', () => {
      const report = generator.generate(makePlan());

      expect(report.riskAnalysis.overallRiskLevel).toBe('high');
      expect(report.riskAnalysis.risks).toHaveLength(1);
      expect(report.riskAnalysis.risks[0].description).toBe('Tight deadline');
    });

    it('should filter sections when specified', () => {
      const report = generator.generate(makePlan(), ['progress']);

      // Progress should be populated
      expect(report.progressAnalysis.totalMissions).toBe(1);
      // Cost and risk should be empty defaults
      expect(report.costAnalysis.plannedCost).toBe(0);
      expect(report.riskAnalysis.risks).toHaveLength(0);
    });

    it('should store report in internal map', () => {
      const report = generator.generate(makePlan());

      const retrieved = generator.getReport(report.reportId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.reportId).toBe(report.reportId);
    });

    it('should handle plan with no missions or tasks', () => {
      const plan = makePlan({ missions: [], tasks: [] });
      const report = generator.generate(plan);

      expect(report.progressAnalysis.totalMissions).toBe(0);
      expect(report.progressAnalysis.totalTasks).toBe(0);
      expect(report.progressAnalysis.overallProgress).toBe(0);
    });
  });

  // ─── export() ───

  describe('export()', () => {
    it('should export valid JSON (Property 22)', () => {
      const report = generator.generate(makePlan());
      const json = generator.export(report, 'json');

      const parsed = JSON.parse(json);
      expect(parsed.reportId).toBe(report.reportId);
      expect(parsed.planId).toBe('plan-1');
      expect(parsed.summary).toBe(report.summary);
    });

    it('should export Markdown with section headers (Property 22)', () => {
      const report = generator.generate(makePlan());
      const md = generator.export(report, 'markdown');

      expect(md).toContain('# Execution Report:');
      expect(md).toContain('## Summary');
      expect(md).toContain('## Progress Analysis');
      expect(md).toContain('## Cost Analysis');
      expect(md).toContain('## Risk Analysis');
    });

    it('should include report data in Markdown output', () => {
      const report = generator.generate(makePlan());
      const md = generator.export(report, 'markdown');

      expect(md).toContain(report.reportId);
      expect(md).toContain('plan-1');
      expect(md).toContain('Tight deadline');
      expect(md).toContain('Overall Risk Level: high');
    });
  });

  // ─── compare() ───

  describe('compare()', () => {
    it('should compute correct deltas between two reports', () => {
      const plan1 = makePlan({ status: 'draft' });
      const plan2 = makePlan({ status: 'completed' });

      const report1 = generator.generate(plan1);
      const report2 = generator.generate(plan2);
      const comparison = generator.compare(report1, report2);

      expect(comparison.planId).toBe('plan-1');
      expect(comparison.report1Id).toBe(report1.reportId);
      expect(comparison.report2Id).toBe(report2.reportId);

      // Draft: 0 completed, Completed: 2 completed tasks
      expect(comparison.progressDiff.completedTasksDelta).toBe(2);
      expect(comparison.progressDiff.completedMissionsDelta).toBe(1);
      expect(comparison.progressDiff.overallProgressDelta).toBe(1); // 0 → 1
    });

    it('should detect risk level changes', () => {
      const planLow: NLExecutionPlan = {
        ...makePlan(),
        riskAssessment: { risks: [], overallRiskLevel: 'low' },
      };
      const planHigh: NLExecutionPlan = {
        ...makePlan(),
        riskAssessment: {
          risks: [{ id: 'r1', description: 'Critical', level: 'critical', probability: 0.9, impact: 0.9, mitigation: 'none' }],
          overallRiskLevel: 'critical',
        },
      };

      const report1 = generator.generate(planLow);
      const report2 = generator.generate(planHigh);
      const comparison = generator.compare(report1, report2);

      expect(comparison.riskDiff.riskLevelChanged).toBe(true);
      expect(comparison.riskDiff.report1RiskLevel).toBe('low');
      expect(comparison.riskDiff.report2RiskLevel).toBe('critical');
    });

    it('should compute cost deltas correctly', () => {
      const plan1: NLExecutionPlan = {
        ...makePlan(),
        costBudget: {
          totalBudget: 100, missionCosts: { m1: 100 },
          taskCosts: { t1: 50, t2: 50 }, // actual = 100
          agentCosts: {}, modelCosts: {}, currency: 'USD',
        },
      };
      const plan2: NLExecutionPlan = {
        ...makePlan(),
        costBudget: {
          totalBudget: 200, missionCosts: { m1: 200 },
          taskCosts: { t1: 120, t2: 130 }, // actual = 250
          agentCosts: {}, modelCosts: {}, currency: 'USD',
        },
      };

      const report1 = generator.generate(plan1);
      const report2 = generator.generate(plan2);
      const comparison = generator.compare(report1, report2);

      expect(comparison.costDiff.plannedCostDelta).toBe(100); // 200 - 100
      expect(comparison.costDiff.actualCostDelta).toBe(150);  // 250 - 100
    });

    it('should show no changes when comparing identical reports', () => {
      const plan = makePlan();
      const report1 = generator.generate(plan);
      const report2 = generator.generate(plan);
      const comparison = generator.compare(report1, report2);

      expect(comparison.progressDiff.overallProgressDelta).toBe(0);
      expect(comparison.costDiff.plannedCostDelta).toBe(0);
      expect(comparison.costDiff.actualCostDelta).toBe(0);
      expect(comparison.riskDiff.riskLevelChanged).toBe(false);
    });
  });

  // ─── getReport() ───

  describe('getReport()', () => {
    it('should return undefined for unknown report ID', () => {
      expect(generator.getReport('nonexistent')).toBeUndefined();
    });
  });
});
