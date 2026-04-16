import type {
  AutonomyConfig,
  CompetitionCost,
  CompetitionSession,
} from "../../shared/autonomy-types.js";

// ─── Local Types ─────────────────────────────────────────────

/** Prometheus-style metrics for autonomy observability. */
export interface AutonomyMetrics {
  assessmentDurationMs: number[];
  competitionTriggerTotal: number;
  winnerQualityScores: number[];
  taskforceFormationTotal: number;
  taskforceDurationSeconds: number[];
}

// ─── CostMonitor ─────────────────────────────────────────────

/**
 * Tracks competition costs, computes ROI, enforces per-mission
 * budget limits, and exposes Prometheus-style metrics.
 */
export class CostMonitor {
  private readonly config: AutonomyConfig;
  private readonly missionBudgetUsed: Map<string, number>;
  private metrics: AutonomyMetrics;

  constructor(config: AutonomyConfig) {
    this.config = config;
    this.missionBudgetUsed = new Map();
    this.metrics = {
      assessmentDurationMs: [],
      competitionTriggerTotal: 0,
      winnerQualityScores: [],
      taskforceFormationTotal: 0,
      taskforceDurationSeconds: [],
    };
  }

  /**
   * Check whether a competition's estimated token cost fits within
   * the mission's remaining budget × budgetRatio.
   */
  checkCompetitionBudget(
    estimatedTokens: number,
    missionRemainingBudget: number
  ): { approved: boolean; reason?: string } {
    const limit = missionRemainingBudget * this.config.competition.budgetRatio;
    if (estimatedTokens > limit) {
      return { approved: false, reason: "budget exceeded" };
    }
    return { approved: true };
  }

  /**
   * Record the total cost of a competition session.
   *
   * Sums all contestants' tokenConsumed, computes ROI via computeROI,
   * logs a warning when ROI < 1.0, and attaches the cost to the session.
   */
  recordCompetitionCost(session: CompetitionSession): CompetitionCost {
    const totalTokens = session.contestants.reduce(
      (sum, c) => sum + c.tokenConsumed,
      0
    );

    // Use the winner's quality score from judging result, default to 0.5
    const winnerQuality =
      session.judgingResult?.scores.find(
        s => s.agentId === session.judgingResult?.winnerId
      )?.totalWeighted ?? 0.5;

    // Estimate what a single normal execution would have cost
    const estimatedNormalTokens =
      session.contestants.length > 0
        ? Math.round(totalTokens / session.contestants.length)
        : totalTokens;

    const roi = this.computeROI(
      winnerQuality,
      estimatedNormalTokens > 0 ? 1.0 : 0
    );

    if (roi < 1.0) {
      console.warn(
        `[COMPETITION_LOW_ROI] session=${session.id} roi=${roi.toFixed(3)} — ` +
          "Competition ROI is below 1.0."
      );
    }

    const cost: CompetitionCost = {
      totalTokens,
      estimatedNormalTokens,
      roi,
    };

    session.competitionCost = cost;

    // Track winner quality for metrics
    this.metrics.winnerQualityScores.push(winnerQuality);

    return cost;
  }

  /**
   * Compute ROI = winnerQuality / normalEstimate.
   * Returns Infinity when normalEstimate is 0.
   */
  computeROI(winnerQuality: number, normalEstimate: number): number {
    if (normalEstimate === 0) return Infinity;
    return winnerQuality / normalEstimate;
  }

  /** Return current accumulated metrics. */
  getMetrics(): AutonomyMetrics {
    return this.metrics;
  }

  /**
   * Check if competition should be disabled for a given mission.
   *
   * Tracks per-mission cumulative token usage. Returns true when
   * the mission has exceeded its competition budget ratio.
   */
  isCompetitionDisabled(missionId: string): boolean {
    const used = this.missionBudgetUsed.get(missionId) ?? 0;
    return used > this.config.competition.budgetRatio;
  }

  // ─── Helper recorders ──────────────────────────────────────

  /** Record a self-assessment duration sample. */
  recordAssessmentDuration(durationMs: number): void {
    this.metrics.assessmentDurationMs.push(durationMs);
  }

  /** Increment the competition trigger counter. */
  recordCompetitionTrigger(): void {
    this.metrics.competitionTriggerTotal += 1;
  }

  /** Increment the taskforce formation counter. */
  recordTaskforceFormation(): void {
    this.metrics.taskforceFormationTotal += 1;
  }

  /** Record a taskforce duration sample. */
  recordTaskforceDuration(durationSeconds: number): void {
    this.metrics.taskforceDurationSeconds.push(durationSeconds);
  }

  /**
   * Track token usage for a mission (used by isCompetitionDisabled).
   * Call this after each competition to accumulate budget usage.
   */
  addMissionTokenUsage(missionId: string, tokens: number): void {
    const current = this.missionBudgetUsed.get(missionId) ?? 0;
    this.missionBudgetUsed.set(missionId, current + tokens);
  }
}
