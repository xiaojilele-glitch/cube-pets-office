import { describe, expect, it, beforeEach, vi } from 'vitest';
import type {
  AutonomyConfig,
  CompetitionSession,
  ContestantEntry,
  JudgingScore,
} from '../../shared/autonomy-types.js';
import { JudgeAgent, type LLMProvider } from '../core/judge-agent.js';

// ─── Test helpers ────────────────────────────────────────────

function makeConfig(): AutonomyConfig {
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
  };
}

function makeLLMProvider(): LLMProvider {
  return { review: vi.fn().mockResolvedValue('mock review response') };
}

function makeContestant(overrides?: Partial<ContestantEntry>): ContestantEntry {
  return {
    agentId: 'agent-1',
    isExternal: false,
    result: 'some result',
    submittedAt: Date.now(),
    tokenConsumed: 100,
    timedOut: false,
    ...overrides,
  };
}

function makeSession(contestants: ContestantEntry[]): CompetitionSession {
  return {
    id: 'comp-1',
    taskId: 'task-1',
    contestants,
    status: 'judging',
    deadline: 90_000,
    budgetApproved: true,
    startedAt: Date.now(),
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('JudgeAgent', () => {
  let config: AutonomyConfig;
  let llm: LLMProvider;
  let judge: JudgeAgent;

  beforeEach(() => {
    config = makeConfig();
    llm = makeLLMProvider();
    judge = new JudgeAgent(llm, config);
  });

  // ─── verifyCorrectness ─────────────────────────────────────

  describe('verifyCorrectness', () => {
    it('returns 0.7 for non-empty result', async () => {
      expect(await judge.verifyCorrectness('some output', [])).toBe(0.7);
    });

    it('returns 0 for empty string', async () => {
      expect(await judge.verifyCorrectness('', [])).toBe(0);
    });

    it('returns 0 for whitespace-only string', async () => {
      expect(await judge.verifyCorrectness('   ', [])).toBe(0);
    });
  });

  // ─── llmReview ─────────────────────────────────────────────

  describe('llmReview', () => {
    it('returns mock scores for each input', async () => {
      const results = [
        { id: 'a1', content: 'solution A' },
        { id: 'a2', content: 'solution B' },
      ];
      const review = await judge.llmReview(results);

      expect(review.size).toBe(2);
      expect(review.get('a1')?.quality).toBe(0.7);
      expect(review.get('a1')?.novelty).toBe(0.5);
      expect(review.get('a2')?.quality).toBe(0.7);
      expect(review.get('a2')?.novelty).toBe(0.5);
    });

    it('returns empty map for empty input', async () => {
      const review = await judge.llmReview([]);
      expect(review.size).toBe(0);
    });

    it('calls llmProvider.review with anonymized prompt (no agent IDs)', async () => {
      const results = [
        { id: 'secret-agent-007', content: 'my solution' },
      ];
      await judge.llmReview(results);

      const reviewFn = llm.review as ReturnType<typeof vi.fn>;
      expect(reviewFn).toHaveBeenCalledOnce();
      const prompt = reviewFn.mock.calls[0][0] as string;
      expect(prompt).toContain('Submission A');
      expect(prompt).not.toContain('secret-agent-007');
    });

    it('handles LLM failure gracefully', async () => {
      const failingLlm: LLMProvider = {
        review: vi.fn().mockRejectedValue(new Error('LLM down')),
      };
      const failJudge = new JudgeAgent(failingLlm, config);

      const review = await failJudge.llmReview([{ id: 'a1', content: 'test' }]);
      expect(review.get('a1')?.quality).toBe(0.7);
    });
  });

  // ─── computeEfficiency ─────────────────────────────────────

  describe('computeEfficiency', () => {
    it('returns 0.5 for all when tokens are equal', () => {
      const contestants = [
        makeContestant({ agentId: 'a', tokenConsumed: 100 }),
        makeContestant({ agentId: 'b', tokenConsumed: 100 }),
      ];
      const eff = judge.computeEfficiency(contestants);
      expect(eff.get('a')).toBe(0.5);
      expect(eff.get('b')).toBe(0.5);
    });

    it('gives higher efficiency to lower token consumers', () => {
      const contestants = [
        makeContestant({ agentId: 'low', tokenConsumed: 50 }),
        makeContestant({ agentId: 'high', tokenConsumed: 200 }),
      ];
      const eff = judge.computeEfficiency(contestants);
      expect(eff.get('low')!).toBeGreaterThan(eff.get('high')!);
    });

    it('returns 0 efficiency for max consumer', () => {
      const contestants = [
        makeContestant({ agentId: 'a', tokenConsumed: 0 }),
        makeContestant({ agentId: 'b', tokenConsumed: 100 }),
      ];
      const eff = judge.computeEfficiency(contestants);
      // a: 1 - 0/100 = 1.0, b: 1 - 100/100 = 0.0
      expect(eff.get('a')).toBe(1.0);
      expect(eff.get('b')).toBe(0.0);
    });

    it('returns empty map for empty input', () => {
      expect(judge.computeEfficiency([]).size).toBe(0);
    });

    it('handles single contestant (same tokens → 0.5)', () => {
      const eff = judge.computeEfficiency([makeContestant({ agentId: 'solo', tokenConsumed: 50 })]);
      expect(eff.get('solo')).toBe(0.5);
    });
  });

  // ─── computeWeightedScores ─────────────────────────────────

  describe('computeWeightedScores', () => {
    it('computes correct weighted total', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 1.0, quality: 1.0, efficiency: 1.0, novelty: 1.0, totalWeighted: 0 },
      ];
      const result = judge.computeWeightedScores(scores);
      // 0.35*1 + 0.30*1 + 0.20*1 + 0.15*1 = 1.0
      expect(result[0].totalWeighted).toBeCloseTo(1.0, 5);
    });

    it('computes zero for all-zero scores', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0 },
      ];
      const result = judge.computeWeightedScores(scores);
      expect(result[0].totalWeighted).toBe(0);
    });

    it('applies correct weights', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0.8, quality: 0.6, efficiency: 0.9, novelty: 0.4, totalWeighted: 0 },
      ];
      const result = judge.computeWeightedScores(scores);
      const expected = 0.35 * 0.8 + 0.30 * 0.6 + 0.20 * 0.9 + 0.15 * 0.4;
      expect(result[0].totalWeighted).toBeCloseTo(expected, 5);
    });

    it('clamps to [0, 1]', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 1.0, quality: 1.0, efficiency: 1.0, novelty: 1.0, totalWeighted: 0 },
      ];
      const result = judge.computeWeightedScores(scores);
      expect(result[0].totalWeighted).toBeLessThanOrEqual(1);
      expect(result[0].totalWeighted).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── checkMergeRequired ────────────────────────────────────

  describe('checkMergeRequired', () => {
    it('returns false for single score', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0.8, quality: 0.7, efficiency: 0.6, novelty: 0.5, totalWeighted: 0.7 },
      ];
      expect(judge.checkMergeRequired(scores)).toBe(false);
    });

    it('returns true when top 2 are within 5%', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.80 },
        { agentId: 'b', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.79 },
      ];
      // |0.80 - 0.79| / 0.80 = 0.0125 < 0.05
      expect(judge.checkMergeRequired(scores)).toBe(true);
    });

    it('returns false when top 2 differ by >= 5%', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.90 },
        { agentId: 'b', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.70 },
      ];
      // |0.90 - 0.70| / 0.90 = 0.222 >= 0.05
      expect(judge.checkMergeRequired(scores)).toBe(false);
    });

    it('returns true when both scores are 0', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0 },
        { agentId: 'b', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0 },
      ];
      expect(judge.checkMergeRequired(scores)).toBe(true);
    });

    it('ignores scores beyond top 2', () => {
      const scores: JudgingScore[] = [
        { agentId: 'a', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.90 },
        { agentId: 'b', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.89 },
        { agentId: 'c', correctness: 0, quality: 0, efficiency: 0, novelty: 0, totalWeighted: 0.10 },
      ];
      // |0.90 - 0.89| / 0.90 = 0.011 < 0.05
      expect(judge.checkMergeRequired(scores)).toBe(true);
    });
  });

  // ─── onJudgmentOverridden ──────────────────────────────────

  describe('onJudgmentOverridden', () => {
    it('decreases confidence by 0.1 each call', () => {
      expect(judge.getJudgeConfidenceScore()).toBe(1.0);
      judge.onJudgmentOverridden();
      expect(judge.getJudgeConfidenceScore()).toBeCloseTo(0.9, 5);
      judge.onJudgmentOverridden();
      expect(judge.getJudgeConfidenceScore()).toBeCloseTo(0.8, 5);
    });

    it('clamps to 0 and does not go negative', () => {
      for (let i = 0; i < 15; i++) judge.onJudgmentOverridden();
      expect(judge.getJudgeConfidenceScore()).toBe(0);
    });

    it('logs warning when below 0.5', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Drop from 1.0 to 0.4 (6 overrides)
      for (let i = 0; i < 6; i++) judge.onJudgmentOverridden();
      expect(judge.getJudgeConfidenceScore()).toBeCloseTo(0.4, 5);
      expect(warnSpy).toHaveBeenCalled();
      const lastCall = warnSpy.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('JUDGE_RELIABILITY_LOW');
      warnSpy.mockRestore();
    });
  });

  // ─── getJudgeConfidenceScore ───────────────────────────────

  describe('getJudgeConfidenceScore', () => {
    it('starts at 1.0', () => {
      expect(judge.getJudgeConfidenceScore()).toBe(1.0);
    });
  });

  // ─── judge (full pipeline) ─────────────────────────────────

  describe('judge (full pipeline)', () => {
    it('returns empty result for no valid contestants', async () => {
      const session = makeSession([
        makeContestant({ agentId: 'a', timedOut: true }),
        makeContestant({ agentId: 'b', result: undefined }),
      ]);
      const result = await judge.judge(session);
      expect(result.scores).toHaveLength(0);
      expect(result.ranking).toHaveLength(0);
      expect(result.winnerId).toBe('');
      expect(result.mergeRequired).toBe(false);
    });

    it('ranks contestants by weighted score descending', async () => {
      const session = makeSession([
        makeContestant({ agentId: 'low-eff', tokenConsumed: 500, result: 'solution A' }),
        makeContestant({ agentId: 'high-eff', tokenConsumed: 50, result: 'solution B' }),
      ]);
      const result = await judge.judge(session);

      expect(result.ranking).toHaveLength(2);
      // high-eff should rank higher due to better efficiency
      expect(result.ranking[0]).toBe('high-eff');
      expect(result.winnerId).toBe('high-eff');
    });

    it('filters out timed-out and no-result contestants', async () => {
      const session = makeSession([
        makeContestant({ agentId: 'valid', tokenConsumed: 100, result: 'ok' }),
        makeContestant({ agentId: 'timeout', tokenConsumed: 100, timedOut: true, result: 'ok' }),
        makeContestant({ agentId: 'empty', tokenConsumed: 100, result: '' }),
      ]);
      const result = await judge.judge(session);
      expect(result.scores).toHaveLength(1);
      expect(result.scores[0].agentId).toBe('valid');
    });

    it('detects merge required when scores are close', async () => {
      // Both have same tokens and same mock scores → identical weighted scores → merge
      const session = makeSession([
        makeContestant({ agentId: 'a', tokenConsumed: 100, result: 'sol A' }),
        makeContestant({ agentId: 'b', tokenConsumed: 100, result: 'sol B' }),
      ]);
      const result = await judge.judge(session);
      expect(result.mergeRequired).toBe(true);
    });

    it('includes rationale text', async () => {
      const session = makeSession([
        makeContestant({ agentId: 'a', tokenConsumed: 100, result: 'solution' }),
      ]);
      const result = await judge.judge(session);
      expect(result.rationaleText).toContain('a');
      expect(result.rationaleText.length).toBeGreaterThan(0);
    });
  });
});
