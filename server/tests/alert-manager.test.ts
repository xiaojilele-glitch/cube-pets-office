/**
 * Unit tests for AlertManager — cost governance alert system.
 *
 * Covers: evaluate (various cost levels), executeResponse (each strategy),
 * getActiveAlerts, resolveAlert, custom threshold override, deduplication.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlertManager, DEFAULT_ALERT_THRESHOLDS } from '../core/governance/alert-manager.js';
import type { MissionBudget, BudgetAlert } from '../../shared/cost-governance.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBudget(overrides: Partial<MissionBudget> = {}): MissionBudget {
  return {
    missionId: 'mission-1',
    budgetType: 'FIXED',
    tokenBudget: 100_000,
    costBudget: 100,
    currency: 'USD',
    budgetPeriod: 'MISSION',
    alertThresholds: [],          // empty → use defaults
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertManager', () => {
  let manager: AlertManager;

  beforeEach(() => {
    manager = new AlertManager();
  });

  // =========================================================================
  // evaluate — default thresholds
  // =========================================================================

  describe('evaluate() with default thresholds', () => {
    it('returns no alerts when cost is below all thresholds', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 10, budget); // 10%
      expect(alerts).toHaveLength(0);
    });

    it('triggers WARNING at 50%', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 50, budget);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alertType).toBe('WARNING');
      expect(alerts[0].action).toBe('LOG');
      expect(alerts[0].threshold).toBe(50);
    });

    it('triggers WARNING + CAUTION at 75%', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 75, budget);
      expect(alerts).toHaveLength(2);
      expect(alerts.map((a) => a.alertType)).toEqual(['WARNING', 'CAUTION']);
      expect(alerts.map((a) => a.action)).toEqual(['LOG', 'REDUCE_CONCURRENCY']);
    });

    it('triggers WARNING + CAUTION + CRITICAL at 90%', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 90, budget);
      expect(alerts).toHaveLength(3);
      expect(alerts.map((a) => a.alertType)).toEqual(['WARNING', 'CAUTION', 'CRITICAL']);
    });

    it('triggers all four alerts at 100%', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 100, budget);
      expect(alerts).toHaveLength(4);
      expect(alerts.map((a) => a.alertType)).toEqual([
        'WARNING',
        'CAUTION',
        'CRITICAL',
        'EXCEEDED',
      ]);
      expect(alerts.map((a) => a.action)).toEqual([
        'LOG',
        'REDUCE_CONCURRENCY',
        'DOWNGRADE_MODEL',
        'PAUSE_TASK',
      ]);
    });

    it('triggers all four alerts when cost exceeds budget', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 150, budget);
      expect(alerts).toHaveLength(4);
    });

    it('sets correct budgetRemaining (clamped to 0)', () => {
      const budget = makeBudget({ costBudget: 100 });
      const alerts = manager.evaluate('m1', 120, budget);
      for (const a of alerts) {
        expect(a.budgetRemaining).toBe(0);
      }
    });

    it('sets correct budgetRemaining when within budget', () => {
      const budget = makeBudget({ costBudget: 100 });
      const alerts = manager.evaluate('m1', 75, budget);
      expect(alerts[0].budgetRemaining).toBe(25);
    });
  });

  // =========================================================================
  // evaluate — deduplication
  // =========================================================================

  describe('evaluate() deduplication', () => {
    it('does not re-fire the same threshold on subsequent calls', () => {
      const budget = makeBudget();
      const first = manager.evaluate('m1', 50, budget);
      expect(first).toHaveLength(1);

      const second = manager.evaluate('m1', 55, budget);
      expect(second).toHaveLength(0);
    });

    it('fires new thresholds as cost increases', () => {
      const budget = makeBudget();
      manager.evaluate('m1', 50, budget);  // fires WARNING
      const alerts = manager.evaluate('m1', 80, budget); // fires CAUTION only
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alertType).toBe('CAUTION');
    });

    it('tracks thresholds independently per mission', () => {
      const budget = makeBudget();
      manager.evaluate('m1', 50, budget);
      const alerts = manager.evaluate('m2', 50, budget);
      expect(alerts).toHaveLength(1); // m2 hasn't fired yet
    });
  });

  // =========================================================================
  // evaluate — custom thresholds
  // =========================================================================

  describe('evaluate() with custom thresholds', () => {
    it('uses custom thresholds when provided', () => {
      const budget = makeBudget({
        alertThresholds: [
          { percent: 30, responseStrategy: 'LOG' },
          { percent: 60, responseStrategy: 'PAUSE_TASK' },
        ],
      });
      const alerts = manager.evaluate('m1', 35, budget); // 35% → fires 30%
      expect(alerts).toHaveLength(1);
      expect(alerts[0].threshold).toBe(30);
      expect(alerts[0].action).toBe('LOG');
    });

    it('custom thresholds override defaults completely', () => {
      const budget = makeBudget({
        alertThresholds: [{ percent: 80, responseStrategy: 'PAUSE_TASK' }],
      });
      // At 75% — default would fire WARNING+CAUTION, but custom only has 80%
      const alerts = manager.evaluate('m1', 75, budget);
      expect(alerts).toHaveLength(0);
    });
  });

  // =========================================================================
  // evaluate — edge cases
  // =========================================================================

  describe('evaluate() edge cases', () => {
    it('returns empty for zero costBudget', () => {
      const budget = makeBudget({ costBudget: 0 });
      const alerts = manager.evaluate('m1', 50, budget);
      expect(alerts).toHaveLength(0);
    });

    it('returns empty for negative costBudget', () => {
      const budget = makeBudget({ costBudget: -10 });
      const alerts = manager.evaluate('m1', 50, budget);
      expect(alerts).toHaveLength(0);
    });

    it('returns empty when currentCost is 0', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 0, budget);
      expect(alerts).toHaveLength(0);
    });
  });

  // =========================================================================
  // executeResponse
  // =========================================================================

  describe('executeResponse()', () => {
    it('logs warning for LOG strategy', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const alert: BudgetAlert = {
        alertId: 'a1',
        missionId: 'm1',
        alertType: 'WARNING',
        threshold: 50,
        currentCost: 50,
        budgetRemaining: 50,
        timestamp: Date.now(),
        action: 'LOG',
        resolved: false,
      };
      manager.executeResponse(alert);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('WARNING');
      spy.mockRestore();
    });

    it('logs for REDUCE_CONCURRENCY strategy', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const alert: BudgetAlert = {
        alertId: 'a2',
        missionId: 'm1',
        alertType: 'CAUTION',
        threshold: 75,
        currentCost: 75,
        budgetRemaining: 25,
        timestamp: Date.now(),
        action: 'REDUCE_CONCURRENCY',
        resolved: false,
      };
      manager.executeResponse(alert);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('CAUTION');
      spy.mockRestore();
    });

    it('logs for DOWNGRADE_MODEL strategy', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const alert: BudgetAlert = {
        alertId: 'a3',
        missionId: 'm1',
        alertType: 'CRITICAL',
        threshold: 90,
        currentCost: 90,
        budgetRemaining: 10,
        timestamp: Date.now(),
        action: 'DOWNGRADE_MODEL',
        resolved: false,
      };
      manager.executeResponse(alert);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('CRITICAL');
      spy.mockRestore();
    });

    it('logs for PAUSE_TASK strategy', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const alert: BudgetAlert = {
        alertId: 'a4',
        missionId: 'm1',
        alertType: 'EXCEEDED',
        threshold: 100,
        currentCost: 100,
        budgetRemaining: 0,
        timestamp: Date.now(),
        action: 'PAUSE_TASK',
        resolved: false,
      };
      manager.executeResponse(alert);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('EXCEEDED');
      spy.mockRestore();
    });
  });

  // =========================================================================
  // getActiveAlerts / resolveAlert
  // =========================================================================

  describe('getActiveAlerts() / resolveAlert()', () => {
    it('returns active alerts for a mission', () => {
      const budget = makeBudget();
      manager.evaluate('m1', 80, budget);
      const active = manager.getActiveAlerts('m1');
      expect(active).toHaveLength(2); // WARNING + CAUTION
      expect(active.every((a) => !a.resolved)).toBe(true);
    });

    it('returns empty for unknown mission', () => {
      expect(manager.getActiveAlerts('unknown')).toHaveLength(0);
    });

    it('resolveAlert marks alert as resolved', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 50, budget);
      expect(alerts).toHaveLength(1);

      manager.resolveAlert(alerts[0].alertId);

      const active = manager.getActiveAlerts('m1');
      expect(active).toHaveLength(0);
    });

    it('resolveAlert is no-op for unknown alertId', () => {
      // Should not throw
      manager.resolveAlert('nonexistent');
    });

    it('does not return alerts from other missions', () => {
      const budget = makeBudget();
      manager.evaluate('m1', 60, budget);
      manager.evaluate('m2', 80, budget);

      const m1Alerts = manager.getActiveAlerts('m1');
      const m2Alerts = manager.getActiveAlerts('m2');

      expect(m1Alerts.every((a) => a.missionId === 'm1')).toBe(true);
      expect(m2Alerts.every((a) => a.missionId === 'm2')).toBe(true);
    });
  });

  // =========================================================================
  // alert fields correctness
  // =========================================================================

  describe('alert field correctness', () => {
    it('each alert has a unique alertId', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 100, budget);
      const ids = alerts.map((a) => a.alertId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('alert contains correct missionId', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('my-mission', 60, budget);
      expect(alerts.every((a) => a.missionId === 'my-mission')).toBe(true);
    });

    it('alert has a valid timestamp', () => {
      const before = Date.now();
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 60, budget);
      const after = Date.now();
      for (const a of alerts) {
        expect(a.timestamp).toBeGreaterThanOrEqual(before);
        expect(a.timestamp).toBeLessThanOrEqual(after);
      }
    });

    it('alert.resolved is false on creation', () => {
      const budget = makeBudget();
      const alerts = manager.evaluate('m1', 60, budget);
      expect(alerts.every((a) => a.resolved === false)).toBe(true);
    });
  });

  // =========================================================================
  // _reset helper
  // =========================================================================

  describe('_reset()', () => {
    it('clears all state', () => {
      const budget = makeBudget();
      manager.evaluate('m1', 100, budget);
      expect(manager.getActiveAlerts('m1').length).toBeGreaterThan(0);

      manager._reset();
      expect(manager.getActiveAlerts('m1')).toHaveLength(0);

      // Can re-fire thresholds after reset
      const alerts = manager.evaluate('m1', 50, budget);
      expect(alerts).toHaveLength(1);
    });
  });
});
