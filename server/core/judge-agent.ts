import type {
  AutonomyConfig,
  CompetitionSession,
  ContestantEntry,
  JudgingResult,
  JudgingScore,
} from "../../shared/autonomy-types.js";

// ─── Local Types ─────────────────────────────────────────────

/** LLM provider interface — real integration comes later. */
export interface LLMProvider {
  review(prompt: string): Promise<string>;
}

// ─── JudgeAgent ──────────────────────────────────────────────

/**
 * Evaluates competition results across four dimensions:
 * correctness (0.35), quality (0.30), efficiency (0.20), novelty (0.15).
 *
 * Performs anonymized LLM review, weighted scoring, ranking,
 * and merge detection when top scores are within 5%.
 */
export class JudgeAgent {
  private judgeConfidenceScore = 1.0;

  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly config: AutonomyConfig
  ) {}

  /**
   * Full judging pipeline:
   * 1. Filter out timed-out / no-result contestants
   * 2. Verify correctness for each valid contestant
   * 3. LLM review for quality + novelty (anonymized)
   * 4. Compute efficiency for all contestants
   * 5. Build scores, compute weighted totals
   * 6. Sort by totalWeighted descending → ranking
   * 7. Check merge required
   */
  async judge(session: CompetitionSession): Promise<JudgingResult> {
    // Step 1: filter valid contestants
    const valid = session.contestants.filter(
      c => !c.timedOut && c.result != null && c.result !== ""
    );

    if (valid.length === 0) {
      return {
        scores: [],
        ranking: [],
        rationaleText: "No valid submissions received.",
        winnerId: "",
        mergeRequired: false,
      };
    }

    // Step 2: verify correctness for each valid contestant
    const correctnessMap = new Map<string, number>();
    for (const c of valid) {
      const score = await this.verifyCorrectness(c.result!, []);
      correctnessMap.set(c.agentId, score);
    }

    // Step 3: LLM review (anonymized) for quality + novelty
    const reviewInputs = valid.map(c => ({
      id: c.agentId,
      content: c.result!,
    }));
    const reviewMap = await this.llmReview(reviewInputs);

    // Step 4: compute efficiency
    const efficiencyMap = this.computeEfficiency(valid);

    // Step 5: build JudgingScore array
    const scores: JudgingScore[] = valid.map(c => {
      const review = reviewMap.get(c.agentId) ?? {
        quality: 0.5,
        novelty: 0.5,
        rationale: "",
      };
      return {
        agentId: c.agentId,
        correctness: correctnessMap.get(c.agentId) ?? 0,
        quality: review.quality,
        efficiency: efficiencyMap.get(c.agentId) ?? 0.5,
        novelty: review.novelty,
        totalWeighted: 0,
      };
    });

    // Step 5b: compute weighted scores
    const weighted = this.computeWeightedScores(scores);

    // Step 6: sort by totalWeighted descending → ranking
    weighted.sort((a, b) => b.totalWeighted - a.totalWeighted);
    const ranking = weighted.map(s => s.agentId);

    // Step 7: check merge required
    const mergeRequired = this.checkMergeRequired(weighted);

    // Build rationale
    const rationaleLines = weighted.map(
      (s, i) =>
        `#${i + 1} ${s.agentId}: total=${s.totalWeighted.toFixed(3)} ` +
        `(correctness=${s.correctness.toFixed(2)}, quality=${s.quality.toFixed(2)}, ` +
        `efficiency=${s.efficiency.toFixed(2)}, novelty=${s.novelty.toFixed(2)})`
    );

    return {
      scores: weighted,
      ranking,
      rationaleText: rationaleLines.join("\n"),
      winnerId: ranking[0] ?? "",
      mergeRequired,
    };
  }

  /**
   * Simple correctness check.
   * Returns 0.7 as default (real implementation would run test cases).
   * Returns 0 if result is empty.
   */
  async verifyCorrectness(
    result: string,
    _constraints: string[]
  ): Promise<number> {
    if (!result || result.trim() === "") return 0;
    return 0.7;
  }

  /**
   * Anonymized LLM review for quality + novelty.
   *
   * Anonymizes by mapping agent IDs to generic labels (Submission A, B, C...).
   * Calls llmProvider.review with anonymized content.
   * For now returns mock scores since real LLM integration comes later.
   */
  async llmReview(
    results: { id: string; content: string }[]
  ): Promise<
    Map<string, { quality: number; novelty: number; rationale: string }>
  > {
    const output = new Map<
      string,
      { quality: number; novelty: number; rationale: string }
    >();

    if (results.length === 0) return output;

    // Anonymize: map real IDs to generic labels
    const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const anonymized = results.map((r, i) => ({
      label: `Submission ${labels[i] ?? i}`,
      content: r.content,
    }));

    // Build prompt for LLM (anonymized — no agent IDs)
    const prompt = anonymized
      .map(a => `--- ${a.label} ---\n${a.content}`)
      .join("\n\n");

    // Call LLM provider (result unused for now — mock scores below)
    try {
      await this.llmProvider.review(prompt);
    } catch {
      // LLM failure: fall back to defaults
    }

    // Mock scores — real LLM parsing comes later
    for (const r of results) {
      output.set(r.id, {
        quality: 0.7,
        novelty: 0.5,
        rationale: "Mock review — real LLM integration pending.",
      });
    }

    return output;
  }

  /**
   * Compute efficiency based on token consumption.
   * Lower tokens = higher efficiency.
   * Formula: efficiency = 1 - (tokenConsumed / maxTokenConsumed)
   * If all consumed the same amount, return 0.5 for all.
   * Clamp to [0, 1].
   */
  computeEfficiency(contestants: ContestantEntry[]): Map<string, number> {
    const result = new Map<string, number>();
    if (contestants.length === 0) return result;

    const maxTokens = Math.max(...contestants.map(c => c.tokenConsumed));
    const minTokens = Math.min(...contestants.map(c => c.tokenConsumed));

    // All consumed the same amount
    if (maxTokens === minTokens) {
      for (const c of contestants) {
        result.set(c.agentId, 0.5);
      }
      return result;
    }

    for (const c of contestants) {
      const efficiency = clamp(1 - c.tokenConsumed / maxTokens, 0, 1);
      result.set(c.agentId, efficiency);
    }

    return result;
  }

  /**
   * Compute weighted total for each score.
   * totalWeighted = 0.35 * correctness + 0.30 * quality + 0.20 * efficiency + 0.15 * novelty
   * Clamp to [0, 1].
   */
  computeWeightedScores(scores: JudgingScore[]): JudgingScore[] {
    return scores.map(s => ({
      ...s,
      totalWeighted: clamp(
        0.35 * s.correctness +
          0.3 * s.quality +
          0.2 * s.efficiency +
          0.15 * s.novelty,
        0,
        1
      ),
    }));
  }

  /**
   * Check if merge is required.
   * Sort by totalWeighted descending. If top 2 exist and
   * |top1 - top2| / max(top1, top2) < 0.05, return true.
   */
  checkMergeRequired(scores: JudgingScore[]): boolean {
    if (scores.length < 2) return false;

    const sorted = [...scores].sort(
      (a, b) => b.totalWeighted - a.totalWeighted
    );
    const top1 = sorted[0].totalWeighted;
    const top2 = sorted[1].totalWeighted;

    const maxVal = Math.max(top1, top2);
    if (maxVal === 0) return true; // both zero → no clear winner

    const relDiff = Math.abs(top1 - top2) / maxVal;
    return relDiff < 0.05;
  }

  /**
   * Called when a judgment is overridden by a user.
   * Decreases judgeConfidenceScore by 0.1.
   * If below 0.5, emit/log JUDGE_RELIABILITY_LOW alert.
   * Clamp to [0, 1].
   */
  onJudgmentOverridden(): void {
    this.judgeConfidenceScore = clamp(this.judgeConfidenceScore - 0.1, 0, 1);

    if (this.judgeConfidenceScore < 0.5) {
      console.warn(
        `[JUDGE_RELIABILITY_LOW] judgeConfidenceScore=${this.judgeConfidenceScore.toFixed(2)} — ` +
          "Judge reliability is low. Consider reviewing LLM configuration."
      );
    }
  }

  /** Getter for current judgeConfidenceScore. */
  getJudgeConfidenceScore(): number {
    return this.judgeConfidenceScore;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
