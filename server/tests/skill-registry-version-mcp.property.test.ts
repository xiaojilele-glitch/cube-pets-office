/**
 * Property-based tests for SkillRegistry — version management & MCP resolution
 *
 * Properties tested:
 *  12 — MCP 解析正确性
 *  13 — MCP 不可用时优雅降级
 *  14 — 审计日志完整性
 *  16 — 指定版本解析
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

import type { SkillDefinition, SkillRecord, SkillAuditLog } from '../../shared/skill-contracts.js';
import type { WorkflowMcpBinding } from '../../shared/organization-schema.js';

// ---------------------------------------------------------------------------
// Mock dynamic-organization — we control which MCP IDs are "valid"
// ---------------------------------------------------------------------------

/** Registry of known MCP templates, populated per-test */
let mockMcpLibrary: Map<string, {
  id: string; name: string; server: string; description: string;
  connection: { transport: string; endpoint: string };
  tools: string[];
}> = new Map();

vi.mock('../core/dynamic-organization.js', () => ({
  resolveMcp: (mcpIds: string[], agentId: string, workflowId: string): WorkflowMcpBinding[] => {
    return mcpIds
      .map(id => mockMcpLibrary.get(id))
      .filter(Boolean)
      .map(t => ({
        id: t!.id,
        name: t!.name,
        server: t!.server,
        description: t!.description,
        connection: {
          ...t!.connection,
          endpoint: t!.connection.endpoint
            .replaceAll('{agentId}', agentId)
            .replaceAll('{workflowId}', workflowId),
        },
        tools: [...t!.tools],
      }));
  },
  skillRegistry: {},
}));

import { SkillRegistry } from '../core/skill-registry.js';

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let skills: SkillRecord[] = [];
  let auditLogs: SkillAuditLog[] = [];
  let auditCounter = 0;

  return {
    getSkills: () => skills,
    getSkill: (id: string, version: string) =>
      skills.find(s => s.id === id && s.version === version),
    upsertSkill(record: SkillRecord): SkillRecord {
      const idx = skills.findIndex(
        s => s.id === record.id && s.version === record.version,
      );
      if (idx >= 0) {
        skills[idx] = { ...record, updatedAt: new Date().toISOString() };
        return skills[idx];
      }
      skills.push(record);
      return record;
    },
    createSkillAuditLog(log: Omit<SkillAuditLog, 'id'>): SkillAuditLog {
      auditCounter++;
      const row: SkillAuditLog = { ...log, id: auditCounter };
      auditLogs.push(row);
      return row;
    },
    getSkillAuditLogs(skillId?: string): SkillAuditLog[] {
      if (skillId) return auditLogs.filter(l => l.skillId === skillId);
      return auditLogs;
    },
    _reset: () => {
      skills = [];
      auditLogs = [];
      auditCounter = 0;
    },
  };
}

/* ─── Arbitraries ─── */

const arbId = fc
  .string({ minLength: 1, maxLength: 20 })
  .map(s => s.replace(/[^a-z0-9-]/gi, 'a').toLowerCase().slice(0, 20) || 'sk');

const arbSemver = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

const arbMcpId = fc
  .string({ minLength: 1, maxLength: 16 })
  .map(s => s.replace(/[^a-z0-9-]/gi, 'a').toLowerCase().slice(0, 16) || 'mcp');

const arbOperator = fc.string({ minLength: 1, maxLength: 20 }).map(s => s.trim() || 'admin');
const arbReason = fc.string({ minLength: 1, maxLength: 40 }).map(s => s.trim() || 'reason');

function makeSkillDef(id: string, overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id, name: `Skill ${id}`, category: 'code', summary: `Summary for ${id}`,
    prompt: `Do {context} with {input} for ${id}`, requiredMcp: [], version: '1.0.0',
    tags: ['test'], ...overrides,
  };
}

function registerMockMcp(mcpId: string) {
  mockMcpLibrary.set(mcpId, {
    id: mcpId, name: `MCP ${mcpId}`, server: `server-${mcpId}`,
    description: `Description for ${mcpId}`,
    connection: { transport: 'stdio', endpoint: `http://localhost/{agentId}/{workflowId}` },
    tools: [`tool-${mcpId}`],
  });
}

const arbUniqueIds = (min: number, max: number) =>
  fc.uniqueArray(arbId, { minLength: min, maxLength: max, comparator: (a, b) => a === b });

const arbUniqueMcpIds = (min: number, max: number) =>
  fc.uniqueArray(arbMcpId, { minLength: min, maxLength: max, comparator: (a, b) => a === b });


/* ─── Property 12: MCP 解析正确性 ─── */
/* **Validates: Requirements 4.2** */

describe('Feature: plugin-skill-system, Property 12: MCP resolve correctness', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
    mockMcpLibrary = new Map();
  });

  it('resolveMcpForSkill returns McpBinding for each valid MCP ID, count equals valid IDs', () => {
    fc.assert(
      fc.property(arbId, arbUniqueMcpIds(1, 6), (skillId, mcpIds) => {
        db._reset();
        mockMcpLibrary = new Map();
        for (const mcpId of mcpIds) registerMockMcp(mcpId);
        const skill = registry.registerSkill(makeSkillDef(skillId, { requiredMcp: mcpIds }));
        const bindings = registry.resolveMcpForSkill(skill, 'agent-1', 'wf-1');
        expect(bindings).toHaveLength(mcpIds.length);
        const bindingIds = new Set(bindings.map(b => b.id));
        for (const mcpId of mcpIds) expect(bindingIds.has(mcpId)).toBe(true);
        for (const b of bindings) {
          expect(b.name).toBeDefined();
          expect(b.server).toBeDefined();
          expect(b.connection).toBeDefined();
          expect(Array.isArray(b.tools)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('resolveMcpForSkill returns empty array when requiredMcp is empty', () => {
    fc.assert(
      fc.property(arbId, (skillId) => {
        db._reset();
        mockMcpLibrary = new Map();
        const skill = registry.registerSkill(makeSkillDef(skillId, { requiredMcp: [] }));
        const bindings = registry.resolveMcpForSkill(skill, 'agent-1', 'wf-1');
        expect(bindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 13: MCP 不可用时优雅降级 ─── */
/* **Validates: Requirements 4.3** */

describe('Feature: plugin-skill-system, Property 13: MCP graceful degradation', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
    mockMcpLibrary = new Map();
  });

  it('resolveMcpForSkill returns bindings for valid MCPs, skips invalid, does not throw', () => {
    fc.assert(
      fc.property(arbId, arbUniqueMcpIds(1, 4), arbUniqueMcpIds(1, 4),
        (skillId, validCandidates, invalidCandidates) => {
          db._reset();
          mockMcpLibrary = new Map();
          const validSet = new Set(validCandidates);
          const invalidIds = invalidCandidates.filter(id => !validSet.has(id));
          if (invalidIds.length === 0) return;
          for (const mcpId of validCandidates) registerMockMcp(mcpId);
          const allMcpIds = [...validCandidates, ...invalidIds];
          const skill = registry.registerSkill(makeSkillDef(skillId, { requiredMcp: allMcpIds }));
          const bindings = registry.resolveMcpForSkill(skill, 'agent-1', 'wf-1');
          expect(bindings).toHaveLength(validCandidates.length);
          const bindingIds = new Set(bindings.map(b => b.id));
          for (const mcpId of validCandidates) expect(bindingIds.has(mcpId)).toBe(true);
          for (const mcpId of invalidIds) expect(bindingIds.has(mcpId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolveMcpForSkill with entirely invalid MCPs returns empty array without throwing', () => {
    fc.assert(
      fc.property(arbId, arbUniqueMcpIds(1, 5), (skillId, mcpIds) => {
        db._reset();
        mockMcpLibrary = new Map();
        const skill = registry.registerSkill(makeSkillDef(skillId, { requiredMcp: mcpIds }));
        const bindings = registry.resolveMcpForSkill(skill, 'agent-1', 'wf-1');
        expect(bindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 14: 审计日志完整性 ─── */
/* **Validates: Requirements 5.4, 6.5** */

describe('Feature: plugin-skill-system, Property 14: audit log completeness', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
    mockMcpLibrary = new Map();
  });

  it('enableSkill produces an audit log with all required fields', () => {
    fc.assert(
      fc.property(arbId, arbSemver, arbOperator, arbReason,
        (skillId, version, operator, reason) => {
          db._reset();
          registry.registerSkill(makeSkillDef(skillId, { version }));
          registry.disableSkill(skillId, version, 'setup', 'setup');
          const logsBefore = db.getSkillAuditLogs(skillId).length;
          registry.enableSkill(skillId, version, operator, reason);
          const logs = db.getSkillAuditLogs(skillId);
          const newLogs = logs.slice(logsBefore);
          expect(newLogs.length).toBeGreaterThanOrEqual(1);
          const log = newLogs.find(l => l.action === 'enable');
          expect(log).toBeDefined();
          expect(log!.skillId).toBe(skillId);
          expect(log!.version).toBe(version);
          expect(log!.action).toBe('enable');
          expect(log!.operator).toBe(operator);
          expect(log!.reason).toBe(reason);
          expect(typeof log!.timestamp).toBe('string');
          expect(log!.timestamp.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('disableSkill produces an audit log with all required fields', () => {
    fc.assert(
      fc.property(arbId, arbSemver, arbOperator, arbReason,
        (skillId, version, operator, reason) => {
          db._reset();
          registry.registerSkill(makeSkillDef(skillId, { version }));
          const logsBefore = db.getSkillAuditLogs(skillId).length;
          registry.disableSkill(skillId, version, operator, reason);
          const logs = db.getSkillAuditLogs(skillId);
          const newLogs = logs.slice(logsBefore);
          expect(newLogs.length).toBeGreaterThanOrEqual(1);
          const log = newLogs.find(l => l.action === 'disable');
          expect(log).toBeDefined();
          expect(log!.skillId).toBe(skillId);
          expect(log!.version).toBe(version);
          expect(log!.action).toBe('disable');
          expect(log!.operator).toBe(operator);
          expect(log!.reason).toBe(reason);
          expect(typeof log!.timestamp).toBe('string');
          expect(log!.timestamp.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sequential enable/disable operations each produce their own audit log entry', () => {
    fc.assert(
      fc.property(
        arbId, arbSemver,
        fc.array(fc.constantFrom('enable' as const, 'disable' as const), { minLength: 1, maxLength: 6 }),
        arbOperator, arbReason,
        (skillId, version, actions, operator, reason) => {
          db._reset();
          registry.registerSkill(makeSkillDef(skillId, { version }));
          for (const action of actions) {
            if (action === 'enable') registry.enableSkill(skillId, version, operator, reason);
            else registry.disableSkill(skillId, version, operator, reason);
          }
          const logs = db.getSkillAuditLogs(skillId);
          expect(logs.length).toBeGreaterThanOrEqual(actions.length);
          for (const log of logs) {
            expect(log.skillId).toBe(skillId);
            expect(log.version).toBe(version);
            expect(['enable', 'disable', 'register', 'version_switch']).toContain(log.action);
            expect(typeof log.operator).toBe('string');
            expect(typeof log.reason).toBe('string');
            expect(typeof log.timestamp).toBe('string');
            expect(log.timestamp.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 16: 指定版本解析 ─── */
/* **Validates: Requirements 6.2** */

describe('Feature: plugin-skill-system, Property 16: version-specific resolve', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
    mockMcpLibrary = new Map();
  });

  it('resolveSkills with versionMap returns the exact specified version', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.uniqueArray(arbSemver, { minLength: 2, maxLength: 6, comparator: (a, b) => a === b }),
        fc.nat(),
        (skillId, versions, pickSeed) => {
          db._reset();
          for (const ver of versions) registry.registerSkill(makeSkillDef(skillId, { version: ver }));
          const targetVersion = versions[pickSeed % versions.length];
          const bindings = registry.resolveSkills([skillId], { versionMap: { [skillId]: targetVersion } });
          expect(bindings).toHaveLength(1);
          expect(bindings[0].skillId).toBe(skillId);
          expect(bindings[0].version).toBe(targetVersion);
          expect(bindings[0].resolvedSkill.version).toBe(targetVersion);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolveSkills with versionMap for multiple skills returns each at the specified version', () => {
    fc.assert(
      fc.property(
        arbUniqueIds(2, 4),
        fc.uniqueArray(arbSemver, { minLength: 2, maxLength: 4, comparator: (a, b) => a === b }),
        (skillIds, versions) => {
          db._reset();
          for (const skillId of skillIds) {
            for (const ver of versions) registry.registerSkill(makeSkillDef(skillId, { version: ver }));
          }
          const versionMap: Record<string, string> = {};
          for (let i = 0; i < skillIds.length; i++) versionMap[skillIds[i]] = versions[i % versions.length];
          const bindings = registry.resolveSkills(skillIds, { versionMap });
          expect(bindings).toHaveLength(skillIds.length);
          for (const binding of bindings) {
            expect(binding.version).toBe(versionMap[binding.skillId]);
            expect(binding.resolvedSkill.version).toBe(versionMap[binding.skillId]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resolveSkills without versionMap returns a valid version', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.uniqueArray(arbSemver, { minLength: 2, maxLength: 5, comparator: (a, b) => a === b }),
        (skillId, versions) => {
          db._reset();
          for (const ver of versions) registry.registerSkill(makeSkillDef(skillId, { version: ver }));
          const bindings = registry.resolveSkills([skillId]);
          expect(bindings).toHaveLength(1);
          expect(versions).toContain(bindings[0].version);
        },
      ),
      { numRuns: 100 },
    );
  });
});
