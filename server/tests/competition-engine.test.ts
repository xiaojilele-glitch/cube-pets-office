import { describe, expect, it, beforeEach } from "vitest";
import type { AutonomyConfig } from "../../shared/autonomy-types.js";
import { CapabilityProfileManager } from "../core/capability-profile-manager.js";
import {
  CompetitionEngine,
  type CompetitionTaskRequest,
  type CostMonitor,
} from "../core/competition-engine.js";

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

function makeTask(
  overrides?: Partial<CompetitionTaskRequest>
): CompetitionTaskRequest {
  return {
    taskId: "task-1",
    requiredSkills: ["coding"],
    requiredSkillWeights: new Map([["coding", 0.8]]),
    priority: "normal",
    qualityRequirement: "normal",
    dataSecurityLevel: "normal",
    estimatedDurationMs: 60_000,
    manualCompetition: false,
    historicalFailRate: 0.3,
    descriptionAmbiguity: 0.2,
    ...overrides,
  };
}

function makeCostMonitor(): CostMonitor {
  return {
    checkCompetitionBudget: () => ({ approved: true }),
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("CompetitionEngine", () => {
  let config: AutonomyConfig;
  let pm: CapabilityProfileManager;
  let cm: CostMonitor;
  let engine: CompetitionEngine;

  beforeEach(() => {
    config = makeConfig();
    pm = new CapabilityProfileManager(config);
    cm = makeCostMonitor();
    engine = new CompetitionEngine(pm, cm, config);
  });

  // ─── shouldTrigger ──────────────────────────────────────────

  describe("shouldTrigger", () => {
    it("returns true when priority is critical", () => {
      const task = makeTask({ priority: "critical" });
      expect(engine.shouldTrigger(task, 0.9)).toBe(true);
    });

    it("returns true when qualityRequirement is high", () => {
      const task = makeTask({ qualityRequirement: "high" });
      expect(engine.shouldTrigger(task, 0.9)).toBe(true);
    });

    it("returns true when uncertainty > 0.7", () => {
      const task = makeTask({
        historicalFailRate: 1.0,
        descriptionAmbiguity: 1.0,
      });
      // uncertainty = 0.4*1.0 + 0.35*(1-0.0) + 0.25*1.0 = 1.0
      expect(engine.shouldTrigger(task, 0.0)).toBe(true);
    });

    it("returns true when manualCompetition is true", () => {
      const task = makeTask({ manualCompetition: true });
      expect(engine.shouldTrigger(task, 0.9)).toBe(true);
    });

    it("returns false when no conditions are met", () => {
      const task = makeTask({
        priority: "low",
        qualityRequirement: "low",
        manualCompetition: false,
        historicalFailRate: 0.0,
        descriptionAmbiguity: 0.0,
      });
      // uncertainty = 0.4*0 + 0.35*(1-0.9) + 0.25*0 = 0.035
      expect(engine.shouldTrigger(task, 0.9)).toBe(false);
    });
  });

  // ─── computeUncertainty ────────────────────────────────────

  describe("computeUncertainty", () => {
    it("computes weighted formula correctly", () => {
      const task = makeTask({
        historicalFailRate: 0.5,
        descriptionAmbiguity: 0.4,
      });
      // 0.4*0.5 + 0.35*(1-0.8) + 0.25*0.4 = 0.2 + 0.07 + 0.1 = 0.37
      expect(engine.computeUncertainty(task, 0.8)).toBeCloseTo(0.37, 5);
    });

    it("clamps to 0 for all-zero inputs with bestFitness=1", () => {
      const task = makeTask({ historicalFailRate: 0, descriptionAmbiguity: 0 });
      expect(engine.computeUncertainty(task, 1.0)).toBeCloseTo(0.0, 5);
    });

    it("clamps to 1 for worst-case inputs", () => {
      const task = makeTask({
        historicalFailRate: 1.0,
        descriptionAmbiguity: 1.0,
      });
      expect(engine.computeUncertainty(task, 0.0)).toBeCloseTo(1.0, 5);
    });

    it("returns value in [0, 1]", () => {
      const task = makeTask({
        historicalFailRate: 0.6,
        descriptionAmbiguity: 0.3,
      });
      const result = engine.computeUncertainty(task, 0.5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  // ─── selectContestants ─────────────────────────────────────

  describe("selectContestants", () => {
    it("returns empty array for empty candidates", () => {
      expect(engine.selectContestants([], 3)).toEqual([]);
    });

    it("returns empty array for count=0", () => {
      pm.initProfile("a", ["coding"]);
      expect(engine.selectContestants(["a"], 0)).toEqual([]);
    });

    it("picks highest-fitness agent as seed", () => {
      const p1 = pm.initProfile("low", ["coding"]);
      p1.skillVector.set("coding", 0.3);
      p1.confidenceScore = 0.3;

      const p2 = pm.initProfile("high", ["coding"]);
      p2.skillVector.set("coding", 0.9);
      p2.confidenceScore = 0.9;

      const result = engine.selectContestants(["low", "high"], 1);
      expect(result[0]).toBe("high");
    });

    it("returns at most count agents", () => {
      for (let i = 0; i < 5; i++) {
        const p = pm.initProfile(`agent-${i}`, ["coding"]);
        p.skillVector.set("coding", 0.6 + i * 0.05);
        p.confidenceScore = 0.7;
      }
      const result = engine.selectContestants(
        ["agent-0", "agent-1", "agent-2", "agent-3", "agent-4"],
        3
      );
      expect(result.length).toBe(3);
    });

    it("excludes agents with fitness < 0.5 from subsequent picks", () => {
      const p1 = pm.initProfile("strong", ["coding"]);
      p1.skillVector.set("coding", 0.9);
      p1.confidenceScore = 0.9;

      const p2 = pm.initProfile("weak", ["coding"]);
      p2.skillVector.set("coding", 0.1);
      p2.confidenceScore = 0.1;

      const p3 = pm.initProfile("medium", ["testing"]);
      p3.skillVector.set("testing", 0.7);
      p3.confidenceScore = 0.7;

      const result = engine.selectContestants(["strong", "weak", "medium"], 3);
      expect(result).toContain("strong");
      expect(result).toContain("medium");
      expect(result).not.toContain("weak");
    });

    it("returns fewer than count if not enough qualify", () => {
      const p1 = pm.initProfile("only-good", ["coding"]);
      p1.skillVector.set("coding", 0.8);
      p1.confidenceScore = 0.8;

      const p2 = pm.initProfile("bad", ["coding"]);
      p2.skillVector.set("coding", 0.1);
      p2.confidenceScore = 0.1;

      const result = engine.selectContestants(["only-good", "bad"], 3);
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result).toContain("only-good");
    });
  });

  // ─── runCompetition ────────────────────────────────────────

  describe("runCompetition", () => {
    it('creates a session with status "running"', async () => {
      pm.initProfile("a", ["coding"]);
      pm.initProfile("b", ["coding"]);

      const task = makeTask();
      const session = await engine.runCompetition(task, ["a", "b"], 90_000);

      expect(session.status).toBe("running");
      expect(session.taskId).toBe("task-1");
      expect(session.contestants).toHaveLength(2);
      expect(session.deadline).toBe(90_000);
      expect(session.budgetApproved).toBe(true);
      expect(session.startedAt).toBeGreaterThan(0);
    });

    it("marks external agents correctly", async () => {
      pm.initProfile("internal", ["coding"]);
      pm.initProfile("ext", ["coding", "external"]);

      const session = await engine.runCompetition(
        makeTask(),
        ["internal", "ext"],
        60_000
      );
      const internal = session.contestants.find(c => c.agentId === "internal");
      const ext = session.contestants.find(c => c.agentId === "ext");

      expect(internal?.isExternal).toBe(false);
      expect(ext?.isExternal).toBe(true);
    });

    it("initializes token consumption to 0", async () => {
      pm.initProfile("a", ["coding"]);
      const session = await engine.runCompetition(makeTask(), ["a"], 60_000);
      expect(session.contestants[0].tokenConsumed).toBe(0);
      expect(session.contestants[0].timedOut).toBe(false);
    });
  });

  // ─── checkDataSecurity ─────────────────────────────────────

  describe("checkDataSecurity", () => {
    it("returns true for non-sensitive tasks regardless of agent type", () => {
      pm.initProfile("ext", ["coding", "external"]);
      const task = makeTask({ dataSecurityLevel: "normal" });
      expect(engine.checkDataSecurity("ext", task)).toBe(true);
    });

    it("returns false for external agent on sensitive task", () => {
      pm.initProfile("ext", ["coding", "external"]);
      const task = makeTask({ dataSecurityLevel: "sensitive" });
      expect(engine.checkDataSecurity("ext", task)).toBe(false);
    });

    it("returns true for internal agent on sensitive task", () => {
      pm.initProfile("internal", ["coding"]);
      const task = makeTask({ dataSecurityLevel: "sensitive" });
      expect(engine.checkDataSecurity("internal", task)).toBe(true);
    });

    it("returns false for unknown agent on sensitive task", () => {
      const task = makeTask({ dataSecurityLevel: "sensitive" });
      expect(engine.checkDataSecurity("unknown", task)).toBe(false);
    });
  });

  // ─── computeDeadline ──────────────────────────────────────

  describe("computeDeadline", () => {
    it("returns estimatedDurationMs * 1.5 when below max", () => {
      // 60000 * 1.5 = 90000 < 300000
      expect(engine.computeDeadline(60_000)).toBe(90_000);
    });

    it("returns maxDeadlineMs when 1.5x exceeds it", () => {
      // 300000 * 1.5 = 450000 > 300000
      expect(engine.computeDeadline(300_000)).toBe(300_000);
    });

    it("returns 0 for 0 duration", () => {
      expect(engine.computeDeadline(0)).toBe(0);
    });

    it("respects custom maxDeadlineMs config", () => {
      const customConfig = makeConfig({
        competition: {
          defaultContestantCount: 3,
          maxDeadlineMs: 100_000,
          budgetRatio: 0.3,
        },
      });
      const customEngine = new CompetitionEngine(pm, cm, customConfig);
      // 80000 * 1.5 = 120000 > 100000
      expect(customEngine.computeDeadline(80_000)).toBe(100_000);
    });
  });
});
