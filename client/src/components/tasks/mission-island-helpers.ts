import type {
  MissionTaskSummary,
  MissionTaskDetail,
  TaskTimelineEvent,
} from "@/lib/tasks-store";
import type { ViewportTier } from "@/hooks/useViewportTier";
import { getAgentEmoji } from "@/lib/agent-config";

/**
 * Select the most relevant mission to display on the island.
 * Priority: running > waiting > most recently created (createdAt descending).
 * Returns null for an empty list.
 */
export function selectDisplayMission(
  tasks: MissionTaskSummary[],
): MissionTaskSummary | null {
  if (tasks.length === 0) return null;

  const running = tasks.find((t) => t.status === "running");
  if (running) return running;

  const waiting = tasks.find((t) => t.status === "waiting");
  if (waiting) return waiting;

  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  return sorted[0] ?? null;
}

/**
 * Truncate a title string to `maxLength` characters, appending '…' when truncated.
 */
export function truncateTitle(title: string, maxLength: number = 40): string {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength - 1).trimEnd() + "\u2026";
}

/**
 * Extract active agents (working / thinking) from a mission detail,
 * returning at most `maxCount` entries with id and emoji.
 */
export function extractActiveAgents(
  detail: MissionTaskDetail,
  maxCount: number = 3,
): Array<{ id: string; emoji: string }> {
  return detail.agents
    .filter((a) => a.status === "working" || a.status === "thinking")
    .slice(0, maxCount)
    .map((a) => ({ id: a.id, emoji: getAgentEmoji(a.id) }));
}

/**
 * Map a viewport tier to the island scale factor.
 */
export function getIslandScale(tier: ViewportTier): number {
  switch (tier) {
    case "desktop":
      return 1.0;
    case "tablet":
      return 0.85;
    case "mobile":
      return 0.7;
  }
}

/**
 * Return the most recent 10 timeline events sorted by time descending.
 */
export function sliceRecentEvents(
  events: TaskTimelineEvent[],
): TaskTimelineEvent[] {
  return [...events].sort((a, b) => b.time - a.time).slice(0, 10);
}
