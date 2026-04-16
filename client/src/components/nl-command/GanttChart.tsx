import { useMemo, useState } from "react";
import type { NLExecutionPlan } from "@shared/nl-command/contracts";

/**
 * Gantt chart component showing Mission/Task timelines.
 * Marks critical path entries with a different color.
 * Supports basic zoom (scale) and horizontal scroll.
 *
 * @see Requirements 6.1
 */
export interface GanttChartProps {
  plan: NLExecutionPlan;
}

const ROW_HEIGHT = 28;
const LABEL_WIDTH = 160;

export function GanttChart({ plan }: GanttChartProps) {
  const [scale, setScale] = useState(1);

  const entries = plan.timeline?.entries ?? [];

  const { minTime, maxTime, rows } = useMemo(() => {
    if (entries.length === 0) return { minTime: 0, maxTime: 1, rows: [] };
    const min = Math.min(...entries.map(e => e.startTime));
    const max = Math.max(...entries.map(e => e.endTime));
    const span = max - min || 1;
    const labelMap = new Map<string, string>();
    for (const m of plan.missions) labelMap.set(m.missionId, m.title);
    for (const t of plan.tasks) labelMap.set(t.taskId, t.title);
    const mapped = entries.map(e => ({
      id: e.entityId,
      label: labelMap.get(e.entityId) ?? e.entityId,
      left: ((e.startTime - min) / span) * 100,
      width: Math.max(((e.endTime - e.startTime) / span) * 100, 1),
      critical: e.isCriticalPath,
      type: e.entityType,
    }));
    return { minTime: min, maxTime: max, rows: mapped };
  }, [entries, plan.missions, plan.tasks]);

  if (entries.length === 0) {
    return (
      <div className="p-4 text-sm text-stone-400">
        No timeline data available.
      </div>
    );
  }

  const chartWidth = 600 * scale;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <span>Gantt Chart</span>
        <button
          onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
          className="rounded border px-1.5 py-0.5 hover:bg-stone-100"
        >
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          onClick={() => setScale(s => Math.min(3, s + 0.25))}
          className="rounded border px-1.5 py-0.5 hover:bg-stone-100"
        >
          +
        </button>
        <span className="ml-2 flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded bg-rose-500" />{" "}
          Critical
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded bg-indigo-400" />{" "}
          Normal
        </span>
      </div>
      <div
        className="overflow-x-auto rounded border border-stone-200"
        style={{ maxHeight: 320 }}
      >
        <div className="flex" style={{ minWidth: LABEL_WIDTH + chartWidth }}>
          {/* Labels */}
          <div className="shrink-0" style={{ width: LABEL_WIDTH }}>
            {rows.map(r => (
              <div
                key={r.id}
                className="truncate border-b border-stone-100 px-2 text-xs leading-7 text-stone-600"
                style={{ height: ROW_HEIGHT }}
              >
                {r.label}
              </div>
            ))}
          </div>
          {/* Bars */}
          <div className="relative flex-1" style={{ width: chartWidth }}>
            {rows.map((r, i) => (
              <div
                key={r.id}
                className="relative border-b border-stone-100"
                style={{ height: ROW_HEIGHT }}
              >
                <div
                  className={`absolute top-1 h-4 rounded ${r.critical ? "bg-rose-500" : "bg-indigo-400"}`}
                  style={{
                    left: `${r.left}%`,
                    width: `${r.width}%`,
                    minWidth: 4,
                  }}
                  title={`${r.label} (${r.type})`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
