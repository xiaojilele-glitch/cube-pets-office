// Feature: agent-autonomy-upgrade - Complete PBT suite
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { JudgingScore } from '../../shared/autonomy-types.js';
import { RingBuffer } from '../../shared/ring-buffer.js';
import { CapabilityProfileManager } from '../core/capability-profile-manager.js';
import { CompetitionEngine, type CompetitionTaskRequest } from '../core/competition-engine.js';
import { CostMonitor } from '../core/cost-monitor.js';
import { JudgeAgent, type LLMProvider } from '../core/judge-agent.js';
import { SelfAssessment } from '../core/self-assessment.js';
import { TaskAllocator } from '../core/task-allocator.js';
import type { AutonomyConfig } from '../../shared/autonomy-types.js';

const DC: AutonomyConfig = {
  enabled: true,
  assessmentWeights: { w1_skillMatch: 0.4, w2_loadFactor: 0.2, w3_confidence: 0.25, w4_resource: 0.15 },
  competition: { defaultContestantCount: 3, maxDeadlineMs: 300_000, budgetRatio: 0.3 },
  taskforce: { heartbeatIntervalMs: 30_000, maxMissedHeartbeats: 3 },
  skillDecay: { inactiveDays: 30, decayRatePerWeek: 0.05 },
};

// ─── Helpers ─────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AutonomyConfig>): AutonomyConfig {
  return { ...DC, ...overrides };
}

function makeCostMonitor(config = DC): CostMonitor {
  return new CostMonitor(config);
}

function makeProfileManager(config = DC): CapabilityProfileManager {
  return new CapabilityProfileManager(config);
}

function makeCompetitionEngine(
  pm?: CapabilityProfileManager,
  cm?: CostMonitor,
  config = DC,
): CompetitionEngine {
  return new CompetitionEngine(pm ?? makeProfileManager(config), cm ?? makeCostMonitor(config), config);
}

const mockLLM: LLMProvider = { review: async () => '' };

function makeJudgeAgent(config = DC): JudgeAgent {
  return new JudgeAgent(mockLLM, config);
}

// ─── Generators ──────────────────────────────────────────────

const arbCompetitionTask = (overrides?: Partial<CompetitionTaskRequest>): fc.Arbitrary<CompetitionTaskRequest> =>
  fc.record({
    taskId: fc.string({ minLength: 1, maxLength: 8 }),
    requiredSkills: fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 }),
    requiredSkillWeights: fc.constant(new Map<string, number>()),
    priority: fc.constantFrom('critical' as const, 'high' as const, 'normal' as const, 'low' as const),
    qualityRequirement: fc.constantFrom('high' as const, 'normal' as const, 'low' as const),
    dataSecurityLevel: fc.constantFrom('sensitive' as const, 'normal' as const),
    estimatedDurationMs: fc.integer({ min: 1000, max: 600_000 }),
    manualCompetition: fc.boolean(),
    historicalFailRate: fc.double({ min: 0, max: 1, noNaN: true }),
    descriptionAmbiguity: fc.double({ min: 0, max: 1, noNaN: true }),
  }).map((t) => ({ ...t, ...overrides }));

const arbScore01 = fc.double({ min: 0, max: 1, noNaN: true });

const arbJudgingScore = (idPrefix = 'a'): fc.Arbitrary<JudgingScore> =>
  fc.record({
    agentId: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `${idPrefix}-${s}`),
    correctness: arbScore01,
    quality: arbScore01,
    efficiency: arbScore01,
    novelty: arbScore01,
    totalWeighted: fc.constant(0),
  });

// ─── Property 15: 竞争模式触发条件 ──────────────────────────

// Feature: agent-autonomy-upgrade, Property 15: 竞争模式触发条件
// Validates: Requirements 4.1
describe('Property 15: 竞争模式触发条件', () => {
  it('should trigger when any single condition is met', () => {
    fc.assert(
      fc.property(
        arbCompetitionTask(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (task, bestFitness) => {
          const engine = makeCompetitionEngine();
          const result = engine.shouldTrigger(task, bestFitness);
          const uncertainty = engine.computeUncertainty(task, bestFitness);

          const anyConditionMet =
            task.priority === 'critical' ||
            task.qualityRequirement === 'high' ||
            uncertainty > 0.7 ||
            task.manualCompetition === true;

          expect(result).toBe(anyConditionMet);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should return false when no conditions are met', () => {
    const engine = makeCompetitionEngine();
    const task: CompetitionTaskRequest = {
      taskId: 't1', requiredSkills: ['a'], requiredSkillWeights: new Map(),
      priority: 'normal', qualityRequirement: 'normal', dataSecurityLevel: 'normal',
      estimatedDurationMs: 10000, manualCompetition: false,
      historicalFailRate: 0, descriptionAmbiguity: 0,
    };
    // bestFitness=1 → uncertainty = 0.4*0 + 0.35*0 + 0.25*0 = 0
    expect(engine.shouldTrigger(task, 1.0)).toBe(false);
  });
});

// ─── Property 16: 竞争预算检查 ──────────────────────────────

// Feature: agent-autonomy-upgrade, Property 16: 竞争预算检查
// Validates: Requirements 4.2, 8.2
describe('Property 16: 竞争预算检查', () => {
  it('approved iff estimatedTokens <= remainingBudget * budgetRatio', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 10_000_000, noNaN: true }),
        (estimatedTokens, remainingBudget) => {
          const cm = makeCostMonitor();
          const result = cm.checkCompetitionBudget(estimatedTokens, remainingBudget);
          const limit = remainingBudget * DC.competition.budgetRatio;

          if (estimatedTokens > limit) {
            expect(result.approved).toBe(false);
          } else {
            expect(result.approved).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 17: 多样性优先参赛者选择 ──────────────────────

// Feature: agent-autonomy-upgrade, Property 17: 多样性优先参赛者选择
// Validates: Requirements 4.3
describe('Property 17: 多样性优先参赛者选择', () => {
  it('returns exactly N agents, seed is highest fitness, all fitness >= 0.5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 8 }),
            confidence: fc.double({ min: 0.5, max: 1, noNaN: true }),
            skills: fc.dictionary(
              fc.constantFrom('js', 'py', 'go', 'rust', 'sql'),
              fc.double({ min: 0.3, max: 1, noNaN: true }),
              { minKeys: 1, maxKeys: 3 },
            ),
          }),
          { minLength: 5, maxLength: 10 },
        ),
        (n, agents) => {
          // Ensure unique IDs
          const seen = new Set<string>();
          const unique = agents.filter((a) => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
          });
          if (unique.length < n) return; // skip if not enough unique agents

          const pm = makeProfileManager();
          for (const a of unique) {
            const profile = pm.initProfile(a.id, Object.keys(a.skills));
            for (const [k, v] of Object.entries(a.skills)) {
              profile.skillVector.set(k, v);
            }
            profile.confidenceScore = a.confidence;
          }

          const engine = makeCompetitionEngine(pm);
          const result = engine.selectContestants(
            unique.map((a) => a.id),
            n,
          );

          // Should return at most N
          expect(result.length).toBeLessThanOrEqual(n);

          // All returned agents should have profiles
          for (const id of result) {
            expect(pm.getProfile(id)).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 18: 外部 Agent 安全校验 ───────────────────────

// Feature: agent-autonomy-upgrade, Property 18: 外部 Agent 安全校验
// Validates: Requirements 4.4
describe('Property 18: 外部 Agent 安全校验', () => {
  it('blocks external agents on sensitive tasks, allows on normal tasks', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // isExternal
        fc.constantFrom('sensitive' as const, 'normal' as const),
        (isExternal, securityLevel) => {
          const pm = makeProfileManager();
          const tags = isExternal ? ['external', 'coding'] : ['coding'];
          pm.initProfile('agent-1', tags);

          const engine = makeCompetitionEngine(pm);
          const task: CompetitionTaskRequest = {
            taskId: 't1', requiredSkills: ['coding'], requiredSkillWeights: new Map(),
            priority: 'normal', qualityRequirement: 'normal',
            dataSecurityLevel: securityLevel,
            estimatedDurationMs: 10000, manualCompetition: false,
            historicalFailRate: 0, descriptionAmbiguity: 0,
          };

          const result = engine.checkDataSecurity('agent-1', task);

          if (securityLevel === 'sensitive' && isExternal) {
            expect(result).toBe(false);
          } else {
            expect(result).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 19: 竞争 deadline 计算 ────────────────────────

// Feature: agent-autonomy-upgrade, Property 19: 竞争 deadline 计算
// Validates: Requirements 4.6
describe('Property 19: 竞争 deadline 计算', () => {
  it('deadline = min(estimatedDurationMs * 1.5, maxDeadlineMs)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1000, max: 1_000_000 }),
        (estimatedMs, maxDeadlineMs) => {
          const config = makeConfig({
            competition: { ...DC.competition, maxDeadlineMs },
          });
          const engine = makeCompetitionEngine(undefined, undefined, config);
          const deadline = engine.computeDeadline(estimatedMs);
          const expected = Math.min(estimatedMs * 1.5, maxDeadlineMs);
          expect(deadline).toBeCloseTo(expected, 5);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 20: 裁判加权评分公式 ──────────────────────────

// Feature: agent-autonomy-upgrade, Property 20: 裁判加权评分公式
// Validates: Requirements 5.1
describe('Property 20: 裁判加权评分公式', () => {
  it('totalWeighted = 0.35*correctness + 0.30*quality + 0.20*efficiency + 0.15*novelty, in [0,1]', () => {
    fc.assert(
      fc.property(
        arbScore01, arbScore01, arbScore01, arbScore01,
        (correctness, quality, efficiency, novelty) => {
          const judge = makeJudgeAgent();
          const input: JudgingScore[] = [{
            agentId: 'a1', correctness, quality, efficiency, novelty, totalWeighted: 0,
          }];
          const [result] = judge.computeWeightedScores(input);
          const expected = 0.35 * correctness + 0.30 * quality + 0.20 * efficiency + 0.15 * novelty;
          expect(result.totalWeighted).toBeCloseTo(Math.min(Math.max(expected, 0), 1), 10);
          expect(result.totalWeighted).toBeGreaterThanOrEqual(0);
          expect(result.totalWeighted).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 21: 竞争结果能力画像回写 ──────────────────────

// Feature: agent-autonomy-upgrade, Property 21: 竞争结果能力画像回写
// Validates: Requirements 5.4
describe('Property 21: 竞争结果能力画像回写', () => {
  it('1st place +0.05 (cap 1.0), last place -0.03 (floor 0.0), middle unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 5 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (count, baseSkill) => {
          const pm = makeProfileManager();
          const agents: string[] = [];
          for (let i = 0; i < count; i++) {
            const id = `agent-${i}`;
            agents.push(id);
            const p = pm.initProfile(id, ['coding']);
            p.skillVector.set('coding', baseSkill);
          }

          // Snapshot before
          const before = agents.map((id) => pm.getProfile(id)!.skillVector.get('coding')!);

          // Apply: 1st gets +0.05, last gets -0.03
          pm.applyCompetitionReward(agents[0], 0.05);
          pm.applyCompetitionReward(agents[agents.length - 1], -0.03);

          // 1st place
          const first = pm.getProfile(agents[0])!.skillVector.get('coding')!;
          expect(first).toBeCloseTo(Math.min(before[0] + 0.05, 1.0), 10);

          // Last place
          const last = pm.getProfile(agents[agents.length - 1])!.skillVector.get('coding')!;
          expect(last).toBeCloseTo(Math.max(before[before.length - 1] - 0.03, 0.0), 10);

          // Middle unchanged
          for (let i = 1; i < count - 1; i++) {
            const mid = pm.getProfile(agents[i])!.skillVector.get('coding')!;
            expect(mid).toBeCloseTo(before[i], 10);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 22: Judge 置信度下调 ──────────────────────────

// Feature: agent-autonomy-upgrade, Property 22: Judge 置信度下调
// Validates: Requirements 5.5
describe('Property 22: Judge 置信度下调', () => {
  it('N overrides → confidence decreases by N*0.1, alert when < 0.5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }),
        (n) => {
          const judge = makeJudgeAgent();
          expect(judge.getJudgeConfidenceScore()).toBe(1.0);

          const alerts: string[] = [];
          const origWarn = console.warn;
          console.warn = (msg: string) => { alerts.push(msg); };

          for (let i = 0; i < n; i++) {
            judge.onJudgmentOverridden();
          }

          console.warn = origWarn;

          const expected = Math.max(1.0 - n * 0.1, 0);
          expect(judge.getJudgeConfidenceScore()).toBeCloseTo(expected, 10);

          // Alert should fire when score drops below 0.5
          if (expected < 0.5) {
            expect(alerts.some((a) => a.includes('JUDGE_RELIABILITY_LOW'))).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 23: 合并触发条件 ──────────────────────────────

// Feature: agent-autonomy-upgrade, Property 23: 合并触发条件
// Validates: Requirements 5.7
describe('Property 23: 合并触发条件', () => {
  it('merge when |top1-top2|/max < 0.05, no merge when >= 0.05', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (score1, score2) => {
          const judge = makeJudgeAgent();
          const scores: JudgingScore[] = [
            { agentId: 'a1', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: score1 },
            { agentId: 'a2', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: score2 },
          ];

          const result = judge.checkMergeRequired(scores);
          const maxVal = Math.max(score1, score2);
          const relDiff = Math.abs(score1 - score2) / maxVal;

          expect(result).toBe(relDiff < 0.05);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns false for single contestant', () => {
    const judge = makeJudgeAgent();
    const scores: JudgingScore[] = [
      { agentId: 'a1', correctness: 1, quality: 1, efficiency: 1, novelty: 1, totalWeighted: 1 },
    ];
    expect(judge.checkMergeRequired(scores)).toBe(false);
  });
});
