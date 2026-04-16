import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { DecayScheduler } from "../core/reputation/decay-scheduler.js";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { TrustTierEvaluator } from "../core/reputation/trust-tier-evaluator.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type {
  ReputationConfig,
  ReputationProfile,
} from "../../shared/reputation.js";
import db from "../db/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function createScheduler(
  config: ReputationConfig = DEFAULT_REPUTATION_CONFIG
): DecayScheduler {
  return new DecayScheduler(
    config,
    new TrustTierEvaluator(config),
    new ReputationCalculator(config)
  );
}

let testId = 0;
function uniqueAgentId(): string {
  return `decay-test-${++testId}-${Date.now()}`;
}

function makeProfile(
  agentId: string,
  overrides: Partial<ReputationProfile> = {}
): ReputationProfile {
  const now = new Date().toISOString();
  return {
    agentId,
    overallScore: 500,
    dimensions: {
      qualityScore: 500,
      speedScore: 500,
      efficiencyScore: 500,
      collaborationScore: 500,
      reliabilityScore: 500,
    },
    grade: "B" as const,
    trustTier: "standard" as const,
    isExternal: false,
    totalTasks: 5,
    consecutiveHighQuality: 0,
    roleReputation: {},
    lastActiveAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DecayScheduler", () => {
  let scheduler: DecayScheduler;

  beforeEach(() => {
    scheduler = createScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  // -----------------------------------------------------------------------
  // start / stop
  // -----------------------------------------------------------------------
  describe("start / stop", () => {
    it("start() sets up an interval and stop() clears it", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      scheduler.start();
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        MS_PER_DAY
      );

      scheduler.stop();
      expect(clearIntervalSpy).toHaveBeenCalledOnce();

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it("calling start() twice does not create duplicate intervals", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");

      scheduler.start();
      scheduler.start();
      expect(setIntervalSpy).toHaveBeenCalledOnce();

      setIntervalSpy.mockRestore();
    });

    it("calling stop() when not started is a no-op", () => {
      // Should not throw
      scheduler.stop();
    });
  });

  // -----------------------------------------------------------------------
  // runDecayCycle
  // -----------------------------------------------------------------------
  describe("runDecayCycle", () => {
    it("decays overallScore for inactive agents (lastActiveAt is null)", () => {
      const agentId = uniqueAgentId();
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: 500,
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(
        500 - DEFAULT_REPUTATION_CONFIG.decay.decayRate
      );
    });

    it("decays overallScore for agents inactive longer than inactivityDays", () => {
      const agentId = uniqueAgentId();
      const profile = makeProfile(agentId, {
        lastActiveAt: daysAgo(15), // 15 days ago, threshold is 14
        overallScore: 600,
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(
        600 - DEFAULT_REPUTATION_CONFIG.decay.decayRate
      );
    });

    it("does NOT decay agents that are still active (within inactivityDays)", () => {
      const agentId = uniqueAgentId();
      const profile = makeProfile(agentId, {
        lastActiveAt: daysAgo(5), // 5 days ago, threshold is 14
        overallScore: 600,
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(600); // unchanged
    });

    it("does NOT decay below decayFloor", () => {
      const agentId = uniqueAgentId();
      const floor = DEFAULT_REPUTATION_CONFIG.decay.decayFloor; // 300
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: floor + 3, // just above floor
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(floor);
    });

    it("does NOT decay agents already at decayFloor", () => {
      const agentId = uniqueAgentId();
      const floor = DEFAULT_REPUTATION_CONFIG.decay.decayFloor;
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: floor,
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(floor);
    });

    it("keeps dimension scores unchanged after decay", () => {
      const agentId = uniqueAgentId();
      const dims = {
        qualityScore: 700,
        speedScore: 600,
        efficiencyScore: 550,
        collaborationScore: 480,
        reliabilityScore: 520,
      };
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: 500,
        dimensions: { ...dims },
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.dimensions).toEqual(dims);
    });

    it("recomputes grade and trustTier after decay", () => {
      const agentId = uniqueAgentId();
      // Score 310 → after decay of 10 → 300 → grade D, trustTier probation
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: 310,
        grade: "C",
        trustTier: "probation",
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(300);
      expect(updated.grade).toBe("C"); // 300 is still in C range (300-499)
      expect(updated.trustTier).toBe("probation");
    });

    it("creates a ReputationChangeEvent with reason inactivity_decay", () => {
      const agentId = uniqueAgentId();
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: 500,
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const events = db.getReputationEvents(agentId);
      expect(events.length).toBeGreaterThanOrEqual(1);
      const decayEvent = events.find(e => e.reason === "inactivity_decay");
      expect(decayEvent).toBeDefined();
      expect(decayEvent!.oldOverallScore).toBe(500);
      expect(decayEvent!.newOverallScore).toBe(490);
      expect(decayEvent!.dimensionDeltas).toEqual({
        qualityDelta: 0,
        speedDelta: 0,
        efficiencyDelta: 0,
        collaborationDelta: 0,
        reliabilityDelta: 0,
      });
    });

    it("handles external agents correctly (uses evaluateExternalUpgrade for trustTier)", () => {
      const agentId = uniqueAgentId();
      const profile = makeProfile(agentId, {
        lastActiveAt: null,
        overallScore: 500,
        isExternal: true,
        totalTasks: 25,
        trustTier: "standard",
      });
      db.upsertReputationProfile(profile);

      scheduler.runDecayCycle();

      const updated = db.getReputationProfile(agentId)!;
      expect(updated.overallScore).toBe(490);
      // External with 25 tasks and score 490 < 500 → probation (doesn't meet standard threshold)
      expect(updated.trustTier).toBe("probation");
    });

    it("processes multiple agents in a single cycle", () => {
      const id1 = uniqueAgentId();
      const id2 = uniqueAgentId();
      const id3 = uniqueAgentId();

      db.upsertReputationProfile(
        makeProfile(id1, { lastActiveAt: null, overallScore: 500 })
      );
      db.upsertReputationProfile(
        makeProfile(id2, { lastActiveAt: daysAgo(20), overallScore: 600 })
      );
      db.upsertReputationProfile(
        makeProfile(id3, { lastActiveAt: daysAgo(5), overallScore: 700 })
      );

      scheduler.runDecayCycle();

      expect(db.getReputationProfile(id1)!.overallScore).toBe(490); // decayed
      expect(db.getReputationProfile(id2)!.overallScore).toBe(590); // decayed
      expect(db.getReputationProfile(id3)!.overallScore).toBe(700); // active, no decay
    });
  });
});
