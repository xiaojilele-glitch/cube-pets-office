/**
 * Property-based tests for SkillRegistry.registerSkill
 *
 * Properties tested:
 *   1 — Skill 注册往返一致性
 *   2 — Prompt 模板验证
 *   3 — 版本并存
 *  15 — 语义化版本验证
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
    // reset helper for tests
    _reset: () => {
      skills = [];
    },
  };
}

/* ─── Arbitraries ─── */

/** Non-empty trimmed alphanumeric string (safe for IDs / names) */
const arbId = fc
  .string({ minLength: 1, maxLength: 24 })
  .map(s => s.replace(/[^a-z0-9-]/gi, "a").slice(0, 24) || "id");

const arbName = fc
  .string({ minLength: 1, maxLength: 40 })
  .map(s => s.trim() || "name");

const arbCategory = fc.constantFrom(
  "code",
  "data",
  "security",
  "analysis",
  "ops"
);

const arbSummary = fc
  .string({ minLength: 1, maxLength: 80 })
  .map(s => s.trim() || "summary");

/** Prompt that always contains both required placeholders */
const arbValidPrompt = fc
  .string({ minLength: 0, maxLength: 60 })
  .map(s => `${s} {context} ... {input}`);

/** Semantic version X.Y.Z where X, Y, Z are non-negative integers */
const arbSemver = fc
  .tuple(fc.nat({ max: 99 }), fc.nat({ max: 99 }), fc.nat({ max: 99 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

const arbTags = fc.array(
  fc.string({ minLength: 1, maxLength: 12 }).map(s => s.trim() || "tag"),
  {
    minLength: 0,
    maxLength: 5,
  }
);

const arbMcpIds = fc.array(arbId, { minLength: 0, maxLength: 3 });

/** A fully valid SkillDefinition */
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

/* ─── Property 1: Skill 注册往返一致性 ─── */
/* **Validates: Requirements 1.1, 1.2, 1.5** */

describe("Feature: plugin-skill-system, Property 1: Skill 注册往返一致性", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("registerSkill then querySkills returns equivalent record", () => {
    fc.assert(
      fc.property(arbValidSkillDef, def => {
        db._reset();
        const returned = registry.registerSkill(def);

        // Query back via querySkills
        const queried = registry.querySkills({ category: def.category });
        const found = queried.find(
          s => s.id === def.id && s.version === def.version
        );

        expect(found).toBeDefined();
        // Core fields must match
        expect(found!.id).toBe(def.id);
        expect(found!.name).toBe(def.name);
        expect(found!.category).toBe(def.category);
        expect(found!.summary).toBe(def.summary);
        expect(found!.prompt).toBe(def.prompt);
        expect(found!.requiredMcp).toEqual(def.requiredMcp);
        expect(found!.version).toBe(def.version);
        expect(found!.tags).toEqual(def.tags);

        // Returned record should also match
        expect(returned.id).toBe(def.id);
        expect(returned.name).toBe(def.name);
        expect(returned.version).toBe(def.version);
        expect(returned.enabled).toBe(true);
        expect(returned.createdAt).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it("registerSkill then getSkillVersions returns equivalent record", () => {
    fc.assert(
      fc.property(arbValidSkillDef, def => {
        db._reset();
        registry.registerSkill(def);

        const versions = registry.getSkillVersions(def.id);
        const found = versions.find(s => s.version === def.version);

        expect(found).toBeDefined();
        expect(found!.id).toBe(def.id);
        expect(found!.name).toBe(def.name);
        expect(found!.category).toBe(def.category);
        expect(found!.summary).toBe(def.summary);
        expect(found!.prompt).toBe(def.prompt);
        expect(found!.requiredMcp).toEqual(def.requiredMcp);
        expect(found!.version).toBe(def.version);
        expect(found!.tags).toEqual(def.tags);
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 2: Prompt 模板验证 ─── */
/* **Validates: Requirements 1.4** */

describe("Feature: plugin-skill-system, Property 2: Prompt 模板验证", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("prompt with both {context} and {input} is accepted", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        fc.string({ minLength: 0, maxLength: 40 }),
        fc.string({ minLength: 0, maxLength: 40 }),
        fc.string({ minLength: 0, maxLength: 40 }),
        (baseDef, prefix, middle, suffix) => {
          db._reset();
          const prompt = `${prefix}{context}${middle}{input}${suffix}`;
          const def: SkillDefinition = { ...baseDef, prompt };

          const record = registry.registerSkill(def);
          expect(record.prompt).toBe(prompt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("prompt missing {context} is rejected", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        fc
          .string({ minLength: 1, maxLength: 60 })
          .filter(s => !s.includes("{context}")),
        (baseDef, rawPrompt) => {
          db._reset();
          // Ensure {input} is present but {context} is not
          const prompt = rawPrompt.includes("{input}")
            ? rawPrompt
            : `${rawPrompt} {input}`;
          const def: SkillDefinition = { ...baseDef, prompt };

          expect(() => registry.registerSkill(def)).toThrow(/\{context\}/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("prompt missing {input} is rejected", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        fc
          .string({ minLength: 1, maxLength: 60 })
          .filter(s => !s.includes("{input}")),
        (baseDef, rawPrompt) => {
          db._reset();
          // Ensure {context} is present but {input} is not
          const prompt = rawPrompt.includes("{context}")
            ? rawPrompt
            : `${rawPrompt} {context}`;
          const def: SkillDefinition = { ...baseDef, prompt };

          expect(() => registry.registerSkill(def)).toThrow(/\{input\}/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("prompt missing both placeholders is rejected", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        fc
          .string({ minLength: 1, maxLength: 60 })
          .filter(s => !s.includes("{context}") && !s.includes("{input}")),
        (baseDef, prompt) => {
          db._reset();
          const def: SkillDefinition = { ...baseDef, prompt };

          expect(() => registry.registerSkill(def)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 3: 版本并存 ─── */
/* **Validates: Requirements 1.3, 6.3** */

describe("Feature: plugin-skill-system, Property 3: 版本并存", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("registering multiple distinct versions of the same skillId preserves all versions", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        fc.uniqueArray(arbSemver, {
          minLength: 1,
          maxLength: 8,
          comparator: (a, b) => a === b,
        }),
        (baseDef, versions) => {
          db._reset();

          for (const ver of versions) {
            registry.registerSkill({ ...baseDef, version: ver });
          }

          const stored = registry.getSkillVersions(baseDef.id);
          expect(stored).toHaveLength(versions.length);

          const storedVersions = new Set(stored.map(s => s.version));
          for (const ver of versions) {
            expect(storedVersions.has(ver)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("each version record retains its own field values", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        arbSemver,
        arbSemver.filter(v => true), // second version
        arbSummary,
        (baseDef, v1, v2, altSummary) => {
          // Ensure two distinct versions
          if (v1 === v2) return; // skip when equal
          db._reset();

          registry.registerSkill({
            ...baseDef,
            version: v1,
            summary: baseDef.summary,
          });
          registry.registerSkill({
            ...baseDef,
            version: v2,
            summary: altSummary,
          });

          const versions = registry.getSkillVersions(baseDef.id);
          const rec1 = versions.find(s => s.version === v1);
          const rec2 = versions.find(s => s.version === v2);

          expect(rec1).toBeDefined();
          expect(rec2).toBeDefined();
          expect(rec1!.summary).toBe(baseDef.summary);
          expect(rec2!.summary).toBe(altSummary);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 15: 语义化版本验证 ─── */
/* **Validates: Requirements 6.1** */

describe("Feature: plugin-skill-system, Property 15: 语义化版本验证", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("valid semver X.Y.Z is accepted by registerSkill", () => {
    fc.assert(
      fc.property(
        arbValidSkillDef,
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (baseDef, x, y, z) => {
          db._reset();
          const version = `${x}.${y}.${z}`;
          const def: SkillDefinition = { ...baseDef, version };

          const record = registry.registerSkill(def);
          expect(record.version).toBe(version);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("strings not matching X.Y.Z are rejected by registerSkill", () => {
    const SEMVER_RE = /^\d+\.\d+\.\d+$/;

    const arbInvalidVersion = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter(s => !SEMVER_RE.test(s));

    fc.assert(
      fc.property(arbValidSkillDef, arbInvalidVersion, (baseDef, version) => {
        db._reset();
        const def: SkillDefinition = { ...baseDef, version };

        expect(() => registry.registerSkill(def)).toThrow(/version/i);
      }),
      { numRuns: 100 }
    );
  });

  it("edge cases: leading zeros, negative-like, extra dots are rejected", () => {
    const invalidVersions = [
      "v1.0.0", // prefix
      "1.0", // missing patch
      "1.0.0.0", // extra segment
      "1.0.0-beta", // pre-release suffix
      "abc", // non-numeric
      "", // empty
      "1..0", // double dot
      ".1.0.0", // leading dot
      "1.0.0.", // trailing dot
    ];

    for (const version of invalidVersions) {
      db._reset();
      const def: SkillDefinition = {
        id: "test-skill",
        name: "Test",
        category: "code",
        summary: "Test skill",
        prompt: "Do {context} with {input}",
        requiredMcp: [],
        version,
        tags: [],
      };

      expect(() => registry.registerSkill(def)).toThrow();
    }
  });
});
