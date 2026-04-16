/**
 * Property 8: 日志批量约束
 *
 * For any sequence of log lines, each batch produced by LogBatcher should not
 * exceed 4KB and batches should flush within 500ms.
 *
 * **Validates: Requirements 2.6**
 *
 * Feature: lobster-executor-real, Property 8: 日志批量约束
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

import { LogBatcher } from "./log-batcher.js";

/* ─── Constants ─── */

const MAX_SIZE_BYTES = 4096;
const MAX_INTERVAL_MS = 500;

/* ─── Arbitraries ─── */

/** Arbitrary log line — mix of ASCII and multi-byte chars, up to ~1KB each */
const arbLogLine = fc.string({ minLength: 1, maxLength: 256 });

/** Sequence of log lines (1–50 lines) */
const arbLogLines = fc.array(arbLogLine, { minLength: 1, maxLength: 50 });

/* ─── Tests ─── */

describe("Property 8: 日志批量约束", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("each batch size does not exceed maxSizeBytes unless it contains a single oversized line", () => {
    fc.assert(
      fc.property(arbLogLines, lines => {
        const batches: string[][] = [];
        const batcher = new LogBatcher(
          b => batches.push([...b]),
          MAX_INTERVAL_MS,
          MAX_SIZE_BYTES
        );

        for (const line of lines) {
          batcher.push(line);
        }
        batcher.destroy();

        for (const batch of batches) {
          const totalBytes = batch.reduce(
            (sum, l) => sum + Buffer.byteLength(l, "utf8"),
            0
          );
          if (batch.length === 1) {
            // A single-line batch is always allowed (even if oversized)
            expect(totalBytes).toBeGreaterThan(0);
          } else {
            expect(totalBytes).toBeLessThanOrEqual(MAX_SIZE_BYTES);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("all pushed lines appear in flushed batches (no data loss)", () => {
    fc.assert(
      fc.property(arbLogLines, lines => {
        const batches: string[][] = [];
        const batcher = new LogBatcher(
          b => batches.push([...b]),
          MAX_INTERVAL_MS,
          MAX_SIZE_BYTES
        );

        for (const line of lines) {
          batcher.push(line);
        }
        batcher.destroy();

        const allFlushed = batches.flat();
        expect(allFlushed).toEqual(lines);
      }),
      { numRuns: 200 }
    );
  });

  it("line order across batches matches push order", () => {
    fc.assert(
      fc.property(arbLogLines, lines => {
        const batches: string[][] = [];
        const batcher = new LogBatcher(
          b => batches.push([...b]),
          MAX_INTERVAL_MS,
          MAX_SIZE_BYTES
        );

        for (const line of lines) {
          batcher.push(line);
        }
        batcher.destroy();

        const allFlushed = batches.flat();
        expect(allFlushed.length).toBe(lines.length);
        for (let i = 0; i < lines.length; i++) {
          expect(allFlushed[i]).toBe(lines[i]);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("timer-based flush fires within maxIntervalMs", () => {
    fc.assert(
      fc.property(arbLogLines, lines => {
        const batches: string[][] = [];
        const batcher = new LogBatcher(
          b => batches.push([...b]),
          MAX_INTERVAL_MS,
          MAX_SIZE_BYTES
        );

        // Push all lines
        for (const line of lines) {
          batcher.push(line);
        }

        // Advance time by maxIntervalMs — any buffered lines should flush
        vi.advanceTimersByTime(MAX_INTERVAL_MS);

        // All lines should now be flushed (via size triggers + timer)
        const allFlushed = batches.flat();
        expect(allFlushed).toEqual(lines);

        batcher.destroy();
      }),
      { numRuns: 200 }
    );
  });
});
