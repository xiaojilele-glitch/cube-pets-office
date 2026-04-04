/**
 * Feature: sandbox-live-preview, Property 5: 滚动日志缓冲区大小不变量
 *
 * 对任意日志条目追加序列，SandboxRelay 的 logBuffer 中每个 missionId
 * 对应的条目数 SHALL 不超过 200。当追加第 201 条时，最旧的条目应被移除，
 * 缓冲区长度保持 200。缓冲区中条目的顺序应与追加顺序一致。
 *
 * **Validates: Requirements 3.4**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { SandboxRelay, type LogBufferEntry } from "../core/sandbox-relay.js";

const MAX_LINES = 200;

const arbEntry = (missionId: string) =>
  fc
    .record({
      missionId: fc.constant(missionId),
      jobId: fc.constant("j-1"),
      stepIndex: fc.nat(50),
      stream: fc.constantFrom<"stdout" | "stderr">("stdout", "stderr"),
      data: fc.string({ minLength: 1, maxLength: 200 }),
      timestamp: fc.constant(new Date().toISOString()),
    })
    .map((r) => r as LogBufferEntry);

const arbEntries = fc.array(arbEntry("m-1"), { minLength: 1, maxLength: 500 });

describe("Property 5: 滚动日志缓冲区大小不变量", () => {
  it("buffer size never exceeds 200 for any append sequence", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const relay = new SandboxRelay();
        for (const entry of entries) {
          relay.appendLog(entry);
          const history = relay.getLogHistory("m-1");
          expect(history.length).toBeLessThanOrEqual(MAX_LINES);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("oldest entries are evicted when buffer exceeds 200", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const relay = new SandboxRelay();
        for (const entry of entries) {
          relay.appendLog(entry);
        }
        const history = relay.getLogHistory("m-1");

        if (entries.length > MAX_LINES) {
          expect(history.length).toBe(MAX_LINES);
          // The last MAX_LINES entries should be the ones in the buffer
          const expected = entries.slice(-MAX_LINES);
          for (let i = 0; i < MAX_LINES; i++) {
            expect(history[i].data).toBe(expected[i].data);
          }
        } else {
          expect(history.length).toBe(entries.length);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("buffer order matches append order", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const relay = new SandboxRelay();
        for (const entry of entries) {
          relay.appendLog(entry);
        }
        const history = relay.getLogHistory("m-1");
        const kept = entries.slice(-MAX_LINES);

        expect(history.length).toBe(kept.length);
        for (let i = 0; i < history.length; i++) {
          expect(history[i].data).toBe(kept[i].data);
          expect(history[i].stream).toBe(kept[i].stream);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("clearMission removes all entries for that mission", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const relay = new SandboxRelay();
        for (const entry of entries) {
          relay.appendLog(entry);
        }
        relay.clearMission("m-1");
        expect(relay.getLogHistory("m-1")).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it("getLogHistory returns empty array for unknown mission", () => {
    const relay = new SandboxRelay();
    expect(relay.getLogHistory("nonexistent")).toHaveLength(0);
  });
});
