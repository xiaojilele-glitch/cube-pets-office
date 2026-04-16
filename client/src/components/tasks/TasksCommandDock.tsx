import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { Button } from "@/components/ui/button";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
  workspaceToneClass,
} from "@/components/workspace/workspace-tone";
import { useI18n } from "@/i18n";
import {
  selectTaskHubLaunchSession,
  useNLCommandStore,
  type TaskHubCommandSubmissionResult,
  type TaskHubCreateMission,
} from "@/lib/nl-command-store";
import type { MissionTaskSummary } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

import { compactText, formatTaskRelative } from "./task-helpers";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function SummaryMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "info" | "warning" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-2 py-1.5",
        tone === "neutral"
          ? "border-stone-200/80 bg-white/78 text-stone-700"
          : workspaceToneClass(tone)
      )}
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] opacity-75">
        {label}
      </div>
      <div className="mt-0.5 text-[11px] font-semibold">{value}</div>
    </div>
  );
}

export function TasksCommandDock({
  createMission,
  tasks,
  activeTask,
  onTaskResolved,
  onOpenCreateDialog,
  onRefresh,
  refreshing = false,
  compact = false,
  embedded = false,
  bare = false,
  dense = false,
  hideHeader = false,
  hideActions = false,
  hideInputLabel = false,
  className,
}: {
  createMission: TaskHubCreateMission;
  tasks: MissionTaskSummary[];
  activeTask: MissionTaskSummary | null;
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  onOpenCreateDialog: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  compact?: boolean;
  embedded?: boolean;
  bare?: boolean;
  dense?: boolean;
  hideHeader?: boolean;
  hideActions?: boolean;
  hideInputLabel?: boolean;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const taskHubSession = useNLCommandStore(
    useShallow(selectTaskHubLaunchSession)
  );
  const {
    loading,
    error,
    currentCommand,
    currentAnalysis,
    currentDialog,
    currentPlan,
    draftText,
    lastSubmission,
    commands,
  } = taskHubSession;
  const setDraftText = useNLCommandStore(state => state.setDraftText);
  const submitTaskHubCommand = useNLCommandStore(
    state => state.submitTaskHubCommand
  );
  const submitTaskHubClarification = useNLCommandStore(
    state => state.submitTaskHubClarification
  );
  const clearError = useNLCommandStore(state => state.clearError);
  const commandHistory = useMemo(
    () => commands.map(command => command.commandText),
    [commands]
  );

  const runningCount = tasks.filter(task => task.status === "running").length;
  const waitingCount = tasks.filter(task => task.status === "waiting").length;
  const warningsCount = tasks.filter(task => task.hasWarnings).length;
  const completedCount = tasks.filter(task => task.status === "done").length;

  const statusTone =
    lastSubmission?.status === "created"
      ? "success"
      : currentDialog?.status === "active"
        ? "warning"
        : "neutral";
  const statusLabel =
    lastSubmission?.status === "created"
      ? t(locale, "已落入任务队列", "Landed in queue")
      : currentDialog?.status === "active"
        ? t(locale, "等待补充澄清", "Clarification needed")
        : t(locale, "等待新指令", "Ready for next command");
  const landingText = lastSubmission?.missionId
    ? lastSubmission.missionId
    : currentDialog?.status === "active"
      ? t(locale, "补完问题后创建", "Created after clarification")
      : t(locale, "尚未创建任务", "No mission created");
  const executionShape = currentPlan
    ? t(
        locale,
        `${currentPlan.missions.length} 条主线 / ${currentPlan.tasks.length} 个阶段`,
        `${currentPlan.missions.length} mission / ${currentPlan.tasks.length} stages`
      )
    : t(locale, "等待规划生成", "Waiting for plan");
  const isCompact = compact;
  const isEmbedded = embedded;
  const isBare = bare;
  const isDense = dense;
  const showHeaderCopy = !hideHeader;
  const showHeaderActions = !hideActions;
  const hasTopHeader = showHeaderCopy || showHeaderActions;
  const hasStatusBar = isCompact || isEmbedded;
  const stageText =
    activeTask?.currentStageLabel ||
    t(locale, "尚未进入执行阶段", "No active stage yet");
  const quickSuggestions = useMemo(
    () =>
      [
        activeTask
          ? t(
              locale,
              `继续推进「${activeTask.title}」，先处理当前阻塞并给出下一步。`,
              `Continue "${activeTask.title}" by resolving the current blocker and proposing the next step.`
            )
          : null,
        t(
          locale,
          "新建一个任务：先整理目标、约束、交付物，再自动落入队列。",
          "Create a task by organizing goal, constraints, and deliverable before landing it in the queue."
        ),
        t(
          locale,
          "检查当前任务队列中的高风险项，并给出优先级建议。",
          "Review high-risk items in the current queue and suggest priorities."
        ),
        t(
          locale,
          "针对当前任务生成一版执行拆解、验收标准和回滚预案。",
          "Generate an execution breakdown, acceptance criteria, and rollback plan for the current task."
        ),
      ].filter((item): item is string => Boolean(item)),
    [activeTask, locale]
  );
  const summaryCards = useMemo(
    () => [
      {
        label: t(locale, "落点", "Landing"),
        value: compactText(landingText, 40),
        hint: lastSubmission?.createdAt
          ? formatTaskRelative(lastSubmission.createdAt, locale)
          : t(
              locale,
              "命令提交后会在这里显示任务落点。",
              "The landing result appears here after submission."
            ),
        tone: (lastSubmission?.missionId ? "success" : "neutral") as
          | "neutral"
          | "info"
          | "warning"
          | "success",
      },
      {
        label: t(locale, "执行编排", "Execution shape"),
        value: compactText(executionShape, 40),
        hint: currentAnalysis?.intent
          ? compactText(currentAnalysis.intent, 44)
          : t(
              locale,
              "分析和拆解会同步压到这里。",
              "Analysis and breakdown stay condensed here."
            ),
        tone: (currentPlan ? "info" : "neutral") as
          | "neutral"
          | "info"
          | "warning"
          | "success",
      },
      {
        label: t(locale, "当前焦点", "Current focus"),
        value: activeTask
          ? compactText(activeTask.title, 34)
          : t(locale, "等待选择任务", "Waiting for task selection"),
        hint: activeTask
          ? compactText(stageText, 34)
          : t(
              locale,
              "左侧队列选择后，这里会绑定当前任务。",
              "Selecting a task from the rail binds it here."
            ),
        tone: (activeTask?.hasWarnings
          ? "warning"
          : activeTask
            ? "info"
            : "neutral") as "neutral" | "info" | "warning" | "success",
      },
    ],
    [
      activeTask,
      currentAnalysis?.intent,
      currentPlan,
      executionShape,
      landingText,
      lastSubmission?.createdAt,
      lastSubmission?.missionId,
      locale,
      stageText,
    ]
  );

  async function handleSubmit(commandText: string) {
    try {
      const result = await submitTaskHubCommand({
        commandText,
        userId: "current-user",
        priority: "medium",
        createMission,
      });

      if (result.status === "created" && result.missionId) {
        toast.success(
          t(
            locale,
            "这条指令已经转成任务，并自动聚焦到驾驶台。",
            "The command was turned into a mission and focused in the cockpit."
          )
        );
        onTaskResolved?.(result);
        return;
      }

      toast(
        t(
          locale,
          "先补完下方缺失的上下文，任务才会创建。",
          "Add the missing context below before the mission is created."
        )
      );
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : t(locale, "指令提交失败。", "Command submission failed.")
      );
    }
  }

  async function handleClarificationAnswer(
    questionId: string,
    text: string,
    selectedOptions?: string[]
  ) {
    if (!currentCommand) {
      return;
    }

    try {
      const result = await submitTaskHubClarification(
        currentCommand.commandId,
        {
          answer: {
            questionId,
            text,
            selectedOptions,
            timestamp: Date.now(),
          },
        },
        { createMission }
      );

      if (result?.status === "created" && result.missionId) {
        toast.success(
          t(
            locale,
            "补充信息已完成，任务已经进入主队列。",
            "Clarification is complete and the mission has entered the queue."
          )
        );
        onTaskResolved?.(result);
      }
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : t(locale, "补充信息提交失败。", "Failed to submit clarification.")
      );
    }
  }

  if (isBare && isDense) {
    return (
      <section className={cn("grid h-full min-h-0 gap-2", className)}>
        {error ? (
          <div
            className={workspaceCalloutClass(
              "danger",
              "flex items-start justify-between gap-2 px-3 py-2 text-[11px] leading-5 text-[var(--workspace-danger)]"
            )}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="workspace-control h-auto rounded-full px-2 py-0.5 text-[10px] text-[var(--workspace-danger)] hover:bg-white/70"
              onClick={clearError}
            >
              {t(locale, "收起", "Dismiss")}
            </Button>
          </div>
        ) : null}

        <div className="grid min-h-0 gap-2">
          <div className="min-h-0 rounded-[10px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,244,237,0.92))] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]">
            <div className="flex flex-wrap gap-1">
              <span
                className={workspaceStatusClass(
                  statusTone === "success"
                    ? "success"
                    : statusTone === "warning"
                      ? "warning"
                      : "neutral",
                  "!gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                )}
              >
                {statusLabel}
              </span>
              {currentDialog?.status === "active" ? (
                <span
                  className={workspaceStatusClass(
                    "warning",
                    "!gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                  )}
                >
                  {t(
                    locale,
                    `待补充 ${currentDialog.questions.length} 项`,
                    `${currentDialog.questions.length} clarifications pending`
                  )}
                </span>
              ) : null}
            </div>

            <div className="mt-0.5 flex flex-wrap gap-1">
              <span
                className={workspaceStatusClass(
                  lastSubmission?.missionId ? "success" : "neutral",
                  "max-w-full !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                )}
              >
                {t(locale, "落点", "Landing")} / {compactText(landingText, 24)}
              </span>
              <span
                className={workspaceStatusClass(
                  currentPlan ? "info" : "neutral",
                  "max-w-full !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                )}
              >
                {t(locale, "编排", "Execution")} /{" "}
                {compactText(executionShape, 24)}
              </span>
              {activeTask ? (
                <span
                  className={workspaceStatusClass(
                    activeTask.hasWarnings ? "warning" : "info",
                    "max-w-full !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                  )}
                >
                  {t(locale, "焦点", "Focus")} /{" "}
                  {compactText(activeTask.title, 20)}
                </span>
              ) : null}
              <span
                className={workspaceStatusClass(
                  warningsCount > 0
                    ? "warning"
                    : runningCount > 0
                      ? "info"
                      : completedCount > 0
                        ? "success"
                        : "neutral",
                  "max-w-full !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                )}
              >
                {t(
                  locale,
                  `${runningCount} 运行 / ${waitingCount} 等待`,
                  `${runningCount} running / ${waitingCount} waiting`
                )}
              </span>
            </div>

            <div className="mt-0.5">
              <CommandInput
                value={draftText}
                onSubmit={handleSubmit}
                onTextChange={setDraftText}
                loading={loading}
                commandHistory={commandHistory}
                label={t(locale, "输入任务指令", "Enter task command")}
                placeholder={t(
                  locale,
                  "直接描述目标、约束、交付物和时限，系统会先帮你压成任务结构。",
                  "Describe the goal, constraints, deliverable, and deadline. The dock will shape it into a task first."
                )}
                hideLabel={hideInputLabel}
                dense
                rows={3}
                submitLabel={t(locale, "发送", "Send")}
                sendingLabel={t(locale, "发送中...", "Sending...")}
              />
            </div>

            <div className="mt-1 flex flex-wrap gap-1">
              {quickSuggestions.map(suggestion => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDraftText(suggestion)}
                  className="rounded-full border border-stone-200/80 bg-white/78 px-1.5 py-0.5 text-[8px] font-medium text-stone-600 transition-colors hover:bg-white hover:text-stone-900"
                >
                  {compactText(suggestion, 18)}
                </button>
              ))}
            </div>

            {currentDialog && currentDialog.status === "active" ? (
              <div className="mt-2 max-h-[180px] overflow-y-auto pr-1">
                <ClarificationPanel
                  dialog={currentDialog}
                  onAnswer={handleClarificationAnswer}
                  title={t(locale, "补齐缺失上下文", "Add the missing context")}
                  answerPlaceholder={t(
                    locale,
                    "补充这条指令还缺的关键信息...",
                    "Add the detail this command still needs..."
                  )}
                  answerLabel={t(locale, "提交补充", "Submit detail")}
                  answeringLabel={t(locale, "提交中...", "Submitting...")}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={cn("grid", isDense ? "gap-2" : "gap-3", className)}>
      <div
        className={cn(
          !isBare && "overflow-hidden md:px-5",
          !isBare &&
            (isEmbedded
              ? "rounded-[24px] border border-white/70 bg-white/78 px-4 py-4 shadow-[0_14px_36px_rgba(99,73,45,0.08)]"
              : "workspace-panel workspace-panel-strong rounded-[30px] px-4 py-4")
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          {hasTopHeader ? (
            <div
              className={cn(
                "flex flex-wrap items-start justify-between",
                isDense ? "gap-3" : "gap-4"
              )}
            >
              {showHeaderCopy ? (
                <div className="min-w-0 max-w-4xl">
                  <div className="workspace-eyebrow">
                    {isEmbedded
                      ? t(locale, "快速任务入口", "Direct mission launch")
                      : copy.tasks.listPage.eyebrow}
                  </div>
                  <h1
                    className={cn(
                      "mt-2 font-semibold tracking-tight text-[var(--workspace-text-strong)]",
                      isEmbedded
                        ? "text-[1.1rem]"
                        : isCompact
                          ? "text-[1.35rem]"
                          : "text-2xl"
                    )}
                  >
                    {isEmbedded
                      ? t(
                          locale,
                          "在驾驶台里快速落任务",
                          "Land missions directly in the dock"
                        )
                      : isCompact
                        ? t(locale, "统一任务入口", "Unified task launch")
                        : copy.tasks.listPage.title}
                  </h1>
                  <p
                    className={cn(
                      "mt-2 max-w-3xl text-[var(--workspace-text-muted)]",
                      isEmbedded
                        ? "text-[13px] leading-5"
                        : isCompact
                          ? "text-[13px] leading-5"
                          : "text-sm leading-6"
                    )}
                  >
                    {isEmbedded
                      ? t(
                          locale,
                          "把自然语言指令、澄清问答和落队结果压进一个主操作区里。",
                          "Keep natural-language commands, clarifications, and task landing inside one operator zone."
                        )
                      : isCompact
                        ? t(
                            locale,
                            "在这里快速发起任务、补齐澄清，并把结果稳定落回当前驾驶台。",
                            "Launch missions, resolve clarifications, and land the result back into the cockpit."
                          )
                        : t(
                            locale,
                            "首屏优先处理任务指令、补充澄清和当前任务落点，队列与详情在同一页闭环推进。",
                            "Prioritize commands, clarifications, and task landing on the first screen while the queue and detail stay in the same loop."
                          )}
                  </p>
                </div>
              ) : null}

              {showHeaderActions ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="rounded-full bg-[linear-gradient(180deg,#c98257,#b86f45)] text-white shadow-[0_14px_28px_rgba(184,111,69,0.22)] hover:brightness-105"
                    onClick={onOpenCreateDialog}
                  >
                    <Plus className="size-4" />
                    {copy.tasks.listPage.create}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="workspace-control rounded-full"
                    onClick={onRefresh}
                    disabled={refreshing}
                  >
                    {refreshing ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {copy.tasks.listPage.refresh}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {hasStatusBar ? (
            <div
              className={cn(
                hasTopHeader && (isDense ? "mt-2.5" : "mt-3"),
                "flex flex-wrap gap-2"
              )}
            >
              <span
                className={cn(
                  "workspace-status font-semibold",
                  isDense
                    ? "px-2 py-0.5 text-[10px]"
                    : "px-2.5 py-1 text-[10px]",
                  statusTone === "success"
                    ? workspaceStatusClass("success", "")
                    : statusTone === "warning"
                      ? workspaceStatusClass("warning", "")
                      : workspaceStatusClass("neutral", "")
                )}
              >
                {statusLabel}
              </span>
              <span
                className={workspaceStatusClass(
                  "neutral",
                  isDense
                    ? "px-2 py-0.5 text-[10px] font-semibold"
                    : "px-2.5 py-1 text-[10px] font-semibold"
                )}
              >
                {t(
                  locale,
                  `${runningCount} 运行 / ${waitingCount} 等待`,
                  `${runningCount} running / ${waitingCount} waiting`
                )}
              </span>
              <span
                className={workspaceStatusClass(
                  warningsCount > 0
                    ? "warning"
                    : completedCount > 0
                      ? "success"
                      : "neutral",
                  isDense
                    ? "px-2 py-0.5 text-[10px] font-semibold"
                    : "px-2.5 py-1 text-[10px] font-semibold"
                )}
              >
                {t(
                  locale,
                  `${completedCount} 完成 / ${warningsCount} 关注`,
                  `${completedCount} done / ${warningsCount} warnings`
                )}
              </span>
              {activeTask ? (
                <span
                  className={workspaceStatusClass(
                    activeTask.hasWarnings ? "warning" : "info",
                    isDense
                      ? "max-w-full px-2 py-0.5 text-[10px] font-semibold"
                      : "max-w-full px-2.5 py-1 text-[10px] font-semibold"
                  )}
                >
                  {compactText(activeTask.title, 42)}
                </span>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto pr-1",
              hasStatusBar
                ? isDense
                  ? "mt-2"
                  : "mt-3"
                : hasTopHeader
                  ? isDense
                    ? "mt-3"
                    : "mt-4"
                  : ""
            )}
          >
            {error ? (
              <div
                className={workspaceCalloutClass(
                  "danger",
                  "mb-4 flex items-start justify-between gap-3 px-4 py-3 text-sm leading-6 text-[var(--workspace-danger)]"
                )}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="workspace-control h-auto rounded-full px-3 py-1 text-[var(--workspace-danger)] hover:bg-white/70"
                  onClick={clearError}
                >
                  {t(locale, "收起", "Dismiss")}
                </Button>
              </div>
            ) : null}

            <CommandInput
              value={draftText}
              onSubmit={handleSubmit}
              onTextChange={setDraftText}
              loading={loading}
              commandHistory={commandHistory}
              label={t(locale, "输入任务指令", "Enter task command")}
              placeholder={t(
                locale,
                "例如：本周内重构支付模块，要求不停机并准备可回滚方案",
                'Example: "Refactor the payment module this week with zero downtime and a rollback plan"'
              )}
              hideLabel={hideInputLabel}
              dense={isDense}
              rows={isDense ? 3 : 2}
              submitLabel={t(locale, "运行指令", "Run command")}
              sendingLabel={t(locale, "运行中...", "Running...")}
            />

            {currentDialog && currentDialog.status === "active" ? (
              <div className={isDense ? "mt-3" : "mt-4"}>
                <ClarificationPanel
                  dialog={currentDialog}
                  onAnswer={handleClarificationAnswer}
                  title={t(locale, "补齐缺失上下文", "Add the missing context")}
                  answerPlaceholder={t(
                    locale,
                    "补充这条指令还缺的关键信息...",
                    "Add the detail this command still needs..."
                  )}
                  answerLabel={t(locale, "提交补充", "Submit detail")}
                  answeringLabel={t(locale, "提交中...", "Submitting...")}
                />
              </div>
            ) : null}

            {!isCompact && !isEmbedded ? (
              <div className="mt-4 rounded-[24px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,249,240,0.92),rgba(255,255,255,0.86))] px-3.5 py-3 shadow-[0_14px_32px_rgba(112,84,51,0.07)] backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                    {lastSubmission?.status === "created" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : (
                      <LoaderCircle className="size-3.5 text-stone-500" />
                    )}
                    {t(locale, "落点摘要", "Landing Summary")}
                  </div>
                  <span
                    className={cn(
                      "workspace-status px-2.5 py-1 text-[10px] font-semibold",
                      statusTone === "success"
                        ? workspaceStatusClass("success", "")
                        : statusTone === "warning"
                          ? workspaceStatusClass("warning", "")
                          : workspaceStatusClass("neutral", "")
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className={workspaceStatusClass(
                      lastSubmission?.missionId ? "success" : "neutral",
                      "max-w-full px-2.5 py-1 text-[10px] font-semibold"
                    )}
                  >
                    {t(locale, "落点", "Landing")} 路{" "}
                    {compactText(landingText, 32)}
                  </span>
                  <span
                    className={workspaceStatusClass(
                      currentPlan ? "info" : "neutral",
                      "max-w-full px-2.5 py-1 text-[10px] font-semibold"
                    )}
                  >
                    {t(locale, "执行形态", "Execution shape")} 路{" "}
                    {compactText(executionShape, 36)}
                  </span>
                  {activeTask ? (
                    <span
                      className={workspaceStatusClass(
                        activeTask.hasWarnings ? "warning" : "info",
                        "max-w-full px-2.5 py-1 text-[10px] font-semibold"
                      )}
                    >
                      {t(locale, "焦点", "Focus")} 路{" "}
                      {compactText(activeTask.title, 28)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <SummaryMetric
                    label={t(locale, "运行 / 等待", "Running / waiting")}
                    value={t(
                      locale,
                      `${runningCount} 运行 / ${waitingCount} 等待`,
                      `${runningCount} running / ${waitingCount} waiting`
                    )}
                    tone={runningCount > 0 ? "warning" : "neutral"}
                  />
                  <SummaryMetric
                    label={t(locale, "完成 / 关注", "Done / warnings")}
                    value={t(
                      locale,
                      `${completedCount} 完成 / ${warningsCount} 关注`,
                      `${completedCount} done / ${warningsCount} warnings`
                    )}
                    tone={
                      warningsCount > 0
                        ? "warning"
                        : completedCount > 0
                          ? "success"
                          : "neutral"
                    }
                  />
                  <SummaryMetric
                    label={t(locale, "当前节奏", "Current cadence")}
                    value={
                      activeTask
                        ? compactText(stageText, 40)
                        : t(
                            locale,
                            "等待选择任务",
                            "Waiting for task selection"
                          )
                    }
                    tone={activeTask?.hasWarnings ? "warning" : "info"}
                  />
                </div>

                {activeTask ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
                    <span
                      className={workspaceStatusClass(
                        "neutral",
                        "px-2 py-1 text-[10px] font-medium"
                      )}
                    >
                      {formatTaskRelative(activeTask.updatedAt, locale)}
                    </span>
                    <span
                      className={workspaceStatusClass(
                        activeTask.hasWarnings ? "warning" : "info",
                        "px-2 py-1 text-[10px] font-medium"
                      )}
                    >
                      {activeTask.hasWarnings
                        ? t(locale, "存在风险信号", "Warnings present")
                        : t(locale, "任务推进健康", "Healthy progression")}
                    </span>
                    {currentAnalysis?.intent ? (
                      <span
                        className={workspaceStatusClass(
                          "neutral",
                          "max-w-full px-2 py-1 text-[10px] font-medium"
                        )}
                      >
                        {compactText(currentAnalysis.intent, 44)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
