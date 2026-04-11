import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { CommandMonitorSummary } from "@/components/nl-command/CommandMonitorSummary";
import { CommandPlanSummary } from "@/components/nl-command/CommandPlanSummary";
import { Button } from "@/components/ui/button";
import {
  useNLCommandStore,
  type TaskHubCommandSubmissionResult,
  type TaskHubCreateMission,
} from "@/lib/nl-command-store";
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
          "The command was turned into a mission and focused in the task view."
        );
        onTaskResolved?.(result);
        return;
      }

      toast("Add the missing details below before the mission is created.");
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "Command submission failed."
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
          "Clarification is complete, and the mission has been created in the main queue."
        );
        onTaskResolved?.(result);
      }
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit the clarification."
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
      <div className="rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_24px_70px_rgba(112,84,51,0.08)] backdrop-blur md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
              Task Command Entry
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">
              Issue commands, clarify, and review the plan without leaving tasks
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              This composer feeds natural-language commands into the main task
              thread. Once a command lands, the queue below and the detail pane
              on the right keep the execution moving.
            </p>
          </div>

          {lastSubmission?.missionId ? (
            <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-4" />
                Linked to task context
              </div>
              <div className="mt-1">{lastSubmission.missionId}</div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 flex items-start justify-between gap-3 rounded-[22px] border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm leading-6 text-rose-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto rounded-full px-3 py-1 text-rose-700 hover:bg-rose-100"
              onClick={clearError}
            >
              Dismiss
            </Button>
          </div>
        ) : null}

        <div className="mt-4">
          <CommandInput
            onSubmit={handleSubmit}
            onTextChange={setDraftText}
            loading={loading}
            commandHistory={commands.map(command => command.commandText)}
            label="Enter task command"
            placeholder='Example: "Refactor the payment module this week with zero downtime and a rollback path"'
            submitLabel="Run Command"
            sendingLabel="Running..."
          />
        </div>

        {currentDialog && currentDialog.status === "active" ? (
          <div className="mt-4">
            <ClarificationPanel
              dialog={currentDialog}
              onAnswer={handleClarificationAnswer}
              title="Add the missing context"
              answerPlaceholder="Add the detail this command still needs..."
              answerLabel="Submit Detail"
              answeringLabel="Submitting..."
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
