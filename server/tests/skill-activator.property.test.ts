/**
 * Property-based tests for SkillActivator
 *
 * Properties tested:
 *   9 — Skill 激活数量上限
 *  10 — 优先级排序的 Prompt 拼接
 *  11 — 上下文占位符替换
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  SkillBinding,
  SkillRecord,
  SkillBindingConfig,
} from "../../shared/skill-contracts.js";
import { SkillActivator } from "../core/skill-activator.js";

/* ─── Helpers ─── */

function makeBinding(
  id: string,
  priority: number,
  prompt: string,
  enabled = true,
  version = "1.0.0"
): SkillBinding {
  const record: SkillRecord = {
    id,
    name: `Skill-${id}`,
    category: "code",
    summary: `Summary ${id}`,
    prompt,
    requiredMcp: [],
    version,
    tags: [],
    enabled,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    skillId: id,
    version,
    resolvedSkill: record,
    mcpBindings: [],
    config: { priority },
    enabled,
  };
}

/* ─── Arbitraries ─── */

const arbId = fc.string({ minLength: 1, maxLength: 16 }).map(
  s =>
    s
      .replace(/[^a-z0-9]/gi, "a")
      .toLowerCase()
      .slice(0, 16) || "sk"
);

const arbPriority = fc.integer({ min: 0, max: 1000 });

const arbContext = fc
  .string({ minLength: 1, maxLength: 60 })
  .map(s => s.trim() || "ctx");

/** Prompt that always contains both required placeholders */
const arbValidPrompt = fc
  .tuple(
    fc.string({ minLength: 0, maxLength: 30 }),
    fc.string({ minLength: 0, maxLength: 30 }),
    fc.string({ minLength: 0, maxLength: 30 })
  )
  .map(([a, b, c]) => `${a}{context}${b}{input}${c}`);

/** Generate a list of SkillBindings with unique ids and distinct priorities */
const arbBindings = (min: number, max: number) =>
  fc
    .uniqueArray(fc.tuple(arbId, arbPriority, arbValidPrompt), {
      minLength: min,
      maxLength: max,
      comparator: (a, b) => a[0] === b[0],
    })
    .map(tuples =>
      tuples.map(([id, pri, prompt]) => makeBinding(id, pri, prompt))
    );

const activator = new SkillActivator();

/* ─── Property 9: Skill 激活数量上限 ─── */
/* **Validates: Requirements 3.1, 3.5** */

describe("Feature: plugin-skill-system, Property 9: Skill 激活数量上限", () => {
  it("activateSkills returns at most maxSkills items", () => {
    fc.assert(
      fc.property(
        arbBindings(1, 20),
        fc.integer({ min: 1, max: 10 }),
        arbContext,
        (bindings, maxSkills, ctx) => {
          const result = activator.activateSkills(bindings, ctx, maxSkills);
          expect(result.length).toBeLessThanOrEqual(maxSkills);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("activateSkills returns min(enabled count, maxSkills) items", () => {
    fc.assert(
      fc.property(
        arbBindings(1, 20),
        fc.integer({ min: 1, max: 10 }),
        arbContext,
        (bindings, maxSkills, ctx) => {
          const enabledCount = bindings.filter(b => b.enabled).length;
          const expected = Math.min(enabledCount, maxSkills);
          const result = activator.activateSkills(bindings, ctx, maxSkills);
          expect(result.length).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("activateSkills with default maxSkills caps at 5", () => {
    fc.assert(
      fc.property(arbBindings(6, 15), arbContext, (bindings, ctx) => {
        const result = activator.activateSkills(bindings, ctx);
        expect(result.length).toBeLessThanOrEqual(5);
      }),
      { numRuns: 100 }
    );
  });

  it("returned skills are the top-N by priority", () => {
    fc.assert(
      fc.property(
        arbBindings(1, 15),
        fc.integer({ min: 1, max: 8 }),
        arbContext,
        (bindings, maxSkills, ctx) => {
          const result = activator.activateSkills(bindings, ctx, maxSkills);

          // Sort all enabled bindings by priority desc
          const sortedEnabled = bindings
            .filter(b => b.enabled)
            .sort(
              (a, b) => (b.config?.priority ?? 0) - (a.config?.priority ?? 0)
            );

          const topN = sortedEnabled.slice(0, maxSkills);
          const topNIds = new Set(topN.map(b => b.skillId));
          const resultIds = new Set(result.map(r => r.skillId));

          expect(resultIds).toEqual(topNIds);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 10: 优先级排序的 Prompt 拼接 ─── */
/* **Validates: Requirements 3.2** */

describe("Feature: plugin-skill-system, Property 10: 优先级排序的 Prompt 拼接", () => {
  it("buildSkillPromptSection orders prompt fragments by priority descending", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(arbId, arbPriority, arbValidPrompt), {
          minLength: 2,
          maxLength: 8,
          comparator: (a, b) => a[0] === b[0],
        }),
        arbContext,
        (tuples, ctx) => {
          // Give each binding a strictly unique priority to avoid ambiguity
          const bindings = tuples.map(([id, _pri, prompt], i) =>
            makeBinding(id, (tuples.length - i) * 10, prompt)
          );

          const activated = activator.activateSkills(
            bindings,
            ctx,
            bindings.length
          );
          const section = activator.buildSkillPromptSection(activated);

          // Priorities should be strictly descending (unique priorities)
          for (let i = 1; i < activated.length; i++) {
            expect(activated[i - 1].priority).toBeGreaterThan(
              activated[i].priority
            );
          }

          // Verify order: each skill's section should appear in priority order
          // Use unique markers with skillId to avoid substring collisions
          const positions = activated.map(skill => {
            const marker = `## Skill: ${skill.name} (v${skill.version})`;
            const pos = section.indexOf(marker);
            expect(pos).toBeGreaterThanOrEqual(0);
            return pos;
          });

          // Positions should be strictly increasing (higher priority appears first in text)
          for (let i = 1; i < positions.length; i++) {
            expect(positions[i]).toBeGreaterThan(positions[i - 1]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("buildSkillPromptSection returns empty string for empty input", () => {
    const result = activator.buildSkillPromptSection([]);
    expect(result).toBe("");
  });
});

/* ─── Property 11: 上下文占位符替换 ─── */
/* **Validates: Requirements 3.3** */

describe("Feature: plugin-skill-system, Property 11: 上下文占位符替换", () => {
  it("resolved prompt contains the task context and no literal {context} placeholder", () => {
    fc.assert(
      fc.property(arbBindings(1, 6), arbContext, (bindings, ctx) => {
        const activated = activator.activateSkills(
          bindings,
          ctx,
          bindings.length
        );

        for (const skill of activated) {
          // Should contain the context string
          expect(skill.resolvedPrompt).toContain(ctx);
          // Should NOT contain the literal placeholder
          expect(skill.resolvedPrompt).not.toContain("{context}");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("multiple {context} occurrences are all replaced", () => {
    fc.assert(
      fc.property(arbId, arbContext, (id, ctx) => {
        const prompt = "A {context} B {context} C {input}";
        const binding = makeBinding(id, 10, prompt);

        const activated = activator.activateSkills([binding], ctx, 5);
        expect(activated).toHaveLength(1);

        const resolved = activated[0].resolvedPrompt;
        expect(resolved).not.toContain("{context}");

        // Count occurrences of ctx in resolved — should be at least 2
        const count = resolved.split(ctx).length - 1;
        expect(count).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 100 }
    );
  });

  it("{input} placeholder is preserved (not replaced by activateSkills)", () => {
    fc.assert(
      fc.property(arbBindings(1, 4), arbContext, (bindings, ctx) => {
        const activated = activator.activateSkills(
          bindings,
          ctx,
          bindings.length
        );

        for (const skill of activated) {
          // {input} should still be present (replaced later at execution time)
          expect(skill.resolvedPrompt).toContain("{input}");
        }
      }),
      { numRuns: 100 }
    );
  });
});
