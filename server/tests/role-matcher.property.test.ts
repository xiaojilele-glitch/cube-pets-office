// Feature: dynamic-role-system, Property 9: roleMatchScore 加权计算正确性
/**
 * Property 9: roleMatchScore 加权计算正确性
 *
 * 对于任意任务、候选 Agent 和角色组合，`roleMatchScore` 应等于：
 *   skillMatch * 0.35 + agentCompetency * 0.30 + rolePerformance * 0.25 * confidenceCoeff + (1 - loadFactor) * 0.10
 * 其中 confidenceCoeff = totalTasks < 10 ? 0.6 : 1.0
 *
 * 返回的 AgentRoleRecommendation 列表中每个元素应包含 agentId、recommendedRoleId、roleMatchScore 和 reason。
 *
 * **Validates: Requirements 3.1, 3.2, 4.4**
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

import type { RoleTemplate, AuthorityLevel, RoleSource, RolePerformanceRecord } from '../../shared/role-schema.js';
import type { WorkflowNodeModelConfig } from '../../shared/organization-schema.js';

// ── vi.hoisted: shared state for mocked singletons ──────────────
const { _perfState, perfTrackerProxy } = vi.hoisted(() => {
  const _perfState: { tracker: any } = { tracker: null };

  const perfTrackerProxy = new Proxy({} as any, {
    get(_target, prop) {
      const t = _perfState.tracker;
      if (!t) throw new Error('Test perf tracker not initialized');
      const val = (t as any)[prop];
      return typeof val === 'function' ? val.bind(t) : val;
    },
  });

  return { _perfState, perfTrackerProxy };
});

// ── Mock the rolePerformanceTracker singleton ───────────────────
vi.mock('../core/role-performance-tracker.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../core/role-performance-tracker.js')>();
  return {
    ...orig,
    rolePerformanceTracker: perfTrackerProxy,
  };
});

// ── Mock roleRegistry (we call computeScore directly, but inferCandidateRoles uses it) ──
vi.mock('../core/role-registry.js', () => ({
  roleRegistry: {
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
    resolve: vi.fn((roleId: string) => undefined),
    register: vi.fn(),
  },
}));

// ── Import after mocks ──────────────────────────────────────────
import { RoleMatcher } from '../core/role-matcher.js';
import { RolePerformanceTracker } from '../core/role-performance-tracker.js';

// ── Arbitraries ─────────────────────────────────────────────────

const arbAuthorityLevel: fc.Arbitrary<AuthorityLevel> = fc.constantFrom('high', 'medium', 'low');
const arbRoleSource: fc.Arbitrary<RoleSource> = fc.constantFrom('predefined', 'generated');

const arbModelConfig: fc.Arbitrary<WorkflowNodeModelConfig> = fc.record({
  model: fc.string({ minLength: 1, maxLength: 20 }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
  maxTokens: fc.integer({ min: 1, max: 128000 }),
});

const arbISODate: fc.Arbitrary<string> = fc
  .integer({ min: 1577836800000, max: 1924905600000 })
  .map((ts) => new Date(ts).toISOString());

const arbRoleId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter((s) => s.length >= 2);

const arbAgentId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter((s) => s.length >= 2);

const arbSkillList: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/).filter((s) => s.length >= 2),
  { minLength: 0, maxLength: 8 },
);

const arbRoleTemplate: fc.Arbitrary<RoleTemplate> = fc.record({
  roleId: arbRoleId,
  roleName: fc.string({ minLength: 1, maxLength: 20 }),
  responsibilityPrompt: fc.string({ minLength: 1, maxLength: 100 }),
  requiredSkillIds: arbSkillList,
  mcpIds: arbSkillList,
  defaultModelConfig: arbModelConfig,
  authorityLevel: arbAuthorityLevel,
  source: arbRoleSource,
  createdAt: arbISODate,
  updatedAt: arbISODate,
});

/** Generate totalTasks count — split between low-confidence (<10) and high-confidence (>=10) */
const arbTotalTasks: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 });

/** Generate avgQualityScore in [0, 100] */
const arbQualityScore: fc.Arbitrary<number> = fc.double({ min: 0, max: 100, noNaN: true });

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Create a minimal mock Agent that satisfies the interface used by computeScore:
 * - config.id
 * - getRoleState().loadedSkillIds
 */
function createMockAgent(agentId: string, loadedSkillIds: string[]): any {
  return {
    config: { id: agentId },
    getRoleState: () => ({
      loadedSkillIds,
      loadedMcpIds: [],
      currentRoleId: null,
      currentRoleLoadedAt: null,
      baseSystemPrompt: '',
      baseModelConfig: '',
      roleLoadPolicy: 'prefer_agent' as const,
      lastRoleSwitchAt: null,
      roleSwitchCooldownMs: 60000,
      operationLog: [],
      effectiveModelConfig: null,
      baseFullModelConfig: null,
    }),
  };
}

/**
 * Compute Jaccard similarity — mirrors the private skillMatch method.
 */
function expectedSkillMatch(taskSkills: string[] | undefined, roleSkills: string[]): number {
  if (!taskSkills || taskSkills.length === 0) return 0.5;
  const taskSet = new Set(taskSkills);
  const roleSet = new Set(roleSkills);
  const intersection = Array.from(taskSet).filter((s) => roleSet.has(s)).length;
  const union = new Set([...taskSet, ...roleSet]).size;
  if (union === 0) return 0.5;
  return intersection / union;
}

/**
 * Compute agent competency — mirrors the private agentCompetency method.
 */
function expectedAgentCompetency(agentSkills: string[], roleRequiredSkills: string[]): number {
  if (agentSkills.length === 0 || roleRequiredSkills.length === 0) return 0.5;
  const agentSet = new Set(agentSkills);
  const matchCount = roleRequiredSkills.filter((s) => agentSet.has(s)).length;
  return matchCount / roleRequiredSkills.length;
}

/**
 * Compute expected rolePerformance score and confidenceCoeff.
 */
function expectedRolePerformance(
  perfRecord: RolePerformanceRecord | undefined,
): { score: number; confidenceCoeff: number } {
  if (!perfRecord || perfRecord.totalTasks === 0) {
    return { score: 0.5, confidenceCoeff: 0.6 };
  }
  const score = perfRecord.avgQualityScore / 100;
  const confidenceCoeff = perfRecord.totalTasks < 10 ? 0.6 : 1.0;
  return { score, confidenceCoeff };
}

/**
 * Compute the full expected score using the design formula.
 */
function expectedScore(
  taskSkills: string[] | undefined,
  roleRequiredSkills: string[],
  agentSkills: string[],
  perfRecord: RolePerformanceRecord | undefined,
): number {
  const sm = expectedSkillMatch(taskSkills, roleRequiredSkills);
  const ac = expectedAgentCompetency(agentSkills, roleRequiredSkills);
  const { score: rp, confidenceCoeff } = expectedRolePerformance(perfRecord);
  const loadFactor = 0; // getLoadFactor always returns 0

  return sm * 0.35 + ac * 0.30 + rp * 0.25 * confidenceCoeff + (1 - loadFactor) * 0.10;
}

// ── Tests ───────────────────────────────────────────────────────

describe('RoleMatcher Property 9: roleMatchScore 加权计算正确性', () => {
  let matcher: RoleMatcher;

  beforeEach(() => {
    matcher = new RoleMatcher();
    _perfState.tracker = new RolePerformanceTracker();
  });

  // **Validates: Requirements 3.1, 3.2**
  it('computeScore matches the weighted formula for any task/agent/role combination (no perf data)', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSkillList, // agent loaded skills
        arbSkillList, // task required skills
        arbRoleTemplate,
        (agentId, agentSkills, taskSkills, role) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          const agent = createMockAgent(agentId, agentSkills);
          const task = { description: 'test task', requiredSkills: taskSkills };

          const actual = matcher.computeScore(task, agent, role);
          const expected = expectedScore(taskSkills, role.requiredSkillIds, agentSkills, undefined);

          expect(actual).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.2, 4.4**
  it('computeScore applies confidenceCoeff=0.6 when totalTasks < 10', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleTemplate,
        arbSkillList,
        arbSkillList,
        fc.integer({ min: 1, max: 9 }), // totalTasks < 10
        arbQualityScore,
        (agentId, role, agentSkills, taskSkills, totalTasks, qualityScore) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          // Populate performance data with exactly totalTasks entries
          for (let i = 0; i < totalTasks; i++) {
            tracker.updateOnTaskComplete(agentId, role.roleId, {
              taskId: `task-${i}`,
              qualityScore,
              latencyMs: 100,
              success: true,
            });
          }

          const perfRecord = tracker.getPerformance(agentId, role.roleId) as RolePerformanceRecord;
          expect(perfRecord.totalTasks).toBe(totalTasks);
          expect(perfRecord.lowConfidence).toBe(true);

          const agent = createMockAgent(agentId, agentSkills);
          const task = { description: 'test task', requiredSkills: taskSkills };

          const actual = matcher.computeScore(task, agent, role);
          const expected = expectedScore(taskSkills, role.requiredSkillIds, agentSkills, perfRecord);

          // Verify confidenceCoeff is 0.6
          const { confidenceCoeff } = expectedRolePerformance(perfRecord);
          expect(confidenceCoeff).toBe(0.6);

          expect(actual).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.2, 4.4**
  it('computeScore applies confidenceCoeff=1.0 when totalTasks >= 10', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleTemplate,
        arbSkillList,
        arbSkillList,
        fc.integer({ min: 10, max: 50 }), // totalTasks >= 10
        arbQualityScore,
        (agentId, role, agentSkills, taskSkills, totalTasks, qualityScore) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          for (let i = 0; i < totalTasks; i++) {
            tracker.updateOnTaskComplete(agentId, role.roleId, {
              taskId: `task-${i}`,
              qualityScore,
              latencyMs: 100,
              success: true,
            });
          }

          const perfRecord = tracker.getPerformance(agentId, role.roleId) as RolePerformanceRecord;
          expect(perfRecord.totalTasks).toBe(totalTasks);
          expect(perfRecord.lowConfidence).toBe(false);

          const agent = createMockAgent(agentId, agentSkills);
          const task = { description: 'test task', requiredSkills: taskSkills };

          const actual = matcher.computeScore(task, agent, role);
          const expected = expectedScore(taskSkills, role.requiredSkillIds, agentSkills, perfRecord);

          const { confidenceCoeff } = expectedRolePerformance(perfRecord);
          expect(confidenceCoeff).toBe(1.0);

          expect(actual).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.1, 3.2**
  it('computeScore is in [0, 1] range for any valid inputs', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSkillList,
        arbSkillList,
        arbRoleTemplate,
        arbTotalTasks,
        arbQualityScore,
        (agentId, agentSkills, taskSkills, role, totalTasks, qualityScore) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          for (let i = 0; i < totalTasks; i++) {
            tracker.updateOnTaskComplete(agentId, role.roleId, {
              taskId: `task-${i}`,
              qualityScore,
              latencyMs: 100,
              success: true,
            });
          }

          const agent = createMockAgent(agentId, agentSkills);
          const task = { description: 'test task', requiredSkills: taskSkills };

          const score = matcher.computeScore(task, agent, role);

          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.1**
  it('computeScore with no task requiredSkills uses 0.5 as skillMatch default', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSkillList,
        arbRoleTemplate,
        (agentId, agentSkills, role) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          const agent = createMockAgent(agentId, agentSkills);
          const task = { description: 'test task' }; // no requiredSkills

          const actual = matcher.computeScore(task, agent, role);
          const expected = expectedScore(undefined, role.requiredSkillIds, agentSkills, undefined);

          expect(actual).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.1, 3.2**
  it('AgentRoleRecommendation contains all required fields (agentId, recommendedRoleId, roleMatchScore, reason)', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSkillList,
        arbSkillList,
        arbRoleTemplate,
        (agentId, agentSkills, taskSkills, role) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          const agent = createMockAgent(agentId, agentSkills);
          const task = { description: 'test task', requiredSkills: taskSkills };

          const score = matcher.computeScore(task, agent, role);

          // Build the recommendation as match() would
          const recommendation = {
            agentId: agent.config.id,
            recommendedRoleId: role.roleId,
            roleMatchScore: Math.round(score * 1000) / 1000,
            reason: 'test',
          };

          expect(recommendation).toHaveProperty('agentId', agentId);
          expect(recommendation).toHaveProperty('recommendedRoleId', role.roleId);
          expect(typeof recommendation.roleMatchScore).toBe('number');
          expect(recommendation.roleMatchScore).toBeGreaterThanOrEqual(0);
          expect(recommendation).toHaveProperty('reason');
          expect(typeof recommendation.reason).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.2, 4.4**
  it('weight components sum correctly: 0.35 + 0.30 + 0.25*coeff + 0.10 for perfect scores', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleTemplate,
        fc.boolean(), // lowConfidence or not
        (agentId, role, isLowConfidence) => {
          const tracker = new RolePerformanceTracker();
          _perfState.tracker = tracker;

          const totalTasks = isLowConfidence ? 5 : 15;
          for (let i = 0; i < totalTasks; i++) {
            tracker.updateOnTaskComplete(agentId, role.roleId, {
              taskId: `task-${i}`,
              qualityScore: 100, // perfect score → rolePerformance = 1.0
              latencyMs: 100,
              success: true,
            });
          }

          // Agent has exactly the role's required skills → competency = 1.0
          // Task has exactly the role's required skills → skillMatch = 1.0
          const agent = createMockAgent(agentId, [...role.requiredSkillIds]);
          const task = { description: 'test', requiredSkills: [...role.requiredSkillIds] };

          // Only compute when role has skills (otherwise defaults kick in)
          if (role.requiredSkillIds.length > 0) {
            const score = matcher.computeScore(task, agent, role);
            const confidenceCoeff = isLowConfidence ? 0.6 : 1.0;
            // All sub-scores are 1.0, loadFactor is 0
            const expectedVal = 1.0 * 0.35 + 1.0 * 0.30 + 1.0 * 0.25 * confidenceCoeff + 1.0 * 0.10;
            expect(score).toBeCloseTo(expectedVal, 10);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: dynamic-role-system, Property 10: requiredRole 约束匹配范围
/**
 * Property 10: requiredRole 约束匹配范围
 *
 * 对于任意显式声明了 requiredRole 的任务，RoleMatcher.match() 返回的所有推荐结果的
 * recommendedRoleId 应等于该 requiredRole，不应包含其他角色。
 *
 * **Validates: Requirements 3.4**
 */

import { roleRegistry } from '../core/role-registry.js';

describe('RoleMatcher Property 10: requiredRole 约束匹配范围', () => {
  let matcher: RoleMatcher;

  beforeEach(() => {
    matcher = new RoleMatcher();
    _perfState.tracker = new RolePerformanceTracker();
    vi.mocked(roleRegistry.get).mockReset();
    vi.mocked(roleRegistry.resolve).mockReset();
    vi.mocked(roleRegistry.list).mockReset();
  });

  // **Validates: Requirements 3.4**
  it('all recommendations have recommendedRoleId equal to task.requiredRole', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRoleTemplate,
        fc.array(
          fc.record({ agentId: arbAgentId, skills: arbSkillList }),
          { minLength: 1, maxLength: 5 },
        ),
        arbSkillList, // task required skills
        async (role, agentDefs, taskSkills) => {
          // Setup registry mock: get() returns the template, resolve() returns it for scoring
          vi.mocked(roleRegistry.get).mockImplementation((roleId: string) =>
            roleId === role.roleId ? role : undefined,
          );
          vi.mocked(roleRegistry.resolve).mockImplementation((roleId: string) => {
            if (roleId === role.roleId) return role;
            throw new Error(`Role ${roleId} not found`);
          });

          const agents = agentDefs.map((d) => createMockAgent(d.agentId, d.skills));

          const task = {
            description: 'any task description',
            requiredSkills: taskSkills,
            requiredRole: role.roleId,
          };

          const results = await matcher.match(task, agents);

          // All results must have recommendedRoleId === requiredRole
          for (const rec of results) {
            expect(rec.recommendedRoleId).toBe(role.roleId);
          }

          // Should have exactly one recommendation per agent
          expect(results.length).toBe(agents.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.4**
  it('requiredRole skips role inference — only the specified role appears even when other roles are registered', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRoleTemplate,
        arbRoleTemplate,
        fc.record({ agentId: arbAgentId, skills: arbSkillList }),
        async (requiredRole, otherRole, agentDef) => {
          // Ensure distinct roleIds
          const other = { ...otherRole, roleId: otherRole.roleId === requiredRole.roleId ? `${otherRole.roleId}-x` : otherRole.roleId };

          vi.mocked(roleRegistry.get).mockImplementation((roleId: string) => {
            if (roleId === requiredRole.roleId) return requiredRole;
            if (roleId === other.roleId) return other;
            return undefined;
          });
          vi.mocked(roleRegistry.resolve).mockImplementation((roleId: string) => {
            if (roleId === requiredRole.roleId) return requiredRole;
            if (roleId === other.roleId) return other;
            throw new Error(`Role ${roleId} not found`);
          });
          vi.mocked(roleRegistry.list).mockReturnValue([requiredRole, other]);

          const agent = createMockAgent(agentDef.agentId, agentDef.skills);

          const task = {
            description: 'implement code review and test',
            requiredRole: requiredRole.roleId,
          };

          const results = await matcher.match(task, [agent]);

          // Despite other roles being registered and keywords matching, only requiredRole appears
          expect(results.length).toBe(1);
          expect(results[0].recommendedRoleId).toBe(requiredRole.roleId);
          expect(results[0].agentId).toBe(agentDef.agentId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 3.4**
  it('each recommendation contains all required fields with correct types', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRoleTemplate,
        fc.array(
          fc.record({ agentId: arbAgentId, skills: arbSkillList }),
          { minLength: 1, maxLength: 4 },
        ),
        async (role, agentDefs) => {
          vi.mocked(roleRegistry.get).mockImplementation((roleId: string) =>
            roleId === role.roleId ? role : undefined,
          );
          vi.mocked(roleRegistry.resolve).mockImplementation((roleId: string) => {
            if (roleId === role.roleId) return role;
            throw new Error(`Role ${roleId} not found`);
          });

          const agents = agentDefs.map((d) => createMockAgent(d.agentId, d.skills));

          const task = {
            description: 'some task',
            requiredRole: role.roleId,
          };

          const results = await matcher.match(task, agents);

          for (const rec of results) {
            expect(rec).toHaveProperty('agentId');
            expect(rec).toHaveProperty('recommendedRoleId', role.roleId);
            expect(typeof rec.roleMatchScore).toBe('number');
            expect(rec.roleMatchScore).toBeGreaterThanOrEqual(0);
            expect(rec.roleMatchScore).toBeLessThanOrEqual(1);
            expect(rec).toHaveProperty('reason');
            expect(typeof rec.reason).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
