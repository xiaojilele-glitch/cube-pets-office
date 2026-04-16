import { describe, expect, it, beforeEach } from "vitest";
import type {
  AutonomyConfig,
  AssessmentResult,
} from "../../shared/autonomy-types.js";
import { CapabilityProfileManager } from "../core/capability-profile-manager.js";
import { SelfAssessment, type TaskRequest } from "../core/self-assessment.js";
import { TaskAllocator } from "../core/task-allocator.js";

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

function makeTask(overrides?: Partial<TaskRequest>): TaskRequest {
  return {
    taskId: "task-1",
    requiredSkills: ["coding", "testing"],
    requiredSkillWeights: new Map([
      ["coding", 0.8],
      ["testing", 0.6],
    ]),
    ...overrides,
  };
}

function makeAssessmentResult(
  overrides?: Partial<AssessmentResult>
): AssessmentResult {
  return {
    agentId: "agent-1",
    taskId: "task-1",
    fitnessScore: 0.5,
    decision: "REQUEST_ASSIST",
    reason: "test",
    referralList: [],
    assessedAt: Date.now(),
    durationMs: 10,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("TaskAllocator", () => {
  let config: AutonomyConfig;
  let pm: CapabilityProfileManager;
  let sa: SelfAssessment;
  let allocator: TaskAllocator;

  beforeEach(() => {
    config = makeConfig();
    pm = new CapabilityProfileManager(config);
    sa = new SelfAssessment(pm, config);
    allocator = new TaskAllocator(sa, pm, config);
  });

  // ─── allocateTask ──────────────────────────────────────────

  describe("allocateTask", () => {
    it("returns NO_CANDIDATES_AVAILABLE when no agents match", async () => {
      const task = makeTask({ requiredSkills: ["quantum-physics"] });
      const decision = await allocator.allocateTask(task);
      expect(decision.reason).toBe("NO_CANDIDATES_AVAILABLE");
      expect(decision.assignedAgentId).toBe("");
    });

    it("uses static assignment when autonomy is disabled", async () => {
      config = makeConfig({ enabled: false });
      pm = new CapabilityProfileManager(config);
      sa = new SelfAssessment(pm, config);
      allocator = new TaskAllocator(sa, pm, config);

      pm.initProfile("agent-a", ["coding", "testing"]);
      pm.initProfile("agent-b", ["coding"]);

      const decision = await allocator.allocateTask(makeTask());
      expect(decision.strategy).toBe("DIRECT_ASSIGN");
      expect(decision.reason).toContain("Static assignment");
      expect(decision.assessments).toEqual([]);
    });

    it("assigns to the best ACCEPT agent", async () => {
      const p1 = pm.initProfile("strong", ["coding", "testing"]);
      p1.skillVector.set("coding", 0.95);
      p1.skillVector.set("testing", 0.9);
      p1.confidenceScore = 0.95;
      p1.resourceQuota.remainingTokenBudget = 100_000;

      const p2 = pm.initProfile("weak", ["coding", "testing"]);
      p2.skillVector.set("coding", 0.3);
      p2.skillVector.set("testing", 0.2);
      p2.confidenceScore = 0.3;

      const decision = await allocator.allocateTask(makeTask());
      expect(decision.assignedAgentId).toBe("strong");
      expect(["DIRECT_ASSIGN", "CAVEAT_ASSIGN"]).toContain(decision.strategy);
    });

    it("force-assigns when all candidates reject", async () => {
      // Create agents with near-zero skills, zero confidence, zero budget,
      // and max load so fitnessScore < 0.4 → REJECT_AND_REFER
      // fitness = 0.4*~0 + 0.2*(1-1) + 0.25*0 + 0.15*0 ≈ 0
      const p1 = pm.initProfile("a1", ["coding"]);
      p1.skillVector.set("coding", 0.01);
      p1.confidenceScore = 0.0;
      p1.loadFactor = 1.0;
      p1.resourceQuota.remainingTokenBudget = 0;

      const p2 = pm.initProfile("a2", ["testing"]);
      p2.skillVector.set("testing", 0.01);
      p2.confidenceScore = 0.0;
      p2.loadFactor = 1.0;
      p2.resourceQuota.remainingTokenBudget = 0;

      const decision = await allocator.allocateTask(makeTask());
      expect(decision.strategy).toBe("FORCE_ASSIGN");
      expect(decision.forceAssignReason).toBeDefined();
    });
  });

  // ─── broadcastAssessment ───────────────────────────────────

  describe("broadcastAssessment", () => {
    it("returns results for all candidates", async () => {
      pm.initProfile("a1", ["coding"]);
      pm.initProfile("a2", ["testing"]);

      const results = await allocator.broadcastAssessment(
        makeTask(),
        ["a1", "a2"],
        200
      );
      expect(results).toHaveLength(2);
      expect(results.map(r => r.agentId).sort()).toEqual(["a1", "a2"]);
    });

    it("returns REJECT for unknown agents (profile missing)", async () => {
      const results = await allocator.broadcastAssessment(
        makeTask(),
        ["unknown"],
        200
      );
      expect(results).toHaveLength(1);
      expect(results[0].decision).toBe("REJECT_AND_REFER");
    });
  });

  // ─── selectBestAgent ──────────────────────────────────────

  describe("selectBestAgent", () => {
    const task = makeTask();

    it("picks ACCEPT with highest fitnessScore as DIRECT_ASSIGN", () => {
      const results: AssessmentResult[] = [
        makeAssessmentResult({
          agentId: "a1",
          decision: "ACCEPT",
          fitnessScore: 0.85,
        }),
        makeAssessmentResult({
          agentId: "a2",
          decision: "ACCEPT",
          fitnessScore: 0.9,
        }),
        makeAssessmentResult({
          agentId: "a3",
          decision: "ACCEPT_WITH_CAVEAT",
          fitnessScore: 0.95,
        }),
      ];
      const decision = allocator.selectBestAgent(results, task);
      expect(decision).not.toBeNull();
      expect(decision!.strategy).toBe("DIRECT_ASSIGN");
      expect(decision!.assignedAgentId).toBe("a2");
    });

    it("picks ACCEPT_WITH_CAVEAT when no ACCEPT exists", () => {
      const results: AssessmentResult[] = [
        makeAssessmentResult({
          agentId: "a1",
          decision: "ACCEPT_WITH_CAVEAT",
          fitnessScore: 0.65,
        }),
        makeAssessmentResult({
          agentId: "a2",
          decision: "ACCEPT_WITH_CAVEAT",
          fitnessScore: 0.75,
        }),
        makeAssessmentResult({
          agentId: "a3",
          decision: "REQUEST_ASSIST",
          fitnessScore: 0.55,
        }),
      ];
      const decision = allocator.selectBestAgent(results, task);
      expect(decision).not.toBeNull();
      expect(decision!.strategy).toBe("CAVEAT_ASSIGN");
      expect(decision!.assignedAgentId).toBe("a2");
    });

    it("picks REQUEST_ASSIST as TASKFORCE when no ACCEPT/CAVEAT", () => {
      const results: AssessmentResult[] = [
        makeAssessmentResult({
          agentId: "a1",
          decision: "REQUEST_ASSIST",
          fitnessScore: 0.45,
        }),
        makeAssessmentResult({
          agentId: "a2",
          decision: "REQUEST_ASSIST",
          fitnessScore: 0.55,
        }),
        makeAssessmentResult({
          agentId: "a3",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.2,
        }),
      ];
      const decision = allocator.selectBestAgent(results, task);
      expect(decision).not.toBeNull();
      expect(decision!.strategy).toBe("TASKFORCE");
      expect(decision!.assignedAgentId).toBe("a2");
    });

    it("returns null when all REJECT", () => {
      const results: AssessmentResult[] = [
        makeAssessmentResult({
          agentId: "a1",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.1,
        }),
        makeAssessmentResult({
          agentId: "a2",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.2,
        }),
      ];
      const decision = allocator.selectBestAgent(results, task);
      expect(decision).toBeNull();
    });
  });

  // ─── forceAssign ──────────────────────────────────────────

  describe("forceAssign", () => {
    const task = makeTask();

    it("picks agent with highest referral count", () => {
      const results: AssessmentResult[] = [
        makeAssessmentResult({
          agentId: "a1",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.1,
          referralList: ["a3"],
        }),
        makeAssessmentResult({
          agentId: "a2",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.2,
          referralList: ["a3", "a4"],
        }),
      ];
      const decision = allocator.forceAssign(results, task);
      expect(decision.strategy).toBe("FORCE_ASSIGN");
      expect(decision.assignedAgentId).toBe("a3");
      expect(decision.forceAssignReason).toContain("most-referred");
    });

    it("picks highest fitnessScore when no referrals", () => {
      const results: AssessmentResult[] = [
        makeAssessmentResult({
          agentId: "a1",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.3,
          referralList: [],
        }),
        makeAssessmentResult({
          agentId: "a2",
          decision: "REJECT_AND_REFER",
          fitnessScore: 0.1,
          referralList: [],
        }),
      ];
      const decision = allocator.forceAssign(results, task);
      expect(decision.strategy).toBe("FORCE_ASSIGN");
      expect(decision.assignedAgentId).toBe("a1");
      expect(decision.forceAssignReason).toContain("highest-fitness");
    });
  });

  // ─── updateRejectRate & checkRejectRateAlert ───────────────

  describe("updateRejectRate / checkRejectRateAlert", () => {
    it("returns false when no history exists", () => {
      expect(allocator.checkRejectRateAlert("unknown")).toBe(false);
    });

    it("returns false when reject rate is below 60%", () => {
      for (let i = 0; i < 50; i++) {
        allocator.updateRejectRate("agent-x", i < 29); // 29 rejects = 58%
      }
      expect(allocator.checkRejectRateAlert("agent-x")).toBe(false);
    });

    it("returns true when reject rate exceeds 60%", () => {
      for (let i = 0; i < 50; i++) {
        allocator.updateRejectRate("agent-y", i < 31); // 31 rejects = 62%
      }
      expect(allocator.checkRejectRateAlert("agent-y")).toBe(true);
    });

    it("maintains sliding window of 50 entries", () => {
      // Fill with 50 rejects
      for (let i = 0; i < 50; i++) {
        allocator.updateRejectRate("agent-z", true);
      }
      expect(allocator.checkRejectRateAlert("agent-z")).toBe(true);

      // Push 25 accepts — window now has 25 rejects + 25 accepts (50%)
      for (let i = 0; i < 25; i++) {
        allocator.updateRejectRate("agent-z", false);
      }
      expect(allocator.checkRejectRateAlert("agent-z")).toBe(false);
    });

    it("returns false at exactly 30 rejects (threshold is > 30)", () => {
      for (let i = 0; i < 50; i++) {
        allocator.updateRejectRate("agent-boundary", i < 30); // exactly 30
      }
      expect(allocator.checkRejectRateAlert("agent-boundary")).toBe(false);
    });
  });
});
