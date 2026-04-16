import { useMemo } from "react";
import type { NLExecutionPlan } from "@shared/nl-command/contracts";

/**
 * Cost distribution chart rendering horizontal bars
 * by mission, by agent, and by model. Shows total budget and breakdown.
 *
 * @see Requirements 6.5
 */
export interface CostChartProps {
  plan: NLExecutionPlan;
}

const SECTION_COLORS: Record<string, string> = {
  mission: "#6366f1",
  agent: "#f59e0b",
  model: "#10b981",
};

interface BarItem {
  label: string;
  value: number;
  pct: number;
}

export function CostChart({ plan }: CostChartProps) {
  const budget = plan.costBudget;

  const sections = useMemo(() => {
    if (!budget) return [];
    const total = budget.totalBudget || 1;
    const toItems = (rec: Record<string, number>): BarItem[] =>
      Object.entries(rec).map(([k, v]) => ({
        label: k,
        value: v,
        pct: (v / total) * 100,
      }));

    const result: { title: string; color: string; items: BarItem[] }[] = [];
    if (Object.keys(budget.missionCosts).length > 0) {
      result.push({
        title: "By Mission",
        color: SECTION_COLORS.mission,
        items: toItems(budget.missionCosts),
      });
    }
    if (Object.keys(budget.agentCosts).length > 0) {
      result.push({
        title: "By Agent",
        color: SECTION_COLORS.agent,
        items: toItems(budget.agentCosts),
      });
    }
    if (Object.keys(budget.modelCosts).length > 0) {
      result.push({
        title: "By Model",
        color: SECTION_COLORS.model,
        items: toItems(budget.modelCosts),
      });
    }
    return result;
  }, [budget]);

  if (!budget || sections.length === 0) {
    return (
      <div className="p-4 text-sm text-stone-400">No cost data available.</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-stone-500">
        <span>Cost Distribution</span>
        <span>
          Total:{" "}
          <span className="font-medium text-stone-700">
            {budget.totalBudget.toLocaleString()} {budget.currency}
          </span>
        </span>
      </div>
      {sections.map(sec => (
        <div key={sec.title} className="flex flex-col gap-1">
          <div className="text-[11px] font-medium text-stone-600">
            {sec.title}
          </div>
          {sec.items.map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="w-24 shrink-0 truncate text-[11px] text-stone-500">
                {item.label}
              </div>
              <div className="relative h-4 flex-1 rounded bg-stone-100">
                <div
                  className="absolute left-0 top-0 h-full rounded"
                  style={{
                    width: `${Math.max(item.pct, 0.5)}%`,
                    backgroundColor: sec.color,
                  }}
                />
              </div>
              <div className="w-16 shrink-0 text-right text-[10px] text-stone-500">
                {item.value.toLocaleString()} ({item.pct.toFixed(1)}%)
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
