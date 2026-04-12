import type { ExecutionReport } from "@shared/nl-command/contracts";
import { useI18n } from "@/i18n";

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
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const {
    progressAnalysis: prog,
    costAnalysis: cost,
    riskAnalysis: risk,
  } = report;
  const riskLabel = !isZh
    ? risk.overallRiskLevel
    : risk.overallRiskLevel === "low"
      ? "低"
      : risk.overallRiskLevel === "medium"
        ? "中"
        : risk.overallRiskLevel === "high"
          ? "高"
          : risk.overallRiskLevel === "critical"
            ? "极高"
            : risk.overallRiskLevel;

  const progressPct =
    prog.totalTasks > 0
      ? Math.round((prog.completedTasks / prog.totalTasks) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-stone-800">
            {isZh ? "执行报告" : "Execution Report"}
          </div>
          <div className="text-[10px] text-stone-400">
            {new Date(report.generatedAt).toLocaleString(locale)}
          </div>
        </div>
        {onExport && (
          <div className="flex gap-1.5">
            <button
              onClick={() => onExport("markdown")}
              className="rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-200"
            >
              {isZh ? "导出 MD" : "Export MD"}
            </button>
            <button
              onClick={() => onExport("json")}
              className="rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-200"
            >
              {isZh ? "导出 JSON" : "Export JSON"}
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="text-xs text-stone-600">{report.summary}</div>

      {/* Progress */}
      <div className="rounded-lg border border-stone-200 p-3">
        <div className="text-xs font-medium text-stone-700">
          {isZh ? "进度" : "Progress"}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
          <span>
            {isZh ? "任务组" : "Missions"}: {prog.completedMissions}/
            {prog.totalMissions}
          </span>
          <span>
            {isZh ? "任务" : "Tasks"}: {prog.completedTasks}/{prog.totalTasks}
          </span>
          <span className="font-medium text-indigo-600">{progressPct}%</span>
        </div>
        {prog.delayedItems.length > 0 && (
          <div className="mt-1 text-[10px] text-red-500">
            {isZh ? "延期：" : "Delayed: "} {prog.delayedItems.join(", ")}
          </div>
        )}
      </div>

      {/* Cost comparison */}
      <div className="rounded-lg border border-stone-200 p-3">
        <div className="text-xs font-medium text-stone-700">
          {isZh ? "成本分析" : "Cost Analysis"}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-stone-500">
          <div>
            {isZh ? "计划：" : "Planned: "} {cost.plannedCost.toLocaleString()}
          </div>
          <div>
            {isZh ? "实际：" : "Actual: "} {cost.actualCost.toLocaleString()}
          </div>
          <div
            className="font-medium"
            style={{ color: cost.variance > 0 ? "#dc2626" : "#22c55e" }}
          >
            {isZh ? "偏差：" : "Variance: "}
            {cost.variancePercentage > 0 ? "+" : ""}
            {cost.variancePercentage.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Risk */}
      <div className="rounded-lg border border-stone-200 p-3">
        <div className="text-xs font-medium text-stone-700">
          {isZh ? "风险等级：" : "Risk Level: "}{" "}
          <span className="capitalize">{riskLabel}</span>
        </div>
        <div className="mt-1 text-[10px] text-stone-400">
          {isZh
            ? `已识别 ${risk.risks.length} 条风险`
            : `${risk.risks.length} risk(s) identified`}
        </div>
      </div>
    </div>
  );
}
