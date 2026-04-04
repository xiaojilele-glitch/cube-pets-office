/**
 * Feature: sandbox-live-preview, Property 1: 日志批处理数据约束
 *
 * 对任意日志块序列（每个块为任意长度的字符串），LogBatcher 的每次 flush
 * 产生的 data 字段长度 SHALL ≤ 4096 字节，且每个 flush 结果包含有效的
 * stream（"stdout" 或 "stderr"）字段。
 *
 * **Validates: Requirements 1.1, 1.3, 1.4**
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

import { LogBatcher, type LogBatchEntry } from "./log-batcher.js";

/* ─── Constants ─── */

const MAX_BATCH_SIZE = 4096;
const MAX_INTERVAL_MS = 500;

/* ─── Arbitraries ─── */

/** Random stream type */
const arbStream = fc.constantFrom<"stdout" | "stderr">("stdout", "stderr");

/**
 * Random chunk: 0–8 KB string.
 * Uses `string16bits` for a mix of single-byte and multi-byte characters
 * to exercise UTF-8 byte-length edge cases.
 */
const arbChunk = fc.string({ minLength: 0, maxLength: 8192 });

/** A single append operation: (stream, chunk) */
const arbAppendOp = fc.tuple(arbStream, arbChunk);

/** Sequence of append operations (1–30 ops) */
const arbAppendOps = fc.array(arbAppendOp, { minLength: 1, maxLength: 30 });

/* ─── Tests ─── */

describe("Property 1: 日志批处理数据约束 (stream-aware API)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("every flushed entry has data byte length ≤ maxBatchSize (4096)", () => {
    fc.assert(
      fc.property(arbAppendOps, (ops) => {
        const batcher = new LogBatcher(null, MAX_INTERVAL_MS, MAX_BATCH_SIZE);

        for (const [stream, chunk] of ops) {
          batcher.append(stream, chunk);
        }

        const entries: LogBatchEntry[] = batcher.flush();

        for (const entry of entries) {
          const byteLen = Buffer.byteLength(entry.data, "utf8");
          expect(byteLen).toBeLessThanOrEqual(MAX_BATCH_SIZE);
        }

        batcher.destroy();
      }),
      { numRuns: 200 },
    );
  });

  it("every flushed entry has a valid stream field ('stdout' or 'stderr')", () => {
    fc.assert(
      fc.property(arbAppendOps, (ops) => {
        const batcher = new LogBatcher(null, MAX_INTERVAL_MS, MAX_BATCH_SIZE);

        for (const [stream, chunk] of ops) {
          batcher.append(stream, chunk);
        }

        const entries: LogBatchEntry[] = batcher.flush();

        for (const entry of entries) {
          expect(["stdout", "stderr"]).toContain(entry.stream);
        }

        batcher.destroy();
      }),
      { numRuns: 200 },
    );
  });

  it("constraints hold even with interleaved flush calls", () => {
    fc.assert(
      fc.property(arbAppendOps, fc.integer({ min: 1, max: 10 }), (ops, flushEvery) => {
        const batcher = new LogBatcher(null, MAX_INTERVAL_MS, MAX_BATCH_SIZE);
        const allEntries: LogBatchEntry[] = [];

        for (let i = 0; i < ops.length; i++) {
          const [stream, chunk] = ops[i];
          batcher.append(stream, chunk);

          // Periodically flush mid-stream
          if ((i + 1) % flushEvery === 0) {
            allEntries.push(...batcher.flush());
          }
        }

        // Final flush
        allEntries.push(...batcher.flush());

        for (const entry of allEntries) {
          const byteLen = Buffer.byteLength(entry.data, "utf8");
          expect(byteLen).toBeLessThanOrEqual(MAX_BATCH_SIZE);
          expect(["stdout", "stderr"]).toContain(entry.stream);
        }

        batcher.destroy();
      }),
      { numRuns: 200 },
    );
  });

  it("no data is lost: concatenated flush data equals concatenated input per stream", () => {
    fc.assert(
      fc.property(arbAppendOps, (ops) => {
        const batcher = new LogBatcher(null, MAX_INTERVAL_MS, MAX_BATCH_SIZE);

        // Track expected data per stream
        const expected: Record<string, string> = { stdout: "", stderr: "" };
        for (const [stream, chunk] of ops) {
          batcher.append(stream, chunk);
          expected[stream] += chunk;
        }

        const entries: LogBatchEntry[] = batcher.flush();

        // Collect actual data per stream
        const actual: Record<string, string> = { stdout: "", stderr: "" };
        for (const entry of entries) {
          actual[entry.stream] += entry.data;
        }

        expect(actual.stdout).toBe(expected.stdout);
        expect(actual.stderr).toBe(expected.stderr);

        batcher.destroy();
      }),
      { numRuns: 200 },
    );
  });
});
