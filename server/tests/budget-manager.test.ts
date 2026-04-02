/**
 * BudgetManager — 单元测试
 *
 * 覆盖 createBudget、updateBudget（含审批阈值）、validateHierarchy、
 * getTemplates、createFromTemplate、reconcile、getVersionHistory。
 *
 * @see Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetManager } from '../core/governance/budget-manager.js';
import { DEFAULT_BUDGET_TEMPLATES } from '../../shared/cost-governance.js';
import type { BudgetLevel, Currency } from '../../shared/cost-governance.js';

function makeBudgetInput(overrides: Record<string, unknown> = {}) {
  return {
    level: 'PROJECT' as BudgetLevel,
    name: 'Test Budget',
    totalBudget: 100,
    usedBudget: 0,
    currency: 'USD' as Currency,
    ...overrides,
  };
}

describe('BudgetManager', () => {
  let mgr: BudgetManager;

  beforeEach(() => {
    mgr = new BudgetManager();
  });

  // ---------------------------------------------------------------------------
  // createBudget
  // ---------------------------------------------------------------------------
  describe('createBudget', () => {
    it('should create a budget with auto-generated id, version=1, timestamps', () => {
      const before = Date.now();
      const b = mgr.createBudget(makeBudgetInput());
      const after = Date.now();

      expect(b.id).toBeTruthy();
      expect(b.version).toBe(1);
      expect(b.createdAt).toBeGreaterThanOrEqual(before);
      expect(b.createdAt).toBeLessThanOrEqual(after);
      expect(b.updatedAt).toBe(b.createdAt);
      expect(b.totalBudget).toBe(100);
      expect(b.name).toBe('Test Budget');
    });

    it('should fallback to default template budget when totalBudget <= 0', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: -5 }));
      expect(b.totalBudget).toBe(DEFAULT_BUDGET_TEMPLATES[0].defaultBudget);
    });

    it('should fallback when totalBudget is zero', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 0 }));
      expect(b.totalBudget).toBe(DEFAULT_BUDGET_TEMPLATES[0].defaultBudget);
    });

    it('should store the budget so it can be retrieved', () => {
      const b = mgr.createBudget(makeBudgetInput());
      expect(mgr.getBudget(b.id)).toEqual(b);
    });
  });

  // ---------------------------------------------------------------------------
  // updateBudget
  // ---------------------------------------------------------------------------
  describe('updateBudget', () => {
    it('should increment version on each update', () => {
      const b = mgr.createBudget(makeBudgetInput());
      expect(b.version).toBe(1);

      const r1 = mgr.updateBudget(b.id, { name: 'Updated' });
      expect(r1.budget.version).toBe(2);

      const r2 = mgr.updateBudget(b.id, { name: 'Updated Again' });
      expect(r2.budget.version).toBe(3);
    });

    it('should not require approval when modification <= 20%', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 100 }));
      // 20% of 100 = 20, so changing to 80 is exactly 20% → not exceeding
      const r = mgr.updateBudget(b.id, { totalBudget: 80 });
      expect(r.requiresApproval).toBe(false);
    });

    it('should require approval when modification > 20%', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 100 }));
      // Changing to 79 is 21% change → requires approval
      const r = mgr.updateBudget(b.id, { totalBudget: 79 });
      expect(r.requiresApproval).toBe(true);
    });

    it('should require approval for large increase', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 100 }));
      const r = mgr.updateBudget(b.id, { totalBudget: 150 });
      expect(r.requiresApproval).toBe(true);
    });

    it('should preserve immutable fields (id, createdAt)', () => {
      const b = mgr.createBudget(makeBudgetInput());
      const r = mgr.updateBudget(b.id, { name: 'New Name' });
      expect(r.budget.id).toBe(b.id);
      expect(r.budget.createdAt).toBe(b.createdAt);
    });

    it('should update updatedAt timestamp', () => {
      const b = mgr.createBudget(makeBudgetInput());
      const r = mgr.updateBudget(b.id, { name: 'New' });
      expect(r.budget.updatedAt).toBeGreaterThanOrEqual(b.updatedAt);
    });

    it('should throw when budget does not exist', () => {
      expect(() => mgr.updateBudget('nonexistent', { name: 'x' })).toThrow('预算不存在');
    });

    it('should fallback invalid totalBudget on update', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 100 }));
      const r = mgr.updateBudget(b.id, { totalBudget: -10 });
      expect(r.budget.totalBudget).toBe(DEFAULT_BUDGET_TEMPLATES[0].defaultBudget);
    });
  });

  // ---------------------------------------------------------------------------
  // validateHierarchy
  // ---------------------------------------------------------------------------
  describe('validateHierarchy', () => {
    it('should return true when child fits within parent budget', () => {
      const parent = mgr.createBudget(makeBudgetInput({ totalBudget: 100, level: 'DEPARTMENT' }));
      expect(mgr.validateHierarchy(50, parent.id)).toBe(true);
    });

    it('should return true when child exactly equals remaining parent budget', () => {
      const parent = mgr.createBudget(makeBudgetInput({ totalBudget: 100, level: 'DEPARTMENT' }));
      // Create a child that uses 60
      mgr.createBudget(makeBudgetInput({ totalBudget: 60, level: 'PROJECT', parentId: parent.id }));
      // 40 remaining, try to add 40
      expect(mgr.validateHierarchy(40, parent.id)).toBe(true);
    });

    it('should return false when child exceeds remaining parent budget', () => {
      const parent = mgr.createBudget(makeBudgetInput({ totalBudget: 100, level: 'DEPARTMENT' }));
      mgr.createBudget(makeBudgetInput({ totalBudget: 60, level: 'PROJECT', parentId: parent.id }));
      // 40 remaining, try to add 50
      expect(mgr.validateHierarchy(50, parent.id)).toBe(false);
    });

    it('should return false when parent does not exist', () => {
      expect(mgr.validateHierarchy(10, 'nonexistent')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getTemplates
  // ---------------------------------------------------------------------------
  describe('getTemplates', () => {
    it('should return the default budget templates', () => {
      const templates = mgr.getTemplates();
      expect(templates).toEqual(DEFAULT_BUDGET_TEMPLATES);
      expect(templates.length).toBeGreaterThanOrEqual(2);
    });

    it('should include standard-coding and data-analysis templates', () => {
      const ids = mgr.getTemplates().map((t) => t.id);
      expect(ids).toContain('standard-coding');
      expect(ids).toContain('data-analysis');
    });
  });

  // ---------------------------------------------------------------------------
  // createFromTemplate
  // ---------------------------------------------------------------------------
  describe('createFromTemplate', () => {
    it('should create MissionBudget with template defaults', () => {
      const template = DEFAULT_BUDGET_TEMPLATES[0];
      const mb = mgr.createFromTemplate('standard-coding', 'mission-1');

      expect(mb.missionId).toBe('mission-1');
      expect(mb.budgetType).toBe('FIXED');
      expect(mb.tokenBudget).toBe(template.defaultTokenBudget);
      expect(mb.costBudget).toBe(template.defaultBudget);
      expect(mb.budgetPeriod).toBe(template.defaultPeriod);
      expect(mb.alertThresholds).toEqual(template.defaultAlertThresholds);
      expect(mb.currency).toBe('USD');
    });

    it('should fallback to first template when templateId is invalid', () => {
      const template = DEFAULT_BUDGET_TEMPLATES[0];
      const mb = mgr.createFromTemplate('nonexistent-template', 'mission-2');
      expect(mb.costBudget).toBe(template.defaultBudget);
      expect(mb.tokenBudget).toBe(template.defaultTokenBudget);
    });

    it('should create from data-analysis template', () => {
      const template = DEFAULT_BUDGET_TEMPLATES[1];
      const mb = mgr.createFromTemplate('data-analysis', 'mission-3');
      expect(mb.costBudget).toBe(template.defaultBudget);
      expect(mb.tokenBudget).toBe(template.defaultTokenBudget);
    });
  });

  // ---------------------------------------------------------------------------
  // reconcile
  // ---------------------------------------------------------------------------
  describe('reconcile', () => {
    it('should return budget, actual cost, and variance', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 100, usedBudget: 30 }));
      const result = mgr.reconcile(b.id);
      expect(result.budget).toBe(100);
      expect(result.actual).toBe(30); // falls back to usedBudget
      expect(result.variance).toBe(70);
    });

    it('should use setActualCost value when available', () => {
      const b = mgr.createBudget(makeBudgetInput({ totalBudget: 100, usedBudget: 30 }));
      mgr.setActualCost(b.id, 45);
      const result = mgr.reconcile(b.id);
      expect(result.actual).toBe(45);
      expect(result.variance).toBe(55);
    });

    it('should throw when budget does not exist', () => {
      expect(() => mgr.reconcile('nonexistent')).toThrow('预算不存在');
    });
  });

  // ---------------------------------------------------------------------------
  // getVersionHistory
  // ---------------------------------------------------------------------------
  describe('getVersionHistory', () => {
    it('should return version history after create', () => {
      const b = mgr.createBudget(makeBudgetInput());
      const history = mgr.getVersionHistory(b.id);
      expect(history).toHaveLength(1);
      expect(history[0].version).toBe(1);
    });

    it('should accumulate versions on updates', () => {
      const b = mgr.createBudget(makeBudgetInput());
      mgr.updateBudget(b.id, { name: 'v2' });
      mgr.updateBudget(b.id, { name: 'v3' });

      const history = mgr.getVersionHistory(b.id);
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(1);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(3);
    });

    it('should return empty array for unknown budgetId', () => {
      expect(mgr.getVersionHistory('unknown')).toEqual([]);
    });

    it('should preserve snapshot data (not reference)', () => {
      const b = mgr.createBudget(makeBudgetInput({ name: 'Original' }));
      mgr.updateBudget(b.id, { name: 'Changed' });

      const history = mgr.getVersionHistory(b.id);
      expect(history[0].name).toBe('Original');
      expect(history[1].name).toBe('Changed');
    });
  });
});
