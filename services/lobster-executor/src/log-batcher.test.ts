import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LogBatcher } from "./log-batcher.js";

describe("LogBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes when size limit is exceeded", () => {
    const batches: string[][] = [];
    // 20 bytes max
    const batcher = new LogBatcher((lines) => batches.push(lines), 500, 20);

    // Each "line-X" = 6 bytes. Push 4 lines → 6+6=12, then 12+6=18, then 18+6=24 > 20 → flush
    batcher.push("line-0"); // 6 bytes, total 6
    batcher.push("line-1"); // 6 bytes, total 12
    batcher.push("line-2"); // 6 bytes, total 18
    batcher.push("line-3"); // 6 bytes, 18+6=24 > 20 → flush first, then start new batch

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["line-0", "line-1", "line-2"]);

    batcher.destroy();
    // destroy flushes the remaining line
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(["line-3"]);
  });

  it("auto-flushes after maxIntervalMs", () => {
    const batches: string[][] = [];
    const batcher = new LogBatcher((lines) => batches.push(lines), 500, 4096);

    batcher.push("hello");
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(500);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["hello"]);

    batcher.destroy();
  });

  it("resets timer on each push", () => {
    const batches: string[][] = [];
    const batcher = new LogBatcher((lines) => batches.push(lines), 500, 4096);

    batcher.push("a");
    vi.advanceTimersByTime(400);
    // Timer reset by second push
    batcher.push("b");
    vi.advanceTimersByTime(400);
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["a", "b"]);

    batcher.destroy();
  });

  it("flush() is a no-op when buffer is empty", () => {
    const onFlush = vi.fn();
    const batcher = new LogBatcher(onFlush, 500, 4096);

    batcher.flush();
    expect(onFlush).not.toHaveBeenCalled();

    batcher.destroy();
  });

  it("destroy() flushes remaining lines", () => {
    const batches: string[][] = [];
    const batcher = new LogBatcher((lines) => batches.push(lines), 500, 4096);

    batcher.push("remaining");
    batcher.destroy();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["remaining"]);
  });

  it("push() is a no-op after destroy()", () => {
    const onFlush = vi.fn();
    const batcher = new LogBatcher(onFlush, 500, 4096);

    batcher.destroy();
    onFlush.mockClear();

    batcher.push("ignored");
    vi.advanceTimersByTime(1000);

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("handles multi-byte UTF-8 characters correctly", () => {
    const batches: string[][] = [];
    // 16 bytes max
    const batcher = new LogBatcher((lines) => batches.push(lines), 500, 16);

    // "你好世界" = 12 bytes in UTF-8
    batcher.push("你好世界");
    // "测试" = 6 bytes → 12 + 6 = 18 > 16 → should flush first batch
    batcher.push("测试");

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["你好世界"]);

    batcher.destroy();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(["测试"]);
  });

  it("a single line larger than maxSizeBytes still gets flushed", () => {
    const batches: string[][] = [];
    const batcher = new LogBatcher((lines) => batches.push(lines), 500, 8);

    // This line is > 8 bytes but it's the first in the batch, so it goes in
    batcher.push("this is a very long line");
    // No flush yet because it's the only line in the batch
    expect(batches).toHaveLength(0);

    batcher.destroy();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(["this is a very long line"]);
  });
});
