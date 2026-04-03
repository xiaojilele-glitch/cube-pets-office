/**
 * Property-based tests for SkillMonitor
 *
 * Properties tested:
 *  18 — 性能指标记录往返
 *  19 — 指标聚合正确性
 *  20 — 告警阈值触发
 */

import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';

import type { SkillExecutionMetrics } from '../../shared/skill-contracts.js';
import { SkillMonitor } from '../core/skill-monitor.js';

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let metrics: SkillExecutionMetrics[] = [];

  return {
    getSkillMetrics: (skillId: string) =>
      metrics.filter(m => m.skillId === skillId),
    createSkillMetric: (m: SkillExecutionMetrics) => {
      metrics.push(m);
    },
    _reset: () => { metrics = []; },
  };
}

/* ─── Arbitraries ─── */

const arbId = fc
  .string({ minLength: 1, maxLength: 16 })
  .map(s => s.replace(/[^a-z0-9-]/gi, 'a').toLowerCase().slice(0, 16) || 'sk');

const arbVersion = fc
  .tuple(fc.nat({ max: 10 }), fc.nat({ max: 10 }), fc.nat({ max: 10 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

const arbRole = fc.constantFrom('coder', 'reviewer', 'planner', 'tester');
const arbTaskType = fc.constantFrom('code', 'review', 'plan', 'test', 'debug');

/** Generate a valid SkillExecutionMetrics record */
function makeMetrics(
  skillId: string,
  overrides: Partial<SkillExecutionMetrics> = {},
): SkillExecutionMetrics {
  return {
    skillId,
    version: '1.0.0',
    workflowId: 'wf-1',
    agentId: 'agent-1',
    agentRole: 'coder',
    taskType: 'code',
    activationTimeMs: 10,
    executionTimeMs: 100,
    tokenCount: 500,
    success: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const arbMetrics = (skillId: string) =>
  fc.record({
    skillId: fc.constant(skillId),
    version: arbVersion,
    workflowId: fc.constant('wf-1'),
    agentId: fc.constant('agent-1'),
    agentRole: arbRole,
    taskType: arbTaskType,
    activationTimeMs: fc.nat({ max: 5000 }),
    executionTimeMs: fc.nat({ max: 30000 }),
    tokenCount: fc.nat({ max: 10000 }),
    success: fc.boolean(),
    timestamp: fc.constant(new Date().toISOString()),
  });


/* ─── Property 18: 性能指标记录往返 ─── */
/* **Validates: Requirements 7.1, 7.2** */

describe('Feature: plugin-skill-system, Property 18: 性能指标记录往返', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let monitor: SkillMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    monitor = new SkillMonitor(db as any);
  });

  it('recordMetrics then getSkillMetrics returns data including the recorded metric', () => {
    fc.assert(
      fc.property(
        arbId,
        arbVersion,
        arbRole,
        arbTaskType,
        fc.nat({ max: 5000 }),
        fc.nat({ max: 30000 }),
        fc.nat({ max: 10000 }),
        fc.boolean(),
        (skillId, version, role, taskType, actMs, execMs, tokens, success) => {
          db._reset();

          const metrics = makeMetrics(skillId, {
            version,
            agentRole: role,
            taskType,
            activationTimeMs: actMs,
            executionTimeMs: execMs,
            tokenCount: tokens,
            success,
          });

          monitor.recordMetrics(metrics);

          const agg = monitor.getSkillMetrics(skillId);

          expect(agg.skillId).toBe(skillId);
          expect(agg.totalExecutions).toBe(1);
          expect(agg.successCount).toBe(success ? 1 : 0);
          expect(agg.failureCount).toBe(success ? 0 : 1);
          expect(agg.avgActivationTimeMs).toBe(actMs);
          expect(agg.avgExecutionTimeMs).toBe(execMs);
          expect(agg.totalTokenCount).toBe(tokens);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('multiple records are all reflected in aggregated metrics', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.array(fc.tuple(fc.nat({ max: 5000 }), fc.nat({ max: 10000 }), fc.boolean()), {
          minLength: 1,
          maxLength: 10,
        }),
        (skillId, records) => {
          db._reset();

          for (const [execMs, tokens, success] of records) {
            monitor.recordMetrics(makeMetrics(skillId, {
              executionTimeMs: execMs,
              tokenCount: tokens,
              success,
            }));
          }

          const agg = monitor.getSkillMetrics(skillId);

          expect(agg.totalExecutions).toBe(records.length);

          const expectedSuccesses = records.filter(([, , s]) => s).length;
          expect(agg.successCount).toBe(expectedSuccesses);
          expect(agg.failureCount).toBe(records.length - expectedSuccesses);

          const expectedTokens = records.reduce((sum, [, t]) => sum + t, 0);
          expect(agg.totalTokenCount).toBe(expectedTokens);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 19: 指标聚合正确性 ─── */
/* **Validates: Requirements 7.3** */

describe('Feature: plugin-skill-system, Property 19: 指标聚合正确性', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let monitor: SkillMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    monitor = new SkillMonitor(db as any);
  });

  it('byVersion groups correctly reflect per-version counts and success rates', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.array(
          fc.tuple(arbVersion, fc.boolean()),
          { minLength: 1, maxLength: 12 },
        ),
        (skillId, records) => {
          db._reset();

          // Track expected counts
          const expected: Record<string, { count: number; successes: number }> = {};

          for (const [version, success] of records) {
            monitor.recordMetrics(makeMetrics(skillId, { version, success }));
            if (!expected[version]) expected[version] = { count: 0, successes: 0 };
            expected[version].count++;
            if (success) expected[version].successes++;
          }

          const agg = monitor.getSkillMetrics(skillId);

          for (const [ver, exp] of Object.entries(expected)) {
            expect(agg.byVersion[ver]).toBeDefined();
            expect(agg.byVersion[ver].count).toBe(exp.count);

            const expectedRate = exp.count > 0 ? exp.successes / exp.count : 0;
            expect(agg.byVersion[ver].successRate).toBeCloseTo(expectedRate, 5);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('byAgentRole groups correctly reflect per-role counts and success rates', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.array(
          fc.tuple(arbRole, fc.boolean()),
          { minLength: 1, maxLength: 12 },
        ),
        (skillId, records) => {
          db._reset();

          const expected: Record<string, { count: number; successes: number }> = {};

          for (const [role, success] of records) {
            monitor.recordMetrics(makeMetrics(skillId, { agentRole: role, success }));
            if (!expected[role]) expected[role] = { count: 0, successes: 0 };
            expected[role].count++;
            if (success) expected[role].successes++;
          }

          const agg = monitor.getSkillMetrics(skillId);

          for (const [role, exp] of Object.entries(expected)) {
            expect(agg.byAgentRole[role]).toBeDefined();
            expect(agg.byAgentRole[role].count).toBe(exp.count);

            const expectedRate = exp.count > 0 ? exp.successes / exp.count : 0;
            expect(agg.byAgentRole[role].successRate).toBeCloseTo(expectedRate, 5);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('byTaskType groups correctly reflect per-taskType counts and success rates', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.array(
          fc.tuple(arbTaskType, fc.boolean()),
          { minLength: 1, maxLength: 12 },
        ),
        (skillId, records) => {
          db._reset();

          const expected: Record<string, { count: number; successes: number }> = {};

          for (const [taskType, success] of records) {
            monitor.recordMetrics(makeMetrics(skillId, { taskType, success }));
            if (!expected[taskType]) expected[taskType] = { count: 0, successes: 0 };
            expected[taskType].count++;
            if (success) expected[taskType].successes++;
          }

          const agg = monitor.getSkillMetrics(skillId);

          for (const [tt, exp] of Object.entries(expected)) {
            expect(agg.byTaskType[tt]).toBeDefined();
            expect(agg.byTaskType[tt].count).toBe(exp.count);

            const expectedRate = exp.count > 0 ? exp.successes / exp.count : 0;
            expect(agg.byTaskType[tt].successRate).toBeCloseTo(expectedRate, 5);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 20: 告警阈值触发 ─── */
/* **Validates: Requirements 7.4** */

describe('Feature: plugin-skill-system, Property 20: 告警阈值触发', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let monitor: SkillMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    monitor = new SkillMonitor(db as any);
  });

  it('checkAlerts returns alert when failure rate exceeds threshold', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.integer({ min: 1, max: 20 }),
        fc.float({ min: Math.fround(0.1), max: Math.fround(0.9), noNaN: true }),
        (skillId, totalCount, threshold) => {
          db._reset();

          // Create enough failures to exceed threshold
          const failCount = Math.ceil(totalCount * threshold) + 1;
          const successCount = Math.max(0, totalCount - failCount);

          for (let i = 0; i < failCount; i++) {
            monitor.recordMetrics(makeMetrics(skillId, { success: false }));
          }
          for (let i = 0; i < successCount; i++) {
            monitor.recordMetrics(makeMetrics(skillId, { success: true }));
          }

          const actualTotal = failCount + successCount;
          const actualFailRate = failCount / actualTotal;

          // Only assert if failure rate truly exceeds threshold
          if (actualFailRate > threshold) {
            const alert = monitor.checkAlerts(skillId, threshold, 60 * 60 * 1000);
            expect(alert).not.toBeNull();
            expect(alert!.skillId).toBe(skillId);
            expect(alert!.alertType).toBe('high_failure_rate');
            expect(alert!.currentRate).toBeCloseTo(actualFailRate, 5);
            expect(alert!.threshold).toBe(threshold);
            expect(typeof alert!.timestamp).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkAlerts returns null when failure rate is below threshold', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.integer({ min: 2, max: 20 }),
        (skillId, totalCount) => {
          db._reset();

          // All successes — failure rate is 0
          for (let i = 0; i < totalCount; i++) {
            monitor.recordMetrics(makeMetrics(skillId, { success: true }));
          }

          const alert = monitor.checkAlerts(skillId, 0.5, 60 * 60 * 1000);
          expect(alert).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkAlerts returns null when no metrics exist', () => {
    fc.assert(
      fc.property(
        arbId,
        (skillId) => {
          db._reset();
          const alert = monitor.checkAlerts(skillId, 0.5, 60 * 60 * 1000);
          expect(alert).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
