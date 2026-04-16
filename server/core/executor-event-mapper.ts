/**
 * executor-event-mapper.ts — Pure mapping from ExecutorEvent types to Mission state actions.
 *
 * Extracted from the `/api/executor/events` route handler to enable property-based testing.
 * The mapping is mode-agnostic: mock and real events follow the same rules.
 */

import type { ExecutorEventType } from "../../shared/executor/contracts.js";

// ─── Result Types ───────────────────────────────────────────────────────────

export type EventMappingResult =
  | { action: "running"; progress: number }
  | { action: "done"; summary: string }
  | { action: "failed"; error: string }
  | { action: "cancelled"; reason: string }
  | { action: "progress"; progress: number }
  | { action: "log"; message: string }
  | { action: "log_stream" }
  | { action: "screenshot" }
  | { action: "waiting" }
  | { action: "unknown" };

// ─── Input ──────────────────────────────────────────────────────────────────

export interface EventMappingInput {
  type: ExecutorEventType | string;
  status?: string;
  progress?: number;
  summary?: string;
  message?: string;
  detail?: string;
  errorCode?: string;
  log?: { level: string; message: string };
}

// ─── Pure Mapping Function ──────────────────────────────────────────────────

/**
 * Maps an executor event to the corresponding Mission state action.
 *
 * Rules (from Requirements 4.1–4.6, 7.4):
 * - job.started  → action "running"
 * - job.progress → action "progress" with clamped progress (0–100)
 * - job.completed → action "done"
 * - job.failed → action "failed"
 * - job.cancelled → action "cancelled"
 * - job.log → action "log"
 * - job.log_stream → action "log_stream"
 * - job.screenshot → action "screenshot"
 * - job.waiting → action "waiting"
 * - anything else → action "unknown"
 *
 * Progress clamping: if event.progress is a number, clamp to [0, 100].
 * If not a number, default to 0.
 */
export function mapExecutorEventToAction(
  input: EventMappingInput
): EventMappingResult {
  const clampedProgress =
    typeof input.progress === "number"
      ? Math.max(0, Math.min(100, input.progress))
      : 0;

  const summaryText =
    input.summary?.trim() ||
    input.detail?.trim() ||
    input.message?.trim() ||
    "";

  switch (input.type) {
    case "job.started":
      return { action: "running", progress: clampedProgress };

    case "job.progress":
      return { action: "progress", progress: clampedProgress };

    case "job.completed":
      return { action: "done", summary: summaryText };

    case "job.failed":
      return {
        action: "failed",
        error: summaryText || input.errorCode || "unknown error",
      };

    case "job.cancelled":
      return {
        action: "cancelled",
        reason: summaryText || input.errorCode || "cancelled",
      };

    case "job.log":
      return {
        action: "log",
        message: input.log?.message?.trim() || summaryText,
      };

    case "job.log_stream":
      return { action: "log_stream" };

    case "job.screenshot":
      return { action: "screenshot" };

    case "job.waiting":
      return { action: "waiting" };

    default:
      // Also handle status-based fallback (job.accepted, job.heartbeat, etc.)
      if (input.status === "completed") {
        return { action: "done", summary: summaryText };
      }
      if (input.status === "failed") {
        return { action: "failed", error: summaryText || "unknown error" };
      }
      if (input.status === "cancelled") {
        return { action: "cancelled", reason: summaryText || "cancelled" };
      }
      if (input.status === "waiting") {
        return { action: "waiting" };
      }
      return { action: "unknown" };
  }
}
