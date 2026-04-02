import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import type { RoleTemplate } from '../../shared/role-schema.js';
import { RoleRegistry } from '../core/role-registry.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_role_registry__');
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

describe('RoleRegistry', () => {
  let registry: RoleRegistry;

  beforeEach(() => {
    // Use a temp store path so tests don't pollute real data
    registry = new RoleRegistry(TEST_STORE_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // ── register / get / list ──────────────────────────────────────

  describe('register & get & list', () => {
    it('registers a template and retrieves it by roleId', () => {
      const t = makeTemplate({ roleId: 'coder' });
      registry.register(t);
      expect(registry.get('coder')).toEqual(t);
    });

    it('lists all registered templates', () => {
      registry.register(makeTemplate({ roleId: 'a' }));
      registry.register(makeTemplate({ roleId: 'b' }));
      expect(registry.list()).toHaveLength(2);
    });

    it('returns undefined for non-existent roleId', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('re-registering same roleId overwrites the template', () => {
      registry.register(makeTemplate({ roleId: 'x', roleName: 'V1' }));
      registry.register(makeTemplate({ roleId: 'x', roleName: 'V2' }));
      expect(registry.get('x')?.roleName).toBe('V2');
      expect(registry.list()).toHaveLength(1);
    });
  });

  // ── unregister ─────────────────────────────────────────────────

  describe('unregister', () => {
    it('removes a registered template', () => {
      registry.register(makeTemplate({ roleId: 'rm' }));
      registry.unregister('rm');
      expect(registry.get('rm')).toBeUndefined();
      expect(registry.list()).toHaveLength(0);
    });

    it('does nothing for non-existent roleId', () => {
      registry.unregister('ghost');
      expect(registry.list()).toHaveLength(0);
    });
  });

  // ── resolve (inheritance) ──────────────────────────────────────

  describe('resolve', () => {
    it('returns the template as-is when no extends', () => {
      const t = makeTemplate({ roleId: 'base' });
      registry.register(t);
      const resolved = registry.resolve('base');
      expect(resolved.responsibilityPrompt).toBe(t.responsibilityPrompt);
      expect(resolved.requiredSkillIds).toEqual(t.requiredSkillIds);
    });

    it('merges parent responsibilityPrompt, requiredSkillIds, mcpIds', () => {
      const parent = makeTemplate({
        roleId: 'parent',
        responsibilityPrompt: 'Parent prompt',
        requiredSkillIds: ['skill-p1', 'skill-shared'],
        mcpIds: ['mcp-p1'],
      });
      const child = makeTemplate({
        roleId: 'child',
        extends: 'parent',
        responsibilityPrompt: 'Child prompt',
        requiredSkillIds: ['skill-c1', 'skill-shared'],
        mcpIds: ['mcp-c1', 'mcp-p1'],
        authorityLevel: 'high',
      });

      registry.register(parent);
      registry.register(child);

      const resolved = registry.resolve('child');

      // prompt = parent + "\n\n" + child
      expect(resolved.responsibilityPrompt).toBe('Parent prompt\n\nChild prompt');
      // union of skills
      expect(resolved.requiredSkillIds).toEqual(
        expect.arrayContaining(['skill-p1', 'skill-shared', 'skill-c1'])
      );
      expect(resolved.requiredSkillIds).toHaveLength(3);
      // union of mcpIds
      expect(resolved.mcpIds).toEqual(expect.arrayContaining(['mcp-p1', 'mcp-c1']));
      expect(resolved.mcpIds).toHaveLength(2);
      // child overrides authorityLevel
      expect(resolved.authorityLevel).toBe('high');
    });

    it('resolves multi-level inheritance (grandparent -> parent -> child)', () => {
      registry.register(makeTemplate({
        roleId: 'gp',
        responsibilityPrompt: 'GP',
        requiredSkillIds: ['s-gp'],
        mcpIds: ['m-gp'],
      }));
      registry.register(makeTemplate({
        roleId: 'p',
        extends: 'gp',
        responsibilityPrompt: 'P',
        requiredSkillIds: ['s-p'],
        mcpIds: ['m-p'],
      }));
      registry.register(makeTemplate({
        roleId: 'c',
        extends: 'p',
        responsibilityPrompt: 'C',
        requiredSkillIds: ['s-c'],
        mcpIds: ['m-c'],
      }));

      const resolved = registry.resolve('c');
      expect(resolved.responsibilityPrompt).toBe('GP\n\nP\n\nC');
      expect(resolved.requiredSkillIds).toEqual(expect.arrayContaining(['s-gp', 's-p', 's-c']));
      expect(resolved.mcpIds).toEqual(expect.arrayContaining(['m-gp', 'm-p', 'm-c']));
    });

    it('throws on circular inheritance', () => {
      registry.register(makeTemplate({ roleId: 'a', extends: 'b' }));
      registry.register(makeTemplate({ roleId: 'b', extends: 'a' }));
      expect(() => registry.resolve('a')).toThrow(/Circular inheritance/);
    });

    it('throws on self-referencing extends', () => {
      registry.register(makeTemplate({ roleId: 'self', extends: 'self' }));
      expect(() => registry.resolve('self')).toThrow(/Circular inheritance/);
    });

    it('throws when parent roleId does not exist', () => {
      registry.register(makeTemplate({ roleId: 'orphan', extends: 'missing' }));
      expect(() => registry.resolve('orphan')).toThrow(/Role not found: missing/);
    });

    it('throws when resolving a non-existent roleId', () => {
      expect(() => registry.resolve('nope')).toThrow(/Role not found: nope/);
    });
  });

  // ── change log ─────────────────────────────────────────────────

  describe('changeLog', () => {
    it('logs "created" on first register', () => {
      registry.register(makeTemplate({ roleId: 'new' }), 'admin');
      const log = registry.getChangeLog('new');
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe('created');
      expect(log[0].changedBy).toBe('admin');
      expect(log[0].roleId).toBe('new');
    });

    it('logs "modified" on re-register with diff', () => {
      registry.register(makeTemplate({ roleId: 'mod', roleName: 'V1' }));
      registry.register(makeTemplate({ roleId: 'mod', roleName: 'V2' }));
      const log = registry.getChangeLog('mod');
      expect(log).toHaveLength(2);
      expect(log[0].action).toBe('created');
      expect(log[1].action).toBe('modified');
      expect(log[1].diff).toHaveProperty('roleName');
      expect(log[1].diff.roleName).toEqual({ old: 'V1', new: 'V2' });
    });

    it('logs "deprecated" on unregister', () => {
      registry.register(makeTemplate({ roleId: 'dep' }));
      registry.unregister('dep', 'ops');
      const log = registry.getChangeLog('dep');
      expect(log).toHaveLength(2);
      expect(log[1].action).toBe('deprecated');
      expect(log[1].changedBy).toBe('ops');
    });

    it('returns all logs when no roleId filter', () => {
      registry.register(makeTemplate({ roleId: 'a' }));
      registry.register(makeTemplate({ roleId: 'b' }));
      expect(registry.getChangeLog()).toHaveLength(2);
    });

    it('filters logs by roleId', () => {
      registry.register(makeTemplate({ roleId: 'x' }));
      registry.register(makeTemplate({ roleId: 'y' }));
      expect(registry.getChangeLog('x')).toHaveLength(1);
      expect(registry.getChangeLog('x')[0].roleId).toBe('x');
    });
  });

  // ── persistence ────────────────────────────────────────────────

  describe('persistence', () => {
    it('persists templates and reloads them in a new instance', () => {
      registry.register(makeTemplate({ roleId: 'persist-1', roleName: 'Persisted' }));

      // Create a new instance pointing to the same file
      const registry2 = new RoleRegistry(TEST_STORE_PATH);
      expect(registry2.get('persist-1')?.roleName).toBe('Persisted');
      expect(registry2.list()).toHaveLength(1);
    });

    it('persists change log across instances', () => {
      registry.register(makeTemplate({ roleId: 'log-persist' }), 'tester');

      const registry2 = new RoleRegistry(TEST_STORE_PATH);
      const log = registry2.getChangeLog('log-persist');
      expect(log).toHaveLength(1);
      expect(log[0].changedBy).toBe('tester');
    });

    it('starts empty when persistence file is corrupted', () => {
      mkdirSync(TEST_STORE_DIR, { recursive: true });
      writeFileSync(TEST_STORE_PATH, '{{invalid json', 'utf-8');

      const reg = new RoleRegistry(TEST_STORE_PATH);
      expect(reg.list()).toHaveLength(0);
      expect(reg.getChangeLog()).toHaveLength(0);
    });

    it('starts empty when persistence file does not exist', () => {
      const reg = new RoleRegistry(resolve(TEST_STORE_DIR, 'nonexistent.json'));
      expect(reg.list()).toHaveLength(0);
    });
  });
});
