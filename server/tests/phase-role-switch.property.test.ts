// Feature: dynamic-role-system, Property 13: 阶段切换自动角色切换
/**
 * Property 13: 阶段切换自动角色切换
 *
 * 对于任意 Mission 阶段切换，如果下一阶段为同一 Agent 分配了不同的 roleId，
 * 工作流引擎应自动执行 unloadRole + loadRole，切换完成后 Agent 的 currentRoleId
 * 应等于下一阶段指定的 roleId。
 *
 * **Validates: Requirements 5.1, 5.2**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RoleTemplate,
  AuthorityLevel,
  RoleSource,
  PhaseAssignment,
} from '../../shared/role-schema.js';
import type { WorkflowNodeModelConfig } from '../../shared/organization-schema.js';
import type { ExecutionPlanStep } from '../../shared/executor/contracts.js';

// ── vi.hoisted: declare shared state available to hoisted mock factories ──
const { _state, registryProxy, validatorProxy } = vi.hoisted(() => {
  const _state: { registry: any; validator: any } = { registry: null, validator: null };

  const registryProxy = new Proxy({} as any, {
    get(_target, prop) {
      const reg = _state.registry;
      if (!reg) throw new Error('Test registry not initialized');
      const val = (reg as any)[prop];
      return typeof val === 'function' ? val.bind(reg) : val;
    },
  });

  const validatorProxy = new Proxy({} as any, {
    get(_target, prop) {
      const v = _state.validator;
      if (!v) throw new Error('Test validator not initialized');
      const val = (v as any)[prop];
      return typeof val === 'function' ? val.bind(v) : val;
    },
  });

  return { _state, registryProxy, validatorProxy };
});

// ── Mock heavy server dependencies ──────────────────────────────

vi.mock('../db/index.js', () => ({
  default: { getAgent: vi.fn(() => null) },
}));

vi.mock('../memory/session-store.js', () => ({
  sessionStore: {
    buildPromptContext: vi.fn(() => []),
    appendLLMExchange: vi.fn(),
    appendMessageLog: vi.fn(),
    materializeWorkflowMemories: vi.fn(),
  },
}));

vi.mock('../memory/soul-store.js', () => ({
  soulStore: {
    getSoulText: vi.fn((_id: string, fallback: string) => fallback),
    appendLearnedBehaviors: vi.fn(),
  },
}));

vi.mock('../core/llm-client.js', () => ({
  callLLM: vi.fn(async () => ({ content: 'mock' })),
  callLLMJson: vi.fn(async () => ({})),
}));

vi.mock('../core/socket.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../core/telemetry-store.js', () => ({
  telemetryStore: { recordAgentTiming: vi.fn() },
}));

vi.mock('../core/message-bus.js', () => ({
  messageBus: { send: vi.fn(), getInbox: vi.fn(async () => []) },
}));

vi.mock('../memory/workspace.js', () => ({
  ensureAgentWorkspace: vi.fn(() => ({ rootDir: '/tmp/ws' })),
}));

vi.mock('../core/access-guard.js', () => ({
  readAgentWorkspaceFile: vi.fn(() => null),
  writeAgentWorkspaceFile: vi.fn(() => '/tmp/ws/f'),
}));

vi.mock('../rag/config.js', () => ({
  getRAGConfig: vi.fn(() => ({ enabled: false })),
}));

// ── Mock role-registry and constraint-validator singletons ──────

vi.mock('../core/role-registry.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../core/role-registry.js')>();
  return {
    ...orig,
    roleRegistry: registryProxy,
  };
});

vi.mock('../core/role-constraint-validator.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../core/role-constraint-validator.js')>();
  return {
    ...orig,
    roleConstraintValidator: validatorProxy,
  };
});

// ── Import real classes (after mocks) ───────────────────────────

import { RoleRegistry } from '../core/role-registry.js';
import { RoleConstraintValidator } from '../core/role-constraint-validator.js';

const { Agent } = await import('../core/agent.js');
type AgentInstance = InstanceType<typeof Agent>;

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_phase_role_switch__');
const TEST_STORE_PATH = resolve(TEST_STORE_DIR, 'role-templates.json');
const AGENT_DATA_ROOT = resolve(__test_dirname, '../../data/agents');

// ── Arbitraries ──────────────────────────────────────────────────

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
  .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
  .filter((s) => s.length >= 2);

const arbAgentId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter((s) => s.length >= 2);

const arbStringList: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 15 }),
  { minLength: 0, maxLength: 5 },
);

/**
 * For phase-transition tests we fix authorityLevel to "medium" and clear
 * compatibleRoles / incompatibleRoles so the constraint validator never
 * blocks the switch (those constraints are tested separately in Property 15).
 */
const arbRoleTemplate: fc.Arbitrary<RoleTemplate> = fc.record({
  roleId: arbRoleId,
  roleName: fc.string({ minLength: 1, maxLength: 20 }),
  responsibilityPrompt: fc.string({ minLength: 1, maxLength: 200 }),
  requiredSkillIds: arbStringList,
  mcpIds: arbStringList,
  defaultModelConfig: arbModelConfig,
  authorityLevel: fc.constant('medium' as AuthorityLevel),
  source: arbRoleSource,
  createdAt: arbISODate,
  updatedAt: arbISODate,
});

const arbStepKey: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,14}$/)
  .filter((s) => s.length >= 2);

// ── Helpers ──────────────────────────────────────────────────────

function cleanup(): void {
  if (existsSync(TEST_STORE_DIR)) {
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  }
}

function cleanupAgentData(agentId: string): void {
  const dir = resolve(AGENT_DATA_ROOT, agentId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function freshState(): void {
  _state.registry = new RoleRegistry(TEST_STORE_PATH);
  _state.validator = new RoleConstraintValidator(_state.registry);
}

function createAgentNoCooldown(id: string, soulMd: string, model: string): AgentInstance {
  const agent = new Agent({
    id,
    name: `Agent-${id}`,
    department: 'engineering',
    role: 'worker' as const,
    managerId: null,
    model,
    soulMd,
  });
  // Disable cooldown so consecutive role switches don't get blocked
  (agent as any).roleState.roleSwitchCooldownMs = 0;
  return agent;
}

/**
 * Simulate the core logic of WorkflowEngine.handlePhaseRoleSwitch:
 * For each agent in the next step whose roleId differs from the current step,
 * execute agent.switchRole(nextRoleId).
 *
 * This directly tests the phase-transition role switching property without
 * needing to instantiate the full WorkflowEngine.
 */
async function simulatePhaseRoleSwitch(
  currentStep: ExecutionPlanStep,
  nextStep: ExecutionPlanStep,
  agentMap: Map<string, AgentInstance>,
): Promise<void> {
  if (!currentStep.assignments?.length || !nextStep.assignments?.length) {
    return;
  }

  // Build lookup of current assignments by agentId
  const currentAssignments = new Map<string, string>();
  for (const a of currentStep.assignments) {
    currentAssignments.set(a.agentId, a.roleId);
  }

  // Detect differences and execute role switches
  for (const nextAssignment of nextStep.assignments) {
    const currentRoleId = currentAssignments.get(nextAssignment.agentId) ?? null;

    // Skip if the agent keeps the same role
    if (currentRoleId === nextAssignment.roleId) {
      continue;
    }

    const agent = agentMap.get(nextAssignment.agentId);
    if (agent) {
      await agent.switchRole(nextAssignment.roleId, 'phase-transition');
    }
  }
}

// ── Property Tests ───────────────────────────────────────────────

describe('Property 13: 阶段切换自动角色切换', () => {
  beforeEach(freshState);
  afterEach(cleanup);

  // **Validates: Requirements 5.1, 5.2**
  it('when next phase assigns a different roleId to the same agent, after switchRole the agent currentRoleId equals the next phase roleId', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        fc.string({ minLength: 1, maxLength: 50 }), // soulMd
        fc.string({ minLength: 1, maxLength: 20 }), // model
        arbRoleTemplate,
        arbRoleTemplate,
        arbStepKey,
        arbStepKey,
        async (agentId, soulMd, model, roleA, roleB, stepKeyA, stepKeyB) => {
          // Ensure distinct roleIds and step keys
          if (roleA.roleId === roleB.roleId) return;
          if (stepKeyA === stepKeyB) return;

          freshState();

          // Register both role templates
          _state.registry!.register(roleA);
          _state.registry!.register(roleB);

          // Create agent with no cooldown and load initial role A
          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(roleA.roleId, 'setup');

          expect(agent.getCurrentRoleId()).toBe(roleA.roleId);

          // Define phase steps with assignments
          const currentStep: ExecutionPlanStep = {
            key: stepKeyA,
            label: 'Phase A',
            description: 'Current phase',
            assignments: [{ agentId, roleId: roleA.roleId }],
          };

          const nextStep: ExecutionPlanStep = {
            key: stepKeyB,
            label: 'Phase B',
            description: 'Next phase',
            assignments: [{ agentId, roleId: roleB.roleId }],
          };

          const agentMap = new Map<string, AgentInstance>();
          agentMap.set(agentId, agent);

          // Execute phase role switch
          await simulatePhaseRoleSwitch(currentStep, nextStep, agentMap);

          // After switch, agent's currentRoleId should equal the next phase's roleId
          expect(agent.getCurrentRoleId()).toBe(roleB.roleId);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.1, 5.2**
  it('when next phase assigns the same roleId, no switch occurs and agent keeps current role', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        arbRoleTemplate,
        arbStepKey,
        arbStepKey,
        async (agentId, soulMd, model, role, stepKeyA, stepKeyB) => {
          if (stepKeyA === stepKeyB) return;

          freshState();
          _state.registry!.register(role);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(role.roleId, 'setup');

          const logBefore = agent.getRoleOperationLog().length;

          const currentStep: ExecutionPlanStep = {
            key: stepKeyA,
            label: 'Phase A',
            description: 'Current phase',
            assignments: [{ agentId, roleId: role.roleId }],
          };

          const nextStep: ExecutionPlanStep = {
            key: stepKeyB,
            label: 'Phase B',
            description: 'Next phase',
            assignments: [{ agentId, roleId: role.roleId }],
          };

          const agentMap = new Map<string, AgentInstance>();
          agentMap.set(agentId, agent);

          await simulatePhaseRoleSwitch(currentStep, nextStep, agentMap);

          // Role should remain unchanged
          expect(agent.getCurrentRoleId()).toBe(role.roleId);
          // No additional operation log entries (no unload/load happened)
          expect(agent.getRoleOperationLog().length).toBe(logBefore);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.1, 5.2**
  it('multi-agent phase transition: each agent ends up with the correct next-phase roleId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbAgentId, { minLength: 2, maxLength: 4 }).chain((ids) => {
          // Ensure unique agent IDs
          const uniqueIds = [...new Set(ids)];
          if (uniqueIds.length < 2) return fc.constant(null);
          return fc.tuple(
            fc.constant(uniqueIds),
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.string({ minLength: 1, maxLength: 20 }),
            // Generate pairs of distinct roles for each agent
            fc.array(
              fc.tuple(arbRoleTemplate, arbRoleTemplate).filter(([a, b]) => a.roleId !== b.roleId),
              { minLength: uniqueIds.length, maxLength: uniqueIds.length },
            ),
            arbStepKey,
            arbStepKey,
          );
        }).filter((v): v is [string[], string, string, [RoleTemplate, RoleTemplate][], string, string] =>
          v !== null && v[4] !== v[5]
        ),
        async ([agentIds, soulMd, model, rolePairs, stepKeyA, stepKeyB]) => {
          freshState();

          // Register all role templates (deduplicate by roleId)
          const registered = new Set<string>();
          for (const [rA, rB] of rolePairs) {
            if (!registered.has(rA.roleId)) {
              _state.registry!.register(rA);
              registered.add(rA.roleId);
            }
            if (!registered.has(rB.roleId)) {
              _state.registry!.register(rB);
              registered.add(rB.roleId);
            }
          }

          const agentMap = new Map<string, AgentInstance>();
          const currentAssignments: PhaseAssignment[] = [];
          const nextAssignments: PhaseAssignment[] = [];

          for (let i = 0; i < agentIds.length; i++) {
            const agentId = agentIds[i];
            const [roleA, roleB] = rolePairs[i];

            const agent = createAgentNoCooldown(agentId, soulMd, model);
            await agent.loadRole(roleA.roleId, 'setup');
            agentMap.set(agentId, agent);

            currentAssignments.push({ agentId, roleId: roleA.roleId });
            nextAssignments.push({ agentId, roleId: roleB.roleId });
          }

          const currentStep: ExecutionPlanStep = {
            key: stepKeyA,
            label: 'Phase A',
            description: 'Current phase',
            assignments: currentAssignments,
          };

          const nextStep: ExecutionPlanStep = {
            key: stepKeyB,
            label: 'Phase B',
            description: 'Next phase',
            assignments: nextAssignments,
          };

          await simulatePhaseRoleSwitch(currentStep, nextStep, agentMap);

          // Verify each agent has the correct next-phase roleId
          for (let i = 0; i < agentIds.length; i++) {
            const agent = agentMap.get(agentIds[i])!;
            const expectedRoleId = rolePairs[i][1].roleId;
            expect(agent.getCurrentRoleId()).toBe(expectedRoleId);
          }

          // Cleanup
          for (const agentId of agentIds) {
            cleanupAgentData(agentId);
          }
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.1, 5.2**
  it('phase transition with no assignments on either step is a no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        arbRoleTemplate,
        arbStepKey,
        arbStepKey,
        async (agentId, soulMd, model, role, stepKeyA, stepKeyB) => {
          if (stepKeyA === stepKeyB) return;

          freshState();
          _state.registry!.register(role);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(role.roleId, 'setup');

          const agentMap = new Map<string, AgentInstance>();
          agentMap.set(agentId, agent);

          // No assignments on steps
          const currentStep: ExecutionPlanStep = {
            key: stepKeyA,
            label: 'Phase A',
            description: 'Current phase',
          };
          const nextStep: ExecutionPlanStep = {
            key: stepKeyB,
            label: 'Phase B',
            description: 'Next phase',
          };

          await simulatePhaseRoleSwitch(currentStep, nextStep, agentMap);

          // Agent role should remain unchanged
          expect(agent.getCurrentRoleId()).toBe(role.roleId);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: dynamic-role-system, Property 14: allowSelfReview 约束
/**
 * Property 14: allowSelfReview 约束
 *
 * 对于任意 Mission 中同一 Agent 从执行类角色（Coder、Writer）切换到审查类角色
 * （Reviewer、QA）的场景，当 allowSelfReview 为 false 时，系统应禁止该 Agent
 * 审查自己在前一阶段产出的内容，并将审查任务分配给其他 Agent。
 *
 * **Validates: Requirements 5.3, 5.4**
 */

// ── Pure reimplementation of WorkflowEngine.enforceAllowSelfReview ──
// Mirrors the private method so we can property-test it without instantiating
// the full WorkflowEngine.

const EXECUTION_ROLES = new Set(['coder', 'writer']);
const REVIEW_ROLES = new Set(['reviewer', 'qa']);

function enforceAllowSelfReview(
  assignments: PhaseAssignment[],
  previousAssignments: PhaseAssignment[],
  allAgentIds: string[],
  allowSelfReview: boolean,
): PhaseAssignment[] {
  if (allowSelfReview) {
    return assignments;
  }

  // Build set of agents that had execution roles in the previous phase
  const executionAgents = new Set<string>();
  for (const prev of previousAssignments) {
    if (EXECUTION_ROLES.has(prev.roleId.toLowerCase())) {
      executionAgents.add(prev.agentId);
    }
  }

  if (executionAgents.size === 0) {
    return assignments;
  }

  const result: PhaseAssignment[] = [];

  for (const assignment of assignments) {
    const isReviewRole = REVIEW_ROLES.has(assignment.roleId.toLowerCase());
    const wasExecutor = executionAgents.has(assignment.agentId);

    if (isReviewRole && wasExecutor) {
      // Find an alternative agent that was NOT an executor in the previous phase
      const alternativeAgentId = allAgentIds.find(
        (id) =>
          id !== assignment.agentId &&
          !executionAgents.has(id) &&
          // Ensure the alternative isn't already assigned a review role in this batch
          !result.some((r) => r.agentId === id && r.roleId === assignment.roleId),
      );

      if (alternativeAgentId) {
        result.push({ agentId: alternativeAgentId, roleId: assignment.roleId });
      } else {
        // No alternative available — keep original assignment
        result.push(assignment);
      }
    } else {
      result.push(assignment);
    }
  }

  return result;
}

// ── Arbitraries for Property 14 ──────────────────────────────────

const arbExecutionRoleId: fc.Arbitrary<string> = fc.constantFrom('coder', 'writer', 'Coder', 'Writer');
const arbReviewRoleId: fc.Arbitrary<string> = fc.constantFrom('reviewer', 'qa', 'Reviewer', 'QA');
const arbNonReviewRoleId: fc.Arbitrary<string> = fc.constantFrom('coder', 'writer', 'architect', 'pm');

// ── Property 14 Tests ────────────────────────────────────────────

describe('Property 14: allowSelfReview 约束', () => {
  // **Validates: Requirements 5.3, 5.4**
  it('when allowSelfReview=false, an agent who had an execution role is NOT assigned a review role in the result (if an alternative exists)', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbAgentId,
        arbExecutionRoleId,
        arbReviewRoleId,
        (executorId, alternativeId, execRole, reviewRole) => {
          // Ensure distinct agent IDs
          if (executorId === alternativeId) return;

          const previousAssignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: execRole },
          ];

          const assignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: reviewRole },
          ];

          const allAgentIds = [executorId, alternativeId];

          const result = enforceAllowSelfReview(
            assignments,
            previousAssignments,
            allAgentIds,
            false,
          );

          // The executor should NOT be assigned the review role
          expect(result.length).toBe(1);
          expect(result[0].agentId).toBe(alternativeId);
          expect(result[0].roleId).toBe(reviewRole);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.3, 5.4**
  it('when allowSelfReview=true, the same agent IS allowed to keep the review role', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbAgentId,
        arbExecutionRoleId,
        arbReviewRoleId,
        (executorId, alternativeId, execRole, reviewRole) => {
          if (executorId === alternativeId) return;

          const previousAssignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: execRole },
          ];

          const assignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: reviewRole },
          ];

          const allAgentIds = [executorId, alternativeId];

          const result = enforceAllowSelfReview(
            assignments,
            previousAssignments,
            allAgentIds,
            true,
          );

          // With allowSelfReview=true, the original assignment is returned unchanged
          expect(result).toEqual(assignments);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.3, 5.4**
  it('when no alternative agent is available, the executor keeps the review role even with allowSelfReview=false', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbExecutionRoleId,
        arbReviewRoleId,
        (executorId, execRole, reviewRole) => {
          const previousAssignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: execRole },
          ];

          const assignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: reviewRole },
          ];

          // Only the executor is available — no alternative
          const allAgentIds = [executorId];

          const result = enforceAllowSelfReview(
            assignments,
            previousAssignments,
            allAgentIds,
            false,
          );

          // Falls back to keeping the original assignment
          expect(result.length).toBe(1);
          expect(result[0].agentId).toBe(executorId);
          expect(result[0].roleId).toBe(reviewRole);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.3, 5.4**
  it('non-review role assignments are never reassigned regardless of allowSelfReview', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbAgentId,
        arbExecutionRoleId,
        arbNonReviewRoleId,
        (executorId, alternativeId, execRole, nonReviewRole) => {
          if (executorId === alternativeId) return;

          const previousAssignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: execRole },
          ];

          const assignments: PhaseAssignment[] = [
            { agentId: executorId, roleId: nonReviewRole },
          ];

          const allAgentIds = [executorId, alternativeId];

          const result = enforceAllowSelfReview(
            assignments,
            previousAssignments,
            allAgentIds,
            false,
          );

          // Non-review roles are never reassigned
          expect(result.length).toBe(1);
          expect(result[0].agentId).toBe(executorId);
          expect(result[0].roleId).toBe(nonReviewRole);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.3, 5.4**
  it('agents without execution roles in the previous phase keep their review assignments', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbAgentId,
        arbReviewRoleId,
        arbReviewRoleId,
        (agentA, agentB, prevReviewRole, nextReviewRole) => {
          if (agentA === agentB) return;

          // Previous phase: agentA had a REVIEW role (not execution)
          const previousAssignments: PhaseAssignment[] = [
            { agentId: agentA, roleId: prevReviewRole },
          ];

          // Next phase: agentA is assigned another review role
          const assignments: PhaseAssignment[] = [
            { agentId: agentA, roleId: nextReviewRole },
          ];

          const allAgentIds = [agentA, agentB];

          const result = enforceAllowSelfReview(
            assignments,
            previousAssignments,
            allAgentIds,
            false,
          );

          // agentA was NOT an executor, so the assignment stays
          expect(result.length).toBe(1);
          expect(result[0].agentId).toBe(agentA);
          expect(result[0].roleId).toBe(nextReviewRole);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.3, 5.4**
  it('multiple executors switching to review roles are all reassigned to different alternatives', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbAgentId,
        arbAgentId,
        arbAgentId,
        arbReviewRoleId,
        (exec1, exec2, alt1, alt2, reviewRole) => {
          const ids = new Set([exec1, exec2, alt1, alt2]);
          if (ids.size < 4) return; // need 4 distinct agents

          const previousAssignments: PhaseAssignment[] = [
            { agentId: exec1, roleId: 'coder' },
            { agentId: exec2, roleId: 'writer' },
          ];

          const assignments: PhaseAssignment[] = [
            { agentId: exec1, roleId: reviewRole },
            { agentId: exec2, roleId: reviewRole },
          ];

          const allAgentIds = [exec1, exec2, alt1, alt2];

          const result = enforceAllowSelfReview(
            assignments,
            previousAssignments,
            allAgentIds,
            false,
          );

          expect(result.length).toBe(2);

          // Neither executor should be assigned the review role
          for (const r of result) {
            expect(r.roleId).toBe(reviewRole);
            expect(r.agentId).not.toBe(exec1);
            expect(r.agentId).not.toBe(exec2);
          }

          // The two review assignments should go to different agents
          expect(result[0].agentId).not.toBe(result[1].agentId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.3, 5.4**
  it('result preserves the total number of assignments', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            agentId: arbAgentId,
            roleId: fc.constantFrom('coder', 'writer', 'reviewer', 'qa', 'architect', 'pm'),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.array(
          fc.record({
            agentId: arbAgentId,
            roleId: fc.constantFrom('coder', 'writer', 'reviewer', 'qa', 'architect', 'pm'),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.boolean(),
        (prevAssignments, nextAssignments, allowSelfReview) => {
          const allAgentIds = [
            ...new Set([
              ...prevAssignments.map((a) => a.agentId),
              ...nextAssignments.map((a) => a.agentId),
              'fallback-agent-1',
              'fallback-agent-2',
            ]),
          ];

          const result = enforceAllowSelfReview(
            nextAssignments,
            prevAssignments,
            allAgentIds,
            allowSelfReview,
          );

          // The number of assignments should always be preserved
          expect(result.length).toBe(nextAssignments.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
