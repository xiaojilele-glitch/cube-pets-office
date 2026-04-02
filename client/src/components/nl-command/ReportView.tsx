import type { ExecutionReport } from "@shared/nl-command/contracts";

/**
 * Report display component with plan-vs-actual comparison
 * and Markdown/JSON export support.
 *
 * @see Requirements 13.1, 13.2, 13.4, 13.5
 */
export interface ReportViewProps {
  report: ExecutionReport;
  onExport?: (format: "json" | "markdown") => void;
}

export function ReportView({ report, onExport }: ReportViewProps) {
  const { progressAnalysis: prog, costAnalysis: cost, riskAnalysis: risk } = report;

  const progressPct =
    prog.totalTasks > 0 ? Math.round((prog.completedTasks / prog.totalTasks) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-stone-800">Execution Report</div>
          <div className="text-[10px] text-stone-400">
            {new Date(report.generatedAt).toLocaleString()}
          </div>
        </div>
        {onExport && (
          <div className="flex gap-1.5">
            <button
              onClick={() => onExport("markdown")}
              className="rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-200"
            >
              Export MD
            </button>
            <button
              onClick={() => onExport("json")}
              className="rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-200"
            >
              Export JSON
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="text-xs text-stone-600">{report.summary}</div>

      {/* Progress */}
      <div className="rounded-lg border border-stone-200 p-3">
        <div className="text-xs font-medium text-stone-700">Progress</div>
        <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
          <span>Missions: {prog.completedMissions}/{prog.totalMissions}</span>
          <span>Tasks: {prog.completedTasks}/{prog.totalTasks}</span>
          <span className="font-medium text-indigo-600">{progressPct}%</span>
        </div>
        {prog.delayedItems.length > 0 && (
          <div className="mt-1 text-[10px] text-red-500">
            Delayed: {prog.delayedItems.join(", ")}
          </div>
        )}
      </div>

      {/* Cost comparison */}
      <div className="rounded-lg border border-stone-200 p-3">
        <div className="text-xs font-medium text-stone-700">Cost Analysis</div>
        <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-stone-500">
          <div>Planned: {cost.plannedCost.toLocaleString()}</div>
          <div>Actual: {cost.actualCost.toLocaleString()}</div>
          <div
            className="font-medium"
            style={{ color: cost.variance > 0 ? "#dc2626" : "#22c55e" }}
          >
            Variance: {cost.variancePercentage > 0 ? "+" : ""}
            {cost.variancePercentage.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Risk */}
      <div className="rounded-lg border border-stone-200 p-3">
        <div className="text-xs font-medium text-stone-700">
          Risk Level:{" "}
          <span className="capitalize">{risk.overallRiskLevel}</span>
        </div>
        <div className="mt-1 text-[10px] text-stone-400">
          {risk.risks.length} risk(s) identified
        </div>
      </div>
    </div>
  );
}
