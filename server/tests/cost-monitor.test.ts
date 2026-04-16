import { describe, expect, it, beforeEach, vi } from "vitest";
import type {
  AutonomyConfig,
  CompetitionSession,
} from "../../shared/autonomy-types.js";
import { CostMonitor } from "../core/cost-monitor.js";

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
    competition: {
      defaultContestantCount: 3,
      maxDeadlineMs: 300_000,
      budgetRatio: 0.3,
    },
    taskforce: { heartbeatIntervalMs: 30_000, maxMissedHeartbeats: 3 },
    skillDecay: { inactiveDays: 30, decayRatePerWeek: 0.05 },
    ...overrides,
  };
}

function makeSession(
  overrides?: Partial<CompetitionSession>
): CompetitionSession {
  return {
    id: "comp-1",
    taskId: "task-1",
    contestants: [
      {
        agentId: "a1",
        isExternal: false,
        result: "code-a",
        tokenConsumed: 100,
        timedOut: false,
      },
      {
        agentId: "a2",
        isExternal: false,
        result: "code-b",
        tokenConsumed: 200,
        timedOut: false,
      },
    ],
    status: "completed",
    deadline: 90_000,
    budgetApproved: true,
    startedAt: Date.now() - 60_000,
    completedAt: Date.now(),
    judgingResult: {
      scores: [
        {
          agentId: "a1",
          correctness: 0.9,
          quality: 0.8,
          efficiency: 0.7,
          novelty: 0.6,
          totalWeighted: 0.79,
        },
        {
          agentId: "a2",
          correctness: 0.7,
          quality: 0.6,
          efficiency: 0.5,
          novelty: 0.4,
          totalWeighted: 0.58,
        },
      ],
      ranking: ["a1", "a2"],
      rationaleText: "a1 wins",
      winnerId: "a1",
      mergeRequired: false,
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("CostMonitor", () => {
  let config: AutonomyConfig;
  let monitor: CostMonitor;

  beforeEach(() => {
    config = makeConfig();
    monitor = new CostMonitor(config);
  });

  // ─── checkCompetitionBudget ────────────────────────────────

  describe("checkCompetitionBudget", () => {
    it("approves when estimated tokens are within budget", () => {
      // limit = 1000 * 0.3 = 300
      const result = monitor.checkCompetitionBudget(200, 1000);
      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects when estimated tokens exceed budget", () => {
      // limit = 1000 * 0.3 = 300
      const result = monitor.checkCompetitionBudget(400, 1000);
      expect(result.approved).toBe(false);
      expect(result.reason).toBe("budget exceeded");
    });

    it("approves when estimated tokens exactly equal the limit", () => {
      // limit = 1000 * 0.3 = 300
      const result = monitor.checkCompetitionBudget(300, 1000);
      expect(result.approved).toBe(true);
    });

    it("rejects when remaining budget is 0", () => {
      const result = monitor.checkCompetitionBudget(1, 0);
      expect(result.approved).toBe(false);
      expect(result.reason).toBe("budget exceeded");
    });

    it("respects custom budgetRatio", () => {
      const customConfig = makeConfig({
        competition: {
          defaultContestantCount: 3,
          maxDeadlineMs: 300_000,
          budgetRatio: 0.5,
        },
      });
      const customMonitor = new CostMonitor(customConfig);
      // limit = 1000 * 0.5 = 500
      expect(customMonitor.checkCompetitionBudget(400, 1000).approved).toBe(
        true
      );
      expect(customMonitor.checkCompetitionBudget(600, 1000).approved).toBe(
        false
      );
    });
  });

  // ─── computeROI ────────────────────────────────────────────

  describe("computeROI", () => {
    it("computes ratio correctly", () => {
      expect(monitor.computeROI(0.8, 0.5)).toBeCloseTo(1.6, 5);
    });

    it("returns Infinity when normalEstimate is 0", () => {
      expect(monitor.computeROI(0.8, 0)).toBe(Infinity);
    });

    it("returns 0 when winnerQuality is 0", () => {
      expect(monitor.computeROI(0, 0.5)).toBeCloseTo(0, 5);
    });

    it("returns 1.0 when values are equal", () => {
      expect(monitor.computeROI(0.7, 0.7)).toBeCloseTo(1.0, 5);
    });
  });

  // ─── recordCompetitionCost ─────────────────────────────────

  describe("recordCompetitionCost", () => {
    it("sums all contestants token consumption", () => {
      const session = makeSession();
      const cost = monitor.recordCompetitionCost(session);
      expect(cost.totalTokens).toBe(300); // 100 + 200
    });

    it("attaches cost to the session", () => {
      const session = makeSession();
      monitor.recordCompetitionCost(session);
      expect(session.competitionCost).toBeDefined();
      expect(session.competitionCost!.totalTokens).toBe(300);
    });

    it("computes estimatedNormalTokens as average", () => {
      const session = makeSession();
      const cost = monitor.recordCompetitionCost(session);
      expect(cost.estimatedNormalTokens).toBe(150); // 300 / 2
    });

    it("logs warning when ROI < 1.0", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Session with low winner quality → ROI < 1.0
      const session = makeSession({
        judgingResult: {
          scores: [
            {
              agentId: "a1",
              correctness: 0.2,
              quality: 0.1,
              efficiency: 0.1,
              novelty: 0.1,
              totalWeighted: 0.13,
            },
          ],
          ranking: ["a1"],
          rationaleText: "low quality",
          winnerId: "a1",
          mergeRequired: false,
        },
      });
      monitor.recordCompetitionCost(session);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("COMPETITION_LOW_ROI")
      );
      warnSpy.mockRestore();
    });

    it("tracks winner quality in metrics", () => {
      const session = makeSession();
      monitor.recordCompetitionCost(session);
      const metrics = monitor.getMetrics();
      expect(metrics.winnerQualityScores).toHaveLength(1);
      expect(metrics.winnerQualityScores[0]).toBe(0.79);
    });

    it("handles session with no judging result", () => {
      const session = makeSession({ judgingResult: undefined });
      const cost = monitor.recordCompetitionCost(session);
      // Falls back to 0.5 for winnerQuality
      expect(cost.totalTokens).toBe(300);
    });

    it("handles session with no contestants", () => {
      const session = makeSession({ contestants: [] });
      const cost = monitor.recordCompetitionCost(session);
      expect(cost.totalTokens).toBe(0);
      expect(cost.estimatedNormalTokens).toBe(0);
    });
  });

  // ─── isCompetitionDisabled ─────────────────────────────────

  describe("isCompetitionDisabled", () => {
    it("returns false for unknown mission", () => {
      expect(monitor.isCompetitionDisabled("mission-1")).toBe(false);
    });

    it("returns false when usage is within budget ratio", () => {
      monitor.addMissionTokenUsage("mission-1", 0.1);
      expect(monitor.isCompetitionDisabled("mission-1")).toBe(false);
    });

    it("returns true when usage exceeds budget ratio", () => {
      monitor.addMissionTokenUsage("mission-1", 0.5); // > 0.3
      expect(monitor.isCompetitionDisabled("mission-1")).toBe(true);
    });

    it("accumulates usage across multiple calls", () => {
      monitor.addMissionTokenUsage("mission-1", 0.1);
      monitor.addMissionTokenUsage("mission-1", 0.1);
      monitor.addMissionTokenUsage("mission-1", 0.15);
      // total = 0.35 > 0.3
      expect(monitor.isCompetitionDisabled("mission-1")).toBe(true);
    });

    it("tracks missions independently", () => {
      monitor.addMissionTokenUsage("m1", 0.5);
      monitor.addMissionTokenUsage("m2", 0.1);
      expect(monitor.isCompetitionDisabled("m1")).toBe(true);
      expect(monitor.isCompetitionDisabled("m2")).toBe(false);
    });
  });

  // ─── getMetrics ────────────────────────────────────────────

  describe("getMetrics", () => {
    it("returns initial empty metrics", () => {
      const metrics = monitor.getMetrics();
      expect(metrics.assessmentDurationMs).toEqual([]);
      expect(metrics.competitionTriggerTotal).toBe(0);
      expect(metrics.winnerQualityScores).toEqual([]);
      expect(metrics.taskforceFormationTotal).toBe(0);
      expect(metrics.taskforceDurationSeconds).toEqual([]);
    });
  });

  // ─── Helper recorders ─────────────────────────────────────

  describe("recordAssessmentDuration", () => {
    it("pushes duration to metrics", () => {
      monitor.recordAssessmentDuration(42);
      monitor.recordAssessmentDuration(18);
      expect(monitor.getMetrics().assessmentDurationMs).toEqual([42, 18]);
    });
  });

  describe("recordCompetitionTrigger", () => {
    it("increments counter", () => {
      monitor.recordCompetitionTrigger();
      monitor.recordCompetitionTrigger();
      expect(monitor.getMetrics().competitionTriggerTotal).toBe(2);
    });
  });

  describe("recordTaskforceFormation", () => {
    it("increments counter", () => {
      monitor.recordTaskforceFormation();
      expect(monitor.getMetrics().taskforceFormationTotal).toBe(1);
    });
  });

  describe("recordTaskforceDuration", () => {
    it("pushes duration to metrics", () => {
      monitor.recordTaskforceDuration(120);
      monitor.recordTaskforceDuration(300);
      expect(monitor.getMetrics().taskforceDurationSeconds).toEqual([120, 300]);
    });
  });
});
