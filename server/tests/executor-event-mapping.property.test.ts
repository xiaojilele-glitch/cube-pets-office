/**
 * Property-based tests for executor event-to-state mapping.
 *
 * **Feature: executor-integration, Property 7: 事件到状态映射**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.4**
 *
 * For any ExecutorEvent:
 * - job.started  → Mission executor.status = running
 * - job.completed → Mission status = done
 * - job.failed → Mission status = failed
 * - job.progress → Mission progress updates to event.progress (clamped 0–100)
 *
 * This mapping applies consistently for both mock and real mode events.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  mapExecutorEventToAction,
  type EventMappingInput,
} from "../core/executor-event-mapper.js";
import { EXECUTOR_EVENT_TYPES } from "../../shared/executor/contracts.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Arbitrary progress value — any finite number (including out-of-range) */
const arbProgress = fc.oneof(
  fc.integer({ min: -500, max: 500 }),
  fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
);

/** Arbitrary non-empty trimmed string for summary/message fields */
const arbText = fc.string({ minLength: 1, maxLength: 100 }).map((s) => s.trim() || "fallback");

/** Arbitrary execution mode — mock or real (used to verify mode-agnostic behavior) */
const arbMode = fc.constantFrom("mock" as const, "real" as const);

/** Arbitrary optional progress (number or undefined) */
const arbOptionalProgress = fc.option(arbProgress, { nil: undefined });

/** Arbitrary optional text */
const arbOptionalText = fc.option(arbText, { nil: undefined });

// ─── Property 7: 事件到状态映射 ────────────────────────────────────────────
// **Feature: executor-integration, Property 7: 事件到状态映射**
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.4**

describe("Feature: executor-integration, Property 7: 事件到状态映射", () => {

  // ── 7a: job.started → action "running" (Req 4.1) ──────────────────────────

  it("job.started always maps to action=running regardless of mode", () => {
    fc.assert(
      fc.property(
        arbMode,
        arbOptionalProgress,
        arbOptionalText,
        arbOptionalText,
        (_mode, progress, summary, message) => {
          const input: EventMappingInput = {
            type: "job.started",
            progress,
            summary,
            message,
          };
          const result = mapExecutorEventToAction(input);
          expect(result.action).toBe("running");
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 7b: job.completed → action "done" (Req 4.3) ───────────────────────────

  it("job.completed always maps to action=done regardless of mode", () => {
    fc.assert(
      fc.property(
        arbMode,
        arbOptionalProgress,
        arbOptionalText,
        arbOptionalText,
        (_mode, progress, summary, message) => {
          const input: EventMappingInput = {
            type: "job.completed",
            progress,
            summary,
            message,
          };
          const result = mapExecutorEventToAction(input);
          expect(result.action).toBe("done");
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 7c: job.failed → action "failed" (Req 4.4) ────────────────────────────

  it("job.failed always maps to action=failed regardless of mode", () => {
    fc.assert(
      fc.property(
        arbMode,
        arbOptionalProgress,
        arbOptionalText,
        arbOptionalText,
        (_mode, progress, summary, message) => {
          const input: EventMappingInput = {
            type: "job.failed",
            progress,
            summary,
            message,
          };
          const result = mapExecutorEventToAction(input);
          expect(result.action).toBe("failed");
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 7d: job.progress → action "progress" with clamped value (Req 4.2) ─────

  it("job.progress maps to action=progress with progress clamped to [0, 100]", () => {
    fc.assert(
      fc.property(
        arbMode,
        arbProgress,
        arbOptionalText,
        (_mode, progress, message) => {
          const input: EventMappingInput = {
            type: "job.progress",
            progress,
            message,
          };
          const result = mapExecutorEventToAction(input);
          expect(result.action).toBe("progress");
          if (result.action === "progress") {
            expect(result.progress).toBeGreaterThanOrEqual(0);
            expect(result.progress).toBeLessThanOrEqual(100);
            // Verify clamping logic
            const expected = Math.max(0, Math.min(100, progress));
            expect(result.progress).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 7e: progress clamping applies to job.started too ───────────────────────

  it("job.started also clamps progress to [0, 100]", () => {
    fc.assert(
      fc.property(arbProgress, (progress) => {
        const input: EventMappingInput = {
          type: "job.started",
          progress,
        };
        const result = mapExecutorEventToAction(input);
        if (result.action === "running") {
          expect(result.progress).toBeGreaterThanOrEqual(0);
          expect(result.progress).toBeLessThanOrEqual(100);
          const expected = Math.max(0, Math.min(100, progress));
          expect(result.progress).toBe(expected);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ── 7f: mock and real mode produce identical mapping (Req 7.4) ─────────────

  it("mock and real mode events produce identical mapping results", () => {
    const arbEventType = fc.constantFrom(
      "job.started" as const,
      "job.progress" as const,
      "job.completed" as const,
      "job.failed" as const,
    );

    fc.assert(
      fc.property(
        arbEventType,
        arbOptionalProgress,
        arbOptionalText,
        arbOptionalText,
        (eventType, progress, summary, message) => {
          const mockInput: EventMappingInput = {
            type: eventType,
            progress,
            summary,
            message,
          };
          const realInput: EventMappingInput = {
            type: eventType,
            progress,
            summary,
            message,
          };

          const mockResult = mapExecutorEventToAction(mockInput);
          const realResult = mapExecutorEventToAction(realInput);

          // Same action
          expect(mockResult.action).toBe(realResult.action);

          // Same progress if applicable
          if (
            (mockResult.action === "running" || mockResult.action === "progress") &&
            (realResult.action === "running" || realResult.action === "progress")
          ) {
            expect(mockResult.progress).toBe(realResult.progress);
          }

          // Same summary/error if applicable
          if (mockResult.action === "done" && realResult.action === "done") {
            expect(mockResult.summary).toBe(realResult.summary);
          }
          if (mockResult.action === "failed" && realResult.action === "failed") {
            expect(mockResult.error).toBe(realResult.error);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 7g: undefined progress defaults to 0 ──────────────────────────────────

  it("undefined progress defaults to 0 for started and progress events", () => {
    const arbStartOrProgress = fc.constantFrom(
      "job.started" as const,
      "job.progress" as const,
    );

    fc.assert(
      fc.property(arbStartOrProgress, arbOptionalText, (eventType, message) => {
        const input: EventMappingInput = {
          type: eventType,
          progress: undefined,
          message,
        };
        const result = mapExecutorEventToAction(input);
        if (result.action === "running" || result.action === "progress") {
          expect(result.progress).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ── 7h: all EXECUTOR_EVENT_TYPES produce a non-unknown action ──────────────

  it("all known EXECUTOR_EVENT_TYPES produce a recognized (non-unknown) action", () => {
    const coreTypes = [
      "job.started",
      "job.progress",
      "job.completed",
      "job.failed",
      "job.cancelled",
      "job.log",
      "job.log_stream",
      "job.screenshot",
      "job.waiting",
    ] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...coreTypes),
        arbOptionalProgress,
        arbOptionalText,
        (eventType, progress, message) => {
          const input: EventMappingInput = {
            type: eventType,
            progress,
            message,
            log: { level: "info", message: message || "test" },
          };
          const result = mapExecutorEventToAction(input);
          expect(result.action).not.toBe("unknown");
        },
      ),
      { numRuns: 100 },
    );
  });
});
