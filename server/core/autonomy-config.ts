import type {
  AutonomyConfig,
  AssessmentWeights,
} from "../../shared/autonomy-types.js";

// ─── Helpers ─────────────────────────────────────────────────

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ─── Loader ──────────────────────────────────────────────────

export function loadAutonomyConfig(): AutonomyConfig {
  const weights: AssessmentWeights = {
    w1_skillMatch: envNumber("AUTONOMY_WEIGHT_SKILL_MATCH", 0.4),
    w2_loadFactor: envNumber("AUTONOMY_WEIGHT_LOAD_FACTOR", 0.2),
    w3_confidence: envNumber("AUTONOMY_WEIGHT_CONFIDENCE", 0.25),
    w4_resource: envNumber("AUTONOMY_WEIGHT_RESOURCE", 0.15),
  };

  const contestantCount = clamp(
    envNumber("AUTONOMY_COMPETITION_CONTESTANT_COUNT", 3),
    2,
    5
  );

  return {
    enabled: envBool("AUTONOMY_ENABLED", false),
    assessmentWeights: weights,
    competition: {
      defaultContestantCount: contestantCount,
      maxDeadlineMs: envNumber("AUTONOMY_COMPETITION_MAX_DEADLINE_MS", 300000),
      budgetRatio: envNumber("AUTONOMY_COMPETITION_BUDGET_RATIO", 0.3),
    },
    taskforce: {
      heartbeatIntervalMs: envNumber("AUTONOMY_TASKFORCE_HEARTBEAT_MS", 30000),
      maxMissedHeartbeats: envNumber(
        "AUTONOMY_TASKFORCE_MAX_MISSED_HEARTBEATS",
        3
      ),
    },
    skillDecay: {
      inactiveDays: envNumber("AUTONOMY_SKILL_DECAY_INACTIVE_DAYS", 30),
      decayRatePerWeek: envNumber("AUTONOMY_SKILL_DECAY_RATE_PER_WEEK", 0.05),
    },
  };
}

// ─── Singleton ───────────────────────────────────────────────

export const autonomyConfig: AutonomyConfig = loadAutonomyConfig();
