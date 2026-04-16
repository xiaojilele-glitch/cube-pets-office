/**
 * RoleMatcher 单元测试
 *
 * 覆盖场景：
 * 1. 空候选 Agent 列表 → 返回空结果
 * 2. 所有 Agent 低分 → 仍返回结果（按分数降序排列）
 * 3. LLM 推断失败降级 → 回退到关键词匹配
 *
 * _Requirements: 3.1, 3.3_
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

import type { RoleTemplate } from "../../shared/role-schema.js";

// ── vi.hoisted: shared state for mocked singletons ──────────────
const { _perfState, perfTrackerProxy } = vi.hoisted(() => {
  const _perfState: { tracker: any } = { tracker: null };

  const perfTrackerProxy = new Proxy({} as any, {
    get(_target, prop) {
      const t = _perfState.tracker;
      if (!t) throw new Error("Test perf tracker not initialized");
      const val = (t as any)[prop];
      return typeof val === "function" ? val.bind(t) : val;
    },
  });

  return { _perfState, perfTrackerProxy };
});

// ── Mock the rolePerformanceTracker singleton ───────────────────
vi.mock("../core/role-performance-tracker.js", async importOriginal => {
  const orig =
    await importOriginal<
      typeof import("../core/role-performance-tracker.js")
    >();
  return {
    ...orig,
    rolePerformanceTracker: perfTrackerProxy,
  };
});

// ── Mock roleRegistry ───────────────────────────────────────────
vi.mock("../core/role-registry.js", () => ({
  roleRegistry: {
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
    resolve: vi.fn(() => undefined),
    register: vi.fn(),
  },
}));

// ── Import after mocks ──────────────────────────────────────────
import { RoleMatcher } from "../core/role-matcher.js";
import { RolePerformanceTracker } from "../core/role-performance-tracker.js";
import { roleRegistry } from "../core/role-registry.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeRole(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  return {
    roleId: "coder",
    roleName: "Coder",
    responsibilityPrompt: "You are a coder.",
    requiredSkillIds: ["typescript", "nodejs"],
    mcpIds: [],
    defaultModelConfig: { model: "gpt-4", temperature: 0.7, maxTokens: 4096 },
    authorityLevel: "medium",
    source: "predefined",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockAgent(agentId: string, loadedSkillIds: string[] = []): any {
  return {
    config: { id: agentId },
    getRoleState: () => ({
      loadedSkillIds,
      loadedMcpIds: [],
      currentRoleId: null,
      currentRoleLoadedAt: null,
      baseSystemPrompt: "",
      baseModelConfig: "",
      roleLoadPolicy: "prefer_agent" as const,
      lastRoleSwitchAt: null,
      roleSwitchCooldownMs: 60000,
      operationLog: [],
      effectiveModelConfig: null,
      baseFullModelConfig: null,
    }),
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("RoleMatcher Unit Tests", () => {
  let matcher: RoleMatcher;

  beforeEach(() => {
    matcher = new RoleMatcher();
    _perfState.tracker = new RolePerformanceTracker();
    vi.mocked(roleRegistry.get).mockReset();
    vi.mocked(roleRegistry.resolve).mockReset();
    vi.mocked(roleRegistry.list).mockReset();
  });

  // ── 1. Empty candidate agent list → returns empty results ──────

  describe("empty candidate agent list", () => {
    it("returns empty array when no candidate agents are provided", async () => {
      const task = {
        description: "implement a feature",
        requiredSkills: ["typescript"],
      };
      const results = await matcher.match(task, []);
      expect(results).toEqual([]);
    });

    it("returns empty array for empty candidates even with requiredRole set", async () => {
      const role = makeRole();
      vi.mocked(roleRegistry.get).mockReturnValue(role);
      vi.mocked(roleRegistry.resolve).mockReturnValue(role);

      const task = {
        description: "implement a feature",
        requiredRole: "coder",
      };
      const results = await matcher.match(task, []);
      expect(results).toEqual([]);
    });
  });

  // ── 2. All agents have low scores → still returns results sorted ──

  describe("all agents have low scores", () => {
    it("returns results sorted by score descending even when all scores are low", async () => {
      const role = makeRole({
        roleId: "coder",
        requiredSkillIds: ["rust", "wasm", "gpu"],
      });

      vi.mocked(roleRegistry.get).mockReturnValue(role);
      vi.mocked(roleRegistry.resolve).mockReturnValue(role);

      // Agents with no matching skills → low skillMatch and competency
      const agentA = createMockAgent("agent-a", ["cooking"]);
      const agentB = createMockAgent("agent-b", ["painting"]);
      const agentC = createMockAgent("agent-c", []);

      const task = {
        description: "implement a feature",
        requiredSkills: ["java", "spring"],
        requiredRole: "coder",
      };

      const results = await matcher.match(task, [agentA, agentB, agentC]);

      expect(results.length).toBe(3);
      // All results should be sorted descending by score
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].roleMatchScore).toBeGreaterThanOrEqual(
          results[i].roleMatchScore
        );
      }
      // All scores should be non-negative
      for (const r of results) {
        expect(r.roleMatchScore).toBeGreaterThanOrEqual(0);
        expect(r.recommendedRoleId).toBe("coder");
      }
    });

    it("returns all agents even when scores are near zero", async () => {
      const role = makeRole({
        roleId: "architect",
        requiredSkillIds: ["system-design", "cloud"],
      });

      vi.mocked(roleRegistry.get).mockReturnValue(role);
      vi.mocked(roleRegistry.resolve).mockReturnValue(role);

      const agents = [
        createMockAgent("agent-1", []),
        createMockAgent("agent-2", []),
      ];

      const task = {
        description: "design system",
        requiredSkills: ["unrelated-skill-xyz"],
        requiredRole: "architect",
      };

      const results = await matcher.match(task, agents);

      expect(results.length).toBe(2);
      // Each result has all required fields
      for (const r of results) {
        expect(r).toHaveProperty("agentId");
        expect(r).toHaveProperty("recommendedRoleId");
        expect(r).toHaveProperty("roleMatchScore");
        expect(r).toHaveProperty("reason");
      }
    });
  });

  // ── 3. LLM inference failure fallback → keyword matching ──────

  describe("LLM inference failure fallback to keyword matching", () => {
    it('infers "coder" role when task description contains code-related keywords', async () => {
      const coderRole = makeRole({
        roleId: "coder",
        requiredSkillIds: ["typescript"],
      });

      vi.mocked(roleRegistry.get).mockImplementation((roleId: string) =>
        roleId === "coder" ? coderRole : undefined
      );
      vi.mocked(roleRegistry.resolve).mockImplementation((roleId: string) => {
        if (roleId === "coder") return coderRole;
        throw new Error(`Role ${roleId} not found`);
      });

      const agent = createMockAgent("agent-a", ["typescript"]);
      const task = {
        description: "implement the login feature and develop the API",
      };

      const results = await matcher.match(task, [agent]);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].recommendedRoleId).toBe("coder");
      expect(results[0].reason).toContain("Keyword match");
    });

    it('infers "reviewer" role when task description contains review keywords', async () => {
      const reviewerRole = makeRole({
        roleId: "reviewer",
        roleName: "Reviewer",
        requiredSkillIds: ["code-review"],
      });

      vi.mocked(roleRegistry.get).mockImplementation((roleId: string) =>
        roleId === "reviewer" ? reviewerRole : undefined
      );
      vi.mocked(roleRegistry.resolve).mockImplementation((roleId: string) => {
        if (roleId === "reviewer") return reviewerRole;
        throw new Error(`Role ${roleId} not found`);
      });

      const agent = createMockAgent("agent-b", []);
      const task = {
        description: "review the pull request and check for issues",
      };

      const results = await matcher.match(task, [agent]);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].recommendedRoleId).toBe("reviewer");
      expect(results[0].reason).toContain("Keyword match");
    });

    it("falls back to all registered roles when no keywords match", async () => {
      const coderRole = makeRole({ roleId: "coder" });
      const qaRole = makeRole({
        roleId: "qa",
        roleName: "QA",
        requiredSkillIds: ["testing"],
      });

      vi.mocked(roleRegistry.get).mockImplementation((roleId: string) => {
        if (roleId === "coder") return coderRole;
        if (roleId === "qa") return qaRole;
        return undefined;
      });
      vi.mocked(roleRegistry.resolve).mockImplementation((roleId: string) => {
        if (roleId === "coder") return coderRole;
        if (roleId === "qa") return qaRole;
        throw new Error(`Role ${roleId} not found`);
      });
      vi.mocked(roleRegistry.list).mockReturnValue([coderRole, qaRole]);

      const agent = createMockAgent("agent-c", []);
      // Description with no matching keywords from KEYWORD_ROLE_MAP
      const task = {
        description: "perform an unrelated activity with no matching terms",
      };

      const results = await matcher.match(task, [agent]);

      // Should return recommendations for all registered roles
      expect(results.length).toBe(2);
      const roleIds = results.map(r => r.recommendedRoleId).sort();
      expect(roleIds).toEqual(["coder", "qa"]);
      // Reason should indicate fallback
      for (const r of results) {
        expect(r.reason).toContain("No keyword match");
      }
    });

    it("returns empty when no keywords match and no roles are registered", async () => {
      vi.mocked(roleRegistry.list).mockReturnValue([]);

      const agent = createMockAgent("agent-d", []);
      const task = { description: "something completely unrelated" };

      const results = await matcher.match(task, [agent]);

      expect(results).toEqual([]);
    });

    it("returns empty when requiredRole is set but not found in registry", async () => {
      vi.mocked(roleRegistry.get).mockReturnValue(undefined);

      const agent = createMockAgent("agent-e", []);
      const task = {
        description: "do something",
        requiredRole: "nonexistent-role",
      };

      const results = await matcher.match(task, [agent]);

      expect(results).toEqual([]);
    });
  });
});
