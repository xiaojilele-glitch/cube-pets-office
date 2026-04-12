import { CircleAlert, ListChecks, MapPinned, Sparkles } from "lucide-react";

import type {
  CommandAnalysis,
  NLExecutionPlan,
  StrategicCommand,
} from "@shared/nl-command/contracts";

import { useI18n } from "@/i18n";
import type { TaskHubCommandSubmissionResult } from "@/lib/nl-command-store";
import { localizeTaskHubText } from "@/lib/task-hub-copy";
import { cn } from "@/lib/utils";

function SummaryList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </div>
      {items.length > 0 ? (
        <div className="space-y-1.5">
          {items.slice(0, 3).map(item => (
            <div
              key={item}
              className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-2 text-sm leading-6 text-stone-700"
            >
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/60 px-3 py-2.5 text-sm text-stone-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

export function CommandPlanSummary({
  command,
  analysis,
  plan,
  submission,
  className,
}: {
  command: StrategicCommand | null;
  analysis: CommandAnalysis | null;
  plan: NLExecutionPlan | null;
  submission: TaskHubCommandSubmissionResult | null;
  className?: string;
}) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const text = {
    eyebrow: isZh ? "计划摘要" : "Plan Summary",
    emptyDescription: isZh
      ? "提交指令后，这里会显示任务落点、执行形态和关键约束。"
      : "After a command is submitted, this area shows the task landing, execution shape, and key constraints.",
    heading: isZh
      ? "这条指令已经进入任务上下文"
      : "The command is now inside task context",
    live: isZh ? "已进入任务" : "Live in Tasks",
    needsClarification: isZh ? "需要补充信息" : "Needs Clarification",
    ready: isZh ? "可创建任务" : "Ready",
    landing: isZh ? "任务落点" : "Task Landing",
    landingCreated: (missionId: string) =>
      isZh
        ? `已创建并关联到 ${missionId}`
        : `Created and linked to ${missionId}`,
    landingWaiting: isZh
      ? "还在等待补充信息，任务暂未创建。"
      : "Waiting for clarification before the mission is created.",
    executionShape: isZh ? "执行形态" : "Execution Shape",
    executionShapeValue: (missionCount: number, taskCount: number) =>
      isZh
        ? `${missionCount} 个 mission / ${taskCount} 个执行阶段`
        : `${missionCount} mission / ${taskCount} execution stages`,
    riskLevel: isZh ? "风险等级" : "Risk Level",
    objectives: isZh ? "目标" : "Objectives",
    constraints: isZh ? "约束" : "Constraints",
    noObjectives: isZh ? "暂未识别出明确目标。" : "No explicit objectives yet.",
    noConstraints: isZh
      ? "暂未识别出明确约束。"
      : "No explicit constraints yet.",
  };

  function riskLabel(level: string) {
    if (!isZh) return level;
    switch (level) {
      case "low":
        return "低";
      case "medium":
        return "中";
      case "high":
        return "高";
      case "critical":
        return "极高";
      default:
        return level;
    }
  }

  if (!command || !analysis || !plan) {
    return (
      <section
        className={cn(
          "rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur",
          className
        )}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
          {text.eyebrow}
        </div>
        <div className="mt-3 rounded-[22px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-5 text-sm leading-6 text-stone-500">
          {text.emptyDescription}
        </div>
      </section>
    );
  }

  const badgeLabel =
    submission?.status === "created"
      ? text.live
      : analysis.needsClarification
        ? text.needsClarification
        : text.ready;
  const badgeTone =
    submission?.status === "created"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : analysis.needsClarification
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-sky-200 bg-sky-50 text-sky-700";

  return (
    <section
      className={cn(
        "rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
            {text.eyebrow}
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-stone-900">
            {text.heading}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            badgeTone
          )}
        >
          {badgeLabel}
        </span>
      </div>

      <div className="mt-4 rounded-[22px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,249,235,0.92),rgba(255,255,255,0.9))] px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-amber-100 p-2 text-amber-700">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-900">
              {command.commandText}
            </div>
            <div className="mt-1 text-sm leading-6 text-stone-600">
              {analysis.intent}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <MapPinned className="size-4 text-emerald-600" />
            {text.landing}
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {submission?.missionId
              ? text.landingCreated(submission.missionId)
              : text.landingWaiting}
          </div>
        </div>

        <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <ListChecks className="size-4 text-sky-600" />
            {text.executionShape}
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {isZh
              ? `${plan.missions.length} 个任务主线 / ${plan.tasks.length} 个执行阶段`
              : text.executionShapeValue(plan.missions.length, plan.tasks.length)}
          </div>
        </div>

        <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <CircleAlert className="size-4 text-amber-600" />
            {text.riskLevel}
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {riskLabel(plan.riskAssessment.overallRiskLevel)}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <SummaryList
          title={text.objectives}
          items={analysis.objectives.map(item =>
            localizeTaskHubText(item, locale)
          )}
          emptyLabel={text.noObjectives}
        />
        <SummaryList
          title={text.constraints}
          items={analysis.constraints.map(item =>
            localizeTaskHubText(item.description, locale)
          )}
          emptyLabel={text.noConstraints}
        />
      </div>
    </section>
  );
}
