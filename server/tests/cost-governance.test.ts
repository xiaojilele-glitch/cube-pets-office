import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { convertCurrency, type Currency } from '../../shared/cost-governance';
import { AuditTrail } from '../core/governance/audit-trail';
import type {
  AuditAction, AuditEntry, BudgetLevel, BudgetTemplate,
  AlertThresholdConfig, BudgetPeriod, MissionBudget, AlertResponseStrategy,
} from '../../shared/cost-governance';
import { BudgetManager } from '../core/governance/budget-manager';
import { DEFAULT_BUDGET_TEMPLATES, DOWNGRADE_CHAIN } from '../../shared/cost-governance';
import { AlertManager, DEFAULT_ALERT_THRESHOLDS } from '../core/governance/alert-manager';
import { ModelDowngradeManager } from '../core/governance/downgrade-manager';

// Feature: cost-governance-strategy, Property 1: 币种转换往返一致性
// **Validates: Requirements 1.4**

describe('Property 1: 币种转换往返一致性', () => {
  const arbCurrency: fc.Arbitrary<Currency> = fc.constantFrom('USD', 'CNY');

  it('round-trip conversion should return the original amount within floating-point precision', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        arbCurrency,
        arbCurrency,
        (amount, from, to) => {
          const converted = convertCurrency(amount, from, to);
          const roundTrip = convertCurrency(converted, to, from);
          expect(roundTrip).toBeCloseTo(amount, 8);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 6: 审计链完整性
// **Validates: Requirements 3.5, 4.4, 4.7, 5.6, 6.7, 7.5, 14.5**

describe('Property 6: 审计链完整性', () => {
  const ALL_AUDIT_ACTIONS: AuditAction[] = [
    'ALERT_TRIGGERED', 'DOWNGRADE_APPLIED', 'DOWNGRADE_ROLLED_BACK',
    'CONCURRENCY_LIMITED', 'RATE_LIMITED', 'TASK_PAUSED', 'TASK_RESUMED',
    'APPROVAL_REQUESTED', 'APPROVAL_RESOLVED', 'OPTIMIZATION_APPLIED',
    'BUDGET_CREATED', 'BUDGET_MODIFIED', 'PERMISSION_CHANGED',
  ];

  const arbAuditAction: fc.Arbitrary<AuditAction> = fc.constantFrom(...ALL_AUDIT_ACTIONS);

  const arbDetails: fc.Arbitrary<Record<string, unknown>> = fc.record({
    reason: fc.string({ minLength: 1, maxLength: 50 }),
    value: fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.string(), fc.boolean()),
  });

  const arbAuditInput = fc.record({
    action: arbAuditAction,
    missionId: fc.option(fc.uuid(), { nil: undefined }),
    userId: fc.option(fc.uuid(), { nil: undefined }),
    details: arbDetails,
  });

  it('every recorded governance operation should have a corresponding AuditEntry with matching action and details', () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditInput, { minLength: 1, maxLength: 20 }),
        (operations) => {
          const trail = new AuditTrail('/dev/null');
          const recorded: AuditEntry[] = [];
          for (const op of operations) {
            const entry = trail.record(op);
            recorded.push(entry);
          }
          for (const entry of recorded) {
            expect(entry.id).toBeDefined();
            expect(typeof entry.id).toBe('string');
            expect(entry.id.length).toBeGreaterThan(0);
            expect(entry.timestamp).toBeDefined();
            expect(typeof entry.timestamp).toBe('number');
            const byAction = trail.query({ action: entry.action });
            const found = byAction.find((e) => e.id === entry.id);
            expect(found).toBeDefined();
            expect(found!.action).toBe(entry.action);
            const original = operations.find((_, idx) => recorded[idx].id === entry.id)!;
            for (const key of Object.keys(original.details)) {
              expect(entry.details).toHaveProperty(key);
              expect(entry.details[key]).toEqual(original.details[key]);
            }
            if (entry.missionId !== undefined) {
              const byMission = trail.query({ missionId: entry.missionId });
              expect(byMission.some((e) => e.id === entry.id)).toBe(true);
            }
            if (entry.userId !== undefined) {
              const byUser = trail.query({ userId: entry.userId });
              expect(byUser.some((e) => e.id === entry.id)).toBe(true);
            }
          }
          const all = trail.query({});
          expect(all.length).toBe(operations.length);
          const actionCounts = new Map<AuditAction, number>();
          for (const op of operations) {
            actionCounts.set(op.action, (actionCounts.get(op.action) ?? 0) + 1);
          }
          for (const [action, count] of actionCounts) {
            const queried = trail.query({ action });
            expect(queried.length).toBe(count);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 22: 预算层级约束
// **Validates: Requirements 11.1, 11.5**

describe('Property 22: 预算层级约束', () => {
  const CHILD_LEVEL: Record<BudgetLevel, BudgetLevel> = {
    ORGANIZATION: 'DEPARTMENT',
    DEPARTMENT: 'PROJECT',
    PROJECT: 'MISSION',
    MISSION: 'MISSION',
  };
  const arbBudgetLevel = fc.constantFrom<BudgetLevel>('ORGANIZATION', 'DEPARTMENT', 'PROJECT');
  const arbBudget = fc.double({ min: 1, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

  it('sum of children totalBudget should not exceed parent totalBudget after valid creates', () => {
    fc.assert(
      fc.property(
        arbBudgetLevel, arbBudget,
        fc.array(fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 10 }),
        (parentLevel, parentBudget, childFractions) => {
          const mgr = new BudgetManager();
          const parent = mgr.createBudget({ level: parentLevel, name: `parent-${parentLevel}`, totalBudget: parentBudget, usedBudget: 0, currency: 'USD' });
          const childLevel = CHILD_LEVEL[parentLevel];
          let childrenSum = 0;
          for (const frac of childFractions) {
            const childAmount = parentBudget * frac;
            const valid = mgr.validateHierarchy(childAmount, parent.id);
            if (valid) {
              mgr.createBudget({ level: childLevel, name: `child-${childrenSum}`, parentId: parent.id, totalBudget: childAmount, usedBudget: 0, currency: 'USD' });
              childrenSum += childAmount;
            }
            expect(childrenSum).toBeLessThanOrEqual(parentBudget + 1e-9);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('creating a child budget that exceeds remaining parent budget should be rejected', () => {
    fc.assert(
      fc.property(arbBudgetLevel, arbBudget, (parentLevel, parentBudget) => {
        const mgr = new BudgetManager();
        const parent = mgr.createBudget({ level: parentLevel, name: `parent-${parentLevel}`, totalBudget: parentBudget, usedBudget: 0, currency: 'USD' });
        const excessAmount = parentBudget + 0.01;
        const valid = mgr.validateHierarchy(excessAmount, parent.id);
        expect(valid).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('validateHierarchy accounts for already-allocated children budgets', () => {
    fc.assert(
      fc.property(
        arbBudget,
        fc.double({ min: 0.1, max: 0.9, noNaN: true, noDefaultInfinity: true }),
        (parentBudget, firstChildFraction) => {
          const mgr = new BudgetManager();
          const parent = mgr.createBudget({ level: 'ORGANIZATION', name: 'org', totalBudget: parentBudget, usedBudget: 0, currency: 'USD' });
          const firstChildAmount = parentBudget * firstChildFraction;
          expect(mgr.validateHierarchy(firstChildAmount, parent.id)).toBe(true);
          mgr.createBudget({ level: 'DEPARTMENT', name: 'dept-1', parentId: parent.id, totalBudget: firstChildAmount, usedBudget: 0, currency: 'USD' });
          const remaining = parentBudget - firstChildAmount;
          const overRemaining = remaining + 0.01;
          expect(mgr.validateHierarchy(overRemaining, parent.id)).toBe(false);
          if (remaining > 0.001) {
            expect(mgr.validateHierarchy(remaining * 0.5, parent.id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 23: 预算模板实例化
// **Validates: Requirements 11.2**

describe('Property 23: 预算模板实例化', () => {
  const arbBudgetPeriod: fc.Arbitrary<BudgetPeriod> = fc.constantFrom('MISSION', 'DAILY', 'HOURLY');
  const arbAlertThreshold: fc.Arbitrary<AlertThresholdConfig> = fc.record({
    percent: fc.integer({ min: 1, max: 100 }),
    responseStrategy: fc.constantFrom('LOG', 'REDUCE_CONCURRENCY', 'DOWNGRADE_MODEL', 'PAUSE_TASK'),
  });
  const arbBudgetTemplate: fc.Arbitrary<BudgetTemplate> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 30 }),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ minLength: 0, maxLength: 100 }),
    defaultBudget: fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
    defaultTokenBudget: fc.integer({ min: 1, max: 10_000_000 }),
    defaultPeriod: arbBudgetPeriod,
    defaultAlertThresholds: fc.array(arbAlertThreshold, { minLength: 1, maxLength: 6 }),
  });

  it('MissionBudget created from a template should inherit defaultBudget, defaultTokenBudget, defaultPeriod and defaultAlertThresholds', () => {
    fc.assert(
      fc.property(arbBudgetTemplate, fc.uuid(), (_template, missionId) => {
        const mgr = new BudgetManager();
        const templates = mgr.getTemplates();
        expect(templates.length).toBeGreaterThan(0);
        for (const tpl of templates) {
          const budget = mgr.createFromTemplate(tpl.id, missionId);
          expect(budget.costBudget).toBe(tpl.defaultBudget);
          expect(budget.tokenBudget).toBe(tpl.defaultTokenBudget);
          expect(budget.budgetPeriod).toBe(tpl.defaultPeriod);
          expect(budget.alertThresholds).toEqual(tpl.defaultAlertThresholds);
          expect(budget.missionId).toBe(missionId);
          expect(budget.alertThresholds).not.toBe(tpl.defaultAlertThresholds);
          expect(budget.createdAt).toBeGreaterThan(0);
          expect(budget.updatedAt).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('unknown templateId should fall back to the first default template', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (unknownTemplateId, missionId) => {
        const realIds = DEFAULT_BUDGET_TEMPLATES.map((t) => t.id);
        fc.pre(!realIds.includes(unknownTemplateId));
        const mgr = new BudgetManager();
        const fallback = DEFAULT_BUDGET_TEMPLATES[0];
        const budget = mgr.createFromTemplate(unknownTemplateId, missionId);
        expect(budget.costBudget).toBe(fallback.defaultBudget);
        expect(budget.tokenBudget).toBe(fallback.defaultTokenBudget);
        expect(budget.budgetPeriod).toBe(fallback.defaultPeriod);
        expect(budget.alertThresholds).toEqual(fallback.defaultAlertThresholds);
        expect(budget.missionId).toBe(missionId);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 24: 预算修改审批阈值
// **Validates: Requirements 11.3, 11.4**

describe('Property 24: 预算修改审批阈值', () => {
  const arbBudget = fc.double({ min: 1, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
  const arbNewBudget = fc.double({ min: 0.01, max: 2_000_000, noNaN: true, noDefaultInfinity: true });

  it('modification exceeding 20% should require approval, <=20% should not', () => {
    fc.assert(
      fc.property(arbBudget, arbNewBudget, (originalBudget, newBudget) => {
        const mgr = new BudgetManager();
        const budget = mgr.createBudget({ level: 'PROJECT', name: 'test-budget', totalBudget: originalBudget, usedBudget: 0, currency: 'USD' });
        fc.pre(newBudget > 0);
        const result = mgr.updateBudget(budget.id, { totalBudget: newBudget });
        const magnitude = Math.abs(newBudget - originalBudget) / originalBudget;
        if (magnitude > 0.2) {
          expect(result.requiresApproval).toBe(true);
        } else {
          expect(result.requiresApproval).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('version number should increment on each successive modification', () => {
    fc.assert(
      fc.property(arbBudget, fc.array(arbNewBudget, { minLength: 1, maxLength: 10 }), (originalBudget, updates) => {
        const mgr = new BudgetManager();
        const budget = mgr.createBudget({ level: 'DEPARTMENT', name: 'versioned-budget', totalBudget: originalBudget, usedBudget: 0, currency: 'USD' });
        expect(budget.version).toBe(1);
        let expectedVersion = 1;
        for (const newVal of updates) {
          fc.pre(newVal > 0);
          const result = mgr.updateBudget(budget.id, { totalBudget: newVal });
          expectedVersion += 1;
          expect(result.budget.version).toBe(expectedVersion);
        }
        const history = mgr.getVersionHistory(budget.id);
        expect(history.length).toBe(expectedVersion);
        for (let i = 1; i < history.length; i++) {
          expect(history[i].version).toBe(history[i - 1].version + 1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('non-totalBudget changes should not require approval and should still increment version', () => {
    fc.assert(
      fc.property(arbBudget, fc.string({ minLength: 1, maxLength: 30 }), (originalBudget, newName) => {
        const mgr = new BudgetManager();
        const budget = mgr.createBudget({ level: 'MISSION', name: 'original-name', totalBudget: originalBudget, usedBudget: 0, currency: 'USD' });
        const result = mgr.updateBudget(budget.id, { name: newName });
        expect(result.requiresApproval).toBe(false);
        expect(result.budget.version).toBe(2);
        expect(result.budget.name).toBe(newName);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 5: 告警类型与响应策略映射
// **Validates: Requirements 3.2, 3.3, 3.6**

describe('Property 5: alert type and response strategy mapping', () => {
  function expectedAlertType(percent: number): string {
    if (percent >= 100) return 'EXCEEDED';
    if (percent >= 90) return 'CRITICAL';
    if (percent >= 75) return 'CAUTION';
    return 'WARNING';
  }

  const arbResponseStrategy: fc.Arbitrary<AlertResponseStrategy> = fc.constantFrom(
    'LOG', 'REDUCE_CONCURRENCY', 'DOWNGRADE_MODEL', 'PAUSE_TASK',
  );
  const arbThresholdConfig: fc.Arbitrary<AlertThresholdConfig> = fc.record({
    percent: fc.integer({ min: 1, max: 100 }),
    responseStrategy: arbResponseStrategy,
  });
  const arbMissionBudget = (thresholds: fc.Arbitrary<AlertThresholdConfig[]>) =>
    fc.record({
      missionId: fc.uuid(),
      budgetType: fc.constantFrom('FIXED' as const, 'PERCENTAGE' as const, 'DYNAMIC' as const),
      tokenBudget: fc.integer({ min: 1000, max: 10_000_000 }),
      costBudget: fc.double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true }),
      currency: fc.constantFrom('USD' as const, 'CNY' as const),
      budgetPeriod: fc.constantFrom('MISSION' as const, 'DAILY' as const, 'HOURLY' as const),
      alertThresholds: thresholds,
      createdAt: fc.constant(Date.now()),
      updatedAt: fc.constant(Date.now()),
    });

  it('when cost reaches a threshold, alert action matches the threshold responseStrategy', () => {
    fc.assert(
      fc.property(
        arbMissionBudget(fc.array(arbThresholdConfig, { minLength: 1, maxLength: 6 })),
        (budget) => {
          const mgr = new AlertManager();
          mgr._reset();
          const sorted = [...budget.alertThresholds].sort((a, b) => a.percent - b.percent);
          for (const th of sorted) {
            const currentCost = (th.percent / 100) * budget.costBudget;
            const alerts = mgr.evaluate(budget.missionId, currentCost, budget as MissionBudget);
            const matchingAlert = alerts.find((a) => a.threshold === th.percent);
            if (matchingAlert) {
              expect(matchingAlert.action).toBe(th.responseStrategy);
              expect(matchingAlert.alertType).toBe(expectedAlertType(th.percent));
              expect(matchingAlert.missionId).toBe(budget.missionId);
              expect(matchingAlert.budgetRemaining).toBeGreaterThanOrEqual(0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('default thresholds are used when alertThresholds is empty', () => {
    fc.assert(
      fc.property(
        arbMissionBudget(fc.constant([] as AlertThresholdConfig[])),
        (budget) => {
          const mgr = new AlertManager();
          mgr._reset();
          const currentCost = budget.costBudget;
          const alerts = mgr.evaluate(budget.missionId, currentCost, budget as MissionBudget);
          expect(alerts.length).toBe(DEFAULT_ALERT_THRESHOLDS.length);
          for (const defaultTh of DEFAULT_ALERT_THRESHOLDS) {
            const alert = alerts.find((a) => a.threshold === defaultTh.percent);
            expect(alert).toBeDefined();
            expect(alert!.action).toBe(defaultTh.responseStrategy);
            expect(alert!.alertType).toBe(expectedAlertType(defaultTh.percent));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('custom thresholds override default thresholds', () => {
    fc.assert(
      fc.property(
        arbMissionBudget(
          fc.array(arbThresholdConfig, { minLength: 1, maxLength: 4 }).filter((arr) => {
            const percents = arr.map((t) => t.percent);
            return new Set(percents).size === percents.length;
          }),
        ),
        (budget) => {
          const mgr = new AlertManager();
          mgr._reset();
          const currentCost = budget.costBudget;
          const alerts = mgr.evaluate(budget.missionId, currentCost, budget as MissionBudget);
          for (const alert of alerts) {
            const customTh = budget.alertThresholds.find((t) => t.percent === alert.threshold);
            expect(customTh).toBeDefined();
            expect(alert.action).toBe(customTh!.responseStrategy);
          }
          const customPercents = new Set(budget.alertThresholds.map((t) => t.percent));
          for (const alert of alerts) {
            expect(customPercents.has(alert.threshold)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 7: 降级链正确性
// **Validates: Requirements 4.2**

describe('Property 7: 降级链正确性', () => {
  const chainModels = Object.keys(DOWNGRADE_CHAIN);
  const allTargets = new Set(Object.values(DOWNGRADE_CHAIN));
  const terminalModels = [...allTargets].filter((m) => !DOWNGRADE_CHAIN[m]);

  const arbChainModel: fc.Arbitrary<string> = fc.constantFrom(...chainModels);
  const arbTerminalModel: fc.Arbitrary<string> = fc.constantFrom(...terminalModels);
  const arbMissionId: fc.Arbitrary<string> = fc.uuid();

  it('downgrading a model in the chain should return the next model in the chain', () => {
    fc.assert(
      fc.property(arbChainModel, arbMissionId, (sourceModel, missionId) => {
        const mgr = new ModelDowngradeManager();
        const record = mgr.applyDowngrade(missionId, sourceModel);
        const expectedTarget = DOWNGRADE_CHAIN[sourceModel];
        expect(record.targetModel).toBe(expectedTarget);
        expect(record.sourceModel).toBe(sourceModel);
        expect(record.status).toBe('APPLIED');
        expect(record.missionId).toBe(missionId);
        const effective = mgr.getEffectiveModel(missionId, sourceModel, 'any-agent');
        expect(effective).toBe(expectedTarget);
        const records = mgr.getRecords(missionId);
        expect(records.length).toBe(1);
        expect(records[0].targetModel).toBe(expectedTarget);
      }),
      { numRuns: 100 },
    );
  });

  it('downgrading a terminal model should return itself with FAILED status', () => {
    fc.assert(
      fc.property(arbTerminalModel, arbMissionId, (terminalModel, missionId) => {
        const mgr = new ModelDowngradeManager();
        const record = mgr.applyDowngrade(missionId, terminalModel);
        expect(record.targetModel).toBe(terminalModel);
        expect(record.sourceModel).toBe(terminalModel);
        expect(record.status).toBe('FAILED');
        const effective = mgr.getEffectiveModel(missionId, terminalModel, 'any-agent');
        expect(effective).toBe(terminalModel);
      }),
      { numRuns: 100 },
    );
  });

  it('successive downgrades should follow the chain correctly', () => {
    fc.assert(
      fc.property(arbMissionId, (missionId) => {
        const mgr = new ModelDowngradeManager();
        for (const startModel of chainModels) {
          let currentModel = startModel;
          const visited = new Set<string>();
          while (DOWNGRADE_CHAIN[currentModel] && !visited.has(currentModel)) {
            visited.add(currentModel);
            const nextExpected = DOWNGRADE_CHAIN[currentModel];
            const record = mgr.applyDowngrade(missionId, currentModel);
            expect(record.targetModel).toBe(nextExpected);
            expect(record.status).toBe('APPLIED');
            currentModel = nextExpected;
          }
          if (!DOWNGRADE_CHAIN[currentModel]) {
            const finalRecord = mgr.applyDowngrade(missionId, currentModel);
            expect(finalRecord.targetModel).toBe(currentModel);
            expect(finalRecord.status).toBe('FAILED');
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 8: 灰度降级比例
// **Validates: Requirements 4.5**

describe('Property 8: 灰度降级比例', () => {
  const chainModels = Object.keys(DOWNGRADE_CHAIN);
  const arbChainModel: fc.Arbitrary<string> = fc.constantFrom(...chainModels);
  const arbMissionId: fc.Arbitrary<string> = fc.uuid();
  const arbGrayPercent: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 });
  const arbAgentIds: fc.Arbitrary<string[]> = fc
    .array(fc.uuid(), { minLength: 1, maxLength: 200 })
    .map((ids) => [...new Set(ids)])
    .filter((ids) => ids.length > 0);

  it('number of downgraded agents should be between floor(N*P/100) and ceil(N*P/100)', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbGrayPercent, arbAgentIds,
        (missionId, sourceModel, grayPercent, agentIds) => {
          const mgr = new ModelDowngradeManager();
          const record = mgr.applyDowngrade(missionId, sourceModel, grayPercent);
          expect(record.status).toBe('APPLIED');

          const N = agentIds.length;
          const targetModel = DOWNGRADE_CHAIN[sourceModel];

          let downgradedCount = 0;
          for (const agentId of agentIds) {
            const effective = mgr.getEffectiveModel(missionId, sourceModel, agentId);
            if (effective === targetModel) {
              downgradedCount++;
            }
          }

          if (grayPercent <= 0) {
            expect(downgradedCount).toBe(0);
            return;
          }
          if (grayPercent >= 100) {
            expect(downgradedCount).toBe(N);
            return;
          }

          const expectedDowngradedCount = agentIds.filter((agentId) => {
            const hash = createHash('sha256').update(agentId).digest();
            const bucket = hash.readUInt32BE(0) % 100;
            return bucket < grayPercent;
          }).length;

          expect(downgradedCount).toBe(expectedDowngradedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('grayPercent=0 should downgrade no agents', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbAgentIds,
        (missionId, sourceModel, agentIds) => {
          const mgr = new ModelDowngradeManager();
          mgr.applyDowngrade(missionId, sourceModel, 0);
          for (const agentId of agentIds) {
            const effective = mgr.getEffectiveModel(missionId, sourceModel, agentId);
            expect(effective).toBe(sourceModel);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('grayPercent=100 should downgrade all agents', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbAgentIds,
        (missionId, sourceModel, agentIds) => {
          const mgr = new ModelDowngradeManager();
          mgr.applyDowngrade(missionId, sourceModel, 100);
          const targetModel = DOWNGRADE_CHAIN[sourceModel];
          for (const agentId of agentIds) {
            const effective = mgr.getEffectiveModel(missionId, sourceModel, agentId);
            expect(effective).toBe(targetModel);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('gray group membership is deterministic for the same agentId', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbGrayPercent, fc.uuid(),
        (missionId, sourceModel, grayPercent, agentId) => {
          const mgr = new ModelDowngradeManager();
          mgr.applyDowngrade(missionId, sourceModel, grayPercent);
          const first = mgr.getEffectiveModel(missionId, sourceModel, agentId);
          const second = mgr.getEffectiveModel(missionId, sourceModel, agentId);
          expect(first).toBe(second);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: cost-governance-strategy, Property 9: 降级失败自动回滚
// **Validates: Requirements 4.6**

describe('Property 9: 降级失败自动回滚', () => {
  const chainModels = Object.keys(DOWNGRADE_CHAIN);
  const arbChainModel: fc.Arbitrary<string> = fc.constantFrom(...chainModels);
  const arbMissionId: fc.Arbitrary<string> = fc.uuid();
  const arbAgentId: fc.Arbitrary<string> = fc.uuid();
  const arbRollbackReason: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 100 });

  it('after rollback, DowngradeRecord status should be ROLLED_BACK with a rollbackReason', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbRollbackReason,
        (missionId, sourceModel, reason) => {
          const mgr = new ModelDowngradeManager();
          const record = mgr.applyDowngrade(missionId, sourceModel);
          expect(record.status).toBe('APPLIED');

          // Simulate downgrade failure → rollback
          mgr.rollback(record.id, reason);

          const records = mgr.getRecords(missionId);
          const rolledBack = records.find((r) => r.id === record.id);
          expect(rolledBack).toBeDefined();
          expect(rolledBack!.status).toBe('ROLLED_BACK');
          expect(rolledBack!.rollbackReason).toBe(reason);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after rollback, getEffectiveModel should return the original model (before downgrade)', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbAgentId, arbRollbackReason,
        (missionId, sourceModel, agentId, reason) => {
          const mgr = new ModelDowngradeManager();
          const record = mgr.applyDowngrade(missionId, sourceModel);

          // Before rollback, effective model should be the downgraded target
          const effectiveBefore = mgr.getEffectiveModel(missionId, sourceModel, agentId);
          expect(effectiveBefore).toBe(DOWNGRADE_CHAIN[sourceModel]);

          // Simulate failure → rollback
          mgr.rollback(record.id, reason);

          // After rollback, effective model should revert to the original
          const effectiveAfter = mgr.getEffectiveModel(missionId, sourceModel, agentId);
          expect(effectiveAfter).toBe(sourceModel);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rollback with gray percent should also restore original model for all agents', () => {
    fc.assert(
      fc.property(
        arbMissionId, arbChainModel, arbRollbackReason,
        fc.integer({ min: 1, max: 100 }),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }).map((ids) => [...new Set(ids)]).filter((ids) => ids.length > 0),
        (missionId, sourceModel, reason, grayPercent, agentIds) => {
          const mgr = new ModelDowngradeManager();
          const record = mgr.applyDowngrade(missionId, sourceModel, grayPercent);
          expect(record.status).toBe('APPLIED');

          // Rollback
          mgr.rollback(record.id, reason);

          // After rollback, ALL agents should get the original model back
          for (const agentId of agentIds) {
            const effective = mgr.getEffectiveModel(missionId, sourceModel, agentId);
            expect(effective).toBe(sourceModel);
          }

          const records = mgr.getRecords(missionId);
          const rolledBack = records.find((r) => r.id === record.id);
          expect(rolledBack!.status).toBe('ROLLED_BACK');
          expect(rolledBack!.rollbackReason).toBe(reason);
        },
      ),
      { numRuns: 100 },
    );
  });
});
