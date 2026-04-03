// Feature: nl-command-center, Property 24: deviation detection correctness
// **Validates: Requirements 8.2**

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type {
  CostBudget,
  NLExecutionPlan,
  TimelineEntry,
} from '../../../shared/nl-command/contracts.js';
import {
  PlanAdjustmentManager,
  type ActualProgress,
} from '../../core/nl-command/plan-adjustment.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_deviation_prop__/nl-audit.json');

// --- Helpers ---

function makeBasePlan(overrides: {
  timelineEntries: TimelineEntry[];
  costBudget: CostBudget;
}): NLExecutionPlan {
  return {
    planId: 'plan-1',
    commandId: 'cmd-1',
    status: 'executing',
    missions: [],
    tasks: [],
    timeline: {
      startDate: '',
      endDate: '',
      criticalPath: [],
      milestones: [],
      entries: overrides.timelineEntries,
    },
    resourceAllocation: { entries: [], totalAgents: 0, peakConcurrency: 0 },
    riskAssessment: { risks: [], overallRiskLevel: 'low' },
    costBudget: overrides.costBudget,
    contingencyPlan: { alternatives: [], degradationStrategies: [], rollbackPlan: '' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// --- Generators ---

/** Generate a timeline entry with a valid time range around "now". */
const timelineEntryArb = (now: number) =>
  fc
    .record({
      entityId: fc.stringMatching(/^[a-z]-[0-9]{1,3}$/),
      // offset from now in ms: -2h to +2h
      startOffset: fc.integer({ min: -7_200_000, max: 7_200_000 }),
      duration: fc.integer({ min: 1_000, max: 7_200_000 }),
      isCriticalPath: fc.boolean(),
    })
    .map(({ entityId, startOffset, duration, isCriticalPath }) => ({
      entityId,
      entityType: 'task' as const,
      startTime: now + startOffset,
      endTime: now + startOffset + duration,
      duration,
      isCriticalPath,
    }));

/** Generate 1..5 unique timeline entries. */
const timelineEntriesArb = (now: number) =>
  fc
    .uniqueArray(timelineEntryArb(now), {
      minLength: 1,
      maxLength: 5,
      selector: (e) => e.entityId,
    });

/** Generate a progress value between 0 and 1. */
const progressArb = fc.double({ min: 0, max: 1, noNaN: true });

/** Generate a non-negative cost value. */
const costArb = fc.double({ min: 0, max: 100_000, noNaN: true });

// --- Tests ---

describe('Property 24: deviation detection correctness', () => {
  let manager: PlanAdjustmentManager;

  function setup() {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    manager = new PlanAdjustmentManager({ auditTrail });
  }

  function cleanup() {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  it('SHALL flag a task as delayed if actual progress < expected progress based on timeline', () => {
    setup();
    try {
      // Use entries clearly in the past (completed) or clearly in the future (not started)
      // to avoid boundary timing issues between test and implementation Date.now() calls.
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.stringMatching(/^[a-z]-[0-9]{1,3}$/), { minLength: 1, maxLength: 5 }),
          fc.infiniteStream(progressArb),
          (entityIds, progressStream) => {
            const now = Date.now();
            const iter = progressStream[Symbol.iterator]();

            // Create entries that are clearly past their endTime (expected progress = 1)
            const entries: TimelineEntry[] = entityIds.map((entityId) => ({
              entityId,
              entityType: 'task' as const,
              startTime: now - 7_200_000, // 2 hours ago
              endTime: now - 3_600_000,   // 1 hour ago
              duration: 3_600_000,
              isCriticalPath: false,
            }));

            const progressMap: Record<string, number> = {};
            for (const entry of entries) {
              progressMap[entry.entityId] = iter.next().value as number;
            }

            const plan = makeBasePlan({
              timelineEntries: entries,
              costBudget: {
                totalBudget: 0, missionCosts: {}, taskCosts: {},
                agentCosts: {}, modelCosts: {}, currency: 'CNY',
              },
            });

            const actual: ActualProgress = { progress: progressMap, costs: {} };
            const result = manager.detectDeviation(plan, actual);

            // All entries are past endTime, so expectedProgress = 1
            // Any actual progress < 1 should be flagged as delayed
            for (const entry of entries) {
              const actualProg = progressMap[entry.entityId] ?? 0;
              if (actualProg < 1) {
                expect(result.delayed).toContain(entry.entityId);
              } else {
                expect(result.delayed).not.toContain(entry.entityId);
              }
            }
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      cleanup();
    }
  });

  it('SHALL flag cost exceeded if actual cost exceeds the budgeted cost', () => {
    setup();
    try {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.stringMatching(/^[a-z]-[0-9]{1,3}$/), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.infiniteStream(costArb),
          fc.infiniteStream(costArb),
          (entityIds, budgetStream, actualStream) => {
            const budgetIter = budgetStream[Symbol.iterator]();
            const actualIter = actualStream[Symbol.iterator]();

            const taskCosts: Record<string, number> = {};
            const actualCosts: Record<string, number> = {};

            for (const id of entityIds) {
              taskCosts[id] = budgetIter.next().value as number;
              actualCosts[id] = actualIter.next().value as number;
            }

            const plan = makeBasePlan({
              timelineEntries: [],
              costBudget: {
                totalBudget: Object.values(taskCosts).reduce((a, b) => a + b, 0),
                missionCosts: {},
                taskCosts,
                agentCosts: {},
                modelCosts: {},
                currency: 'CNY',
              },
            });

            const actual: ActualProgress = { progress: {}, costs: actualCosts };
            const result = manager.detectDeviation(plan, actual);

            for (const id of entityIds) {
              if (actualCosts[id] > taskCosts[id]) {
                expect(result.costExceeded).toContain(id);
              } else {
                expect(result.costExceeded).not.toContain(id);
              }
            }
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      cleanup();
    }
  });

  it('SHALL not flag tasks that have not started yet (expected progress = 0)', () => {
    setup();
    try {
      const now = Date.now();

      fc.assert(
        fc.property(
          fc.uniqueArray(
            fc.record({
              entityId: fc.stringMatching(/^[a-z]-[0-9]{1,3}$/),
              futureOffset: fc.integer({ min: 1_000, max: 7_200_000 }),
              duration: fc.integer({ min: 1_000, max: 7_200_000 }),
            }),
            { minLength: 1, maxLength: 5, selector: (e) => e.entityId },
          ),
          (futureEntries) => {
            const entries: TimelineEntry[] = futureEntries.map((e) => ({
              entityId: e.entityId,
              entityType: 'task' as const,
              startTime: now + e.futureOffset,
              endTime: now + e.futureOffset + e.duration,
              duration: e.duration,
              isCriticalPath: false,
            }));

            // All tasks have 0 progress — matching expected 0
            const progressMap: Record<string, number> = {};
            for (const e of entries) {
              progressMap[e.entityId] = 0;
            }

            const plan = makeBasePlan({
              timelineEntries: entries,
              costBudget: {
                totalBudget: 0,
                missionCosts: {},
                taskCosts: {},
                agentCosts: {},
                modelCosts: {},
                currency: 'CNY',
              },
            });

            const result = manager.detectDeviation(plan, { progress: progressMap, costs: {} });
            expect(result.delayed).toHaveLength(0);
          },
        ),
        { numRuns: 20 },
      );
    } finally {
      cleanup();
    }
  });
});
