import { useMemo } from "react";
import type { NLExecutionPlan } from "@shared/nl-command/contracts";

/**
 * Resource allocation chart showing agent types and their time allocations
 * as horizontal stacked bars.
 *
 * @see Requirements 6.3
 */
export interface ResourceChartProps {
  plan: NLExecutionPlan;
}

const COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];
const BAR_HEIGHT = 24;

export function ResourceChart({ plan }: ResourceChartProps) {
  const { agents, maxTime, minTime, legend } = useMemo(() => {
    const entries = plan.resourceAllocation?.entries ?? [];
    if (entries.length === 0)
      return { agents: [], maxTime: 1, minTime: 0, legend: [] };

    const min = Math.min(...entries.map(e => e.startTime));
    const max = Math.max(...entries.map(e => e.endTime));
    const span = max - min || 1;

    // Group by agentType
    const grouped = new Map<
      string,
      { taskId: string; left: number; width: number; count: number }[]
    >();
    const typeSet = new Set<string>();
    for (const e of entries) {
      typeSet.add(e.agentType);
      if (!grouped.has(e.agentType)) grouped.set(e.agentType, []);
      grouped.get(e.agentType)!.push({
        taskId: e.taskId,
        left: ((e.startTime - min) / span) * 100,
        width: Math.max(((e.endTime - e.startTime) / span) * 100, 1),
        count: e.agentCount,
      });
    }

    const types = [...typeSet];
    const legendItems = types.map((t, i) => ({
      type: t,
      color: COLORS[i % COLORS.length],
    }));
    const agentRows = types.map((t, i) => ({
      type: t,
      color: COLORS[i % COLORS.length],
      segments: grouped.get(t)!,
    }));

    return {
      agents: agentRows,
      maxTime: max,
      minTime: min,
      legend: legendItems,
    };
  }, [plan]);

  if (agents.length === 0) {
    return (
      <div className="p-4 text-sm text-stone-400">
        No resource allocation data available.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span>Resource Allocation</span>
        {legend.map(l => (
          <span key={l.type} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-4 rounded"
              style={{ backgroundColor: l.color }}
            />
            {l.type}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded border border-stone-200">
        {agents.map(a => (
          <div
            key={a.type}
            className="flex items-center border-b border-stone-100"
            style={{ height: BAR_HEIGHT + 8 }}
          >
            <div className="w-28 shrink-0 truncate px-2 text-xs text-stone-600">
              {a.type}
            </div>
            <div className="relative flex-1" style={{ height: BAR_HEIGHT }}>
              {a.segments.map((s, i) => (
                <div
                  key={i}
                  className="absolute top-0 rounded opacity-80"
                  style={{
                    left: `${s.left}%`,
                    width: `${s.width}%`,
                    height: BAR_HEIGHT,
                    backgroundColor: a.color,
                    minWidth: 4,
                  }}
                  title={`${a.type} ×${s.count} — ${s.taskId}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-stone-400">
        Total agents: {plan.resourceAllocation?.totalAgents ?? 0} · Peak
        concurrency: {plan.resourceAllocation?.peakConcurrency ?? 0}
      </div>
    </div>
  );
}
