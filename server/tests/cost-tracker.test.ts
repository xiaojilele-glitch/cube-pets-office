import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostRecord } from '../../shared/cost.js';
import { estimateCost } from '../../shared/cost.js';
import { CostTracker } from '../core/cost-tracker.js';

/** Helper: build a minimal valid CostRecord */
function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  const model = overrides.model ?? 'gpt-4o-mini';
  const tokensIn = overrides.tokensIn ?? 100;
  const tokensOut = overrides.tokensOut ?? 50;
  return {
    id: overrides.id ?? `rec-${Date.now()}`,
    timestamp: overrides.timestamp ?? Date.now(),
    model,
    tokensIn,
    tokensOut,
    unitPriceIn: 0.00015,
    unitPriceOut: 0.0006,
    actualCost: overrides.actualCost ?? estimateCost(model, tokensIn, tokensOut),
    durationMs: overrides.durationMs ?? 120,
    ...overrides,
  };
}

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  // ---------------------------------------------------------------------------
  // recordCall
  // ---------------------------------------------------------------------------

  describe('recordCall', () => {
    it('stores a record and reflects it in getRecords', () => {
      const record = makeRecord({ id: 'r1' });
      tracker.recordCall(record);
      expect(tracker.getRecords()).toHaveLength(1);
      expect(tracker.getRecords()[0]).toBe(record);
    });

    it('tracks currentMissionId from the first record with missionId', () => {
      expect(tracker.getCurrentMissionId()).toBeNull();
      tracker.recordCall(makeRecord({ missionId: 'm-1' }));
      expect(tracker.getCurrentMissionId()).toBe('m-1');
    });

    it('does not overwrite currentMissionId once set', () => {
      tracker.recordCall(makeRecord({ missionId: 'm-1' }));
      tracker.recordCall(makeRecord({ missionId: 'm-2' }));
      expect(tracker.getCurrentMissionId()).toBe('m-1');
    });
  });

  // ---------------------------------------------------------------------------
  // getSnapshot
  // ---------------------------------------------------------------------------

  describe('getSnapshot', () => {
    it('returns zero-value snapshot when no records exist', () => {
      const snap = tracker.getSnapshot();
      expect(snap.totalTokensIn).toBe(0);
      expect(snap.totalTokensOut).toBe(0);
      expect(snap.totalCost).toBe(0);
      expect(snap.totalCalls).toBe(0);
      expect(snap.agentCosts).toEqual([]);
      expect(snap.budgetUsedPercent).toBe(0);
      expect(snap.tokenUsedPercent).toBe(0);
      expect(snap.alerts).toEqual([]);
      expect(snap.downgradeLevel).toBe('none');
    });

    it('aggregates totals from multiple records', () => {
      tracker.recordCall(makeRecord({ tokensIn: 100, tokensOut: 50, actualCost: 0.01 }));
      tracker.recordCall(makeRecord({ tokensIn: 200, tokensOut: 80, actualCost: 0.02 }));

      const snap = tracker.getSnapshot();
      expect(snap.totalTokensIn).toBe(300);
      expect(snap.totalTokensOut).toBe(130);
      expect(snap.totalCost).toBeCloseTo(0.03);
      expect(snap.totalCalls).toBe(2);
    });

    it('includes updatedAt timestamp', () => {
      const before = Date.now();
      const snap = tracker.getSnapshot();
      expect(snap.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  // getAgentCosts
  // ---------------------------------------------------------------------------

  describe('getAgentCosts', () => {
    it('returns empty array when no records', () => {
      expect(tracker.getAgentCosts()).toEqual([]);
    });

    it('aggregates by agentId and sorts by totalCost descending', () => {
      tracker.recordCall(makeRecord({ agentId: 'a1', tokensIn: 100, tokensOut: 50, actualCost: 0.01 }));
      tracker.recordCall(makeRecord({ agentId: 'a2', tokensIn: 200, tokensOut: 80, actualCost: 0.05 }));
      tracker.recordCall(makeRecord({ agentId: 'a1', tokensIn: 50, tokensOut: 20, actualCost: 0.005 }));

      const costs = tracker.getAgentCosts();
      expect(costs).toHaveLength(2);

      // a2 has higher cost, should be first
      expect(costs[0].agentId).toBe('a2');
      expect(costs[0].totalCost).toBeCloseTo(0.05);
      expect(costs[0].callCount).toBe(1);

      // a1 aggregated
      expect(costs[1].agentId).toBe('a1');
      expect(costs[1].tokensIn).toBe(150);
      expect(costs[1].tokensOut).toBe(70);
      expect(costs[1].totalCost).toBeCloseTo(0.015);
      expect(costs[1].callCount).toBe(2);
    });

    it('groups records without agentId under "unknown"', () => {
      tracker.recordCall(makeRecord({ agentId: undefined, actualCost: 0.01 }));
      const costs = tracker.getAgentCosts();
      expect(costs).toHaveLength(1);
      expect(costs[0].agentId).toBe('unknown');
    });
  });

  // ---------------------------------------------------------------------------
  // getSessionCosts
  // ---------------------------------------------------------------------------

  describe('getSessionCosts', () => {
    it('returns empty map when no records', () => {
      expect(tracker.getSessionCosts().size).toBe(0);
    });

    it('aggregates by sessionId', () => {
      tracker.recordCall(makeRecord({ sessionId: 's1', tokensIn: 100, tokensOut: 50, actualCost: 0.01 }));
      tracker.recordCall(makeRecord({ sessionId: 's1', tokensIn: 200, tokensOut: 80, actualCost: 0.02 }));
      tracker.recordCall(makeRecord({ sessionId: 's2', tokensIn: 50, tokensOut: 30, actualCost: 0.005 }));

      const sessions = tracker.getSessionCosts();
      expect(sessions.size).toBe(2);

      const s1 = sessions.get('s1')!;
      expect(s1.tokensIn).toBe(300);
      expect(s1.tokensOut).toBe(130);
      expect(s1.cost).toBeCloseTo(0.03);

      const s2 = sessions.get('s2')!;
      expect(s2.tokensIn).toBe(50);
      expect(s2.tokensOut).toBe(30);
      expect(s2.cost).toBeCloseTo(0.005);
    });

    it('groups records without sessionId under "unknown"', () => {
      tracker.recordCall(makeRecord({ sessionId: undefined }));
      const sessions = tracker.getSessionCosts();
      expect(sessions.has('unknown')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // finalizeMission
  // ---------------------------------------------------------------------------

  describe('finalizeMission', () => {
    it('archives current records into history', () => {
      tracker.recordCall(makeRecord({ tokensIn: 100, tokensOut: 50, actualCost: 0.01 }));
      tracker.recordCall(makeRecord({ tokensIn: 200, tokensOut: 80, actualCost: 0.02 }));

      tracker.finalizeMission('m-1', 'Test Mission');

      const history = tracker.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].missionId).toBe('m-1');
      expect(history[0].title).toBe('Test Mission');
      expect(history[0].totalTokensIn).toBe(300);
      expect(history[0].totalTokensOut).toBe(130);
      expect(history[0].totalCost).toBeCloseTo(0.03);
      expect(history[0].totalCalls).toBe(2);
      expect(history[0].topAgents).toBeDefined();
    });

    it('clears current records after finalization', () => {
      tracker.recordCall(makeRecord({ missionId: 'm-1' }));
      tracker.finalizeMission('m-1', 'Done');

      expect(tracker.getRecords()).toHaveLength(0);
      expect(tracker.getCurrentMissionId()).toBeNull();
    });

    it('caps history at 10 entries, keeping the most recent', () => {
      for (let i = 0; i < 12; i++) {
        tracker.recordCall(makeRecord({ actualCost: 0.001 * (i + 1) }));
        tracker.finalizeMission(`m-${i}`, `Mission ${i}`);
      }

      const history = tracker.getHistory();
      expect(history).toHaveLength(10);
      // Should keep m-2 through m-11 (the last 10)
      expect(history[0].missionId).toBe('m-2');
      expect(history[9].missionId).toBe('m-11');
    });

    it('includes top 5 agents in the summary', () => {
      for (let i = 0; i < 7; i++) {
        tracker.recordCall(makeRecord({ agentId: `agent-${i}`, actualCost: 0.01 * (i + 1) }));
      }
      tracker.finalizeMission('m-1', 'Many Agents');

      const history = tracker.getHistory();
      expect(history[0].topAgents.length).toBeLessThanOrEqual(5);
      // Top agent by cost should be agent-6
      expect(history[0].topAgents[0].agentId).toBe('agent-6');
    });
  });

  // ---------------------------------------------------------------------------
  // resetCurrentMission
  // ---------------------------------------------------------------------------

  describe('resetCurrentMission', () => {
    it('clears all current state', () => {
      tracker.recordCall(makeRecord({ missionId: 'm-1' }));
      tracker.resetCurrentMission();

      expect(tracker.getRecords()).toHaveLength(0);
      expect(tracker.getCurrentMissionId()).toBeNull();
    });

    it('sets new missionId when provided', () => {
      tracker.resetCurrentMission('m-new');
      expect(tracker.getCurrentMissionId()).toBe('m-new');
    });

    it('does not affect history', () => {
      tracker.recordCall(makeRecord());
      tracker.finalizeMission('m-1', 'Archived');
      tracker.recordCall(makeRecord());
      tracker.resetCurrentMission();

      expect(tracker.getHistory()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getHistory
  // ---------------------------------------------------------------------------

  describe('getHistory', () => {
    it('returns a copy of the history array', () => {
      tracker.recordCall(makeRecord());
      tracker.finalizeMission('m-1', 'Test');

      const h1 = tracker.getHistory();
      const h2 = tracker.getHistory();
      expect(h1).not.toBe(h2);
      expect(h1).toEqual(h2);
    });
  });

  // ---------------------------------------------------------------------------
  // Stub methods (budget/downgrade)
  // ---------------------------------------------------------------------------

  describe('budget stubs', () => {
    it('returns default budget', () => {
      const budget = tracker.getBudget();
      expect(budget.maxCost).toBe(1.0);
      expect(budget.maxTokens).toBe(100000);
      expect(budget.warningThreshold).toBe(0.8);
    });

    it('setBudget updates the budget', () => {
      tracker.setBudget({ maxCost: 5.0, maxTokens: 500000, warningThreshold: 0.9 });
      const budget = tracker.getBudget();
      expect(budget.maxCost).toBe(5.0);
    });
  });

  describe('downgrade logic (Task 4.1)', () => {
    it('getDowngradeLevel returns none by default', () => {
      expect(tracker.getDowngradeLevel()).toBe('none');
    });

    it('getEffectiveModel returns original model when no downgrade', () => {
      expect(tracker.getEffectiveModel('gpt-4o')).toBe('gpt-4o');
    });

    it('isAgentPaused returns false by default', () => {
      expect(tracker.isAgentPaused('any-agent')).toBe(false);
    });

    it('getDowngradePolicy returns default policy', () => {
      const policy = tracker.getDowngradePolicy();
      expect(policy.enabled).toBe(true);
      expect(policy.lowCostModel).toBe('glm-4.6');
      expect(policy.criticalAgentIds).toEqual([]);
    });

    it('setDowngradePolicy updates the policy', () => {
      tracker.setDowngradePolicy({ enabled: false, lowCostModel: 'gpt-4o-mini', criticalAgentIds: ['a1'] });
      const policy = tracker.getDowngradePolicy();
      expect(policy.enabled).toBe(false);
      expect(policy.lowCostModel).toBe('gpt-4o-mini');
      expect(policy.criticalAgentIds).toEqual(['a1']);
    });

    it('getDowngradePolicy returns a copy (not a reference)', () => {
      const p1 = tracker.getDowngradePolicy();
      const p2 = tracker.getDowngradePolicy();
      expect(p1).not.toBe(p2);
      expect(p1.criticalAgentIds).not.toBe(p2.criticalAgentIds);
    });

    // ---- soft downgrade ----

    it('triggers soft downgrade when cost_warning alert is generated', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      // 0.85 > 1.0 * 0.8 → cost_warning → soft downgrade
      tracker.recordCall(makeRecord({ actualCost: 0.85 }));

      expect(tracker.getDowngradeLevel()).toBe('soft');
    });

    it('triggers soft downgrade when token_warning alert is generated', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 1000, warningThreshold: 0.8 });
      // 500 + 400 = 900 > 1000 * 0.8 = 800 → token_warning → soft
      tracker.recordCall(makeRecord({ tokensIn: 500, tokensOut: 400, actualCost: 0.001 }));

      expect(tracker.getDowngradeLevel()).toBe('soft');
    });

    it('getEffectiveModel returns lowCostModel during soft downgrade', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.85 }));

      expect(tracker.getDowngradeLevel()).toBe('soft');
      expect(tracker.getEffectiveModel('gpt-4o')).toBe('glm-4.6');
    });

    it('does not pause agents during soft downgrade', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.85 }));

      expect(tracker.getDowngradeLevel()).toBe('soft');
      expect(tracker.isAgentPaused('a1')).toBe(false);
    });

    // ---- hard downgrade ----

    it('triggers hard downgrade when cost_exceeded alert is generated', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));

      expect(tracker.getDowngradeLevel()).toBe('hard');
    });

    it('triggers hard downgrade when token_exceeded alert is generated', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 500, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', tokensIn: 300, tokensOut: 200, actualCost: 0.001 }));

      expect(tracker.getDowngradeLevel()).toBe('hard');
    });

    it('getEffectiveModel returns lowCostModel during hard downgrade', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));

      expect(tracker.getEffectiveModel('gpt-4o')).toBe('glm-4.6');
    });

    it('pauses non-critical agents during hard downgrade', () => {
      tracker.setDowngradePolicy({ enabled: true, lowCostModel: 'glm-4.6', criticalAgentIds: ['critical-1'] });
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });

      tracker.recordCall(makeRecord({ agentId: 'critical-1', actualCost: 0.1 }));
      tracker.recordCall(makeRecord({ agentId: 'worker-1', actualCost: 0.1 }));
      tracker.recordCall(makeRecord({ agentId: 'worker-2', actualCost: 0.4 }));

      expect(tracker.getDowngradeLevel()).toBe('hard');
      expect(tracker.isAgentPaused('critical-1')).toBe(false);
      expect(tracker.isAgentPaused('worker-1')).toBe(true);
      expect(tracker.isAgentPaused('worker-2')).toBe(true);
    });

    it('does not pause agents not seen in records', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));

      expect(tracker.getDowngradeLevel()).toBe('hard');
      // 'unknown-agent' never appeared in records, so not in pausedAgentIds
      expect(tracker.isAgentPaused('unknown-agent')).toBe(false);
    });

    // ---- manual release ----

    it('manualReleaseDegradation resets downgrade to none', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));
      expect(tracker.getDowngradeLevel()).toBe('hard');

      tracker.manualReleaseDegradation();
      expect(tracker.getDowngradeLevel()).toBe('none');
    });

    it('manualReleaseDegradation restores original model', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));
      expect(tracker.getEffectiveModel('gpt-4o')).toBe('glm-4.6');

      tracker.manualReleaseDegradation();
      expect(tracker.getEffectiveModel('gpt-4o')).toBe('gpt-4o');
    });

    it('manualReleaseDegradation unpauses all agents', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));
      expect(tracker.isAgentPaused('a1')).toBe(true);

      tracker.manualReleaseDegradation();
      expect(tracker.isAgentPaused('a1')).toBe(false);
    });

    // ---- state machine transitions ----

    it('state machine: none → soft → hard', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });

      // Below threshold → none
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.5 }));
      expect(tracker.getDowngradeLevel()).toBe('none');

      // Cross warning threshold → soft
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.35 }));
      expect(tracker.getDowngradeLevel()).toBe('soft');

      // Cross limit → hard
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.2 }));
      expect(tracker.getDowngradeLevel()).toBe('hard');
    });

    it('resetCurrentMission resets downgrade to none (new Mission)', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));
      expect(tracker.getDowngradeLevel()).toBe('hard');

      tracker.resetCurrentMission('new-mission');
      expect(tracker.getDowngradeLevel()).toBe('none');
      expect(tracker.isAgentPaused('a1')).toBe(false);
    });

    it('finalizeMission resets downgrade to none', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));
      expect(tracker.getDowngradeLevel()).toBe('hard');

      tracker.finalizeMission('m-1', 'Done');
      expect(tracker.getDowngradeLevel()).toBe('none');
      expect(tracker.isAgentPaused('a1')).toBe(false);
    });

    // ---- downgrade disabled ----

    it('does not downgrade when policy is disabled', () => {
      tracker.setDowngradePolicy({ enabled: false, lowCostModel: 'glm-4.6', criticalAgentIds: [] });
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.6 }));

      expect(tracker.getDowngradeLevel()).toBe('none');
      expect(tracker.getEffectiveModel('gpt-4o')).toBe('gpt-4o');
      expect(tracker.isAgentPaused('a1')).toBe(false);
    });

    // ---- setBudget triggers downgrade re-evaluation ----

    it('setBudget triggers downgrade when budget is lowered', () => {
      tracker.recordCall(makeRecord({ agentId: 'a1', actualCost: 0.5 }));
      expect(tracker.getDowngradeLevel()).toBe('none');

      // Lower budget so 0.5 >= 0.4 → cost_exceeded → hard
      tracker.setBudget({ maxCost: 0.4, maxTokens: 100000, warningThreshold: 0.8 });
      expect(tracker.getDowngradeLevel()).toBe('hard');
      expect(tracker.isAgentPaused('a1')).toBe(true);
    });

    // ---- custom lowCostModel ----

    it('uses custom lowCostModel from policy', () => {
      tracker.setDowngradePolicy({ enabled: true, lowCostModel: 'gpt-4o-mini', criticalAgentIds: [] });
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.85 }));

      expect(tracker.getEffectiveModel('gpt-4o')).toBe('gpt-4o-mini');
    });
  });

  // ---------------------------------------------------------------------------
  // Task 3.1: 预算管理与预警逻辑
  // ---------------------------------------------------------------------------

  describe('budget percentages (Task 3.1)', () => {
    it('computes budgetUsedPercent correctly', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.5 }));

      const snap = tracker.getSnapshot();
      expect(snap.budgetUsedPercent).toBeCloseTo(0.5);
    });

    it('computes tokenUsedPercent correctly', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 1000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ tokensIn: 300, tokensOut: 200, actualCost: 0.001 }));

      const snap = tracker.getSnapshot();
      // (300 + 200) / 1000 = 0.5
      expect(snap.tokenUsedPercent).toBeCloseTo(0.5);
    });

    it('caps budgetUsedPercent at 1.0', () => {
      tracker.setBudget({ maxCost: 0.01, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.05 }));

      const snap = tracker.getSnapshot();
      expect(snap.budgetUsedPercent).toBe(1.0);
    });

    it('caps tokenUsedPercent at 1.0', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 100, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ tokensIn: 80, tokensOut: 80, actualCost: 0.001 }));

      const snap = tracker.getSnapshot();
      expect(snap.tokenUsedPercent).toBe(1.0);
    });

    it('returns 0 for budgetUsedPercent when maxCost is 0', () => {
      tracker.setBudget({ maxCost: 0, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.5 }));

      const snap = tracker.getSnapshot();
      expect(snap.budgetUsedPercent).toBe(0);
    });

    it('returns 0 for tokenUsedPercent when maxTokens is 0', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 0, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ tokensIn: 500, tokensOut: 500, actualCost: 0.001 }));

      const snap = tracker.getSnapshot();
      expect(snap.tokenUsedPercent).toBe(0);
    });
  });

  describe('checkAlerts (Task 3.1)', () => {
    it('generates cost_warning when cost exceeds warning threshold', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      // 0.81 > 1.0 * 0.8 = 0.8 → cost_warning
      tracker.recordCall(makeRecord({ actualCost: 0.81 }));

      const alerts = tracker.getAlerts();
      expect(alerts.some((a) => a.type === 'cost_warning')).toBe(true);
    });

    it('generates token_warning when tokens exceed warning threshold', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 1000, warningThreshold: 0.8 });
      // 500 + 400 = 900 > 1000 * 0.8 = 800 → token_warning
      tracker.recordCall(makeRecord({ tokensIn: 500, tokensOut: 400, actualCost: 0.001 }));

      const alerts = tracker.getAlerts();
      expect(alerts.some((a) => a.type === 'token_warning')).toBe(true);
    });

    it('generates cost_exceeded when cost reaches maxCost', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.5 }));

      const alerts = tracker.getAlerts();
      expect(alerts.some((a) => a.type === 'cost_exceeded')).toBe(true);
    });

    it('generates token_exceeded when tokens reach maxTokens', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 500, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ tokensIn: 300, tokensOut: 200, actualCost: 0.001 }));

      const alerts = tracker.getAlerts();
      expect(alerts.some((a) => a.type === 'token_exceeded')).toBe(true);
    });

    it('does not duplicate alerts of the same type', () => {
      tracker.setBudget({ maxCost: 1.0, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.85 }));
      tracker.recordCall(makeRecord({ actualCost: 0.05 }));

      const costWarnings = tracker.getAlerts().filter((a) => a.type === 'cost_warning');
      expect(costWarnings).toHaveLength(1);
    });

    it('does not generate alerts when below thresholds', () => {
      tracker.setBudget({ maxCost: 10, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ tokensIn: 10, tokensOut: 5, actualCost: 0.001 }));

      expect(tracker.getAlerts()).toHaveLength(0);
    });

    it('generates both warning and exceeded when cost jumps past both', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      // 0.6 > 0.5 * 0.8 = 0.4 (warning) AND 0.6 >= 0.5 (exceeded)
      tracker.recordCall(makeRecord({ actualCost: 0.6 }));

      const types = tracker.getAlerts().map((a) => a.type);
      expect(types).toContain('cost_warning');
      expect(types).toContain('cost_exceeded');
    });

    it('each alert has a unique id and timestamp', () => {
      tracker.setBudget({ maxCost: 0.01, maxTokens: 100, warningThreshold: 0.5 });
      tracker.recordCall(makeRecord({ tokensIn: 80, tokensOut: 80, actualCost: 0.02 }));

      const alerts = tracker.getAlerts();
      expect(alerts.length).toBeGreaterThanOrEqual(2);
      const ids = alerts.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length); // all unique
      for (const a of alerts) {
        expect(a.timestamp).toBeGreaterThan(0);
        expect(a.resolved).toBe(false);
      }
    });
  });

  describe('setBudget triggers re-evaluation (Task 3.1)', () => {
    it('generates alerts when budget is lowered below current cost', () => {
      tracker.recordCall(makeRecord({ actualCost: 0.5 }));
      expect(tracker.getAlerts()).toHaveLength(0);

      // Lower budget so 0.5 >= 0.4 (maxCost) → cost_exceeded + cost_warning
      tracker.setBudget({ maxCost: 0.4, maxTokens: 100000, warningThreshold: 0.8 });

      const types = tracker.getAlerts().map((a) => a.type);
      expect(types).toContain('cost_exceeded');
      expect(types).toContain('cost_warning');
    });

    it('does not clear existing alerts when budget is raised', () => {
      tracker.setBudget({ maxCost: 0.5, maxTokens: 100000, warningThreshold: 0.8 });
      tracker.recordCall(makeRecord({ actualCost: 0.5 }));
      const alertsBefore = tracker.getAlerts().length;
      expect(alertsBefore).toBeGreaterThan(0);

      // Raise budget — existing alerts remain (they are not cleared)
      tracker.setBudget({ maxCost: 10, maxTokens: 100000, warningThreshold: 0.8 });
      expect(tracker.getAlerts().length).toBe(alertsBefore);
    });
  });

  describe('alerts cleared on mission lifecycle (Task 3.1)', () => {
    it('clears alerts on resetCurrentMission', () => {
      tracker.setBudget({ maxCost: 0.01, maxTokens: 100, warningThreshold: 0.5 });
      tracker.recordCall(makeRecord({ tokensIn: 80, tokensOut: 80, actualCost: 0.02 }));
      expect(tracker.getAlerts().length).toBeGreaterThan(0);

      tracker.resetCurrentMission();
      expect(tracker.getAlerts()).toHaveLength(0);
    });

    it('clears alerts on finalizeMission', () => {
      tracker.setBudget({ maxCost: 0.01, maxTokens: 100, warningThreshold: 0.5 });
      tracker.recordCall(makeRecord({ tokensIn: 80, tokensOut: 80, actualCost: 0.02 }));
      expect(tracker.getAlerts().length).toBeGreaterThan(0);

      tracker.finalizeMission('m-1', 'Done');
      expect(tracker.getAlerts()).toHaveLength(0);
    });
  });
});


// ---------------------------------------------------------------------------
// Task 6.1: JSON 文件持久化
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('CostTracker persistence (Task 6.1)', () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-tracker-test-'));
    historyPath = path.join(tmpDir, 'cost-history.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTracker(): CostTracker {
    return new CostTracker(historyPath);
  }

  // ---- persistHistory (via finalizeMission) ----

  it('writes cost-history.json after finalizeMission', () => {
    const tracker = createTracker();
    tracker.recordCall(makeRecord({ tokensIn: 100, tokensOut: 50, actualCost: 0.01 }));
    tracker.finalizeMission('m-1', 'Test Mission');

    expect(fs.existsSync(historyPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(data.version).toBe(1);
    expect(data.missions).toHaveLength(1);
    expect(data.missions[0].missionId).toBe('m-1');
    expect(data.missions[0].title).toBe('Test Mission');
  });

  it('persists budget and downgradePolicy', () => {
    const tracker = createTracker();
    tracker.setBudget({ maxCost: 5.0, maxTokens: 50000, warningThreshold: 0.9 });
    tracker.setDowngradePolicy({ enabled: false, lowCostModel: 'gpt-4o-mini', criticalAgentIds: ['a1'] });

    tracker.recordCall(makeRecord({ actualCost: 0.01 }));
    tracker.finalizeMission('m-1', 'Budget Test');

    const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(data.budget.maxCost).toBe(5.0);
    expect(data.budget.maxTokens).toBe(50000);
    expect(data.budget.warningThreshold).toBe(0.9);
    expect(data.downgradePolicy.enabled).toBe(false);
    expect(data.downgradePolicy.lowCostModel).toBe('gpt-4o-mini');
    expect(data.downgradePolicy.criticalAgentIds).toEqual(['a1']);
  });

  it('persists after setBudget', () => {
    const tracker = createTracker();
    tracker.setBudget({ maxCost: 2.0, maxTokens: 200000, warningThreshold: 0.7 });

    expect(fs.existsSync(historyPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(data.budget.maxCost).toBe(2.0);
  });

  it('persists after setDowngradePolicy', () => {
    const tracker = createTracker();
    tracker.setDowngradePolicy({ enabled: true, lowCostModel: 'glm-4.6', criticalAgentIds: ['x'] });

    expect(fs.existsSync(historyPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(data.downgradePolicy.criticalAgentIds).toEqual(['x']);
  });

  it('creates data directory if it does not exist', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'cost-history.json');
    const tracker = new CostTracker(nestedPath);
    tracker.recordCall(makeRecord({ actualCost: 0.01 }));
    tracker.finalizeMission('m-1', 'Nested');

    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  // ---- loadHistory ----

  it('loads history from existing file', () => {
    // First tracker writes data
    const tracker1 = createTracker();
    tracker1.setBudget({ maxCost: 3.0, maxTokens: 30000, warningThreshold: 0.75 });
    tracker1.recordCall(makeRecord({ tokensIn: 200, tokensOut: 100, actualCost: 0.02 }));
    tracker1.finalizeMission('m-1', 'Persisted Mission');

    // Second tracker loads it
    const tracker2 = createTracker();
    tracker2.loadHistory();

    const history = tracker2.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].missionId).toBe('m-1');
    expect(history[0].title).toBe('Persisted Mission');

    const budget = tracker2.getBudget();
    expect(budget.maxCost).toBe(3.0);
    expect(budget.maxTokens).toBe(30000);
    expect(budget.warningThreshold).toBe(0.75);
  });

  it('restores downgradePolicy from file', () => {
    const tracker1 = createTracker();
    tracker1.setDowngradePolicy({ enabled: false, lowCostModel: 'gpt-4o-mini', criticalAgentIds: ['c1', 'c2'] });
    // setDowngradePolicy triggers persist

    const tracker2 = createTracker();
    tracker2.loadHistory();

    const policy = tracker2.getDowngradePolicy();
    expect(policy.enabled).toBe(false);
    expect(policy.lowCostModel).toBe('gpt-4o-mini');
    expect(policy.criticalAgentIds).toEqual(['c1', 'c2']);
  });

  it('keeps last 10 missions on load', () => {
    const tracker1 = createTracker();
    for (let i = 0; i < 12; i++) {
      tracker1.recordCall(makeRecord({ actualCost: 0.001 }));
      tracker1.finalizeMission(`m-${i}`, `Mission ${i}`);
    }

    const tracker2 = createTracker();
    tracker2.loadHistory();

    const history = tracker2.getHistory();
    expect(history).toHaveLength(10);
    expect(history[0].missionId).toBe('m-2');
    expect(history[9].missionId).toBe('m-11');
  });

  // ---- error handling ----

  it('starts with empty history when file does not exist', () => {
    const tracker = createTracker();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    tracker.loadHistory();

    expect(tracker.getHistory()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('持久化文件不存在'),
    );

    warnSpy.mockRestore();
  });

  it('starts with empty history when file is corrupted', () => {
    fs.writeFileSync(historyPath, '{{invalid json!!!', 'utf-8');

    const tracker = createTracker();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    tracker.loadHistory();

    expect(tracker.getHistory()).toHaveLength(0);
    expect(tracker.getBudget()).toEqual(expect.objectContaining({ maxCost: 1.0 }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('持久化文件损坏'),
    );

    warnSpy.mockRestore();
  });

  it('keeps defaults when file has partial/invalid budget', () => {
    fs.writeFileSync(historyPath, JSON.stringify({
      version: 1,
      budget: { maxCost: 'not-a-number' },
      downgradePolicy: { enabled: true, lowCostModel: 'glm-4.6', criticalAgentIds: [] },
      missions: [],
    }), 'utf-8');

    const tracker = createTracker();
    tracker.loadHistory();

    // Should keep default budget since the file had invalid data
    expect(tracker.getBudget().maxCost).toBe(1.0);
  });

  it('does not throw on write failure (read-only dir)', () => {
    // Use a path that can't be written to
    const badPath = path.join(tmpDir, '\0invalid', 'cost-history.json');
    const tracker = new CostTracker(badPath);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw
    expect(() => {
      tracker.recordCall(makeRecord({ actualCost: 0.01 }));
      tracker.finalizeMission('m-1', 'Fail Write');
    }).not.toThrow();

    errorSpy.mockRestore();
  });

  // ---- round-trip consistency ----

  it('round-trips mission data correctly', () => {
    const tracker1 = createTracker();

    tracker1.recordCall(makeRecord({
      agentId: 'agent-a',
      tokensIn: 500,
      tokensOut: 300,
      actualCost: 0.05,
    }));
    tracker1.recordCall(makeRecord({
      agentId: 'agent-b',
      tokensIn: 200,
      tokensOut: 100,
      actualCost: 0.02,
    }));
    tracker1.finalizeMission('m-rt', 'Round Trip');

    const tracker2 = createTracker();
    tracker2.loadHistory();

    const history = tracker2.getHistory();
    expect(history).toHaveLength(1);

    const mission = history[0];
    expect(mission.missionId).toBe('m-rt');
    expect(mission.title).toBe('Round Trip');
    expect(mission.totalTokensIn).toBe(700);
    expect(mission.totalTokensOut).toBe(400);
    expect(mission.totalCost).toBeCloseTo(0.07);
    expect(mission.totalCalls).toBe(2);
    expect(mission.topAgents).toHaveLength(2);
  });
});
