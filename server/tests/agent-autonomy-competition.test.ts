// Feature: agent-autonomy-upgrade - Competition Engine & Judge Agent PBT (Properties 15-23)
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CapabilityProfileManager } from "../core/capability-profile-manager.js";
import { CompetitionEngine } from "../core/competition-engine.js";
import type { CompetitionTaskRequest } from "../core/competition-engine.js";
import { JudgeAgent } from "../core/judge-agent.js";
import type { LLMProvider } from "../core/judge-agent.js";
import { CostMonitor } from "../core/cost-monitor.js";
import type {
  AutonomyConfig,
  JudgingScore,
} from "../../shared/autonomy-types.js";

const DC: AutonomyConfig = {
  enabled: true,
  assessmentWeights: {
    w1_skillMatch: 0.4,
    w2_loadFactor: 0.2,
    w3_confidence: 0.25,
    w4_resource: 0.15,
  },
  competition: {
    defaultContestantCount: 3,
    maxDeadlineMs: 300_000,
    budgetRatio: 0.3,
  },
  taskforce: { heartbeatIntervalMs: 30_000, maxMissedHeartbeats: 3 },
  skillDecay: { inactiveDays: 30, decayRatePerWeek: 0.05 },
};

function makeConfig(ov?: Partial<AutonomyConfig>): AutonomyConfig {
  return { ...DC, ...ov };
}
function makePM(c = DC) {
  return new CapabilityProfileManager(c);
}
function makeCM(c = DC) {
  return new CostMonitor(c);
}
function makeCE(pm?: CapabilityProfileManager, cm?: CostMonitor, c = DC) {
  return new CompetitionEngine(pm ?? makePM(c), cm ?? makeCM(c), c);
}
const mockLLM: LLMProvider = { review: async () => "" };
function makeJA(c = DC) {
  return new JudgeAgent(mockLLM, c);
}

const arbTask = (
  ov?: Partial<CompetitionTaskRequest>
): fc.Arbitrary<CompetitionTaskRequest> =>
  fc
    .record({
      taskId: fc.string({ minLength: 1, maxLength: 8 }),
      requiredSkills: fc.array(fc.string({ minLength: 1, maxLength: 6 }), {
        minLength: 1,
        maxLength: 3,
      }),
      requiredSkillWeights: fc.constant(new Map<string, number>()),
      priority: fc.constantFrom(
        "critical" as const,
        "high" as const,
        "normal" as const,
        "low" as const
      ),
      qualityRequirement: fc.constantFrom(
        "high" as const,
        "normal" as const,
        "low" as const
      ),
      dataSecurityLevel: fc.constantFrom(
        "sensitive" as const,
        "normal" as const
      ),
      estimatedDurationMs: fc.integer({ min: 1000, max: 600_000 }),
      manualCompetition: fc.boolean(),
      historicalFailRate: fc.double({ min: 0, max: 1, noNaN: true }),
      descriptionAmbiguity: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(t => ({ ...t, ...ov }));

const arb01 = fc.double({ min: 0, max: 1, noNaN: true });

// Feature: agent-autonomy-upgrade, Property 15: 竞争模式触发条件
// Validates: Requirements 4.1
describe("Property 15: 竞争模式触发条件", () => {
  it("should trigger iff any condition is met", () => {
    fc.assert(
      fc.property(arbTask(), arb01, (task, bestFitness) => {
        const ce = makeCE();
        const result = ce.shouldTrigger(task, bestFitness);
        const unc = ce.computeUncertainty(task, bestFitness);
        const expected =
          task.priority === "critical" ||
          task.qualityRequirement === "high" ||
          unc > 0.7 ||
          task.manualCompetition === true;
        expect(result).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
  it("returns false when no conditions met", () => {
    const task: CompetitionTaskRequest = {
      taskId: "t1",
      requiredSkills: ["a"],
      requiredSkillWeights: new Map(),
      priority: "normal",
      qualityRequirement: "normal",
      dataSecurityLevel: "normal",
      estimatedDurationMs: 10000,
      manualCompetition: false,
      historicalFailRate: 0,
      descriptionAmbiguity: 0,
    };
    expect(makeCE().shouldTrigger(task, 1.0)).toBe(false);
  });
});

// Feature: agent-autonomy-upgrade, Property 16: 竞争预算检查
// Validates: Requirements 4.2, 8.2
describe("Property 16: 竞争预算检查", () => {
  it("approved iff estimatedTokens <= remainingBudget * budgetRatio", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 10_000_000, noNaN: true }),
        (est, rem) => {
          const result = makeCM().checkCompetitionBudget(est, rem);
          const limit = rem * DC.competition.budgetRatio;
          if (est > limit) expect(result.approved).toBe(false);
          else expect(result.approved).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 17: 多样性优先参赛者选择
// Validates: Requirements 4.3
describe("Property 17: 多样性优先参赛者选择", () => {
  it("returns <= N agents, no duplicates, all have profiles", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.array(
          fc.record({
            id: fc.stringMatching(/^[a-z]{1,6}$/),
            conf: fc.double({ min: 0.6, max: 1, noNaN: true }),
            skills: fc.dictionary(
              fc.constantFrom("js", "py", "go", "rust", "sql"),
              fc.double({ min: 0.3, max: 1, noNaN: true }),
              { minKeys: 1, maxKeys: 3 }
            ),
          }),
          { minLength: 6, maxLength: 10 }
        ),
        (n, agents) => {
          const seen = new Set<string>();
          const uniq = agents.filter(a => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
          });
          if (uniq.length < n) return;
          const pm = makePM();
          for (const a of uniq) {
            const p = pm.initProfile(a.id, Object.keys(a.skills));
            for (const [k, v] of Object.entries(a.skills))
              p.skillVector.set(k, v);
            p.confidenceScore = a.conf;
          }
          const result = makeCE(pm).selectContestants(
            uniq.map(a => a.id),
            n
          );
          expect(result.length).toBeLessThanOrEqual(n);
          expect(result.length).toBeGreaterThan(0);
          expect(new Set(result).size).toBe(result.length);
          for (const id of result) expect(pm.getProfile(id)).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 18: 外部 Agent 安全校验
// Validates: Requirements 4.4
describe("Property 18: 外部 Agent 安全校验", () => {
  it("blocks external agents on sensitive tasks, allows otherwise", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom("sensitive" as const, "normal" as const),
        (isExt, secLvl) => {
          const pm = makePM();
          pm.initProfile("a1", isExt ? ["external", "coding"] : ["coding"]);
          const task: CompetitionTaskRequest = {
            taskId: "t1",
            requiredSkills: ["coding"],
            requiredSkillWeights: new Map(),
            priority: "normal",
            qualityRequirement: "normal",
            dataSecurityLevel: secLvl,
            estimatedDurationMs: 10000,
            manualCompetition: false,
            historicalFailRate: 0,
            descriptionAmbiguity: 0,
          };
          const result = makeCE(pm).checkDataSecurity("a1", task);
          if (secLvl === "sensitive" && isExt) expect(result).toBe(false);
          else expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 19: 竞争 deadline 计算
// Validates: Requirements 4.6
describe("Property 19: 竞争 deadline 计算", () => {
  it("deadline = min(estimatedDurationMs * 1.5, maxDeadlineMs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1000, max: 1_000_000 }),
        (estMs, maxMs) => {
          const cfg = makeConfig({
            competition: { ...DC.competition, maxDeadlineMs: maxMs },
          });
          const dl = makeCE(undefined, undefined, cfg).computeDeadline(estMs);
          expect(dl).toBeCloseTo(Math.min(estMs * 1.5, maxMs), 5);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 20: 裁判加权评分公式
// Validates: Requirements 5.1
describe("Property 20: 裁判加权评分公式", () => {
  it("totalWeighted = 0.35*c + 0.30*q + 0.20*e + 0.15*n, in [0,1]", () => {
    fc.assert(
      fc.property(arb01, arb01, arb01, arb01, (c, q, e, n) => {
        const input: JudgingScore[] = [
          {
            agentId: "a1",
            correctness: c,
            quality: q,
            efficiency: e,
            novelty: n,
            totalWeighted: 0,
          },
        ];
        const [r] = makeJA().computeWeightedScores(input);
        const exp = 0.35 * c + 0.3 * q + 0.2 * e + 0.15 * n;
        expect(r.totalWeighted).toBeCloseTo(Math.min(Math.max(exp, 0), 1), 10);
        expect(r.totalWeighted).toBeGreaterThanOrEqual(0);
        expect(r.totalWeighted).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 21: 竞争结果能力画像回写
// Validates: Requirements 5.4
describe("Property 21: 竞争结果能力画像回写", () => {
  it("1st +0.05 (cap 1.0), last -0.03 (floor 0.0), middle unchanged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 5 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (cnt, base) => {
          const pm = makePM();
          const ids: string[] = [];
          for (let i = 0; i < cnt; i++) {
            ids.push(`ag${i}`);
            const p = pm.initProfile(`ag${i}`, ["coding"]);
            p.skillVector.set("coding", base);
          }
          const before = ids.map(
            id => pm.getProfile(id)!.skillVector.get("coding")!
          );
          pm.applyCompetitionReward(ids[0], 0.05);
          pm.applyCompetitionReward(ids[ids.length - 1], -0.03);
          expect(pm.getProfile(ids[0])!.skillVector.get("coding")!).toBeCloseTo(
            Math.min(before[0] + 0.05, 1.0),
            10
          );
          expect(
            pm.getProfile(ids[ids.length - 1])!.skillVector.get("coding")!
          ).toBeCloseTo(Math.max(before[cnt - 1] - 0.03, 0.0), 10);
          for (let i = 1; i < cnt - 1; i++)
            expect(
              pm.getProfile(ids[i])!.skillVector.get("coding")!
            ).toBeCloseTo(before[i], 10);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 22: Judge 置信度下调
// Validates: Requirements 5.5
describe("Property 22: Judge 置信度下调", () => {
  it("N overrides → confidence decreases by N*0.1, alert when < 0.5", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), n => {
        const ja = makeJA();
        expect(ja.getJudgeConfidenceScore()).toBe(1.0);
        const alerts: string[] = [];
        const ow = console.warn;
        console.warn = (m: string) => {
          alerts.push(m);
        };
        for (let i = 0; i < n; i++) ja.onJudgmentOverridden();
        console.warn = ow;
        const exp = Math.max(1.0 - n * 0.1, 0);
        expect(ja.getJudgeConfidenceScore()).toBeCloseTo(exp, 10);
        if (exp < 0.5)
          expect(alerts.some(a => a.includes("JUDGE_RELIABILITY_LOW"))).toBe(
            true
          );
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: agent-autonomy-upgrade, Property 23: 合并触发条件
// Validates: Requirements 5.7
describe("Property 23: 合并触发条件", () => {
  it("merge when |top1-top2|/max < 0.05, no merge when >= 0.05", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (s1, s2) => {
          const scores: JudgingScore[] = [
            {
              agentId: "a1",
              correctness: 0,
              quality: 0,
              efficiency: 0,
              novelty: 0,
              totalWeighted: s1,
            },
            {
              agentId: "a2",
              correctness: 0,
              quality: 0,
              efficiency: 0,
              novelty: 0,
              totalWeighted: s2,
            },
          ];
          const result = makeJA().checkMergeRequired(scores);
          const mx = Math.max(s1, s2);
          expect(result).toBe(Math.abs(s1 - s2) / mx < 0.05);
        }
      ),
      { numRuns: 200 }
    );
  });
  it("returns false for single contestant", () => {
    const scores: JudgingScore[] = [
      {
        agentId: "a1",
        correctness: 1,
        quality: 1,
        efficiency: 1,
        novelty: 1,
        totalWeighted: 1,
      },
    ];
    expect(makeJA().checkMergeRequired(scores)).toBe(false);
  });
});
