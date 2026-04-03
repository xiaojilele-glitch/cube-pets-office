// Feature: nl-command-center, Property 22: report structure completeness and format correctness
// **Validates: Requirements 13.1, 13.2**

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
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { ReportGenerator } from '../../core/nl-command/report-generator.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_report_prop__/nl-audit.json');

function cleanup() {
  const dir = dirname(TEST_AUDIT_PATH);
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

/** Build a random but structurally valid NLExecutionPlan. */
const planArb: fc.Arbitrary<NLExecutionPlan> = fc
  .record({
    missions: fc.array(missionArb, { minLength: 0, maxLength: 4 }),
    tasks: fc.array(taskArb, { minLength: 0, maxLength: 6 }),
    risks: fc.array(riskArb, { minLength: 0, maxLength: 3 }),
    overallRiskLevel: riskLevelArb,
    planStatus: fc.constantFrom(
      'draft' as const, 'pending_approval' as const, 'approved' as const,
      'executing' as const, 'completed' as const, 'failed' as const,
    ),
  })
  .map(({ missions, tasks, risks, overallRiskLevel, planStatus }) => {
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
      planId: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      commandId: `cmd-${Date.now()}`,
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

describe('Property 22: report structure completeness and format correctness', () => {
  let auditTrail: AuditTrail;
  let generator: ReportGenerator;

  beforeEach(() => {
    cleanup();
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    generator = new ReportGenerator({ auditTrail });
  });

  afterEach(() => { cleanup(); });

  it('report SHALL contain non-empty summary, progressAnalysis, costAnalysis, and riskAnalysis', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const report = generator.generate(plan);

        expect(report.reportId).toBeTruthy();
        expect(report.planId).toBe(plan.planId);
        expect(typeof report.summary).toBe('string');
        expect(report.summary.length).toBeGreaterThan(0);

        // progressAnalysis structure
        expect(report.progressAnalysis).toBeDefined();
        expect(typeof report.progressAnalysis.totalMissions).toBe('number');
        expect(typeof report.progressAnalysis.completedMissions).toBe('number');
        expect(typeof report.progressAnalysis.totalTasks).toBe('number');
        expect(typeof report.progressAnalysis.completedTasks).toBe('number');
        expect(typeof report.progressAnalysis.overallProgress).toBe('number');
        expect(Array.isArray(report.progressAnalysis.delayedItems)).toBe(true);
        expect(Array.isArray(report.progressAnalysis.onTrackItems)).toBe(true);

        // costAnalysis structure
        expect(report.costAnalysis).toBeDefined();
        expect(typeof report.costAnalysis.plannedCost).toBe('number');
        expect(typeof report.costAnalysis.actualCost).toBe('number');
        expect(typeof report.costAnalysis.variance).toBe('number');
        expect(typeof report.costAnalysis.variancePercentage).toBe('number');

        // riskAnalysis structure
        expect(report.riskAnalysis).toBeDefined();
        expect(Array.isArray(report.riskAnalysis.risks)).toBe(true);
        expect(['low', 'medium', 'high', 'critical']).toContain(report.riskAnalysis.overallRiskLevel);

        expect(typeof report.generatedAt).toBe('number');
        expect(report.generatedAt).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('JSON export SHALL be valid JSON that round-trips back to the report', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const report = generator.generate(plan);
        const json = generator.export(report, 'json');

        // Must be valid JSON
        const parsed = JSON.parse(json);
        expect(parsed.reportId).toBe(report.reportId);
        expect(parsed.planId).toBe(report.planId);
        expect(parsed.summary).toBe(report.summary);
        expect(parsed.progressAnalysis).toBeDefined();
        expect(parsed.costAnalysis).toBeDefined();
        expect(parsed.riskAnalysis).toBeDefined();
      }),
      { numRuns: 20 },
    );
  });

  it('Markdown export SHALL contain section headers for each analysis area', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const report = generator.generate(plan);
        const md = generator.export(report, 'markdown');

        expect(md).toContain('## Summary');
        expect(md).toContain('## Progress Analysis');
        expect(md).toContain('## Cost Analysis');
        expect(md).toContain('## Risk Analysis');
        // Should also contain the report ID and plan ID
        expect(md).toContain(report.reportId);
        expect(md).toContain(report.planId);
      }),
      { numRuns: 20 },
    );
  });

  it('progressAnalysis mission/task counts SHALL match plan input', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const report = generator.generate(plan);

        expect(report.progressAnalysis.totalMissions).toBe(plan.missions.length);
        expect(report.progressAnalysis.totalTasks).toBe(plan.tasks.length);
        expect(report.progressAnalysis.completedMissions).toBeLessThanOrEqual(plan.missions.length);
        expect(report.progressAnalysis.completedTasks).toBeLessThanOrEqual(plan.tasks.length);
        expect(report.progressAnalysis.overallProgress).toBeGreaterThanOrEqual(0);
        expect(report.progressAnalysis.overallProgress).toBeLessThanOrEqual(1);
      }),
      { numRuns: 20 },
    );
  });
});
