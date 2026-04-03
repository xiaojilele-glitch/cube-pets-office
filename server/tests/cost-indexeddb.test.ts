/**
 * Property 11: IndexedDB 往返一致性
 *
 * For any valid CostRecord, writing it to IndexedDB via the browser cost store
 * and reading it back should produce an equivalent object.
 *
 * Uses fake-indexeddb to provide an in-memory IndexedDB implementation.
 *
 * Feature: cost-observability, Property 11: IndexedDB 往返一致性
 * Validates: Requirements 12.2, 12.3
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  PRICING_TABLE,
  DEFAULT_PRICING,
  estimateCost,
} from '../../shared/cost.js';
import type { CostRecord } from '../../shared/cost.js';

// Dynamic imports — reset per test for fresh IndexedDB
let recordBrowserCost: typeof import('../../client/src/lib/browser-cost-store').recordBrowserCost;
let loadBrowserCostRecords: typeof import('../../client/src/lib/browser-cost-store').loadBrowserCostRecords;
let clearBrowserCostRecords: typeof import('../../client/src/lib/browser-cost-store').clearBrowserCostRecords;

const protoKeys = new Set(Object.getOwnPropertyNames(Object.prototype));
const knownModels = Object.keys(PRICING_TABLE);

const arbModel = fc.oneof(
  fc.constantFrom(...knownModels),
  fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !protoKeys.has(s)),
);
const arbTokens = fc.nat({ max: 1_000_000 });

beforeEach(async () => {
  // Reset fake-indexeddb
  const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
  globalThis.indexedDB = new FDBFactory();
  (globalThis as any).window = globalThis;

  // Clear module cache so the browser-cost-store gets a fresh DB connection
  vi.resetModules();

  const mod = await import('../../client/src/lib/browser-cost-store');
  recordBrowserCost = mod.recordBrowserCost;
  loadBrowserCostRecords = mod.loadBrowserCostRecords;
  clearBrowserCostRecords = mod.clearBrowserCostRecords;
});

describe('Property 11: IndexedDB 往返一致性', () => {
  it('should produce equivalent CostRecord after write + read round-trip', async () => {
    // Run fewer iterations since each involves async IndexedDB operations
    await fc.assert(
      fc.asyncProperty(
        arbModel,
        arbTokens,
        arbTokens,
        fc.nat({ max: 60_000 }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        async (model, tokensIn, tokensOut, durationMs, agentId, missionId, sessionId) => {
          await clearBrowserCostRecords();

          const pricing = Object.hasOwn(PRICING_TABLE, model) ? PRICING_TABLE[model] : DEFAULT_PRICING;
          const id = `test-${Math.random().toString(36).slice(2)}`;

          const written = await recordBrowserCost({
            id,
            timestamp: Date.now(),
            model,
            tokensIn,
            tokensOut,
            durationMs,
            agentId,
            missionId,
            sessionId,
          });

          const loaded = await loadBrowserCostRecords();
          expect(loaded).toHaveLength(1);

          const read = loaded[0];
          expect(read.id).toBe(written.id);
          expect(read.model).toBe(model);
          expect(read.tokensIn).toBe(tokensIn);
          expect(read.tokensOut).toBe(tokensOut);
          expect(read.durationMs).toBe(durationMs);
          expect(read.unitPriceIn).toBe(pricing.input);
          expect(read.unitPriceOut).toBe(pricing.output);
          expect(read.actualCost).toBeCloseTo(estimateCost(model, tokensIn, tokensOut), 12);
          expect(read.agentId).toBe(agentId);
          expect(read.missionId).toBe(missionId);
          expect(read.sessionId).toBe(sessionId);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should restore multiple records after page refresh simulation', async () => {
    await clearBrowserCostRecords();

    // Write 5 records
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const rec = await recordBrowserCost({
        id: `rec-${i}`,
        timestamp: Date.now() + i,
        model: 'gpt-4o-mini',
        tokensIn: 100 * (i + 1),
        tokensOut: 50 * (i + 1),
        durationMs: 10,
      });
      ids.push(rec.id);
    }

    // Simulate "page refresh" by loading all records
    const loaded = await loadBrowserCostRecords();
    expect(loaded).toHaveLength(5);

    const loadedIds = loaded.map((r) => r.id).sort();
    expect(loadedIds).toEqual(ids.sort());
  });
});
