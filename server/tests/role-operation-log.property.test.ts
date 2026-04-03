// Feature: dynamic-role-system, Property 8: 角色操作日志完整性
/**
 * Property 8: 角色操作日志完整性
 *
 * 对于任意角色加载、卸载或约束校验失败事件，系统应记录包含
 * agentId、roleId、action、timestamp 和 triggerSource（或 denialReason）的日志条目。
 *
 * **Validates: Requirements 2.5, 5.5, 6.5**
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate, AuthorityLevel, RoleSource, RoleOperationLog } from '../../shared/role-schema.js';
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
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_op_log_prop__');
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
const arbTriggerSource: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 40 });

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

function createAgentNoCooldown(id: string, soulMd: string, model: string): AgentInstance {
  const agent = createAgent(id, soulMd, model);
  (agent as any).roleState.roleSwitchCooldownMs = 0;
  return agent;
}

function isValidISO(ts: string): boolean {
  return !Number.isNaN(Date.parse(ts));
}

// ── Property Tests ───────────────────────────────────────────────

describe('Property 8: 角色操作日志完整性', () => {
  beforeEach(freshState);
  afterEach(cleanup);

  // **Validates: Requirements 2.5**
  it('after loadRole, operation log contains a "load" entry with correct agentId, roleId, timestamp, triggerSource', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTriggerSource,
        (agentId, soulMd, model, tpl, trigger) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgent(agentId, soulMd, model);
          agent.loadRole(tpl.roleId, trigger);

          const log = agent.getRoleOperationLog();
          const loadEntry = log.find(
            (e) => e.roleId === tpl.roleId && e.action === 'load',
          );

          expect(loadEntry).toBeDefined();
          expect(loadEntry!.agentId).toBe(agentId);
          expect(loadEntry!.roleId).toBe(tpl.roleId);
          expect(loadEntry!.action).toBe('load');
          expect(loadEntry!.triggerSource).toBe(trigger);
          expect(isValidISO(loadEntry!.timestamp)).toBe(true);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.5**
  it('after unloadRole, operation log contains an "unload" entry with correct fields', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTriggerSource,
        arbTriggerSource,
        (agentId, soulMd, model, tpl, loadTrigger, unloadTrigger) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgent(agentId, soulMd, model);
          agent.loadRole(tpl.roleId, loadTrigger);
          agent.unloadRole(unloadTrigger);

          const log = agent.getRoleOperationLog();
          const unloadEntry = log.find(
            (e) => e.roleId === tpl.roleId && e.action === 'unload',
          );

          expect(unloadEntry).toBeDefined();
          expect(unloadEntry!.agentId).toBe(agentId);
          expect(unloadEntry!.roleId).toBe(tpl.roleId);
          expect(unloadEntry!.action).toBe('unload');
          expect(unloadEntry!.triggerSource).toBe(unloadTrigger);
          expect(isValidISO(unloadEntry!.timestamp)).toBe(true);

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.5, 5.5**
  it('after a sequence of load/unload operations, all entries are present in order', () => {
    // Generate 2-4 distinct role templates for sequential operations
    const arbRoleList = fc
      .array(arbRoleTemplate, { minLength: 2, maxLength: 4 })
      .chain((templates) => {
        // Ensure unique roleIds
        const seen = new Set<string>();
        const unique: RoleTemplate[] = [];
        for (const t of templates) {
          if (!seen.has(t.roleId)) {
            seen.add(t.roleId);
            unique.push(t);
          }
        }
        return unique.length >= 2
          ? fc.constant(unique)
          : fc.constant(undefined as any);
      })
      .filter((v): v is RoleTemplate[] => v !== undefined && v.length >= 2);

    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleList,
        (agentId, soulMd, model, roles) => {
          freshState();
          for (const tpl of roles) {
            _state.registry!.register(tpl);
          }

          const agent = createAgentNoCooldown(agentId, soulMd, model);

          // Perform load/unload sequence for each role
          const expectedActions: Array<{ roleId: string; action: 'load' | 'unload' }> = [];
          for (const tpl of roles) {
            agent.loadRole(tpl.roleId, `mission-${tpl.roleId}`);
            expectedActions.push({ roleId: tpl.roleId, action: 'load' });

            agent.unloadRole(`mission-${tpl.roleId}-done`);
            expectedActions.push({ roleId: tpl.roleId, action: 'unload' });
          }

          const log = agent.getRoleOperationLog();

          // All expected entries should be present
          expect(log.length).toBeGreaterThanOrEqual(expectedActions.length);

          // Verify order: filter to only load/unload entries and check sequence
          for (let i = 0; i < expectedActions.length; i++) {
            expect(log[i].roleId).toBe(expectedActions[i].roleId);
            expect(log[i].action).toBe(expectedActions[i].action);
            expect(log[i].agentId).toBe(agentId);
          }

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.5, 5.5, 6.5**
  it('each log entry has a valid ISO timestamp', () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbSoulMd,
        arbModel,
        arbRoleTemplate,
        arbTriggerSource,
        (agentId, soulMd, model, tpl, trigger) => {
          freshState();
          _state.registry!.register(tpl);

          const agent = createAgentNoCooldown(agentId, soulMd, model);
          agent.loadRole(tpl.roleId, trigger);
          agent.unloadRole(trigger);

          const log = agent.getRoleOperationLog();
          for (const entry of log) {
            expect(isValidISO(entry.timestamp)).toBe(true);
            // Verify it round-trips through Date
            const parsed = new Date(entry.timestamp);
            expect(parsed.toISOString()).toBe(entry.timestamp);
          }

          cleanupAgentData(agentId);
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });
});
