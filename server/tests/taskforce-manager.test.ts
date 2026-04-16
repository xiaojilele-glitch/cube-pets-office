import { describe, expect, it, beforeEach, vi } from "vitest";
import type {
  AutonomyConfig,
  AssessmentResult,
} from "../../shared/autonomy-types.js";
import { CapabilityProfileManager } from "../core/capability-profile-manager.js";
import { SelfAssessment } from "../core/self-assessment.js";
import {
  TaskforceManager,
  type RuntimeMessageBus,
  type TaskforceApplication,
} from "../core/taskforce-manager.js";

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

function makeMockMessageBus(): RuntimeMessageBus {
  return {
    createRoom: vi.fn(),
    broadcastToRoom: vi.fn(),
    destroyRoom: vi.fn(),
  };
}

function makeAssessmentResult(
  overrides?: Partial<AssessmentResult>
): AssessmentResult {
  return {
    agentId: "agent-1",
    taskId: "task-1",
    fitnessScore: 0.7,
    decision: "ACCEPT_WITH_CAVEAT",
    reason: "test",
    referralList: [],
    assessedAt: Date.now(),
    durationMs: 5,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("TaskforceManager", () => {
  let config: AutonomyConfig;
  let pm: CapabilityProfileManager;
  let sa: SelfAssessment;
  let bus: RuntimeMessageBus;
  let tfm: TaskforceManager;

  beforeEach(() => {
    config = makeConfig();
    pm = new CapabilityProfileManager(config);
    sa = new SelfAssessment(pm, config);
    bus = makeMockMessageBus();
    tfm = new TaskforceManager(sa, pm, bus, config);
  });

  // ─── electLead ─────────────────────────────────────────────

  describe("electLead", () => {
    it("returns agentId with highest fitnessScore", () => {
      const candidates = [
        makeAssessmentResult({ agentId: "a", fitnessScore: 0.5 }),
        makeAssessmentResult({ agentId: "b", fitnessScore: 0.9 }),
        makeAssessmentResult({ agentId: "c", fitnessScore: 0.7 }),
      ];
      expect(tfm.electLead(candidates)).toBe("b");
    });

    it("returns empty string for empty candidates", () => {
      expect(tfm.electLead([])).toBe("");
    });

    it("returns the only candidate when there is one", () => {
      const candidates = [
        makeAssessmentResult({ agentId: "solo", fitnessScore: 0.3 }),
      ];
      expect(tfm.electLead(candidates)).toBe("solo");
    });

    it("returns first highest when multiple candidates tie", () => {
      const candidates = [
        makeAssessmentResult({ agentId: "a", fitnessScore: 0.8 }),
        makeAssessmentResult({ agentId: "b", fitnessScore: 0.8 }),
      ];
      // First one with highest score wins
      expect(tfm.electLead(candidates)).toBe("a");
    });
  });

  // ─── formTaskforce ─────────────────────────────────────────

  describe("formTaskforce", () => {
    it("creates a session with recruiting status", async () => {
      pm.initProfile("trigger-agent", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };

      const session = await tfm.formTaskforce(task, "trigger-agent");

      expect(session.status).toBe("recruiting");
      expect(session.taskId).toBe("task-1");
      expect(session.taskforceId).toMatch(/^tf-/);
      expect(session.members.length).toBe(1);
      expect(session.members[0].role).toBe("lead");
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it("creates a message bus room", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };

      const session = await tfm.formTaskforce(task, "agent-1");

      expect(bus.createRoom).toHaveBeenCalledWith(
        `taskforce:${session.taskforceId}`
      );
    });

    it("elects the best candidate as lead", async () => {
      const p1 = pm.initProfile("weak", ["coding"]);
      p1.skillVector.set("coding", 0.3);
      p1.confidenceScore = 0.3;

      const p2 = pm.initProfile("strong", ["coding"]);
      p2.skillVector.set("coding", 0.95);
      p2.confidenceScore = 0.95;
      p2.resourceQuota.remainingTokenBudget = 100_000;

      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "weak");

      expect(session.leadAgentId).toBe("strong");
    });

    it("uses triggerAgentId as fallback when no candidates", async () => {
      // No profiles registered — electLead returns ''
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "fallback-agent");

      expect(session.leadAgentId).toBe("fallback-agent");
    });
  });

  // ─── processApplications ──────────────────────────────────

  describe("processApplications", () => {
    it("filters out applications with fitnessScore < 0.5", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      const apps: TaskforceApplication[] = [
        {
          agentId: "good",
          fitnessScore: 0.7,
          loadFactor: 0.3,
          estimatedCompletionTime: 1000,
        },
        {
          agentId: "bad",
          fitnessScore: 0.3,
          loadFactor: 0.2,
          estimatedCompletionTime: 500,
        },
      ];

      const members = await tfm.processApplications(session.taskforceId, apps);
      expect(members.length).toBe(1);
      expect(members[0].agentId).toBe("good");
    });

    it("filters out applications with loadFactor >= 0.8", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      const apps: TaskforceApplication[] = [
        {
          agentId: "overloaded",
          fitnessScore: 0.9,
          loadFactor: 0.8,
          estimatedCompletionTime: 1000,
        },
        {
          agentId: "available",
          fitnessScore: 0.6,
          loadFactor: 0.5,
          estimatedCompletionTime: 800,
        },
      ];

      const members = await tfm.processApplications(session.taskforceId, apps);
      expect(members.length).toBe(1);
      expect(members[0].agentId).toBe("available");
    });

    it("sorts accepted members by fitnessScore descending", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      const apps: TaskforceApplication[] = [
        {
          agentId: "mid",
          fitnessScore: 0.6,
          loadFactor: 0.3,
          estimatedCompletionTime: 1000,
        },
        {
          agentId: "top",
          fitnessScore: 0.9,
          loadFactor: 0.2,
          estimatedCompletionTime: 500,
        },
        {
          agentId: "low",
          fitnessScore: 0.5,
          loadFactor: 0.4,
          estimatedCompletionTime: 1500,
        },
      ];

      const members = await tfm.processApplications(session.taskforceId, apps);
      expect(members.map(m => m.agentId)).toEqual(["top", "mid", "low"]);
    });

    it('assigns role "worker" to all accepted members', async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      const apps: TaskforceApplication[] = [
        {
          agentId: "w1",
          fitnessScore: 0.7,
          loadFactor: 0.3,
          estimatedCompletionTime: 1000,
        },
      ];

      const members = await tfm.processApplications(session.taskforceId, apps);
      expect(members.every(m => m.role === "worker")).toBe(true);
    });

    it("returns empty array for unknown taskforceId", async () => {
      const members = await tfm.processApplications("nonexistent", []);
      expect(members).toEqual([]);
    });
  });

  // ─── handleHeartbeat ──────────────────────────────────────

  describe("handleHeartbeat", () => {
    it("updates lastHeartbeat and sets online to true", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      // Manually set member offline for testing
      session.members[0].online = false;
      session.members[0].lastHeartbeat = Date.now() - 100_000;

      const before = session.members[0].lastHeartbeat;
      tfm.handleHeartbeat(session.taskforceId, session.leadAgentId);

      expect(session.members[0].online).toBe(true);
      expect(session.members[0].lastHeartbeat).toBeGreaterThan(before);
    });

    it("does nothing for unknown taskforceId", () => {
      // Should not throw
      tfm.handleHeartbeat("nonexistent", "agent-1");
    });

    it("does nothing for unknown agentId", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      const hb = session.members[0].lastHeartbeat;
      tfm.handleHeartbeat(session.taskforceId, "unknown-agent");
      expect(session.members[0].lastHeartbeat).toBe(hb);
    });
  });

  // ─── checkOfflineMembers ──────────────────────────────────

  describe("checkOfflineMembers", () => {
    it("marks members as offline when heartbeat exceeds threshold", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      // Simulate stale heartbeat (> 90s ago with default 30s interval)
      session.members[0].lastHeartbeat = Date.now() - 100_000;

      const offline = tfm.checkOfflineMembers(session.taskforceId);
      expect(offline).toContain(session.leadAgentId);
      expect(session.members[0].online).toBe(false);
    });

    it("does not mark members with recent heartbeat as offline", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      const offline = tfm.checkOfflineMembers(session.taskforceId);
      expect(offline).toEqual([]);
      expect(session.members[0].online).toBe(true);
    });

    it("returns empty array for unknown taskforceId", () => {
      expect(tfm.checkOfflineMembers("nonexistent")).toEqual([]);
    });
  });

  // ─── dissolveTaskforce ────────────────────────────────────

  describe("dissolveTaskforce", () => {
    it("sets status to dissolved and records dissolvedAt", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");
      const tfId = session.taskforceId;

      await tfm.dissolveTaskforce(tfId);

      expect(session.status).toBe("dissolved");
      expect(session.dissolvedAt).toBeGreaterThan(0);
    });

    it("destroys the message bus room", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      await tfm.dissolveTaskforce(session.taskforceId);

      expect(bus.destroyRoom).toHaveBeenCalledWith(
        `taskforce:${session.taskforceId}`
      );
    });

    it("removes session from activeSessions", async () => {
      pm.initProfile("agent-1", ["coding"]);
      const task = {
        taskId: "task-1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const session = await tfm.formTaskforce(task, "agent-1");

      await tfm.dissolveTaskforce(session.taskforceId);

      expect(tfm.getActiveTaskforces()).toEqual([]);
    });

    it("does nothing for unknown taskforceId", async () => {
      // Should not throw
      await tfm.dissolveTaskforce("nonexistent");
    });
  });

  // ─── getActiveTaskforces ──────────────────────────────────

  describe("getActiveTaskforces", () => {
    it("returns empty array when no sessions exist", () => {
      expect(tfm.getActiveTaskforces()).toEqual([]);
    });

    it("returns all non-dissolved sessions", async () => {
      pm.initProfile("a1", ["coding"]);
      pm.initProfile("a2", ["testing"]);
      const task1 = {
        taskId: "t1",
        requiredSkills: ["coding"],
        requiredSkillWeights: new Map([["coding", 0.8]]),
      };
      const task2 = {
        taskId: "t2",
        requiredSkills: ["testing"],
        requiredSkillWeights: new Map([["testing", 0.7]]),
      };

      const s1 = await tfm.formTaskforce(task1, "a1");
      const s2 = await tfm.formTaskforce(task2, "a2");

      expect(tfm.getActiveTaskforces().length).toBe(2);

      await tfm.dissolveTaskforce(s1.taskforceId);

      const active = tfm.getActiveTaskforces();
      expect(active.length).toBe(1);
      expect(active[0].taskforceId).toBe(s2.taskforceId);
    });
  });
});
