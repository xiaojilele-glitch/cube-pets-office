/**
 * Property 12: 并发 Job 限制
 *
 * For any number of concurrent acquire calls exceeding maxConcurrent,
 * the number of simultaneously held permits should never exceed maxConcurrent.
 *
 * **Validates: Requirements 4.5**
 *
 * Feature: lobster-executor-real, Property 12: 并发 Job 限制
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ConcurrencyLimiter } from "./concurrency-limiter.js";

/* ─── Arbitraries ─── */

const arbMaxConcurrent = fc.integer({ min: 1, max: 10 });
const arbNumTasks = fc.integer({ min: 1, max: 50 });

/* ─── Tests ─── */

describe("Property 12: 并发 Job 限制", () => {
  it("concurrent count never exceeds maxConcurrent", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMaxConcurrent,
        arbNumTasks,
        async (maxConcurrent, numTasks) => {
          const limiter = new ConcurrencyLimiter(maxConcurrent);

          let concurrent = 0;
          let peakConcurrent = 0;
          let completed = 0;

          const tasks = Array.from({ length: numTasks }, async () => {
            await limiter.acquire();
            concurrent++;
            peakConcurrent = Math.max(peakConcurrent, concurrent);

            // Invariant: at no point should concurrent exceed maxConcurrent
            expect(concurrent).toBeLessThanOrEqual(maxConcurrent);

            // Yield to allow other tasks to attempt acquire concurrently
            await Promise.resolve();

            concurrent--;
            completed++;
            limiter.release();
          });

          await Promise.all(tasks);

          // All tasks ran
          expect(completed).toBe(numTasks);
          // Peak never exceeded limit
          expect(peakConcurrent).toBeLessThanOrEqual(maxConcurrent);
        }
      ),
      { numRuns: 100 }
    );
  }, 30_000);
});
