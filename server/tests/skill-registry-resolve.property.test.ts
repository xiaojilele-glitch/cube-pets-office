/**
 * Property-based tests for SkillRegistry.resolveSkills
 *
 * Properties tested:
 *   4 — Skill 解析正确性
 *   5 — 依赖传递闭包
 *   6 — 缺失 Skill 优雅降级
 *   7 — 循环依赖检测
 *   8 — 禁用 Skill 过滤
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import fc from "fast-check";

// Mock dynamic-organization to break circular dependency
vi.mock("../core/dynamic-organization.js", () => ({
  resolveMcp: () => [],
  skillRegistry: {},
}));

import type {
  SkillDefinition,
  SkillRecord,
} from "../../shared/skill-contracts.js";
import { CircularDependencyError } from "../../shared/skill-contracts.js";
import { SkillRegistry } from "../core/skill-registry.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let skills: SkillRecord[] = [];

  return {
    getSkills: () => skills,
    getSkill: (id: string, version: string) =>
      skills.find(s => s.id === id && s.version === version),
    upsertSkill(record: SkillRecord): SkillRecord {
      const idx = skills.findIndex(
        s => s.id === record.id && s.version === record.version
      );
      if (idx >= 0) {
        skills[idx] = { ...record, updatedAt: new Date().toISOString() };
        return skills[idx];
      }
      skills.push(record);
      return record;
    },
    createSkillAuditLog: () => ({ id: 1 }),
    _reset: () => {
      skills = [];
    },
  };
}

/* ─── Arbitraries ─── */

/** Unique skill id: lowercase alphanumeric with dashes */
const arbSkillId = fc.string({ minLength: 1, maxLength: 20 }).map(
  s =>
    s
      .replace(/[^a-z0-9]/gi, "a")
      .toLowerCase()
      .slice(0, 20) || "sk"
);

const arbName = fc
  .string({ minLength: 1, maxLength: 30 })
  .map(s => s.trim() || "name");
const arbCategory = fc.constantFrom(
  "code",
  "data",
  "security",
  "analysis",
  "ops"
);
const arbSummary = fc
  .string({ minLength: 1, maxLength: 60 })
  .map(s => s.trim() || "summary");

/** Prompt that always contains both required placeholders */
const arbValidPrompt = fc
  .string({ minLength: 0, maxLength: 40 })
  .map(s => `${s} {context} ... {input}`);

/** Semantic version X.Y.Z */
const arbSemver = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

const arbTags = fc.array(
  fc.string({ minLength: 1, maxLength: 10 }).map(s => s.trim() || "tag"),
  { minLength: 0, maxLength: 3 }
);

/** Build a valid SkillDefinition with a given id and optional dependencies */
function makeSkillDef(
  id: string,
  deps: string[] = [],
  overrides: Partial<SkillDefinition> = {}
): SkillDefinition {
  return {
    id,
    name: `Skill ${id}`,
    category: "code",
    summary: `Summary for ${id}`,
    prompt: `Do {context} with {input} for ${id}`,
    requiredMcp: [],
    version: "1.0.0",
    tags: ["test"],
    dependencies: deps,
    ...overrides,
  };
}

/** Arbitrary for a valid SkillDefinition (no dependencies) */
const arbValidSkillDef: fc.Arbitrary<SkillDefinition> = fc.record({
  id: arbSkillId,
  name: arbName,
  category: arbCategory,
  summary: arbSummary,
  prompt: arbValidPrompt,
  requiredMcp: fc.constant([] as string[]),
  version: arbSemver,
  tags: arbTags,
});

/**
 * Generate a set of N unique skill IDs.
 * Returns an array of distinct lowercase IDs.
 */
const arbUniqueSkillIds = (min: number, max: number) =>
  fc.uniqueArray(arbSkillId, {
    minLength: min,
    maxLength: max,
    comparator: (a, b) => a === b,
  });

/* ─── Property 4: Skill 解析正确性 ─── */
/* **Validates: Requirements 2.2** */

describe("Feature: plugin-skill-system, Property 4: Skill 解析正确性", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("resolveSkills returns bindings whose skillIds are a subset of the registered input ids", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(1, 8), ids => {
        db._reset();

        // Register all skills (enabled, no dependencies)
        for (const id of ids) {
          registry.registerSkill(makeSkillDef(id));
        }

        const bindings = registry.resolveSkills(ids);

        // Every binding's skillId must be one of the input ids
        for (const b of bindings) {
          expect(ids).toContain(b.skillId);
        }

        // Every input id should appear in the result (all are valid & enabled)
        const resultIds = new Set(bindings.map(b => b.skillId));
        for (const id of ids) {
          expect(resultIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("each binding contains a resolvedSkill with matching skillId and version", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(1, 6), ids => {
        db._reset();

        for (const id of ids) {
          registry.registerSkill(makeSkillDef(id));
        }

        const bindings = registry.resolveSkills(ids);

        for (const b of bindings) {
          expect(b.resolvedSkill).toBeDefined();
          expect(b.resolvedSkill.id).toBe(b.skillId);
          expect(b.version).toBe(b.resolvedSkill.version);
          expect(b.enabled).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 5: 依赖传递闭包 ─── */
/* **Validates: Requirements 2.3, 8.2** */

describe("Feature: plugin-skill-system, Property 5: 依赖传递闭包", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("resolveSkills returns the root and all transitive dependencies with no duplicates", () => {
    // Generate an acyclic chain: ids[0] → ids[1] → ids[2] → ... → ids[n-1]
    fc.assert(
      fc.property(arbUniqueSkillIds(2, 6), ids => {
        db._reset();

        // Build a linear dependency chain: ids[0] depends on ids[1], ids[1] on ids[2], etc.
        for (let i = 0; i < ids.length; i++) {
          const deps = i < ids.length - 1 ? [ids[i + 1]] : [];
          registry.registerSkill(makeSkillDef(ids[i], deps));
        }

        // Resolve only the root
        const bindings = registry.resolveSkills([ids[0]]);
        const resultIds = bindings.map(b => b.skillId);

        // Should contain ALL skills in the chain (transitive closure)
        for (const id of ids) {
          expect(resultIds).toContain(id);
        }

        // No duplicates
        const uniqueIds = new Set(resultIds);
        expect(uniqueIds.size).toBe(resultIds.length);

        // Total count should equal the chain length
        expect(bindings.length).toBe(ids.length);
      }),
      { numRuns: 100 }
    );
  });

  it("resolveSkills handles diamond dependencies without duplicates", () => {
    // Diamond: A → B, A → C, B → D, C → D
    fc.assert(
      fc.property(arbUniqueSkillIds(4, 4), ([a, b, c, d]) => {
        db._reset();

        registry.registerSkill(makeSkillDef(a, [b, c]));
        registry.registerSkill(makeSkillDef(b, [d]));
        registry.registerSkill(makeSkillDef(c, [d]));
        registry.registerSkill(makeSkillDef(d, []));

        const bindings = registry.resolveSkills([a]);
        const resultIds = bindings.map(b => b.skillId);

        // All four should be present
        expect(resultIds).toContain(a);
        expect(resultIds).toContain(b);
        expect(resultIds).toContain(c);
        expect(resultIds).toContain(d);

        // No duplicates
        expect(new Set(resultIds).size).toBe(resultIds.length);
        expect(bindings.length).toBe(4);
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 6: 缺失 Skill 优雅降级 ─── */
/* **Validates: Requirements 2.4** */

describe("Feature: plugin-skill-system, Property 6: 缺失 Skill 优雅降级", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("resolveSkills returns bindings for valid ids and skips invalid ones without throwing", () => {
    fc.assert(
      fc.property(
        arbUniqueSkillIds(1, 5),
        arbUniqueSkillIds(1, 5),
        (validIds, invalidCandidates) => {
          db._reset();

          // Register only the valid skills
          for (const id of validIds) {
            registry.registerSkill(makeSkillDef(id));
          }

          // Ensure invalid ids don't overlap with valid ones
          const validSet = new Set(validIds);
          const invalidIds = invalidCandidates.filter(id => !validSet.has(id));

          // Mix valid and invalid
          const mixedIds = [...validIds, ...invalidIds];

          // Should NOT throw
          const bindings = registry.resolveSkills(mixedIds);
          const resultIds = new Set(bindings.map(b => b.skillId));

          // All valid ids should be present
          for (const id of validIds) {
            expect(resultIds.has(id)).toBe(true);
          }

          // No invalid ids should be present
          for (const id of invalidIds) {
            expect(resultIds.has(id)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("resolveSkills with entirely invalid ids returns empty array without throwing", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(1, 5), ids => {
        db._reset();
        // Don't register anything — all ids are invalid

        const bindings = registry.resolveSkills(ids);
        expect(bindings).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 7: 循环依赖检测 ─── */
/* **Validates: Requirements 8.3** */

describe("Feature: plugin-skill-system, Property 7: 循环依赖检测", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("resolveSkills detects a direct self-cycle and throws CircularDependencyError", () => {
    fc.assert(
      fc.property(arbSkillId, id => {
        db._reset();

        // Skill depends on itself
        registry.registerSkill(makeSkillDef(id, [id]));

        expect(() => registry.resolveSkills([id])).toThrow(
          CircularDependencyError
        );
      }),
      { numRuns: 100 }
    );
  });

  it("resolveSkills detects cycles in chains of length 2..N and throws CircularDependencyError", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(2, 6), ids => {
        db._reset();

        // Build a cycle: ids[0] → ids[1] → ... → ids[n-1] → ids[0]
        for (let i = 0; i < ids.length; i++) {
          const nextIdx = (i + 1) % ids.length;
          registry.registerSkill(makeSkillDef(ids[i], [ids[nextIdx]]));
        }

        expect(() => registry.resolveSkills([ids[0]])).toThrow(
          CircularDependencyError
        );
      }),
      { numRuns: 100 }
    );
  });

  it("CircularDependencyError contains the cycle path", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(2, 4), ids => {
        db._reset();

        // Build a cycle: ids[0] → ids[1] → ... → ids[n-1] → ids[0]
        for (let i = 0; i < ids.length; i++) {
          const nextIdx = (i + 1) % ids.length;
          registry.registerSkill(makeSkillDef(ids[i], [ids[nextIdx]]));
        }

        try {
          registry.resolveSkills([ids[0]]);
          // Should not reach here
          expect.unreachable("Expected CircularDependencyError");
        } catch (err) {
          expect(err).toBeInstanceOf(CircularDependencyError);
          const cde = err as CircularDependencyError;
          // The cycle path should contain at least 2 entries and form a cycle
          expect(cde.cyclePath.length).toBeGreaterThanOrEqual(2);
          // First and last element should be the same (cycle)
          expect(cde.cyclePath[cde.cyclePath.length - 1]).toBe(
            cde.cyclePath[0]
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 8: 禁用 Skill 过滤 ─── */
/* **Validates: Requirements 5.2, 5.3** */

describe("Feature: plugin-skill-system, Property 8: 禁用 Skill 过滤", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("resolveSkills only returns enabled skills; disabled skills are filtered out", () => {
    fc.assert(
      fc.property(
        arbUniqueSkillIds(2, 8),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (ids, disableRatio) => {
          db._reset();

          // Register all skills
          for (const id of ids) {
            registry.registerSkill(makeSkillDef(id));
          }

          // Disable a portion of them
          const disableCount = Math.max(
            1,
            Math.floor(ids.length * disableRatio)
          );
          const disabledIds = new Set(ids.slice(0, disableCount));
          const enabledIds = ids.filter(id => !disabledIds.has(id));

          for (const id of disabledIds) {
            registry.disableSkill(id, "1.0.0", "test", "property test");
          }

          // Resolve all ids
          const bindings = registry.resolveSkills(ids);
          const resultIds = new Set(bindings.map(b => b.skillId));

          // Disabled skills should NOT appear
          for (const id of disabledIds) {
            expect(resultIds.has(id)).toBe(false);
          }

          // Enabled skills should appear
          for (const id of enabledIds) {
            expect(resultIds.has(id)).toBe(true);
          }

          // All returned bindings should have enabled=true
          for (const b of bindings) {
            expect(b.enabled).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("disableSkill takes effect immediately — resolveSkills reflects the change", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(2, 6), ids => {
        db._reset();

        for (const id of ids) {
          registry.registerSkill(makeSkillDef(id));
        }

        // Initially all should resolve
        const before = registry.resolveSkills(ids);
        expect(before.length).toBe(ids.length);

        // Disable the first skill
        const targetId = ids[0];
        registry.disableSkill(
          targetId,
          "1.0.0",
          "test",
          "immediate effect test"
        );

        // Immediately resolve again
        const after = registry.resolveSkills(ids);
        const afterIds = new Set(after.map(b => b.skillId));

        expect(afterIds.has(targetId)).toBe(false);
        expect(after.length).toBe(ids.length - 1);
      }),
      { numRuns: 100 }
    );
  });

  it("re-enabling a disabled skill makes it appear in resolveSkills again", () => {
    fc.assert(
      fc.property(arbUniqueSkillIds(1, 4), ids => {
        db._reset();

        for (const id of ids) {
          registry.registerSkill(makeSkillDef(id));
        }

        const targetId = ids[0];

        // Disable then re-enable
        registry.disableSkill(targetId, "1.0.0", "test", "disable");
        registry.enableSkill(targetId, "1.0.0", "test", "re-enable");

        const bindings = registry.resolveSkills(ids);
        const resultIds = new Set(bindings.map(b => b.skillId));

        expect(resultIds.has(targetId)).toBe(true);
        expect(bindings.length).toBe(ids.length);
      }),
      { numRuns: 100 }
    );
  });
});
