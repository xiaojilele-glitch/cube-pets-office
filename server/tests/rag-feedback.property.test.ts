/**
 * Feedback Layer Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 18: utilizationRate = usedCount/injectedCount
 * Property 19: Explicit feedback fully recorded; irrelevant chunks in hard negative set
 * Property 20: Consecutive low utilization triggers RETRIEVAL_GAP_DETECTED alert
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FeedbackCollector } from '../rag/feedback/feedback-collector.js';
import { HardNegativeSet } from '../rag/feedback/hard-negative-set.js';
import { WeightTuner } from '../rag/feedback/weight-tuner.js';

const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const FB_PATH = resolve(__dn, '../../data/test_feedback.json');
const HN_PATH = resolve(__dn, '../../data/test_hard_neg.json');

function cleanup() {
  for (const p of [FB_PATH, HN_PATH]) {
    if (existsSync(p)) unlinkSync(p);
  }
}

/* ---- Property 18: utilizationRate = usedCount/injectedCount ---- */

describe('Property 18: utilizationRate equals usedCount divided by injectedCount', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('for any N injected and M used (M <= N, N > 0), utilizationRate = M/N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (injected, used) => {
          const actualUsed = Math.min(used, injected);
          const collector = new FeedbackCollector(FB_PATH);
          const record = collector.recordImplicit('task-1', 'agent-1', 'proj-1', injected, actualUsed);
          const expected = actualUsed / injected;
          expect(record.utilizationRate).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('when injectedCount is 0, utilizationRate is 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (used) => {
        const collector = new FeedbackCollector(FB_PATH);
        const record = collector.recordImplicit('task-1', 'agent-1', 'proj-1', 0, used);
        expect(record.utilizationRate).toBe(0);
      }),
      { numRuns: 15 },
    );
  });
});


/* ---- Property 19: Explicit feedback recorded; irrelevant in hard negative set ---- */

describe('Property 19: Explicit feedback fully recorded with hard negatives', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('explicit feedback is fully recorded and irrelevant chunks appear in hard negative set', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^chunk-[a-z0-9]{3,6}$/), { minLength: 0, maxLength: 5 }),
        fc.uniqueArray(fc.stringMatching(/^chunk-[a-z0-9]{3,6}$/), { minLength: 1, maxLength: 5 }),
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        (helpfulIds, irrelevantIds, missingCtx) => {
          const collector = new FeedbackCollector(FB_PATH);
          const hardNeg = new HardNegativeSet(HN_PATH);

          const record = collector.recordExplicit({
            taskId: 'task-1',
            agentId: 'agent-1',
            projectId: 'proj-1',
            helpfulChunkIds: helpfulIds,
            irrelevantChunkIds: irrelevantIds,
            missingContext: missingCtx,
          });

          expect(record.helpfulChunkIds).toEqual(helpfulIds);
          expect(record.irrelevantChunkIds).toEqual(irrelevantIds);
          expect(record.missingContext).toBe(missingCtx);

          hardNeg.addBatch(irrelevantIds);

          for (const id of irrelevantIds) {
            expect(hardNeg.isNegative(id)).toBe(true);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/* ---- Property 20: Consecutive low utilization triggers alert ---- */

describe('Property 20: Consecutive low utilization triggers RETRIEVAL_GAP_DETECTED', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('consecutive low utilization rates trigger RETRIEVAL_GAP_DETECTED alert', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 15 }),
        (consecutiveCount) => {
          const collector = new FeedbackCollector(FB_PATH);
          const threshold = 5;
          const tuner = new WeightTuner({
            lowUtilizationThreshold: 0.3,
            consecutiveThreshold: threshold,
          });

          let alertFired = false;
          tuner.onAlert((alert) => {
            alertFired = true;
            expect(alert.type).toBe('RETRIEVAL_GAP_DETECTED');
            expect(alert.consecutiveCount).toBe(threshold);
          });

          for (let i = 0; i < consecutiveCount; i++) {
            collector.recordImplicit(`task-${i}`, 'agent-1', 'proj-1', 10, 1);
          }

          const triggered = tuner.check(collector);

          if (consecutiveCount >= threshold) {
            expect(triggered).toBe(true);
            expect(alertFired).toBe(true);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it('mixed utilization rates (some high) do not trigger alert', () => {
    const collector = new FeedbackCollector(FB_PATH);
    const tuner = new WeightTuner({ lowUtilizationThreshold: 0.3, consecutiveThreshold: 5 });

    let alertFired = false;
    tuner.onAlert(() => { alertFired = true; });

    collector.recordImplicit('t1', 'a1', 'p1', 10, 1);  // 0.1
    collector.recordImplicit('t2', 'a1', 'p1', 10, 1);  // 0.1
    collector.recordImplicit('t3', 'a1', 'p1', 10, 8);  // 0.8 (high)
    collector.recordImplicit('t4', 'a1', 'p1', 10, 1);  // 0.1
    collector.recordImplicit('t5', 'a1', 'p1', 10, 1);  // 0.1

    const triggered = tuner.check(collector);
    expect(triggered).toBe(false);
    expect(alertFired).toBe(false);
  });
});
