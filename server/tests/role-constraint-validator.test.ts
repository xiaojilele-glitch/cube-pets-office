import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate } from '../../shared/role-schema.js';
import { RoleRegistry } from '../core/role-registry.js';
import {
  RoleConstraintValidator,
  type ValidatableAgent,
  type RoleConstraintContext,
} from '../core/role-constraint-validator.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_constraint_validator__');
const TEST_STORE_PATH = resolve(TEST_STORE_DIR, 'role-templates.json');

/** Helper: build a minimal valid RoleTemplate */
function makeTemplate(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  const now = new Date().toISOString();
  return {
    roleId: overrides.roleId ?? `role-${Date.now()}`,
    roleName: overrides.roleName ?? 'TestRole',
    responsibilityPrompt: overrides.responsibilityPrompt ?? 'Test prompt',
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

function makeAgent(id = 'agent-1'): ValidatableAgent {
  return { config: { id } };
}

function makeContext(overrides: Partial<RoleConstraintContext> = {}): RoleConstraintContext {
  return {
    currentRoleId: null,
    hasIncompleteTasks: false,
    triggerSource: 'test-mission',
    lastRoleSwitchAt: null,
    roleSwitchCooldownMs: 60_000,
    ...overrides,
  };
}

describe('RoleConstraintValidator', () => {
  let registry: RoleRegistry;
  let validator: RoleConstraintValidator;

  beforeEach(() => {
    registry = new RoleRegistry(TEST_STORE_PATH);
    validator = new RoleConstraintValidator(registry);
  });

  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // ── All checks pass ────────────────────────────────────────────

  describe('all checks pass', () => {
    it('returns null when no constraints are violated', () => {
      registry.register(makeTemplate({ roleId: 'coder', authorityLevel: 'medium' }));
      registry.register(makeTemplate({ roleId: 'reviewer', authorityLevel: 'medium' }));

      const result = validator.validate(
        makeAgent(),
        'reviewer',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).toBeNull();
    });

    it('returns null when agent has no current role', () => {
      registry.register(makeTemplate({ roleId: 'coder' }));

      const result = validator.validate(
        makeAgent(),
        'coder',
        makeContext({ currentRoleId: null })
      );
      expect(result).toBeNull();
    });

    it('returns null when switching from high to low authority', () => {
      registry.register(makeTemplate({ roleId: 'architect', authorityLevel: 'high' }));
      registry.register(makeTemplate({ roleId: 'worker', authorityLevel: 'low' }));

      const result = validator.validate(
        makeAgent(),
        'worker',
        makeContext({ currentRoleId: 'architect' })
      );
      expect(result).toBeNull();
    });
  });

  // ── AGENT_BUSY ─────────────────────────────────────────────────

  describe('AGENT_BUSY', () => {
    it('returns AGENT_BUSY when agent has incomplete tasks', () => {
      const result = validator.validate(
        makeAgent('busy-agent'),
        'any-role',
        makeContext({ hasIncompleteTasks: true })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('AGENT_BUSY');
      expect(result!.agentId).toBe('busy-agent');
      expect(result!.requestedRoleId).toBe('any-role');
    });

    it('AGENT_BUSY takes priority over all other constraints', () => {
      // Set up conditions that would trigger ALL constraints
      registry.register(makeTemplate({
        roleId: 'current',
        authorityLevel: 'low',
        incompatibleRoles: ['target'],
      }));
      registry.register(makeTemplate({ roleId: 'target', authorityLevel: 'high' }));

      const result = validator.validate(
        makeAgent(),
        'target',
        makeContext({
          currentRoleId: 'current',
          hasIncompleteTasks: true,
          lastRoleSwitchAt: new Date().toISOString(), // within cooldown
        })
      );
      expect(result!.code).toBe('AGENT_BUSY');
    });
  });

  // ── COOLDOWN_ACTIVE ────────────────────────────────────────────

  describe('COOLDOWN_ACTIVE', () => {
    it('returns COOLDOWN_ACTIVE when within cooldown period', () => {
      const result = validator.validate(
        makeAgent('cool-agent'),
        'target-role',
        makeContext({
          lastRoleSwitchAt: new Date().toISOString(),
          roleSwitchCooldownMs: 60_000,
        })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('COOLDOWN_ACTIVE');
      expect(result!.agentId).toBe('cool-agent');
    });

    it('passes when cooldown has elapsed', () => {
      const pastTime = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
      const result = validator.validate(
        makeAgent(),
        'target-role',
        makeContext({
          lastRoleSwitchAt: pastTime,
          roleSwitchCooldownMs: 60_000,
        })
      );
      expect(result).toBeNull();
    });

    it('passes when lastRoleSwitchAt is null', () => {
      const result = validator.validate(
        makeAgent(),
        'target-role',
        makeContext({ lastRoleSwitchAt: null })
      );
      expect(result).toBeNull();
    });

    it('COOLDOWN_ACTIVE takes priority over ROLE_SWITCH_DENIED', () => {
      registry.register(makeTemplate({
        roleId: 'current',
        incompatibleRoles: ['target'],
      }));
      registry.register(makeTemplate({ roleId: 'target' }));

      const result = validator.validate(
        makeAgent(),
        'target',
        makeContext({
          currentRoleId: 'current',
          lastRoleSwitchAt: new Date().toISOString(),
        })
      );
      expect(result!.code).toBe('COOLDOWN_ACTIVE');
    });
  });

  // ── ROLE_SWITCH_DENIED ─────────────────────────────────────────

  describe('ROLE_SWITCH_DENIED', () => {
    it('returns ROLE_SWITCH_DENIED when target is in incompatibleRoles', () => {
      registry.register(makeTemplate({
        roleId: 'coder',
        incompatibleRoles: ['qa'],
      }));
      registry.register(makeTemplate({ roleId: 'qa' }));

      const result = validator.validate(
        makeAgent(),
        'qa',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('ROLE_SWITCH_DENIED');
      expect(result!.denialReason).toContain('incompatibleRoles');
    });

    it('returns ROLE_SWITCH_DENIED when target is not in compatibleRoles', () => {
      registry.register(makeTemplate({
        roleId: 'coder',
        compatibleRoles: ['reviewer'],
      }));
      registry.register(makeTemplate({ roleId: 'pm' }));

      const result = validator.validate(
        makeAgent(),
        'pm',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('ROLE_SWITCH_DENIED');
      expect(result!.denialReason).toContain('compatibleRoles');
    });

    it('passes when target is in compatibleRoles', () => {
      registry.register(makeTemplate({
        roleId: 'coder',
        compatibleRoles: ['reviewer', 'qa'],
      }));
      registry.register(makeTemplate({ roleId: 'reviewer', authorityLevel: 'medium' }));

      const result = validator.validate(
        makeAgent(),
        'reviewer',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).toBeNull();
    });

    it('passes when no compatibleRoles or incompatibleRoles defined', () => {
      registry.register(makeTemplate({ roleId: 'coder' }));
      registry.register(makeTemplate({ roleId: 'reviewer', authorityLevel: 'medium' }));

      const result = validator.validate(
        makeAgent(),
        'reviewer',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).toBeNull();
    });

    it('skips role compatibility check when currentRoleId is null', () => {
      registry.register(makeTemplate({ roleId: 'target' }));

      const result = validator.validate(
        makeAgent(),
        'target',
        makeContext({ currentRoleId: null })
      );
      expect(result).toBeNull();
    });

    it('skips role compatibility check when current role template not found', () => {
      registry.register(makeTemplate({ roleId: 'target', authorityLevel: 'medium' }));

      const result = validator.validate(
        makeAgent(),
        'target',
        makeContext({ currentRoleId: 'nonexistent' })
      );
      // Should not crash, just skip the check
      expect(result).toBeNull();
    });
  });

  // ── AUTHORITY_APPROVAL_REQUIRED ────────────────────────────────

  describe('AUTHORITY_APPROVAL_REQUIRED', () => {
    it('returns AUTHORITY_APPROVAL_REQUIRED when switching low → high', () => {
      registry.register(makeTemplate({ roleId: 'worker', authorityLevel: 'low' }));
      registry.register(makeTemplate({ roleId: 'architect', authorityLevel: 'high' }));

      const result = validator.validate(
        makeAgent(),
        'architect',
        makeContext({ currentRoleId: 'worker' })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('AUTHORITY_APPROVAL_REQUIRED');
    });

    it('returns AUTHORITY_APPROVAL_REQUIRED when switching low → medium', () => {
      registry.register(makeTemplate({ roleId: 'worker', authorityLevel: 'low' }));
      registry.register(makeTemplate({ roleId: 'coder', authorityLevel: 'medium' }));

      const result = validator.validate(
        makeAgent(),
        'coder',
        makeContext({ currentRoleId: 'worker' })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('AUTHORITY_APPROVAL_REQUIRED');
    });

    it('returns AUTHORITY_APPROVAL_REQUIRED when switching medium → high', () => {
      registry.register(makeTemplate({ roleId: 'coder', authorityLevel: 'medium' }));
      registry.register(makeTemplate({ roleId: 'architect', authorityLevel: 'high' }));

      const result = validator.validate(
        makeAgent(),
        'architect',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).not.toBeNull();
      expect(result!.code).toBe('AUTHORITY_APPROVAL_REQUIRED');
    });

    it('passes when switching same authority level', () => {
      registry.register(makeTemplate({ roleId: 'coder', authorityLevel: 'medium' }));
      registry.register(makeTemplate({ roleId: 'reviewer', authorityLevel: 'medium' }));

      const result = validator.validate(
        makeAgent(),
        'reviewer',
        makeContext({ currentRoleId: 'coder' })
      );
      expect(result).toBeNull();
    });

    it('passes when switching high → low', () => {
      registry.register(makeTemplate({ roleId: 'architect', authorityLevel: 'high' }));
      registry.register(makeTemplate({ roleId: 'worker', authorityLevel: 'low' }));

      const result = validator.validate(
        makeAgent(),
        'worker',
        makeContext({ currentRoleId: 'architect' })
      );
      expect(result).toBeNull();
    });

    it('skips authority check when target template not found', () => {
      registry.register(makeTemplate({ roleId: 'worker', authorityLevel: 'low' }));

      const result = validator.validate(
        makeAgent(),
        'nonexistent-role',
        makeContext({ currentRoleId: 'worker' })
      );
      // Should not crash, just skip the authority check
      expect(result).toBeNull();
    });
  });

  // ── Priority ordering ──────────────────────────────────────────

  describe('priority ordering', () => {
    it('ROLE_SWITCH_DENIED takes priority over AUTHORITY_APPROVAL_REQUIRED', () => {
      registry.register(makeTemplate({
        roleId: 'worker',
        authorityLevel: 'low',
        incompatibleRoles: ['architect'],
      }));
      registry.register(makeTemplate({ roleId: 'architect', authorityLevel: 'high' }));

      const result = validator.validate(
        makeAgent(),
        'architect',
        makeContext({ currentRoleId: 'worker' })
      );
      expect(result!.code).toBe('ROLE_SWITCH_DENIED');
    });
  });

  // ── Error shape ────────────────────────────────────────────────

  describe('error shape', () => {
    it('includes all required fields in the error', () => {
      const result = validator.validate(
        makeAgent('test-agent'),
        'target-role',
        makeContext({ hasIncompleteTasks: true })
      );
      expect(result).toMatchObject({
        code: 'AGENT_BUSY',
        agentId: 'test-agent',
        requestedRoleId: 'target-role',
      });
      expect(result!.denialReason).toBeTruthy();
      expect(result!.timestamp).toBeTruthy();
      // Verify timestamp is a valid ISO string
      expect(new Date(result!.timestamp).toISOString()).toBe(result!.timestamp);
    });
  });
});
