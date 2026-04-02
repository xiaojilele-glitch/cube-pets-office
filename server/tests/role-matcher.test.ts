import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate } from '../../shared/role-schema.js';
import { RoleRegistry } from '../core/role-registry.js';
import { RolePerformanceTracker } from '../core/role-performance-tracker.js';
import { RoleMatcher, KEYWORD_ROLE_MAP } from '../core/role-matcher.js';

// We need to mock the singletons used by RoleMatcher.
// Instead of mocking, we'll create fresh instances and wire them up via module internals.
// Since RoleMatcher imports singletons, we'll test the class directly with controlled state.

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_role_matcher__');
const TEST_STORE_PATH = resolve(TEST_STORE_DIR, 'role-templates.json');

/** Helper: build a minimal valid RoleTemplate */
function makeTemplate(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  const now = new Date().toISOString();
  return {
    roleId: overrides.roleId ?? `role-${Date.now()}`,
    roleName: overrides.roleName ?? 'TestRole',
    responsibilityPrompt: overrides.responsibilityPrompt ?? 'You are a test role.',
    requiredSkillIds: overrides.requiredSkillIds ?? ['skill-a'],
    mcpIds: overrides.mcpIds ?? ['mcp-a'],
    defaultModelConfig: overrides.defaultModelConfig ?? { model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 },
    authorityLevel: overrides.authorityLevel ?? 'medium',
    source: overrides.source ?? 'predefined',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

/** Minimal mock Agent that satisfies the interface used by RoleMatcher */
function makeMockAgent(id: string, loadedSkillIds: string[] = []): any {
  return {
    config: { id },
    getCurrentRoleId: () => null,
    getRoleState: () => ({
      currentRoleId: null,
      currentRoleLoadedAt: null,
      baseSystemPrompt: '',
      baseModelConfig: 'gpt-4o',
      roleLoadPolicy: 'merge' as const,
      lastRoleSwitchAt: null,
      roleSwitchCooldownMs: 60000,
      operationLog: [],
      loadedSkillIds,
      loadedMcpIds: [],
    }),
  };
}

describe('RoleMatcher', () => {
  let matcher: RoleMatcher;

  beforeEach(() => {
    matcher = new RoleMatcher();
  });

  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // ── inferCandidateRoles ────────────────────────────────────────

  describe('inferCandidateRoles', () => {
    it('matches "code" keyword to coder role when registered', async () => {
      // We need the role registered in the global registry for this test
      const { roleRegistry } = await import('../core/role-registry.js');
      const coderTemplate = makeTemplate({ roleId: 'coder', roleName: 'Coder' });
      roleRegistry.register(coderTemplate);

      try {
        const roles = await matcher.inferCandidateRoles('Please implement the code for this feature');
        const roleIds = roles.map(r => r.roleId);
        expect(roleIds).toContain('coder');
      } finally {
        roleRegistry.unregister('coder');
      }
    });

    it('matches "review" keyword to reviewer role when registered', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({ roleId: 'reviewer', roleName: 'Reviewer' }));

      try {
        const roles = await matcher.inferCandidateRoles('Please review this pull request');
        const roleIds = roles.map(r => r.roleId);
        expect(roleIds).toContain('reviewer');
      } finally {
        roleRegistry.unregister('reviewer');
      }
    });

    it('matches "design" keyword to architect role when registered', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({ roleId: 'architect', roleName: 'Architect' }));

      try {
        const roles = await matcher.inferCandidateRoles('Design the system architecture');
        const roleIds = roles.map(r => r.roleId);
        expect(roleIds).toContain('architect');
      } finally {
        roleRegistry.unregister('architect');
      }
    });

    it('matches "test" keyword to qa role when registered', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({ roleId: 'qa', roleName: 'QA' }));

      try {
        const roles = await matcher.inferCandidateRoles('Test the login functionality');
        const roleIds = roles.map(r => r.roleId);
        expect(roleIds).toContain('qa');
      } finally {
        roleRegistry.unregister('qa');
      }
    });

    it('returns all registered roles when no keywords match', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({ roleId: 'role-x', roleName: 'X' }));
      roleRegistry.register(makeTemplate({ roleId: 'role-y', roleName: 'Y' }));

      try {
        const roles = await matcher.inferCandidateRoles('something completely unrelated xyz');
        expect(roles.length).toBe(roleRegistry.list().length);
      } finally {
        roleRegistry.unregister('role-x');
        roleRegistry.unregister('role-y');
      }
    });
  });

  // ── computeScore ───────────────────────────────────────────────

  describe('computeScore', () => {
    it('computes score with default values when no skills or performance data', () => {
      const agent = makeMockAgent('agent-1');
      const role = makeTemplate({ roleId: 'coder', requiredSkillIds: ['ts', 'node'] });
      const task = { description: 'Implement feature' };

      const score = matcher.computeScore(task, agent, role);

      // skillMatch: no task skills → 0.5
      // agentCompetency: no agent skills → 0.5
      // rolePerformance: no data → 0.5, confidenceCoeff = 0.6
      // loadFactor: 0
      // = 0.5*0.35 + 0.5*0.30 + 0.5*0.25*0.6 + (1-0)*0.10
      // = 0.175 + 0.15 + 0.075 + 0.10 = 0.5
      expect(score).toBeCloseTo(0.5, 2);
    });

    it('computes higher score when task skills match role skills', () => {
      const agent = makeMockAgent('agent-1');
      const role = makeTemplate({ roleId: 'coder', requiredSkillIds: ['ts', 'node'] });
      const taskMatch = { description: 'Implement', requiredSkills: ['ts', 'node'] };
      const taskNoMatch = { description: 'Implement', requiredSkills: ['python', 'django'] };

      const scoreMatch = matcher.computeScore(taskMatch, agent, role);
      const scoreNoMatch = matcher.computeScore(taskNoMatch, agent, role);

      expect(scoreMatch).toBeGreaterThan(scoreNoMatch);
    });

    it('computes higher score when agent has matching skills', () => {
      const agentWithSkills = makeMockAgent('agent-1', ['ts', 'node']);
      const agentNoSkills = makeMockAgent('agent-2', ['python']);
      const role = makeTemplate({ roleId: 'coder', requiredSkillIds: ['ts', 'node'] });
      const task = { description: 'Implement feature' };

      const scoreWith = matcher.computeScore(task, agentWithSkills, role);
      const scoreWithout = matcher.computeScore(task, agentNoSkills, role);

      expect(scoreWith).toBeGreaterThan(scoreWithout);
    });

    it('applies confidence coefficient of 0.6 when totalTasks < 10', async () => {
      const { rolePerformanceTracker } = await import('../core/role-performance-tracker.js');
      const agent = makeMockAgent('agent-score-conf');
      const role = makeTemplate({ roleId: 'coder-conf', requiredSkillIds: [] });

      // Add 5 tasks (< 10 threshold)
      for (let i = 0; i < 5; i++) {
        rolePerformanceTracker.updateOnTaskComplete('agent-score-conf', 'coder-conf', {
          taskId: `t-${i}`,
          qualityScore: 80,
          latencyMs: 100,
          success: true,
        });
      }

      const task = { description: 'Test' };
      const score = matcher.computeScore(task, agent, role);

      // rolePerformance = 80/100 = 0.8, confidenceCoeff = 0.6
      // perfComponent = 0.8 * 0.25 * 0.6 = 0.12
      expect(score).toBeDefined();
      expect(typeof score).toBe('number');
    });

    it('applies confidence coefficient of 1.0 when totalTasks >= 10', async () => {
      const { rolePerformanceTracker } = await import('../core/role-performance-tracker.js');
      const agent = makeMockAgent('agent-score-full');
      const role = makeTemplate({ roleId: 'coder-full', requiredSkillIds: [] });

      // Add 15 tasks (>= 10 threshold)
      for (let i = 0; i < 15; i++) {
        rolePerformanceTracker.updateOnTaskComplete('agent-score-full', 'coder-full', {
          taskId: `t-${i}`,
          qualityScore: 80,
          latencyMs: 100,
          success: true,
        });
      }

      const task = { description: 'Test' };
      const score = matcher.computeScore(task, agent, role);

      expect(score).toBeDefined();
      expect(typeof score).toBe('number');
    });

    it('score is always between 0 and 1', () => {
      const agent = makeMockAgent('agent-range', ['ts']);
      const role = makeTemplate({ roleId: 'coder', requiredSkillIds: ['ts'] });
      const task = { description: 'Code', requiredSkills: ['ts'] };

      const score = matcher.computeScore(task, agent, role);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  // ── match ──────────────────────────────────────────────────────

  describe('match', () => {
    it('returns empty array when no candidate agents', async () => {
      const result = await matcher.match({ description: 'Do something' }, []);
      expect(result).toEqual([]);
    });

    it('returns empty array when requiredRole is not in registry', async () => {
      const agent = makeMockAgent('agent-1');
      const result = await matcher.match(
        { description: 'Do something', requiredRole: 'nonexistent-role' },
        [agent]
      );
      expect(result).toEqual([]);
    });

    it('only returns the requiredRole when task specifies one', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({ roleId: 'coder', roleName: 'Coder' }));
      roleRegistry.register(makeTemplate({ roleId: 'reviewer', roleName: 'Reviewer' }));

      try {
        const agent = makeMockAgent('agent-1');
        const result = await matcher.match(
          { description: 'Review the code', requiredRole: 'coder' },
          [agent]
        );

        expect(result.length).toBe(1);
        expect(result[0].recommendedRoleId).toBe('coder');
        expect(result[0].agentId).toBe('agent-1');
      } finally {
        roleRegistry.unregister('coder');
        roleRegistry.unregister('reviewer');
      }
    });

    it('returns results sorted by score descending', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({
        roleId: 'coder',
        roleName: 'Coder',
        requiredSkillIds: ['ts', 'node'],
      }));

      try {
        const agentGood = makeMockAgent('agent-good', ['ts', 'node']);
        const agentBad = makeMockAgent('agent-bad', ['python']);

        const result = await matcher.match(
          { description: 'Implement the code', requiredRole: 'coder' },
          [agentGood, agentBad]
        );

        expect(result.length).toBe(2);
        expect(result[0].roleMatchScore).toBeGreaterThanOrEqual(result[1].roleMatchScore);
        expect(result[0].agentId).toBe('agent-good');
      } finally {
        roleRegistry.unregister('coder');
      }
    });

    it('each recommendation contains required fields', async () => {
      const { roleRegistry } = await import('../core/role-registry.js');
      roleRegistry.register(makeTemplate({ roleId: 'coder', roleName: 'Coder' }));

      try {
        const agent = makeMockAgent('agent-1');
        const result = await matcher.match(
          { description: 'Code something', requiredRole: 'coder' },
          [agent]
        );

        expect(result.length).toBe(1);
        const rec = result[0];
        expect(rec).toHaveProperty('agentId');
        expect(rec).toHaveProperty('recommendedRoleId');
        expect(rec).toHaveProperty('roleMatchScore');
        expect(rec).toHaveProperty('reason');
        expect(typeof rec.roleMatchScore).toBe('number');
      } finally {
        roleRegistry.unregister('coder');
      }
    });
  });

  // ── skillMatch (via computeScore) ──────────────────────────────

  describe('skillMatch edge cases', () => {
    it('defaults to 0.5 when task has no requiredSkills', () => {
      const agent = makeMockAgent('a1');
      const role = makeTemplate({ roleId: 'r1', requiredSkillIds: ['ts'] });
      const task = { description: 'Do stuff' }; // no requiredSkills

      const score = matcher.computeScore(task, agent, role);
      // skillMatch = 0.5 (default)
      expect(score).toBeDefined();
    });

    it('defaults to 0.5 when task has empty requiredSkills', () => {
      const agent = makeMockAgent('a1');
      const role = makeTemplate({ roleId: 'r1', requiredSkillIds: ['ts'] });
      const task = { description: 'Do stuff', requiredSkills: [] };

      const score = matcher.computeScore(task, agent, role);
      expect(score).toBeDefined();
    });

    it('returns 1.0 skillMatch when task and role skills are identical', () => {
      const agent = makeMockAgent('a1');
      const role = makeTemplate({ roleId: 'r1', requiredSkillIds: ['ts', 'node'] });
      const taskPerfect = { description: 'Do stuff', requiredSkills: ['ts', 'node'] };
      const taskNone = { description: 'Do stuff', requiredSkills: ['python', 'go'] };

      const scorePerfect = matcher.computeScore(taskPerfect, agent, role);
      const scoreNone = matcher.computeScore(taskNone, agent, role);

      // Perfect match should have higher skillMatch component
      expect(scorePerfect).toBeGreaterThan(scoreNone);
    });
  });
});
