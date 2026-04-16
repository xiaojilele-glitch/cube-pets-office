import { useMemo } from "react";

import type { NLExecutionPlan } from "@shared/nl-command/contracts";

/**
 * Risk heat map component rendering risks as a grid
 * with probability × impact, color-coded by risk level.
 *
 * @see Requirements 6.4
 */
export interface RiskHeatMapProps {
  plan: NLExecutionPlan;
}

const LEVEL_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const CELL = 36;

export function RiskHeatMap({ plan }: RiskHeatMapProps) {
  const risks = plan.riskAssessment?.risks ?? [];

  // Build a 5×5 grid (probability 0-1 on X, impact 0-1 on Y, bucketed into 5 bins)
  const { grid, placed } = useMemo(() => {
    const g: { count: number; level: string; labels: string[] }[][] =
      Array.from({ length: 5 }, () =>
        Array.from({ length: 5 }, () => ({
          count: 0,
          level: "low",
          labels: [],
        }))
      );
    const levels = ["low", "medium", "high", "critical"];
    for (const r of risks) {
      const px = Math.min(4, Math.floor((r.probability ?? 0) * 5));
      const iy = Math.min(4, Math.floor((r.impact ?? 0) * 5));
      const cell = g[4 - iy][px]; // flip Y so high impact is top
      cell.count++;
      cell.labels.push(r.description.slice(0, 40));
      if (levels.indexOf(r.level) > levels.indexOf(cell.level))
        cell.level = r.level;
    }
    return { grid: g, placed: risks.length };
  }, [risks]);

  if (risks.length === 0) {
    return (
      <div className="p-4 text-sm text-stone-400">No risk data available.</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span>Risk Heat Map</span>
        <span className="ml-auto">
          Overall:{" "}
          <span
            className="font-medium"
            style={{
              color:
                LEVEL_COLORS[plan.riskAssessment?.overallRiskLevel ?? "low"],
            }}
          >
            {plan.riskAssessment?.overallRiskLevel ?? "—"}
          </span>
        </span>
      </div>
      <div className="flex gap-1">
        <div
          className="flex flex-col justify-between pr-1 text-[10px] text-stone-400"
          style={{ height: CELL * 5 }}
        >
          <span>High</span>
          <span>Impact</span>
          <span>Low</span>
        </div>
        <div>
          {grid.map((row, ri) => (
            <div key={ri} className="flex gap-0.5">
              {row.map((cell, ci) => (
                <div
                  key={ci}
                  className="flex items-center justify-center rounded text-[10px] font-medium text-white"
                  style={{
                    width: CELL,
                    height: CELL,
                    backgroundColor:
                      cell.count > 0 ? LEVEL_COLORS[cell.level] : "#f1f5f9",
                    opacity:
                      cell.count > 0 ? 0.7 + Math.min(cell.count, 3) * 0.1 : 1,
                  }}
                  title={cell.labels.join("\n") || "No risks"}
                >
                  {cell.count > 0 ? cell.count : ""}
                </div>
              ))}
            </div>
          ))}
          <div
            className="mt-0.5 flex justify-between text-[10px] text-stone-400"
            style={{ width: CELL * 5 + 4 * 2 }}
          >
            <span>Low</span>
            <span>Probability</span>
            <span>High</span>
          </div>
        </div>
      </div>
      <div className="flex gap-3 text-[10px] text-stone-500">
        {Object.entries(LEVEL_COLORS).map(([level, color]) => (
          <span key={level} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded"
              style={{ backgroundColor: color }}
            />
            {level}
          </span>
        ))}
      </div>
    </div>
  );
}
