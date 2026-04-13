import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRightCircle,
  Bot,
  Sparkles,
  UserRound,
  Workflow,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
      <div className="mt-1.5 line-clamp-3 text-[13px] leading-5">
        {item.detail}
      </div>
      {item.meta ? (
        <div className="mt-1 text-[11px] leading-4 opacity-75">{item.meta}</div>
      ) : null}
    </div>
  );
}

function ProgressiveItem({
  value,
  title,
  description,
  meta,
  children,
}: {
  value: string;
  title: string;
  description: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="overflow-hidden rounded-[20px] border border-stone-200/80 bg-white/72 px-3.5"
    >
      <AccordionTrigger className="py-3 text-left hover:no-underline">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900">{title}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {description}
            {meta ? ` / ${meta}` : ""}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-3">{children}</AccordionContent>
    </AccordionItem>
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
  const [expandedSections, setExpandedSections] = useState<string[]>([]);

  useEffect(() => {
    setExpandedSections([]);
  }, [detail?.id]);

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
  const latestTimeline = [...detail.timeline].slice(-4).reverse();
  const latestArtifacts = detail.artifacts.slice(0, 4);
  const failureSummary =
    detail.status === "failed"
      ? compactText(
          detail.failureReasons[0] ||
            detail.lastSignal ||
            t(
              locale,
              "任务执行失败，请先阅读失败信号再决定是否重试。",
              "Mission execution failed. Review the signal before retrying."
            ),
          180
        )
      : null;

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

  const cadenceSummary: TaskInsightSummary = {
    label: t(locale, "当前节奏", "Current cadence"),
    title:
      detail.currentStageLabel ||
      t(locale, "等待进入执行阶段", "Waiting to enter active stage"),
    detail:
      compactText(
        detail.lastSignal ||
          detail.waitingFor ||
          t(
            locale,
            "当前还没有新的运行时信号。",
            "No fresh runtime signal has arrived yet."
          ),
        120
      ) || copy.tasks.detailView.noDetail,
    meta: formatTaskRelative(detail.updatedAt, locale),
    tone:
      detail.status === "failed"
        ? "danger"
        : detail.status === "done"
          ? "success"
          : detail.operatorState === "blocked"
            ? "warning"
            : "neutral",
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-4 pb-1">
          <section className="sticky top-0 z-10 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,252,248,0.96),rgba(247,239,229,0.94))] px-4 py-4 shadow-[0_18px_40px_rgba(99,73,45,0.12)] backdrop-blur">
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                    {t(locale, "任务优先视图", "Task priority view")}
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
                  <h2 className="mt-3 text-[1.2rem] font-semibold tracking-tight text-stone-900">
                    {detail.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    {summaryText || copy.tasks.detailView.noDetail}
                  </p>
                </div>

                <div className="min-w-[168px] rounded-[18px] border border-white/80 bg-white/78 px-3.5 py-3 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    {copy.tasks.hero.updated}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-stone-900">
                    {formatTaskRelative(detail.updatedAt, locale)}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-stone-500">
                    {compactText(
                      detail.currentStageLabel ||
                        t(
                          locale,
                          "等待下一条执行信号",
                          "Waiting for next runtime signal"
                        ),
                      56
                    )}
                  </div>
                </div>
              </div>

              {failureSummary ? (
                <div
                  className={cn(
                    workspaceCalloutClass("danger"),
                    "px-4 py-3 text-sm"
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--workspace-danger)]">
                    <AlertTriangle className="size-4" />
                    {t(locale, "失败信号", "Failure signal")}
                  </div>
                  <div className="mt-2 leading-6 text-[var(--workspace-text-strong)]">
                    {failureSummary}
                  </div>
                  {detail.lastSignal && detail.lastSignal !== failureSummary ? (
                    <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                      {compactText(detail.lastSignal, 120)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[24px] border border-stone-200/80 bg-white/80 px-4 py-4 shadow-[0_14px_34px_rgba(99,73,45,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                  {t(locale, "主操作区", "Primary action zone")}
                </div>
                <div className="mt-1 text-sm leading-6 text-stone-600">
                  {t(
                    locale,
                    "先处理失败信号、决策和操作者动作，长内容后置到折叠区。",
                    "Handle failure signals, decisions, and operator actions first, then move long-form detail into progressive sections."
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {primaryActions.recommended.map(action => (
                  <span
                    key={action.key}
                    className={workspaceStatusClass(
                      action.tone === "primary"
                        ? "success"
                        : action.tone === "danger"
                          ? "danger"
                          : "info",
                      "px-2.5 py-1 text-[10px] font-semibold"
                    )}
                  >
                    {action.label}
                  </span>
                ))}
              </div>
            </div>

            {primaryActions.recommended.length > 0 ? (
              <div
                className={cn(
                  workspaceCalloutClass(
                    detail.status === "failed" ? "danger" : "success"
                  ),
                  "mt-3 px-4 py-3 text-sm"
                )}
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
                  <Sparkles className="size-4" />
                  {copy.tasks.hero.recommended}
                </div>
                <div className="mt-2 space-y-2">
                  {primaryActions.recommended.map(action => (
                    <div key={`${action.key}-description`} className="leading-6">
                      {action.description}
                    </div>
                  ))}
                </div>
              </div>
            ) : primaryActions.passiveMessage ? (
              <div
                className={cn(
                  workspaceCalloutClass("neutral"),
                  "mt-3 border-dashed px-4 py-3 text-sm leading-6 text-[var(--workspace-text-muted)]"
                )}
              >
                {primaryActions.passiveMessage}
              </div>
            ) : null}

            <div className="mt-4">
              <OperatorActionBar
                detail={detail}
                loadingByAction={operatorActionLoading}
                onSubmitAction={onSubmitOperatorAction}
                showContextSummary={false}
                variant="compact"
              />
            </div>
          </section>

          <section className="grid gap-3">
            <InsightCard item={owner} icon={<UserRound className="size-4" />} />
            <InsightCard
              item={blocker}
              icon={<AlertTriangle className="size-4" />}
            />
            <InsightCard
              item={nextStep}
              icon={<ArrowRightCircle className="size-4" />}
            />
            <InsightCard
              item={cadenceSummary}
              icon={
                detail.executor ? (
                  <Bot className="size-4" />
                ) : (
                  <Workflow className="size-4" />
                )
              }
            />
          </section>

          <section className="rounded-[24px] border border-stone-200/80 bg-white/80 px-4 py-4 shadow-[0_14px_34px_rgba(99,73,45,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                  {t(locale, "渐进细节", "Progressive detail")}
                </div>
                <div className="mt-1 text-sm leading-6 text-stone-600">
                  {t(
                    locale,
                    "低频细节、交付物和历史仍然都在，只是后置到折叠区里。",
                    "Low-frequency detail, artifacts, and history are all still here, just pushed into progressive sections."
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] text-stone-500">
                <span className="rounded-full border border-stone-200/80 bg-stone-50/80 px-2.5 py-1 font-medium">
                  {detail.artifacts.length} {t(locale, "交付物", "artifacts")}
                </span>
                <span className="rounded-full border border-stone-200/80 bg-stone-50/80 px-2.5 py-1 font-medium">
                  {detail.timeline.length} {t(locale, "历史事件", "events")}
                </span>
              </div>
            </div>

            <Accordion
              type="multiple"
              value={expandedSections}
              onValueChange={values => setExpandedSections(values as string[])}
              className="mt-3 space-y-3"
            >
              <ProgressiveItem
                value="artifacts"
                title={t(locale, "交付物与附件", "Artifacts and attachments")}
                description={t(
                  locale,
                  "先看最新可交付物，再决定是否进入完整详情。",
                  "Scan the latest deliverables before opening the full detail view."
                )}
                meta={latestArtifacts.length > 0 ? String(latestArtifacts.length) : copy.common.unavailable}
              >
                {latestArtifacts.length > 0 ? (
                  <div className="space-y-2">
                    {latestArtifacts.map(artifact => (
                      <div
                        key={artifact.id}
                        className="rounded-[18px] border border-stone-200/80 bg-stone-50/85 px-3 py-3"
                      >
                        <div className="text-sm font-semibold text-stone-900">
                          {artifact.title}
                        </div>
                        <div className="mt-1 text-xs leading-6 text-stone-500">
                          {compactText(
                            artifact.description || artifact.filename || copy.tasks.detailView.noDetail,
                            120
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                    {t(
                      locale,
                      "当前还没有可展示的交付物或附件。",
                      "There are no artifacts or attachments to show yet."
                    )}
                  </div>
                )}
              </ProgressiveItem>

              <ProgressiveItem
                value="history"
                title={t(locale, "最近历史", "Recent history")}
                description={t(
                  locale,
                  "保留最近的真实运行信号，帮助判断任务是否还在推进。",
                  "Keep the latest runtime signals visible so you can judge whether the mission is still progressing."
                )}
                meta={latestTimeline.length > 0 ? String(latestTimeline.length) : copy.common.unavailable}
              >
                {latestTimeline.length > 0 ? (
                  <div className="space-y-2">
                    {latestTimeline.map(item => (
                      <div
                        key={item.id}
                        className="rounded-[18px] border border-stone-200/80 bg-stone-50/85 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-stone-900">
                              {item.title}
                            </div>
                            <div className="mt-1 text-xs leading-6 text-stone-500">
                              {compactText(item.description, 140)}
                            </div>
                          </div>
                          <div className="shrink-0 text-[10px] text-stone-400">
                            {formatTaskRelative(item.time, locale)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                    {t(
                      locale,
                      "当前还没有可显示的时间线事件。",
                      "There are no timeline events to show yet."
                    )}
                  </div>
                )}
              </ProgressiveItem>

              <ProgressiveItem
                value="detail"
                title={t(locale, "完整详情工作区", "Full detail workspace")}
                description={t(
                  locale,
                  "这里保留原有的执行、决策、交付物和成本细节，不删能力，只后置层级。",
                  "Keep the original execution, decision, artifact, and cost detail here without removing capability."
                )}
                meta={t(locale, "保留原详情", "Preserved")}
              >
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
                  autoHeight
                  className="pt-1"
                />
              </ProgressiveItem>
            </Accordion>
          </section>
        </div>
      </div>
    </div>
  );
}
