/**
 * Feature: sandbox-live-preview
 * Property 6: Stderr 视觉区分格式化
 * Property 7: 时间戳显示格式化
 *
 * **Validates: Requirements 4.3, 5.3**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { formatLogLine, formatTimestamp, type LogLine } from "../sandbox-store";

// ---------------------------------------------------------------------------
// Property 6: Stderr 视觉区分格式化
// ---------------------------------------------------------------------------

describe("Property 6: Stderr 视觉区分格式化", () => {
  const arbLogLine = (stream: "stdout" | "stderr") =>
    fc
      .record({
        stepIndex: fc.nat(100),
        stream: fc.constant(stream),
        data: fc.string({ minLength: 0, maxLength: 500 }),
        timestamp: fc.constant(new Date().toISOString()),
      })
      .map((r) => r as LogLine);

  it("stderr lines contain ANSI red escape code \\x1b[31m", () => {
    fc.assert(
      fc.property(arbLogLine("stderr"), (line) => {
        const result = formatLogLine(line);
        expect(result).toContain("\x1b[31m");
        expect(result).toContain("\x1b[0m");
      }),
      { numRuns: 200 },
    );
  });

  it("stdout lines do NOT contain ANSI red escape code", () => {
    fc.assert(
      fc.property(arbLogLine("stdout"), (line) => {
        const result = formatLogLine(line);
        expect(result).not.toContain("\x1b[31m");
      }),
      { numRuns: 200 },
    );
  });

  it("stdout lines return data unchanged", () => {
    fc.assert(
      fc.property(arbLogLine("stdout"), (line) => {
        expect(formatLogLine(line)).toBe(line.data);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: 时间戳显示格式化
// ---------------------------------------------------------------------------

describe("Property 7: 时间戳显示格式化", () => {
  // Generate valid ISO timestamps from integer milliseconds to avoid invalid Date edge cases
  const arbISOTimestamp = fc
    .integer({
      min: new Date("2000-01-01T00:00:00Z").getTime(),
      max: new Date("2099-12-31T23:59:59Z").getTime(),
    })
    .map((ms) => new Date(ms).toISOString());

  it("output is a non-empty string for any valid ISO timestamp", () => {
    fc.assert(
      fc.property(arbISOTimestamp, (iso) => {
        const result = formatTimestamp(iso);
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("output matches HH:MM:SS format", () => {
    fc.assert(
      fc.property(arbISOTimestamp, (iso) => {
        const result = formatTimestamp(iso);
        expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }),
      { numRuns: 200 },
    );
  });

  it("output contains correct hours and minutes from the input", () => {
    fc.assert(
      fc.property(arbISOTimestamp, (iso) => {
        const d = new Date(iso);
        const result = formatTimestamp(iso);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        expect(result).toContain(`${hh}:${mm}`);
      }),
      { numRuns: 200 },
    );
  });
});
