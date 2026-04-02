import { describe, expect, it, beforeEach } from 'vitest';
import type { AutonomyConfig } from '../../shared/autonomy-types.js';
import { CapabilityProfileManager } from '../core/capability-profile-manager.js';
import { SelfAssessment, type TaskRequest } from '../core/self-assessment.js';

// ─── Test helpers ────────────────────────────────────────────

function makeConfig(overrides?: Partial<AutonomyConfig>): AutonomyConfig {
  return {
    enabled: true,
    assessmentWeights: {
      w1_skillMatch: 0.4,
      w2_loadFactor: 0.2,
      w3_confidence: 0.25,
      w4_resource: 0.15,
    },
    competition: { defaultContestantCount: 3, maxDeadlineMs: 300_000, budgetRatio: 0.3 },
    taskforce: { heartbeatIntervalMs: 30_000, maxMissedHeartbeats: 3 },
    skillDecay: { inactiveDays: 30, decayRatePerWeek: 0.05 },
    ...overrides,
  };
}

function makeTask(overrides?: Partial<TaskRequest>): TaskRequest {
  return {
    taskId: 'task-1',
    requiredSkills: ['coding', 'testing'],
    requiredSkillWeights: new Map([['coding', 0.8], ['testing', 0.6]]),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('SelfAssessment', () => {
  let config: AutonomyConfig;
  let pm: CapabilityProfileManager;
  let sa: SelfAssessment;

  beforeEach(() => {
    config = makeConfig();
    pm = new CapabilityProfileManager(config);
    sa = new SelfAssessment(pm, config);
  });

  // ─── coarseFilter ──────────────────────────────────────────

  describe('coarseFilter', () => {
    it('returns true when there is overlap', () => {
      expect(sa.coarseFilter(['coding', 'design'], ['coding', 'testing'])).toBe(true);
    });

    it('returns false when there is no overlap', () => {
      expect(sa.coarseFilter(['design', 'art'], ['coding', 'testing'])).toBe(false);
    });

    it('returns false when agentTags is empty', () => {
      expect(sa.coarseFilter([], ['coding'])).toBe(false);
    });

    it('returns false when requiredSkills is empty', () => {
      expect(sa.coarseFilter(['coding'], [])).toBe(false);
    });

    it('returns false when both are empty', () => {
      expect(sa.coarseFilter([], [])).toBe(false);
    });
  });

  // ─── computeSkillMatch ───────────────────────────────────────

  describe('computeSkillMatch', () => {
    it('returns 1.0 for identical non-zero vectors', () => {
      const v = new Map([['a', 0.8], ['b', 0.6]]);
      expect(sa.computeSkillMatch(v, v)).toBeCloseTo(1.0, 5);
    });

    it('returns 0.0 for orthogonal vectors', () => {
      const a = new Map([['x', 1.0]]);
      const b = new Map([['y', 1.0]]);
      expect(sa.computeSkillMatch(a, b)).toBeCloseTo(0.0, 5);
    });

    it('returns 0.0 when agent vector is empty', () => {
      const empty = new Map<string, number>();
      const task = new Map([['a', 0.5]]);
      expect(sa.computeSkillMatch(empty, task)).toBe(0);
    });

    it('returns 0.0 when task vector is empty', () => {
      const agent = new Map([['a', 0.5]]);
      const empty = new Map<string, number>();
      expect(sa.computeSkillMatch(agent, empty)).toBe(0);
    });

    it('returns value in [0, 1] for partial overlap', () => {
      const agent = new Map([['a', 0.9], ['b', 0.3]]);
      const task = new Map([['a', 0.5], ['c', 0.7]]);
      const result = sa.computeSkillMatch(agent, task);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  // ─── computeFitnessScore ─────────────────────────────────────

  describe('computeFitnessScore', () => {
    it('computes correct weighted sum with default weights', () => {
      // fitness = 0.4*1.0 + 0.2*(1-0) + 0.25*1.0 + 0.15*1.0 = 1.0
      expect(sa.computeFitnessScore(1, 0, 1, 1, config.assessmentWeights)).toBeCloseTo(1.0, 5);
    });

    it('returns 0 when all inputs are worst-case', () => {
      // fitness = 0.4*0 + 0.2*(1-1) + 0.25*0 + 0.15*0 = 0
      expect(sa.computeFitnessScore(0, 1, 0, 0, config.assessmentWeights)).toBeCloseTo(0.0, 5);
    });

    it('clamps result to [0, 1]', () => {
      const result = sa.computeFitnessScore(0.5, 0.5, 0.5, 0.5, config.assessmentWeights);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  // ─── makeDecision ────────────────────────────────────────────

  describe('makeDecision', () => {
    it('returns ACCEPT for >= 0.8', () => {
      expect(sa.makeDecision(0.8)).toBe('ACCEPT');
      expect(sa.makeDecision(0.95)).toBe('ACCEPT');
      expect(sa.makeDecision(1.0)).toBe('ACCEPT');
    });

    it('returns ACCEPT_WITH_CAVEAT for [0.6, 0.8)', () => {
      expect(sa.makeDecision(0.6)).toBe('ACCEPT_WITH_CAVEAT');
      expect(sa.makeDecision(0.7)).toBe('ACCEPT_WITH_CAVEAT');
      expect(sa.makeDecision(0.79)).toBe('ACCEPT_WITH_CAVEAT');
    });

    it('returns REQUEST_ASSIST for [0.4, 0.6)', () => {
      expect(sa.makeDecision(0.4)).toBe('REQUEST_ASSIST');
      expect(sa.makeDecision(0.5)).toBe('REQUEST_ASSIST');
      expect(sa.makeDecision(0.59)).toBe('REQUEST_ASSIST');
    });

    it('returns REJECT_AND_REFER for < 0.4', () => {
      expect(sa.makeDecision(0.0)).toBe('REJECT_AND_REFER');
      expect(sa.makeDecision(0.2)).toBe('REJECT_AND_REFER');
      expect(sa.makeDecision(0.39)).toBe('REJECT_AND_REFER');
    });
  });

  // ─── computeResourceAdequacy ─────────────────────────────────

  describe('computeResourceAdequacy', () => {
    it('returns 1.0 for budget >= 50000', () => {
      expect(sa.computeResourceAdequacy(50_000)).toBeCloseTo(1.0);
      expect(sa.computeResourceAdequacy(100_000)).toBeCloseTo(1.0);
    });

    it('returns 0.5 for budget = 25000', () => {
      expect(sa.computeResourceAdequacy(25_000)).toBeCloseTo(0.5);
    });

    it('returns 0 for budget = 0', () => {
      expect(sa.computeResourceAdequacy(0)).toBe(0);
    });
  });

  // ─── assess (integration) ────────────────────────────────────

  describe('assess', () => {
    it('returns REJECT_AND_REFER with reason "profile missing" for unknown agent', () => {
      const result = sa.assess('unknown', makeTask());
      expect(result.decision).toBe('REJECT_AND_REFER');
      expect(result.reason).toBe('profile missing');
      expect(result.fitnessScore).toBe(0);
    });

    it('returns REJECT_AND_REFER when coarse filter fails', () => {
      pm.initProfile('agent-1', ['art', 'design']);
      const task = makeTask({ requiredSkills: ['coding', 'testing'] });
      const result = sa.assess('agent-1', task);
      expect(result.decision).toBe('REJECT_AND_REFER');
      expect(result.reason).toContain('coarse filter failed');
    });

    it('returns a valid AssessmentResult for a capable agent', () => {
      const profile = pm.initProfile('agent-1', ['coding', 'testing']);
      profile.skillVector.set('coding', 0.9);
      profile.skillVector.set('testing', 0.8);
      profile.confidenceScore = 0.9;
      profile.resourceQuota.remainingTokenBudget = 80_000;

      const result = sa.assess('agent-1', makeTask());
      expect(result.agentId).toBe('agent-1');
      expect(result.taskId).toBe('task-1');
      expect(result.fitnessScore).toBeGreaterThan(0);
      expect(['ACCEPT', 'ACCEPT_WITH_CAVEAT', 'REQUEST_ASSIST', 'REJECT_AND_REFER']).toContain(result.decision);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('generates referralList only for REJECT_AND_REFER', () => {
      // Create a strong agent that will ACCEPT
      const p1 = pm.initProfile('strong', ['coding', 'testing']);
      p1.skillVector.set('coding', 0.95);
      p1.skillVector.set('testing', 0.9);
      p1.confidenceScore = 0.95;
      p1.resourceQuota.remainingTokenBudget = 100_000;

      const result = sa.assess('strong', makeTask());
      if (result.decision !== 'REJECT_AND_REFER') {
        expect(result.referralList).toEqual([]);
      }
    });
  });

  // ─── generateReferralList ────────────────────────────────────

  describe('generateReferralList', () => {
    it('excludes the given agent', () => {
      pm.initProfile('a', ['coding']);
      pm.initProfile('b', ['coding']);
      pm.initProfile('c', ['coding']);

      const list = sa.generateReferralList(makeTask(), 'a');
      expect(list).not.toContain('a');
    });

    it('returns at most maxCount agents', () => {
      for (let i = 0; i < 10; i++) {
        pm.initProfile(`agent-${i}`, ['coding']);
      }
      const list = sa.generateReferralList(makeTask(), 'agent-0', 3);
      expect(list.length).toBeLessThanOrEqual(3);
    });

    it('returns agents sorted by fitness descending', () => {
      const p1 = pm.initProfile('low', ['coding']);
      p1.skillVector.set('coding', 0.1);
      p1.confidenceScore = 0.2;

      const p2 = pm.initProfile('high', ['coding']);
      p2.skillVector.set('coding', 0.95);
      p2.confidenceScore = 0.95;
      p2.resourceQuota.remainingTokenBudget = 100_000;

      const list = sa.generateReferralList(makeTask(), 'excluded');
      expect(list[0]).toBe('high');
    });

    it('returns empty array when no other agents exist', () => {
      pm.initProfile('only', ['coding']);
      const list = sa.generateReferralList(makeTask(), 'only');
      expect(list).toEqual([]);
    });
  });
});
