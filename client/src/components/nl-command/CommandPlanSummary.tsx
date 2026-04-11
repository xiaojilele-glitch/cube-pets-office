import { CircleAlert, ListChecks, MapPinned, Sparkles } from "lucide-react";

import type {
  CommandAnalysis,
  NLExecutionPlan,
  StrategicCommand,
} from "@shared/nl-command/contracts";

import type { TaskHubCommandSubmissionResult } from "@/lib/nl-command-store";
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
  if (!command || !analysis || !plan) {
    return (
      <section
        className={cn(
          "rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur",
          className
        )}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
          Plan Summary
        </div>
        <div className="mt-3 rounded-[22px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-5 text-sm leading-6 text-stone-500">
          After a command is submitted, this area shows the task landing,
          execution shape, and key constraints.
        </div>
      </section>
    );
  }

  const badgeLabel =
    submission?.status === "created"
      ? "Live in Tasks"
      : analysis.needsClarification
        ? "Needs Clarification"
        : "Ready";
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
            Plan Summary
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-stone-900">
            The command is now inside task context
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
            Task Landing
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {submission?.missionId
              ? `Created and linked to ${submission.missionId}`
              : "Waiting for clarification before the mission is created."}
          </div>
        </div>

        <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <ListChecks className="size-4 text-sky-600" />
            Execution Shape
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {`${plan.missions.length} mission / ${plan.tasks.length} execution stages`}
          </div>
        </div>

        <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <CircleAlert className="size-4 text-amber-600" />
            Risk Level
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-600">
            {plan.riskAssessment.overallRiskLevel}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <SummaryList
          title="Objectives"
          items={analysis.objectives}
          emptyLabel="No explicit objectives yet."
        />
        <SummaryList
          title="Constraints"
          items={analysis.constraints.map(item => item.description)}
          emptyLabel="No explicit constraints yet."
        />
      </div>
    </section>
  );
}
