import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { CommandMonitorSummary } from "@/components/nl-command/CommandMonitorSummary";
import { CommandPlanSummary } from "@/components/nl-command/CommandPlanSummary";
import { Button } from "@/components/ui/button";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
} from "@/components/workspace/workspace-tone";
import {
  useNLCommandStore,
  type TaskHubCommandSubmissionResult,
  type TaskHubCreateMission,
} from "@/lib/nl-command-store";
import { useI18n } from "@/i18n";
import type { MissionTaskSummary } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

export function TaskHubCommandPanel({
  createMission,
  tasks,
  onTaskResolved,
  className,
}: {
  createMission: TaskHubCreateMission;
  tasks: MissionTaskSummary[];
  onTaskResolved?: (result: TaskHubCommandSubmissionResult) => void;
  className?: string;
}) {
  const { locale } = useI18n();
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
  const panelCopy =
    locale === "zh-CN"
      ? {
          createdToast: "这条指令已经转成任务，并自动聚焦到任务视图。",
          needDetailsToast: "请先补完下面缺失的上下文，任务才会创建。",
          submitError: "提交指令失败。",
          clarificationCreatedToast: "补充信息已完成，任务已经进入主队列。",
          clarificationError: "提交补充信息失败。",
          eyebrow: "任务指令入口",
          title: "不离开任务页，也能发指令、补上下文、查看计划落点",
          description:
            "这里会把自然语言指令送进主任务线程。指令落地后，下方队列和右侧详情会接着把执行闭环推进下去。",
          linkedTitle: "已挂到任务上下文",
          dismiss: "收起",
          commandLabel: "输入任务指令",
          commandPlaceholder:
            '例如："本周内重构支付模块，要求不停机并准备可回滚方案"',
          submitLabel: "运行指令",
          sendingLabel: "运行中...",
          clarificationTitle: "补齐缺失上下文",
          clarificationAnswerPlaceholder: "补充这条指令还缺的关键信息...",
          clarificationAnswerLabel: "提交补充",
          clarificationAnswering: "提交中...",
        }
      : {
          createdToast:
            "The command was turned into a mission and focused in the task view.",
          needDetailsToast:
            "Add the missing details below before the mission is created.",
          submitError: "Command submission failed.",
          clarificationCreatedToast:
            "Clarification is complete, and the mission has been created in the main queue.",
          clarificationError: "Failed to submit the clarification.",
          eyebrow: "Task Command Entry",
          title:
            "Issue commands, clarify, and review the plan without leaving tasks",
          description:
            "This composer feeds natural-language commands into the main task thread. Once a command lands, the queue below and the detail pane on the right keep the execution moving.",
          linkedTitle: "Linked to task context",
          dismiss: "Dismiss",
          commandLabel: "Enter task command",
          commandPlaceholder:
            'Example: "Refactor the payment module this week with zero downtime and a rollback path"',
          submitLabel: "Run Command",
          sendingLabel: "Running...",
          clarificationTitle: "Add the missing context",
          clarificationAnswerPlaceholder:
            "Add the detail this command still needs...",
          clarificationAnswerLabel: "Submit Detail",
          clarificationAnswering: "Submitting...",
        };

  async function handleSubmit(commandText: string) {
    try {
      const result = await submitTaskHubCommand({
        commandText,
        userId: "current-user",
        priority: "medium",
        createMission,
      });

      if (result.status === "created" && result.missionId) {
        toast.success(panelCopy.createdToast);
        onTaskResolved?.(result);
        return;
      }

      toast(panelCopy.needDetailsToast);
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : panelCopy.submitError
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
        toast.success(panelCopy.clarificationCreatedToast);
        onTaskResolved?.(result);
      }
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : panelCopy.clarificationError
      );
    }
  }

  return (
    <section
      className={cn(
        "mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_380px]",
        className
      )}
    >
      <div className="workspace-panel workspace-panel-strong rounded-[28px] px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="workspace-eyebrow">{panelCopy.eyebrow}</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">
              {panelCopy.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              {panelCopy.description}
            </p>
          </div>

          {lastSubmission?.missionId ? (
            <div
              className={workspaceCalloutClass(
                "success",
                "px-4 py-3 text-sm text-[var(--workspace-success)]"
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-4" />
                {panelCopy.linkedTitle}
              </div>
              <div className="mt-2">
                <span
                  className={workspaceStatusClass(
                    "neutral",
                    "bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-stone-700"
                  )}
                >
                  {lastSubmission.missionId}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div
            className={workspaceCalloutClass(
              "danger",
              "mt-4 flex items-start justify-between gap-3 px-4 py-3 text-sm leading-6 text-[var(--workspace-danger)]"
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
              {panelCopy.dismiss}
            </Button>
          </div>
        ) : null}

        <div className="mt-4">
          <CommandInput
            onSubmit={handleSubmit}
            onTextChange={setDraftText}
            loading={loading}
            commandHistory={commands.map(command => command.commandText)}
            label={panelCopy.commandLabel}
            placeholder={panelCopy.commandPlaceholder}
            submitLabel={panelCopy.submitLabel}
            sendingLabel={panelCopy.sendingLabel}
          />
        </div>

        {currentDialog && currentDialog.status === "active" ? (
          <div className="mt-4">
            <ClarificationPanel
              dialog={currentDialog}
              onAnswer={handleClarificationAnswer}
              title={panelCopy.clarificationTitle}
              answerPlaceholder={panelCopy.clarificationAnswerPlaceholder}
              answerLabel={panelCopy.clarificationAnswerLabel}
              answeringLabel={panelCopy.clarificationAnswering}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3">
        <CommandPlanSummary
          command={currentCommand}
          analysis={currentAnalysis}
          plan={currentPlan}
          submission={lastSubmission}
        />
        <CommandMonitorSummary tasks={tasks} />
      </div>
    </section>
  );
}
