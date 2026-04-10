import type { ReactNode } from "react";

import {
  AlertTriangle,
  ArrowRightCircle,
  Bot,
  Sparkles,
  UserRound,
  Workflow,
} from "lucide-react";

import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
} from "@/lib/tasks-store";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import { OperatorActionBar } from "./OperatorActionBar";
import {
  compactText,
  deriveCurrentOwner,
  deriveNextStep,
  derivePrimaryActions,
  deriveTaskBlocker,
  formatTaskRelative,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
  missionStatusTone,
  taskInsightToneClasses,
  type TaskInsightSummary,
  type TaskInsightTone,
} from "./task-helpers";

interface TaskOperationsHeroProps {
  detail: MissionTaskDetail;
  loadingByAction?: MissionOperatorActionLoadingMap;
  onSubmitOperatorAction?: (payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) => void | Promise<void>;
}

function recommendedToneClasses(
  tone: "primary" | "secondary" | "danger"
): string {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-semibold",
    tone === "primary" && "border-teal-200 bg-teal-50 text-teal-800",
    tone === "secondary" && "border-stone-200 bg-stone-50 text-stone-700",
    tone === "danger" && "border-rose-200 bg-rose-50 text-rose-800"
  );
}

function summaryToneForRuntime(detail: MissionTaskDetail): TaskInsightTone {
  if (detail.status === "done") return "success";
  if (detail.status === "failed") return "danger";
  if (detail.status === "waiting" || detail.operatorState === "paused") {
    return "info";
  }
  if (detail.operatorState === "blocked") return "warning";
  return "neutral";
}

function SummaryCard({
  item,
  icon,
}: {
  item: TaskInsightSummary;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[22px] border px-4 py-4 shadow-sm backdrop-blur",
        taskInsightToneClasses(item.tone)
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70">
            {item.label}
          </div>
          <div className="mt-2 text-base font-semibold">{item.title}</div>
        </div>
        <div className="shrink-0 opacity-80">{icon}</div>
      </div>
      <div className="mt-2 text-sm leading-6">{item.detail}</div>
      {item.meta ? (
        <div className="mt-2 text-xs leading-5 opacity-75">{item.meta}</div>
      ) : null}
    </div>
  );
}

export function TaskOperationsHero({
  detail,
  loadingByAction,
  onSubmitOperatorAction,
}: TaskOperationsHeroProps) {
  const { locale, copy } = useI18n();
  const summaryText = compactText(detail.summary || detail.sourceText, 260);
  const liveSignalText = compactText(
    detail.lastSignal || detail.waitingFor || copy.tasks.detailView.noDetail,
    140
  );
  const primaryActions = derivePrimaryActions(detail, locale);
  const owner = deriveCurrentOwner(detail, locale);
  const blocker = deriveTaskBlocker(detail, locale);
  const nextStep = deriveNextStep(detail, locale);

  const runtimeSummary: TaskInsightSummary = {
    label: copy.tasks.hero.runtimeLabel,
    title: detail.currentStageLabel || missionStatusLabel(detail.status, locale),
    detail:
      compactText(
        detail.lastSignal ||
          detail.waitingFor ||
          detail.summary ||
          copy.tasks.detailView.noDetail,
        160
      ) || copy.tasks.detailView.noDetail,
    meta: [
      `${detail.progress}% progress`,
      detail.executor?.status ? `Executor ${detail.executor.status}` : null,
      detail.instance?.image || null,
    ]
      .filter(Boolean)
      .join(" / "),
    tone: summaryToneForRuntime(detail),
  };

  return (
    <section className="shrink-0 overflow-hidden rounded-[28px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_28%),linear-gradient(180deg,#fffdf8,#f7f0e6)] p-5 shadow-[0_24px_70px_rgba(113,83,49,0.1)]">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-4xl">
              <div className="flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    missionStatusTone(detail.status)
                  )}
                >
                  {missionStatusLabel(detail.status, locale)}
                </span>
                <span className="rounded-full border border-stone-200 bg-white/70 px-3 py-1 text-xs font-medium text-stone-700">
                  {detail.kind}
                </span>
                {detail.operatorState !== "active" ? (
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      missionOperatorStateTone(detail.operatorState)
                    )}
                  >
                    {missionOperatorStateLabel(detail.operatorState, locale)}
                  </span>
                ) : null}
                {detail.departmentLabels.map(label => (
                  <span
                    key={label}
                    className="rounded-full border border-white/80 bg-white/65 px-3 py-1 text-xs text-stone-600"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <h1 className="mt-3 max-w-4xl text-2xl font-semibold tracking-tight text-stone-900 md:text-3xl">
                {detail.title}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">
                {summaryText}
              </p>
            </div>

            <div className="rounded-[20px] border border-white/80 bg-white/72 px-4 py-3 text-sm text-stone-700 shadow-sm backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                {copy.tasks.hero.updated}
              </div>
              <div className="mt-2 text-sm font-medium">
                {formatTaskRelative(detail.updatedAt, locale)}
              </div>
              <div className="mt-2 max-w-[260px] text-xs leading-5 text-stone-500">
                {liveSignalText}
              </div>
            </div>
          </div>

          {primaryActions.recommended.length > 0 ? (
            <div className="rounded-[22px] border border-teal-200/80 bg-teal-50/75 px-4 py-4 text-sm text-teal-900 shadow-sm">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-700">
                <Sparkles className="size-4" />
                {copy.tasks.hero.recommended}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {primaryActions.recommended.map(action => (
                  <span
                    key={action.key}
                    className={recommendedToneClasses(action.tone)}
                  >
                    {action.label}
                  </span>
                ))}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {primaryActions.recommended.map(action => (
                  <div
                    key={`${action.key}-detail`}
                    className="rounded-[18px] border border-white/70 bg-white/75 px-3 py-3 text-sm leading-6 text-teal-900"
                  >
                    {action.description}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {primaryActions.decisionRequired ? (
            <div className="rounded-[22px] border border-sky-200/80 bg-sky-50/80 px-4 py-4 text-sm text-sky-900 shadow-sm">
              <div className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-sky-700" />
                {copy.tasks.hero.pendingDecision}
              </div>
              <div className="mt-2 leading-6">
                {compactText(
                  detail.waitingFor ||
                    detail.decisionPrompt ||
                    detail.decision?.prompt ||
                    copy.tasks.detailView.decisionEntryFallback,
                  220
                )}
              </div>
            </div>
          ) : null}

          <OperatorActionBar
            detail={detail}
            loadingByAction={loadingByAction}
            onSubmitAction={onSubmitOperatorAction}
            showContextSummary={false}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <SummaryCard item={owner} icon={<UserRound className="size-4" />} />
          <SummaryCard
            item={blocker}
            icon={<AlertTriangle className="size-4" />}
          />
          <SummaryCard
            item={nextStep}
            icon={<ArrowRightCircle className="size-4" />}
          />
          <SummaryCard
            item={runtimeSummary}
            icon={
              detail.executor ? (
                <Bot className="size-4" />
              ) : (
                <Workflow className="size-4" />
              )
            }
          />
        </div>
      </div>
    </section>
  );
}
