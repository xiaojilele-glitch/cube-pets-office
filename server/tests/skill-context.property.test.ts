/**
 * Property-based tests for SkillContext — 上下文隔离
 *
 * Properties tested:
 *  21 — 上下文隔离
 *  22 — 副作用记录
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createSkillContext, recordSideEffect } from '../core/skill-context.js';
import type { SideEffect } from '../../shared/skill-contracts.js';

/* ─── Arbitraries ─── */

const arbId = fc
  .string({ minLength: 1, maxLength: 20 })
  .map(s => s.replace(/[^a-z0-9-]/gi, 'a').toLowerCase().slice(0, 20) || 'sk');

const arbKey = fc
  .string({ minLength: 1, maxLength: 16 })
  .map(s => 'sk_' + s.replace(/[^a-z0-9]/gi, 'k').slice(0, 13));

const arbValue = fc.oneof(fc.string(), fc.integer(), fc.boolean());

const arbSideEffectType = fc.constantFrom(
  'file_write' as const,
  'db_operation' as const,
  'api_call' as const,
);

const arbDescription = fc.string({ minLength: 1, maxLength: 40 }).map(s => s.trim() || 'desc');


/* ─── Property 21: 上下文隔离 ─── */
/* **Validates: Requirements 9.1, 9.2** */

describe('Feature: plugin-skill-system, Property 21: 上下文隔离', () => {
  it('modifying one context state does not affect another context state', () => {
    fc.assert(
      fc.property(
        arbId,
        arbId,
        arbKey,
        arbValue,
        (id1, id2, key, value) => {
          const ctx1 = createSkillContext(id1);
          const ctx2 = createSkillContext(id2);

          // Modify ctx1's state
          ctx1.state[key] = value;

          // ctx2's state should be unaffected
          expect(ctx2.state[key]).toBeUndefined();
          expect(Object.keys(ctx2.state)).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each context has independent input/output/state/sideEffects', () => {
    fc.assert(
      fc.property(
        arbId,
        arbId,
        arbKey,
        arbValue,
        (id1, id2, key, value) => {
          const ctx1 = createSkillContext(id1);
          const ctx2 = createSkillContext(id2);

          ctx1.input[key] = value;
          ctx1.output[key] = value;
          ctx1.state[key] = value;
          recordSideEffect(ctx1, {
            type: 'file_write',
            description: 'test',
            reversible: true,
          });

          // ctx2 should be completely clean
          expect(Object.keys(ctx2.input)).toHaveLength(0);
          expect(Object.keys(ctx2.output)).toHaveLength(0);
          expect(Object.keys(ctx2.state)).toHaveLength(0);
          expect(ctx2.sideEffects).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('contexts created with the same skillId are still independent', () => {
    fc.assert(
      fc.property(
        arbId,
        arbKey,
        arbValue,
        (id, key, value) => {
          const ctx1 = createSkillContext(id);
          const ctx2 = createSkillContext(id);

          ctx1.state[key] = value;

          expect(ctx2.state[key]).toBeUndefined();
          expect(ctx1.skillId).toBe(ctx2.skillId);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 22: 副作用记录 ─── */
/* **Validates: Requirements 9.3** */

describe('Feature: plugin-skill-system, Property 22: 副作用记录', () => {
  it('recordSideEffect appends to sideEffects with type, description, and timestamp', () => {
    fc.assert(
      fc.property(
        arbId,
        arbSideEffectType,
        arbDescription,
        fc.boolean(),
        (skillId, type, description, reversible) => {
          const ctx = createSkillContext(skillId);

          recordSideEffect(ctx, { type, description, reversible });

          expect(ctx.sideEffects).toHaveLength(1);

          const effect = ctx.sideEffects[0];
          expect(effect.type).toBe(type);
          expect(effect.description).toBe(description);
          expect(effect.reversible).toBe(reversible);
          expect(typeof effect.timestamp).toBe('string');
          expect(effect.timestamp.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('multiple side effects are recorded in order', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.array(
          fc.tuple(arbSideEffectType, arbDescription, fc.boolean()),
          { minLength: 1, maxLength: 8 },
        ),
        (skillId, effects) => {
          const ctx = createSkillContext(skillId);

          for (const [type, description, reversible] of effects) {
            recordSideEffect(ctx, { type, description, reversible });
          }

          expect(ctx.sideEffects).toHaveLength(effects.length);

          for (let i = 0; i < effects.length; i++) {
            const [type, description, reversible] = effects[i];
            expect(ctx.sideEffects[i].type).toBe(type);
            expect(ctx.sideEffects[i].description).toBe(description);
            expect(ctx.sideEffects[i].reversible).toBe(reversible);
            expect(typeof ctx.sideEffects[i].timestamp).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('side effects on one context do not leak to another', () => {
    fc.assert(
      fc.property(
        arbId,
        arbId,
        arbSideEffectType,
        arbDescription,
        (id1, id2, type, desc) => {
          const ctx1 = createSkillContext(id1);
          const ctx2 = createSkillContext(id2);

          recordSideEffect(ctx1, { type, description: desc, reversible: true });

          expect(ctx1.sideEffects).toHaveLength(1);
          expect(ctx2.sideEffects).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
