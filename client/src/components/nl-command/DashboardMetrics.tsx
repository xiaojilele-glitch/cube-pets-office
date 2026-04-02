import type { DashboardResponse } from "@shared/nl-command/api";

/**
 * Dashboard key metrics cards: total missions, completion rate,
 * active tasks, and overall risk level.
 *
 * @see Requirements 9.1
 */
export interface DashboardMetricsProps {
  dashboard: DashboardResponse;
}

const RISK_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#dc2626",
};

export function DashboardMetrics({ dashboard }: DashboardMetricsProps) {
  const completionRate =
    dashboard.totalMissions > 0
      ? Math.round((dashboard.completedMissions / dashboard.totalMissions) * 100)
      : 0;

  const activeTasks = dashboard.totalTasks - dashboard.completedTasks;

  const cards = [
    { label: "Total Missions", value: String(dashboard.totalMissions) },
    { label: "Completion Rate", value: `${completionRate}%` },
    { label: "Active Tasks", value: String(activeTasks) },
    {
      label: "Risk Level",
      value: dashboard.overallRiskLevel,
      color: RISK_COLORS[dashboard.overallRiskLevel] ?? "#94a3b8",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <div className="text-xs text-stone-500">{c.label}</div>
          <div
            className="mt-1 text-xl font-semibold"
            style={c.color ? { color: c.color } : undefined}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
