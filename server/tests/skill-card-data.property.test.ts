/**
 * Property-based tests for SkillCard data completeness
 *
 * Properties tested:
 *  23 — Skill 卡片渲染完整性
 *
 * Since no React DOM testing library is available, this test validates
 * the data contract: for any SkillBinding, the projected SkillCardData
 * contains all required display fields (name, summary, category, version, enabled).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock dynamic-organization to break circular dependency
vi.mock('../core/dynamic-organization.js', () => ({
  resolveMcp: () => [],
  skillRegistry: {},
}));

import type { SkillDefinition, SkillRecord, SkillBinding } from '../../shared/skill-contracts.js';
import { SkillRegistry } from '../core/skill-registry.js';

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let skills: SkillRecord[] = [];

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
    createSkillAuditLog: () => ({ id: 1 }),
    _reset: () => { skills = []; },
  };
}

/* ─── SkillCardData projection (mirrors client/src/components/SkillCard.tsx) ─── */

interface SkillCardData {
  id: string;
  name: string;
  summary: string;
  category?: string;
  version?: string;
  enabled?: boolean;
  prompt?: string;
  requiredMcp?: string[];
}

/** Project a SkillBinding to SkillCardData (same logic used by the API) */
function toSkillCardData(binding: SkillBinding): SkillCardData {
  return {
    id: binding.skillId,
    name: binding.resolvedSkill.name,
    summary: binding.resolvedSkill.summary,
    category: binding.resolvedSkill.category,
    version: binding.version,
    enabled: binding.enabled,
    prompt: binding.resolvedSkill.prompt,
    requiredMcp: binding.resolvedSkill.requiredMcp,
  };
}

/* ─── Arbitraries ─── */

const arbId = fc
  .string({ minLength: 1, maxLength: 20 })
  .map(s => s.replace(/[^a-z0-9-]/gi, 'a').toLowerCase().slice(0, 20) || 'sk');

const arbName = fc.string({ minLength: 1, maxLength: 30 }).map(s => s.trim() || 'name');
const arbCategory = fc.constantFrom('code', 'data', 'security', 'analysis', 'ops');
const arbSummary = fc.string({ minLength: 1, maxLength: 60 }).map(s => s.trim() || 'summary');

const arbValidPrompt = fc
  .string({ minLength: 0, maxLength: 40 })
  .map(s => `${s} {context} ... {input}`);

const arbSemver = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

const arbTags = fc.array(
  fc.string({ minLength: 1, maxLength: 10 }).map(s => s.trim() || 'tag'),
  { minLength: 0, maxLength: 3 },
);

const arbMcpIds = fc.array(arbId, { minLength: 0, maxLength: 3 });

const arbValidSkillDef: fc.Arbitrary<SkillDefinition> = fc.record({
  id: arbId,
  name: arbName,
  category: arbCategory,
  summary: arbSummary,
  prompt: arbValidPrompt,
  requiredMcp: arbMcpIds,
  version: arbSemver,
  tags: arbTags,
});


/* ─── Property 23: Skill 卡片渲染完整性 ─── */
/* **Validates: Requirements 10.2** */

describe('Feature: plugin-skill-system, Property 23: Skill 卡片渲染完整性', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it('SkillBinding projected to SkillCardData contains name, summary, category, version, enabled', () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        (def) => {
          db._reset();

          registry.registerSkill(def);
          const bindings = registry.resolveSkills([def.id]);

          expect(bindings).toHaveLength(1);

          const cardData = toSkillCardData(bindings[0]);

          // All required display fields must be present and non-empty
          expect(cardData.id).toBe(def.id);
          expect(typeof cardData.name).toBe('string');
          expect(cardData.name.length).toBeGreaterThan(0);
          expect(typeof cardData.summary).toBe('string');
          expect(cardData.summary.length).toBeGreaterThan(0);
          expect(typeof cardData.category).toBe('string');
          expect(cardData.category!.length).toBeGreaterThan(0);
          expect(typeof cardData.version).toBe('string');
          expect(cardData.version!.length).toBeGreaterThan(0);
          expect(typeof cardData.enabled).toBe('boolean');

          // Values should match the original definition
          expect(cardData.name).toBe(def.name);
          expect(cardData.summary).toBe(def.summary);
          expect(cardData.category).toBe(def.category);
          expect(cardData.version).toBe(def.version);
          expect(cardData.enabled).toBe(true); // newly registered skills are enabled
        },
      ),
      { numRuns: 100 },
    );
  });

  it('disabled Skill projected to SkillCardData shows enabled=false', () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        (def) => {
          db._reset();

          registry.registerSkill(def);
          registry.disableSkill(def.id, def.version, 'test', 'test');

          // Get the raw record since resolveSkills filters disabled
          const record = db.getSkill(def.id, def.version)!;
          const binding: SkillBinding = {
            skillId: record.id,
            version: record.version,
            resolvedSkill: record,
            mcpBindings: [],
            enabled: record.enabled,
          };

          const cardData = toSkillCardData(binding);

          expect(cardData.enabled).toBe(false);
          expect(cardData.name).toBe(def.name);
          expect(cardData.summary).toBe(def.summary);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('prompt and requiredMcp are included in card data for detail view', () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        (def) => {
          db._reset();

          registry.registerSkill(def);
          const bindings = registry.resolveSkills([def.id]);
          const cardData = toSkillCardData(bindings[0]);

          expect(cardData.prompt).toBe(def.prompt);
          expect(cardData.requiredMcp).toEqual(def.requiredMcp);
        },
      ),
      { numRuns: 100 },
    );
  });
});
