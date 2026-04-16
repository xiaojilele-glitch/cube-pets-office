/**
 * Feature: sandbox-live-preview, Property 2: 重试缓冲区溢出保护
 *
 * 对任意日志条目序列，RetryBuffer 中缓冲的总数据量 SHALL 不超过 64KB（65536 字节）。
 * 当缓冲区已满时，新条目应被丢弃（buffer 方法返回 false）。
 * 重试延迟应遵循指数退避：第 n 次重试的延迟为 baseDelayMs * 2^n。
 *
 * **Validates: Requirements 1.5**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { RetryBuffer, type LogBufferEntry } from "./retry-buffer.js";

const MAX_BUFFER_SIZE = 65536;

const arbEntry = fc
  .record({
    missionId: fc.constant("m-1"),
    jobId: fc.constant("j-1"),
    stepIndex: fc.nat(100),
    stream: fc.constantFrom<"stdout" | "stderr">("stdout", "stderr"),
    data: fc.string({ minLength: 0, maxLength: 10240 }),
    timestamp: fc.constant(new Date().toISOString()),
  })
  .map(r => r as LogBufferEntry);

const arbEntries = fc.array(arbEntry, { minLength: 1, maxLength: 50 });

describe("Property 2: 重试缓冲区溢出保护", () => {
  it("totalBytes never exceeds maxBufferSize after any sequence of buffer() calls", () => {
    fc.assert(
      fc.property(arbEntries, entries => {
        const buf = new RetryBuffer(async () => {}, {
          maxBufferSize: MAX_BUFFER_SIZE,
        });

        for (const entry of entries) {
          buf.buffer(entry);
          expect(buf.totalBytes).toBeLessThanOrEqual(MAX_BUFFER_SIZE);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("buffer() returns false when adding would exceed maxBufferSize", () => {
    fc.assert(
      fc.property(arbEntries, entries => {
        const buf = new RetryBuffer(async () => {}, {
          maxBufferSize: MAX_BUFFER_SIZE,
        });

        for (const entry of entries) {
          const bytesBefore = buf.totalBytes;
          const entryBytes = Buffer.byteLength(entry.data, "utf8");
          const result = buf.buffer(entry);

          if (bytesBefore + entryBytes > MAX_BUFFER_SIZE) {
            expect(result).toBe(false);
            expect(buf.totalBytes).toBe(bytesBefore);
          } else {
            expect(result).toBe(true);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("retry delays follow exponential backoff: baseDelayMs * 2^attempt", async () => {
    const baseDelayMs = 100;
    const maxRetries = 3;
    const delays: number[] = [];

    const failSend = async () => {
      throw new Error("unreachable");
    };
    const captureSleep = async (ms: number) => {
      delays.push(ms);
    };

    const buf = new RetryBuffer(failSend, {
      maxBufferSize: MAX_BUFFER_SIZE,
      maxRetries,
      baseDelayMs,
      sleep: captureSleep,
    });

    buf.buffer({
      missionId: "m-1",
      jobId: "j-1",
      stepIndex: 0,
      stream: "stdout",
      data: "test",
      timestamp: new Date().toISOString(),
    });

    await buf.retryAll();

    expect(delays).toHaveLength(maxRetries);
    for (let i = 0; i < maxRetries; i++) {
      expect(delays[i]).toBe(baseDelayMs * 2 ** i);
    }
  });
});
