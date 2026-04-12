import { AlertTriangle, CheckCircle2, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
        "rounded-[18px] border px-3 py-3",
        tone === "neutral"
          ? "border-stone-200/80 bg-white/78 text-stone-700"
          : workspaceToneClass(tone)
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
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
  className,
}: {
  createMission: TaskHubCreateMission;
  tasks: MissionTaskSummary[];
  activeTask: MissionTaskSummary | null;
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  onOpenCreateDialog: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const loading = useNLCommandStore(state => state.loading);
  const error = useNLCommandStore(state => state.error);
  const currentCommand = useNLCommandStore(state => state.currentCommand);
  const currentAnalysis = useNLCommandStore(state => state.currentAnalysis);
  const currentDialog = useNLCommandStore(state => state.currentDialog);
  const currentPlan = useNLCommandStore(state => state.currentPlan);
  const commands = useNLCommandStore(state => state.commands);
  const lastSubmission = useNLCommandStore(state => state.lastSubmission);
  const setDraftText = useNLCommandStore(state => state.setDraftText);
  const submitTaskHubCommand = useNLCommandStore(
    state => state.submitTaskHubCommand
  );
  const submitTaskHubClarification = useNLCommandStore(
    state => state.submitTaskHubClarification
  );
  const clearError = useNLCommandStore(state => state.clearError);

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
  const commandSummary = currentCommand?.commandText || activeTask?.title || "";
  const landingText = lastSubmission?.missionId
    ? lastSubmission.missionId
    : currentDialog?.status === "active"
      ? t(locale, "补全问题后创建", "Created after clarification")
      : t(locale, "尚未创建任务", "No mission created");

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
            "这条指令已转成任务，并自动聚焦到任务驾驶舱。",
            "The command was turned into a mission and focused in the cockpit."
          )
        );
        onTaskResolved?.(result);
        return;
      }

      toast(
        t(
          locale,
          "先补完下方缺失上下文，任务才会创建。",
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

  return (
    <section
      className={cn(
        "grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_360px]",
        className
      )}
    >
      <div className="workspace-panel workspace-panel-strong overflow-hidden rounded-[30px] px-4 py-4 md:px-5">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-4xl">
              <div className="workspace-eyebrow">{copy.tasks.listPage.eyebrow}</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--workspace-text-strong)]">
                {copy.tasks.listPage.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--workspace-text-muted)]">
                {t(
                  locale,
                  "首屏优先处理任务指令、补充澄清和当前任务落点，队列与详情在同一页闭环推进。",
                  "Prioritize commands, clarifications, and task landing on the first screen while the queue and detail stay in the same loop."
                )}
              </p>
            </div>

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
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
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
              onSubmit={handleSubmit}
              onTextChange={setDraftText}
              loading={loading}
              commandHistory={commands.map(command => command.commandText)}
              label={t(locale, "输入任务指令", "Enter task command")}
              placeholder={t(
                locale,
                "例如：本周内重构支付模块，要求不停机并准备可回滚方案",
                'Example: "Refactor the payment module this week with zero downtime and a rollback plan"'
              )}
              submitLabel={t(locale, "运行指令", "Run command")}
              sendingLabel={t(locale, "运行中...", "Running...")}
            />

            {currentDialog && currentDialog.status === "active" ? (
              <div className="mt-4">
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
      </div>

      <div className="workspace-panel overflow-hidden rounded-[30px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,249,240,0.94),rgba(255,255,255,0.88))] px-4 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                {t(locale, "落点摘要", "Landing Summary")}
              </div>
              <div className="mt-2 text-base font-semibold text-stone-900">
                {statusLabel}
              </div>
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

          <div className="mt-3 rounded-[22px] border border-stone-200/80 bg-white/82 px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              {t(locale, "当前指令", "Current command")}
            </div>
            <div className="mt-1.5 text-sm font-medium leading-6 text-stone-900">
              {commandSummary
                ? compactText(commandSummary, 76)
                : t(
                    locale,
                    "输入一条自然语言指令，这里会显示任务落点和执行概况。",
                    "Enter a natural-language command to see mission landing and execution shape."
                  )}
            </div>
            {currentAnalysis?.intent ? (
              <div className="mt-1.5 text-xs leading-5 text-stone-500">
                {compactText(currentAnalysis.intent, 92)}
              </div>
            ) : null}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <SummaryMetric
              label={t(locale, "任务落点", "Task landing")}
              value={landingText}
              tone={lastSubmission?.missionId ? "success" : "neutral"}
            />
            <SummaryMetric
              label={t(locale, "执行形态", "Execution shape")}
              value={
                currentPlan
                  ? t(
                      locale,
                      `${currentPlan.missions.length} 条主线 / ${currentPlan.tasks.length} 个执行阶段`,
                      `${currentPlan.missions.length} mission / ${currentPlan.tasks.length} stages`
                    )
                  : t(locale, "等待规划生成", "Waiting for plan")
              }
              tone={currentPlan ? "info" : "neutral"}
            />
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
              tone={warningsCount > 0 ? "warning" : completedCount > 0 ? "success" : "neutral"}
            />
          </div>

          <div className="mt-3 rounded-[22px] border border-stone-200/80 bg-[rgba(255,255,255,0.76)] px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              {lastSubmission?.status === "created" ? (
                <CheckCircle2 className="size-3.5 text-emerald-600" />
              ) : (
                <LoaderCircle className="size-3.5 text-stone-500" />
              )}
              {t(locale, "当前焦点任务", "Current focus task")}
            </div>
            {activeTask ? (
              <>
                <div className="mt-2 text-sm font-semibold leading-6 text-stone-900">
                  {compactText(activeTask.title, 52)}
                </div>
                <div className="mt-1 text-xs leading-5 text-stone-500">
                  {compactText(
                    activeTask.currentStageLabel ||
                      t(locale, "尚未进入执行阶段", "No active stage yet"),
                    48
                  )}
                </div>
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
                      ? t(locale, "有风险信号", "Warnings present")
                      : t(locale, "持续推进中", "Healthy progression")}
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-2 text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "左侧选择一个任务后，这里会显示它的最新落点和节奏。",
                  "Select a task from the queue to pin its latest landing and cadence here."
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
