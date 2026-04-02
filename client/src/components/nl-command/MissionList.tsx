import { useMemo, useState } from "react";

import type { DecomposedMission, CommandPriority } from "@shared/nl-command/contracts";

/**
 * Filterable mission list with priority filter and drill-down selection.
 *
 * @see Requirements 9.2, 9.5, 9.6
 */
export interface MissionListProps {
  missions: DecomposedMission[];
  onSelect?: (mission: DecomposedMission) => void;
}

const PRIORITIES: CommandPriority[] = ["critical", "high", "medium", "low"];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export function MissionList({ missions, onSelect }: MissionListProps) {
  const [filter, setFilter] = useState<CommandPriority | "all">("all");

  const filtered = useMemo(
    () => (filter === "all" ? missions : missions.filter((m) => m.priority === filter)),
    [missions, filter],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-stone-500">Filter:</span>
        {(["all", ...PRIORITIES] as const).map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
              filter === p ? "bg-indigo-100 text-indigo-700" : "text-stone-500 hover:bg-stone-100"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-4 text-center text-sm text-stone-400">No missions found.</div>
      )}

      <ul className="flex flex-col gap-1">
        {filtered.map((m) => (
          <li
            key={m.missionId}
            onClick={() => onSelect?.(m)}
            className="cursor-pointer rounded-lg border border-stone-200 px-3 py-2 transition-colors hover:bg-stone-50"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect?.(m)}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-stone-800">{m.title}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: PRIORITY_COLORS[m.priority] }}
              >
                {m.priority}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-stone-500 line-clamp-1">{m.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
