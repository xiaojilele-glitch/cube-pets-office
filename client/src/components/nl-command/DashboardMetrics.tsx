import type { DashboardResponse } from "@shared/nl-command/api";
import { useI18n } from "@/i18n";

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
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const completionRate =
    dashboard.totalMissions > 0
      ? Math.round(
          (dashboard.completedMissions / dashboard.totalMissions) * 100
        )
      : 0;

  const activeTasks = dashboard.totalTasks - dashboard.completedTasks;

  const localizedRiskLevel = !isZh
    ? dashboard.overallRiskLevel
    : dashboard.overallRiskLevel === "low"
      ? "低"
      : dashboard.overallRiskLevel === "medium"
        ? "中"
        : dashboard.overallRiskLevel === "high"
          ? "高"
          : dashboard.overallRiskLevel === "critical"
            ? "极高"
            : dashboard.overallRiskLevel;

  const cards = [
    {
      label: isZh ? "任务总数" : "Total Missions",
      value: String(dashboard.totalMissions),
    },
    { label: isZh ? "完成率" : "Completion Rate", value: `${completionRate}%` },
    { label: isZh ? "活跃任务" : "Active Tasks", value: String(activeTasks) },
    {
      label: isZh ? "风险等级" : "Risk Level",
      value: localizedRiskLevel,
      color: RISK_COLORS[dashboard.overallRiskLevel] ?? "#94a3b8",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(c => (
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
