import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRightCircle,
  Bot,
  Sparkles,
  UserRound,
  Workflow,
} from "lucide-react";

import { useI18n } from "@/i18n";
import { localizeTaskHubBriefText } from "@/lib/task-hub-copy";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
} from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
} from "@/components/workspace/workspace-tone";

import { OperatorActionBar } from "./OperatorActionBar";
import { StatusPillStack } from "./StatusPillStack";
import { TaskDetailView } from "./TaskDetailView";
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
} from "./task-helpers";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function InsightCard({
  item,
  icon,
}: {
  item: TaskInsightSummary;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        "workspace-callout rounded-[20px] px-3.5 py-3",
        taskInsightToneClasses(item.tone)
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">
            {item.label}
          </div>
          <div className="mt-1.5 line-clamp-1 text-sm font-semibold">
            {item.title}
          </div>
        </div>
        <div className="shrink-0 opacity-75">{icon}</div>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[13px] leading-5">
        {item.detail}
      </div>
      {item.meta ? (
        <div className="mt-1 text-[11px] leading-4 opacity-75">{item.meta}</div>
      ) : null}
    </div>
  );
}

export function TasksCockpitDetail({
  detail,
  decisionNote,
  onDecisionNoteChange,
  onLaunchDecision,
  launchingPresetId,
  onSubmitOperatorAction,
  operatorActionLoading,
  onDecisionSubmitted,
  className,
}: {
  detail: MissionTaskDetail | null;
  decisionNote: string;
  onDecisionNoteChange: (next: string) => void;
  onLaunchDecision: (presetId: string) => void | Promise<void>;
  launchingPresetId?: string | null;
  onSubmitOperatorAction?: (payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) => void | Promise<void>;
  operatorActionLoading?: MissionOperatorActionLoadingMap;
  onDecisionSubmitted?: () => void;
  className?: string;
}) {
  const { locale, copy } = useI18n();

  if (!detail) {
    return (
      <TaskDetailView
        detail={detail}
        decisionNote={decisionNote}
        onDecisionNoteChange={onDecisionNoteChange}
        onLaunchDecision={onLaunchDecision}
        launchingPresetId={launchingPresetId}
        onSubmitOperatorAction={onSubmitOperatorAction}
        operatorActionLoading={operatorActionLoading}
        onDecisionSubmitted={onDecisionSubmitted}
        variant="cockpit"
        className={className}
      />
    );
  }

  const summaryText = compactText(
    localizeTaskHubBriefText(detail.summary || detail.sourceText, locale),
    220
  );
  const primaryActions = derivePrimaryActions(detail, locale);
  const owner = deriveCurrentOwner(detail, locale);
  const blocker = deriveTaskBlocker(detail, locale);
  const nextStep = deriveNextStep(detail, locale);
  const statusItems = [
    {
      key: "mission-status",
      label: missionStatusLabel(detail.status, locale),
      className: missionStatusTone(detail.status),
    },
    {
      key: "operator-status",
      label: missionOperatorStateLabel(detail.operatorState, locale),
      className: missionOperatorStateTone(detail.operatorState),
    },
    {
      key: "kind",
      label: detail.kind,
      className: "workspace-tone-neutral bg-white/75 font-medium",
    },
  ];

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <section className="shrink-0 overflow-hidden rounded-[28px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_26%),linear-gradient(180deg,#fffdf8,#f5ede1)] px-4 py-4 shadow-[0_24px_70px_rgba(113,83,49,0.1)]">
        <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                  {copy.tasks.hero.statusStack}
                </div>
                <StatusPillStack items={statusItems} className="mt-2" />
                {detail.departmentLabels.length > 0 ? (
                  <StatusPillStack
                    items={detail.departmentLabels.map(label => ({
                      key: `department-${label}`,
                      label,
                      className: "workspace-tone-neutral bg-white/65 font-medium",
                    }))}
                    className="mt-2"
                  />
                ) : null}
              </div>

              <div className="rounded-[18px] border border-white/80 bg-white/78 px-3.5 py-3 text-right shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {copy.tasks.hero.updated}
                </div>
                <div className="mt-1.5 text-sm font-semibold text-stone-900">
                  {formatTaskRelative(detail.updatedAt, locale)}
                </div>
                <div className="mt-1 text-xs leading-5 text-stone-500">
                  {compactText(
                    detail.currentStageLabel ||
                      t(locale, "等待下一条执行信号", "Waiting for next runtime signal"),
                    34
                  )}
                </div>
              </div>
            </div>

            <h2 className="mt-3 line-clamp-2 text-[1.45rem] font-semibold tracking-tight text-stone-900">
              {detail.title}
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-stone-700">
              {summaryText || copy.tasks.detailView.noDetail}
            </p>

            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              <InsightCard item={owner} icon={<UserRound className="size-4" />} />
              <InsightCard
                item={blocker}
                icon={<AlertTriangle className="size-4" />}
              />
              <InsightCard
                item={nextStep}
                icon={<ArrowRightCircle className="size-4" />}
              />
            </div>
          </div>

          <div className="grid content-start gap-3">
            {primaryActions.recommended.length > 0 ? (
              <div
                className={cn(
                  workspaceCalloutClass("success"),
                  "px-4 py-3 text-sm"
                )}
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--workspace-success)]">
                  <Sparkles className="size-4" />
                  {copy.tasks.hero.recommended}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {primaryActions.recommended.map(action => (
                    <span
                      key={action.key}
                      className={workspaceStatusClass(
                        action.tone === "primary" ? "success" : "info",
                        "px-2.5 py-1 text-[10px] font-semibold"
                      )}
                    >
                      {action.label}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--workspace-text)]">
                  {compactText(
                    primaryActions.recommended[0]?.description ||
                      t(
                        locale,
                        "按建议顺序处理当前任务，能最快把链路继续推下去。",
                        "Follow the suggested order to keep the mission moving."
                      ),
                    160
                  )}
                </div>
              </div>
            ) : primaryActions.passiveMessage ? (
              <div
                className={cn(
                  workspaceCalloutClass("neutral"),
                  "border-dashed px-4 py-3 text-sm leading-6 text-[var(--workspace-text-muted)]"
                )}
              >
                {primaryActions.passiveMessage}
              </div>
            ) : null}

            <div className="rounded-[22px] border border-stone-200/80 bg-white/82 px-3.5 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                {detail.executor ? (
                  <Bot className="size-3.5 text-sky-600" />
                ) : (
                  <Workflow className="size-3.5 text-stone-500" />
                )}
                {t(locale, "当前节奏", "Current cadence")}
              </div>
              <div className="mt-2 text-sm font-semibold text-stone-900">
                {detail.currentStageLabel ||
                  t(locale, "等待进入执行阶段", "Waiting to enter active stage")}
              </div>
              <div className="mt-1 text-xs leading-5 text-stone-500">
                {compactText(
                  detail.lastSignal ||
                    detail.waitingFor ||
                    t(
                      locale,
                      "当前还没有新的运行时信号。",
                      "No fresh runtime signal has arrived yet."
                    ),
                  100
                )}
              </div>
            </div>

            <OperatorActionBar
              detail={detail}
              loadingByAction={operatorActionLoading}
              onSubmitAction={onSubmitOperatorAction}
              showContextSummary={false}
              variant="compact"
            />
          </div>
        </div>
      </section>

      <TaskDetailView
        detail={detail}
        decisionNote={decisionNote}
        onDecisionNoteChange={onDecisionNoteChange}
        onLaunchDecision={onLaunchDecision}
        launchingPresetId={launchingPresetId}
        onSubmitOperatorAction={onSubmitOperatorAction}
        operatorActionLoading={operatorActionLoading}
        onDecisionSubmitted={onDecisionSubmitted}
        variant="cockpit"
        className="min-h-0 flex-1"
      />
    </div>
  );
}
