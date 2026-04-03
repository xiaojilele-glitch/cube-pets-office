// Feature: dynamic-role-system, Property 4: loadRole 后 Agent 状态正确性
/**
 * Property 4: loadRole 后 Agent 状态正确性
 *
 * 对于任意 Agent 和任意合法的 roleId，执行 `agent.loadRole(roleId)` 后：
 * - Agent 的 system prompt 应包含该角色的 responsibilityPrompt
 * - `currentRoleId` 应等于 roleId
 * - Agent 应持有该角色关联的 skills 和 MCP 工具
 *
 * **Validates: Requirements 2.1**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate, AuthorityLevel, RoleSource } from '../../shared/role-schema.js';
import type { WorkflowNodeModelConfig } from '../../shared/organization-schema.js';

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
// Replace the module-level singletons with proxies that defer to _state.

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

// ── Import real classes and Agent (after mocks) ─────────────────

import { RoleRegistry } from '../core/role-registry.js';
import { RoleConstraintValidator } from '../core/role-constraint-validator.js';

const { Agent } = await import('../core/agent.js');
type AgentInstance = InstanceType<typeof Agent>;

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_agent_role_prop__');
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

const arbRoleTemplate: fc.Arbitrary<RoleTemplate> = fc.record({
  roleId: arbRoleId,
  roleName: fc.string({ minLength: 1, maxLength: 20 }),
  responsibilityPrompt: fc.string({ minLength: 1, maxLength: 200 }),
  requiredSkillIds: arbStringList,
  mcpIds: arbStringList,
  defaultModelConfig: arbModelConfig,
  authorityLevel: arbAuthorityLevel,
  source: arbRoleSource,
  createdAt: arbISODate,
  updatedAt: arbISODate,
});

const arbSoulMd: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 100 });
const arbModel: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 20 });

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

function createAgent(id: string, soulMd: string, model: string): AgentInstance {
  return new Agent({
    id,
    name: `Agent-${id}`,
    department: 'engineering',
    role: 'worker' as const,
    managerId: null,
    model,
    soulMd,
  });
}

// ── Property Tests ───────────────────────────────────────────────

describe('Agent Property 4: loadRole 后 Agent 状态正确性', () => {
  beforeEach(freshState);
  afterEach(cleanup);

  // **Validates: Requirements 2.1**
  it('after loadRole, system prompt = base + "\\n\\n" + responsibilityPrompt', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');

        expect(agent.config.soulMd).toBe(soulMd + '\n\n' + tpl.responsibilityPrompt);
        expect(agent.config.soulMd).toContain(soulMd);
        expect(agent.config.soulMd).toContain(tpl.responsibilityPrompt);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.1**
  it('after loadRole, currentRoleId equals the loaded roleId', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');

        expect(agent.getCurrentRoleId()).toBe(tpl.roleId);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.1**
  it('after loadRole, agent holds the role requiredSkillIds', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');

        expect(agent.getRoleState().loadedSkillIds).toEqual(tpl.requiredSkillIds);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.1**
  it('after loadRole, agent holds the role mcpIds', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');

        expect(agent.getRoleState().loadedMcpIds).toEqual(tpl.mcpIds);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.1**
  it('after loadRole, all state fields correct (combined check)', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');

        // 1. currentRoleId
        expect(agent.getCurrentRoleId()).toBe(tpl.roleId);
        // 2. system prompt
        expect(agent.config.soulMd).toBe(soulMd + '\n\n' + tpl.responsibilityPrompt);
        // 3. skills
        const rs = agent.getRoleState();
        expect(rs.loadedSkillIds).toEqual(tpl.requiredSkillIds);
        // 4. MCP tools
        expect(rs.loadedMcpIds).toEqual(tpl.mcpIds);
        // 5. loadedAt is valid ISO date
        expect(rs.currentRoleLoadedAt).not.toBeNull();
        expect(Number.isNaN(Date.parse(rs.currentRoleLoadedAt!))).toBe(false);
        // 6. operation log has a 'load' entry
        const entry = agent.getRoleOperationLog().find(
          (e) => e.roleId === tpl.roleId && e.action === 'load',
        );
        expect(entry).toBeDefined();
        expect(entry!.agentId).toBe(agentId);
        expect(entry!.triggerSource).toBe('test-mission');

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.1**
  it('after loadRole with inherited role, state reflects resolved (merged) template', () => {
    const arbParentChild = fc
      .tuple(arbRoleId, arbRoleId)
      .filter(([a, b]) => a !== b)
      .chain(([pId, cId]) =>
        fc.tuple(arbRoleTemplate, arbRoleTemplate).map(([p, c]) => ({
          parent: { ...p, roleId: pId, extends: undefined },
          child: { ...c, roleId: cId, extends: pId },
        })),
      );

    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbParentChild, (agentId, soulMd, model, { parent, child }) => {
        freshState();
        _state.registry!.register(parent);
        _state.registry!.register(child);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(child.roleId, 'test-mission');

        const resolved = _state.registry!.resolve(child.roleId);

        expect(agent.getCurrentRoleId()).toBe(child.roleId);
        expect(agent.config.soulMd).toBe(soulMd + '\n\n' + resolved.responsibilityPrompt);
        expect(agent.config.soulMd).toContain(parent.responsibilityPrompt);
        expect(agent.config.soulMd).toContain(child.responsibilityPrompt);

        const rs = agent.getRoleState();
        expect(new Set(rs.loadedSkillIds)).toEqual(new Set(resolved.requiredSkillIds));
        expect(new Set(rs.loadedMcpIds)).toEqual(new Set(resolved.mcpIds));

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: dynamic-role-system, Property 5: unloadRole 后 Agent 状态恢复
/**
 * Property 5: unloadRole 后 Agent 状态恢复
 *
 * 对于任意已加载角色的 Agent，执行 `agent.unloadRole()` 后：
 * - Agent 的 system prompt 应恢复为基础 SOUL.md prompt
 * - `currentRoleId` 应为 null
 * - 角色关联的 skills 和 MCP 工具应被移除
 * - Agent 基础配置保持不变
 *
 * **Validates: Requirements 2.2**
 */

describe('Agent Property 5: unloadRole 后 Agent 状态恢复', () => {
  beforeEach(freshState);
  afterEach(cleanup);

  // **Validates: Requirements 2.2**
  it('after unloadRole, system prompt restores to base SOUL.md prompt', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');

        // Verify role is loaded
        expect(agent.config.soulMd).toContain(tpl.responsibilityPrompt);

        agent.unloadRole('test-mission');

        // System prompt should be exactly the original base prompt
        expect(agent.config.soulMd).toBe(soulMd);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('after unloadRole, currentRoleId is null', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');
        expect(agent.getCurrentRoleId()).toBe(tpl.roleId);

        agent.unloadRole('test-mission');
        expect(agent.getCurrentRoleId()).toBeNull();

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('after unloadRole, role-associated skills are removed', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');
        expect(agent.getRoleState().loadedSkillIds).toEqual(tpl.requiredSkillIds);

        agent.unloadRole('test-mission');
        expect(agent.getRoleState().loadedSkillIds).toEqual([]);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('after unloadRole, role-associated MCP tools are removed', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        agent.loadRole(tpl.roleId, 'test-mission');
        expect(agent.getRoleState().loadedMcpIds).toEqual(tpl.mcpIds);

        agent.unloadRole('test-mission');
        expect(agent.getRoleState().loadedMcpIds).toEqual([]);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('after unloadRole, agent base model config is preserved', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        const originalModel = agent.config.model;

        agent.loadRole(tpl.roleId, 'test-mission');
        agent.unloadRole('test-mission');

        // Model should be restored to the original base config
        expect(agent.config.model).toBe(originalModel);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('after unloadRole, all state fields correct (combined check)', () => {
    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbRoleTemplate, (agentId, soulMd, model, tpl) => {
        freshState();
        _state.registry!.register(tpl);

        const agent = createAgent(agentId, soulMd, model);
        const originalModel = agent.config.model;

        agent.loadRole(tpl.roleId, 'test-mission');
        agent.unloadRole('test-mission-unload');

        // 1. currentRoleId is null
        expect(agent.getCurrentRoleId()).toBeNull();
        // 2. system prompt restored to base
        expect(agent.config.soulMd).toBe(soulMd);
        // 3. skills removed
        const rs = agent.getRoleState();
        expect(rs.loadedSkillIds).toEqual([]);
        // 4. MCP tools removed
        expect(rs.loadedMcpIds).toEqual([]);
        // 5. currentRoleLoadedAt is null
        expect(rs.currentRoleLoadedAt).toBeNull();
        // 6. base model config preserved
        expect(agent.config.model).toBe(originalModel);
        // 7. operation log has an 'unload' entry
        const entry = agent.getRoleOperationLog().find(
          (e) => e.roleId === tpl.roleId && e.action === 'unload',
        );
        expect(entry).toBeDefined();
        expect(entry!.agentId).toBe(agentId);
        expect(entry!.triggerSource).toBe('test-mission-unload');

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('after load then unload with inherited role, state fully restores', () => {
    const arbParentChild = fc
      .tuple(arbRoleId, arbRoleId)
      .filter(([a, b]) => a !== b)
      .chain(([pId, cId]) =>
        fc.tuple(arbRoleTemplate, arbRoleTemplate).map(([p, c]) => ({
          parent: { ...p, roleId: pId, extends: undefined },
          child: { ...c, roleId: cId, extends: pId },
        })),
      );

    fc.assert(
      fc.property(arbAgentId, arbSoulMd, arbModel, arbParentChild, (agentId, soulMd, model, { parent, child }) => {
        freshState();
        _state.registry!.register(parent);
        _state.registry!.register(child);

        const agent = createAgent(agentId, soulMd, model);
        const originalModel = agent.config.model;

        agent.loadRole(child.roleId, 'test-mission');

        // Verify inherited role is loaded (prompt contains both parent and child)
        expect(agent.config.soulMd).toContain(parent.responsibilityPrompt);
        expect(agent.config.soulMd).toContain(child.responsibilityPrompt);

        agent.unloadRole('test-mission');

        // Full restoration
        expect(agent.getCurrentRoleId()).toBeNull();
        expect(agent.config.soulMd).toBe(soulMd);
        expect(agent.getRoleState().loadedSkillIds).toEqual([]);
        expect(agent.getRoleState().loadedMcpIds).toEqual([]);
        expect(agent.config.model).toBe(originalModel);

        cleanupAgentData(agentId);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: dynamic-role-system, Property 6: 角色切换失败回滚
/**
 * Property 6: 角色切换失败回滚
 *
 * 对于任意 Agent 从角色 A 切换到角色 B 的操作，如果切换过程中任一步骤失败，
 * Agent 应回滚到切换前的完整状态（角色 A 完全恢复，包括 system prompt、skills、
 * MCP 工具和 model 配置）。
 *
 * **Validates: Requirements 2.3**
 */

describe('Agent Property 6: 角色切换失败回滚', () => {
  beforeEach(freshState);
  afterEach(cleanup);

  /**
   * Helper: create an agent with cooldown disabled so switchRole is not blocked
   * by the COOLDOWN_ACTIVE constraint after the initial loadRole.
   */
  function createAgentNoCooldown(id: string, soulMd: string, model: string): AgentInstance {
    const agent = createAgent(id, soulMd, model);
    // Disable cooldown so switchRole is not rejected after loadRole
    (agent as any).roleState.roleSwitchCooldownMs = 0;
    return agent;
  }

  /**
   * Helper: register role B that will cause resolve() to throw during loadRole
   * because its `extends` points to a non-existent parent.
   */
  function registerBadRole(tpl: RoleTemplate, roleBId: string): RoleTemplate {
    const roleB: RoleTemplate = {
      ...tpl,
      roleId: roleBId,
      extends: 'non-existent-parent-role-xyz',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    _state.registry!.register(roleB);
    return roleB;
  }

  const arbTwoRoleIds = fc
    .tuple(arbRoleId, arbRoleId)
    .filter(([a, b]) => a !== b);

  // **Validates: Requirements 2.3**
  it('switchRole rollback restores system prompt when loadRole fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTwoRoleIds,
        async (agentId, soulMd, model, tplA, [roleAId, roleBId]) => {
          freshState();

          const roleA = { ...tplA, roleId: roleAId, extends: undefined };
          _state.registry!.register(roleA);
          registerBadRole(tplA, roleBId);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(roleA.roleId, 'test-mission');
          const promptAfterA = agent.config.soulMd;

          await expect(agent.switchRole(roleBId, 'test-mission')).rejects.toThrow();

          expect(agent.config.soulMd).toBe(promptAfterA);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.3**
  it('switchRole rollback restores currentRoleId when loadRole fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTwoRoleIds,
        async (agentId, soulMd, model, tplA, [roleAId, roleBId]) => {
          freshState();

          const roleA = { ...tplA, roleId: roleAId, extends: undefined };
          _state.registry!.register(roleA);
          registerBadRole(tplA, roleBId);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(roleA.roleId, 'test-mission');

          await expect(agent.switchRole(roleBId, 'test-mission')).rejects.toThrow();

          expect(agent.getCurrentRoleId()).toBe(roleA.roleId);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.3**
  it('switchRole rollback restores skills and MCP tools when loadRole fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTwoRoleIds,
        async (agentId, soulMd, model, tplA, [roleAId, roleBId]) => {
          freshState();

          const roleA = { ...tplA, roleId: roleAId, extends: undefined };
          _state.registry!.register(roleA);
          registerBadRole(tplA, roleBId);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(roleA.roleId, 'test-mission');

          const skillsBefore = [...agent.getRoleState().loadedSkillIds];
          const mcpBefore = [...agent.getRoleState().loadedMcpIds];

          await expect(agent.switchRole(roleBId, 'test-mission')).rejects.toThrow();

          expect(agent.getRoleState().loadedSkillIds).toEqual(skillsBefore);
          expect(agent.getRoleState().loadedMcpIds).toEqual(mcpBefore);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.3**
  it('switchRole rollback restores model config when loadRole fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTwoRoleIds,
        async (agentId, soulMd, model, tplA, [roleAId, roleBId]) => {
          freshState();

          const roleA = { ...tplA, roleId: roleAId, extends: undefined };
          _state.registry!.register(roleA);
          registerBadRole(tplA, roleBId);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(roleA.roleId, 'test-mission');

          const modelBefore = agent.config.model;

          await expect(agent.switchRole(roleBId, 'test-mission')).rejects.toThrow();

          expect(agent.config.model).toBe(modelBefore);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.3**
  it('switchRole rollback restores complete state (combined check)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTwoRoleIds,
        async (agentId, soulMd, model, tplA, [roleAId, roleBId]) => {
          freshState();

          const roleA = { ...tplA, roleId: roleAId, extends: undefined };
          _state.registry!.register(roleA);
          registerBadRole(tplA, roleBId);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          await agent.loadRole(roleA.roleId, 'test-mission');

          // Capture full pre-switch state
          const preSwitch = {
            soulMd: agent.config.soulMd,
            model: agent.config.model,
            currentRoleId: agent.getCurrentRoleId(),
            loadedSkillIds: [...agent.getRoleState().loadedSkillIds],
            loadedMcpIds: [...agent.getRoleState().loadedMcpIds],
            currentRoleLoadedAt: agent.getRoleState().currentRoleLoadedAt,
          };

          await expect(agent.switchRole(roleBId, 'test-mission')).rejects.toThrow();

          // All state fields should be fully restored
          expect(agent.config.soulMd).toBe(preSwitch.soulMd);
          expect(agent.config.model).toBe(preSwitch.model);
          expect(agent.getCurrentRoleId()).toBe(preSwitch.currentRoleId);
          expect(agent.getRoleState().loadedSkillIds).toEqual(preSwitch.loadedSkillIds);
          expect(agent.getRoleState().loadedMcpIds).toEqual(preSwitch.loadedMcpIds);
          expect(agent.getRoleState().currentRoleLoadedAt).toBe(preSwitch.currentRoleLoadedAt);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.3**
  it('switchRole rollback works when agent has no prior role (null → invalid)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        async (agentId, soulMd, model, tpl) => {
          freshState();

          registerBadRole(tpl, tpl.roleId);

          const agent = createAgentNoCooldown(agentId, soulMd, model);

          // Agent has no role loaded — currentRoleId is null
          expect(agent.getCurrentRoleId()).toBeNull();

          const preSwitch = {
            soulMd: agent.config.soulMd,
            model: agent.config.model,
          };

          await expect(agent.switchRole(tpl.roleId, 'test-mission')).rejects.toThrow();

          // Should rollback to the original no-role state
          expect(agent.getCurrentRoleId()).toBeNull();
          expect(agent.config.soulMd).toBe(preSwitch.soulMd);
          expect(agent.config.model).toBe(preSwitch.model);
          expect(agent.getRoleState().loadedSkillIds).toEqual([]);
          expect(agent.getRoleState().loadedMcpIds).toEqual([]);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: dynamic-role-system, Property 7: roleLoadPolicy 模型配置合并
/**
 * Property 7: roleLoadPolicy 模型配置合并
 *
 * 对于任意 Agent 和角色模板的 defaultModelConfig 组合：
 * - 当 roleLoadPolicy 为 "override" 时，Agent 的 model 配置应完全等于角色模板配置
 * - 当 roleLoadPolicy 为 "prefer_agent" 时，应保留 Agent 原始配置
 * - 当 roleLoadPolicy 为 "merge" 时，temperature 应取两者较低值，maxTokens 应取两者较高值
 *
 * **Validates: Requirements 2.4**
 */

describe('Agent Property 7: roleLoadPolicy 模型配置合并', () => {
  beforeEach(freshState);
  afterEach(cleanup);

  /**
   * Helper: create an agent and set its roleLoadPolicy + baseFullModelConfig
   * so that applyModelConfig can perform the merge calculation.
   */
  function createAgentWithPolicy(
    id: string,
    soulMd: string,
    model: string,
    policy: 'override' | 'prefer_agent' | 'merge',
    baseFullConfig: { model: string; temperature: number; maxTokens: number },
  ): InstanceType<typeof Agent> {
    const agent = createAgent(id, soulMd, model);
    (agent as any).roleState.roleLoadPolicy = policy;
    (agent as any).roleState.baseFullModelConfig = { ...baseFullConfig };
    return agent;
  }

  // **Validates: Requirements 2.4**
  it('override: effectiveModelConfig equals role template config', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbModelConfig,
        arbRoleTemplate,
        (agentId, soulMd, model, agentBaseConfig, tpl) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgentWithPolicy(agentId, soulMd, model, 'override', agentBaseConfig);
          agent.loadRole(tpl.roleId, 'test-mission');

          // config.model should be the role template's model
          expect(agent.config.model).toBe(tpl.defaultModelConfig.model);

          // effectiveModelConfig should completely equal the role template config
          const effective = agent.getRoleState().effectiveModelConfig;
          expect(effective).not.toBeNull();
          expect(effective!.model).toBe(tpl.defaultModelConfig.model);
          expect(effective!.temperature).toBe(tpl.defaultModelConfig.temperature);
          expect(effective!.maxTokens).toBe(tpl.defaultModelConfig.maxTokens);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.4**
  it('prefer_agent: agent retains its own model config', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbModelConfig,
        arbRoleTemplate,
        (agentId, soulMd, model, agentBaseConfig, tpl) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgentWithPolicy(agentId, soulMd, model, 'prefer_agent', agentBaseConfig);
          const originalModel = agent.config.model;

          agent.loadRole(tpl.roleId, 'test-mission');

          // config.model should remain the agent's original model
          expect(agent.config.model).toBe(originalModel);

          // effectiveModelConfig should equal the agent's base config
          const effective = agent.getRoleState().effectiveModelConfig;
          expect(effective).not.toBeNull();
          expect(effective!.model).toBe(agentBaseConfig.model);
          expect(effective!.temperature).toBe(agentBaseConfig.temperature);
          expect(effective!.maxTokens).toBe(agentBaseConfig.maxTokens);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.4**
  it('merge: temperature is min of both, maxTokens is max of both', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbModelConfig,
        arbRoleTemplate,
        (agentId, soulMd, model, agentBaseConfig, tpl) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgentWithPolicy(agentId, soulMd, model, 'merge', agentBaseConfig);
          agent.loadRole(tpl.roleId, 'test-mission');

          const effective = agent.getRoleState().effectiveModelConfig;
          expect(effective).not.toBeNull();

          // model string should be the role template's model
          expect(effective!.model).toBe(tpl.defaultModelConfig.model);
          expect(agent.config.model).toBe(tpl.defaultModelConfig.model);

          // temperature should be the lower of both
          const expectedTemp = Math.min(agentBaseConfig.temperature, tpl.defaultModelConfig.temperature);
          expect(effective!.temperature).toBe(expectedTemp);

          // maxTokens should be the higher of both
          const expectedMaxTokens = Math.max(agentBaseConfig.maxTokens, tpl.defaultModelConfig.maxTokens);
          expect(effective!.maxTokens).toBe(expectedMaxTokens);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.4**
  it('all three policies produce correct effectiveModelConfig (combined check)', () => {
    const arbPolicy = fc.constantFrom('override' as const, 'prefer_agent' as const, 'merge' as const);

    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbModelConfig,
        arbRoleTemplate,
        arbPolicy,
        (agentId, soulMd, model, agentBaseConfig, tpl, policy) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgentWithPolicy(agentId, soulMd, model, policy, agentBaseConfig);
          const originalModel = agent.config.model;

          agent.loadRole(tpl.roleId, 'test-mission');

          const effective = agent.getRoleState().effectiveModelConfig;
          expect(effective).not.toBeNull();

          switch (policy) {
            case 'override':
              expect(agent.config.model).toBe(tpl.defaultModelConfig.model);
              expect(effective!.model).toBe(tpl.defaultModelConfig.model);
              expect(effective!.temperature).toBe(tpl.defaultModelConfig.temperature);
              expect(effective!.maxTokens).toBe(tpl.defaultModelConfig.maxTokens);
              break;

            case 'prefer_agent':
              expect(agent.config.model).toBe(originalModel);
              expect(effective!.model).toBe(agentBaseConfig.model);
              expect(effective!.temperature).toBe(agentBaseConfig.temperature);
              expect(effective!.maxTokens).toBe(agentBaseConfig.maxTokens);
              break;

            case 'merge':
              expect(agent.config.model).toBe(tpl.defaultModelConfig.model);
              expect(effective!.model).toBe(tpl.defaultModelConfig.model);
              expect(effective!.temperature).toBe(
                Math.min(agentBaseConfig.temperature, tpl.defaultModelConfig.temperature),
              );
              expect(effective!.maxTokens).toBe(
                Math.max(agentBaseConfig.maxTokens, tpl.defaultModelConfig.maxTokens),
              );
              break;
          }

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.4**
  it('after unloadRole, effectiveModelConfig is cleared', () => {
    const arbPolicy = fc.constantFrom('override' as const, 'prefer_agent' as const, 'merge' as const);

    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbModelConfig,
        arbRoleTemplate,
        arbPolicy,
        (agentId, soulMd, model, agentBaseConfig, tpl, policy) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgentWithPolicy(agentId, soulMd, model, policy, agentBaseConfig);
          agent.loadRole(tpl.roleId, 'test-mission');

          // effectiveModelConfig should be set after load
          expect(agent.getRoleState().effectiveModelConfig).not.toBeNull();

          agent.unloadRole('test-mission');

          // effectiveModelConfig should be cleared after unload
          expect(agent.getRoleState().effectiveModelConfig).toBeNull();

          // config.model should be restored to original
          expect(agent.config.model).toBe(model);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });
});
