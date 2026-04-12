import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FolderKanban,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { CreateMissionDialog } from "@/components/tasks/CreateMissionDialog";
import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { TaskDetailView } from "@/components/tasks/TaskDetailView";
import { TaskHubCommandPanel } from "@/components/nl-command/TaskHubCommandPanel";
import {
  compactText,
  formatTaskRelative,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
  missionStatusTone,
} from "@/components/tasks/task-helpers";
import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { workspaceStatusClass } from "@/components/workspace/workspace-tone";
import { useI18n } from "@/i18n";
import type { TaskHubCommandSubmissionResult } from "@/lib/nl-command-store";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

import { resolveTaskHubLocationUpdate } from "./task-hub-location";

export default function TasksPage({
  initialTaskId = null,
  className,
}: {
  initialTaskId?: string | null;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const ensureReady = useTasksStore(state => state.ensureReady);
  const refresh = useTasksStore(state => state.refresh);
  const selectTask = useTasksStore(state => state.selectTask);
  const createMission = useTasksStore(state => state.createMission);
  const submitOperatorAction = useTasksStore(
    state => state.submitOperatorAction
  );
  const setDecisionNote = useTasksStore(state => state.setDecisionNote);
  const launchDecision = useTasksStore(state => state.launchDecision);
  const tasks = useTasksStore(state => state.tasks);
  const detailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const loading = useTasksStore(state => state.loading);
  const ready = useTasksStore(state => state.ready);
  const error = useTasksStore(state => state.error);
  const decisionNotes = useTasksStore(state => state.decisionNotes);
  const operatorActionLoadingByMissionId = useTasksStore(
    state => state.operatorActionLoadingByMissionId
  );
  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [launchingPresetId, setLaunchingPresetId] = useState<string | null>(
    null
  );
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const taskButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  useEffect(() => {
    if (initialTaskId) {
      startTransition(() => {
        selectTask(initialTaskId);
      });
    }
  }, [initialTaskId, selectTask]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setCreateDialogOpen(true);
    }
  }, []);

  const filteredTasks = useMemo(() => {
    if (!deferredSearch) return tasks;
    return tasks.filter(task => {
      const searchable = [
        task.title,
        task.sourceText,
        task.summary,
        task.currentStageLabel,
        task.waitingFor,
        ...task.departmentLabels,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(deferredSearch);
    });
  }, [deferredSearch, tasks]);

  useEffect(() => {
    if (!highlightedTaskId) {
      return;
    }

    const button = taskButtonRefs.current.get(highlightedTaskId);
    if (button) {
      button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    if (typeof window === "undefined") {
      return;
    }

    const timer = window.setTimeout(() => {
      setHighlightedTaskId(current =>
        current === highlightedTaskId ? null : current
      );
    }, 2400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [filteredTasks, highlightedTaskId]);

  const activeTaskId =
    (selectedTaskId && detailsById[selectedTaskId] ? selectedTaskId : null) ||
    filteredTasks[0]?.id ||
    null;
  const selectedDetail = activeTaskId
    ? detailsById[activeTaskId] || null
    : null;
  const decisionNote = activeTaskId ? decisionNotes[activeTaskId] || "" : "";

  async function handleLaunchDecision(presetId: string) {
    if (!activeTaskId) return;
    setLaunchingPresetId(presetId);
    try {
      await launchDecision(activeTaskId, presetId);
    } finally {
      setLaunchingPresetId(null);
    }
  }

  async function handleCreateMission(input: {
    title?: string;
    sourceText?: string;
    kind?: string;
    topicId?: string;
    autoDispatch?: boolean;
  }) {
    try {
      const missionId = await createMission(input);
      if (missionId) {
        toast.success(copy.tasks.listPage.createSuccess);
      }
      return missionId;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy.tasks.listPage.createError;
      toast.error(message);
      return null;
    }
  }

  async function handleSubmitOperatorAction(payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) {
    if (!activeTaskId) return;
    try {
      await submitOperatorAction(activeTaskId, {
        action: payload.action,
        reason: payload.reason,
      });
      toast.success(
        copy.tasks.listPage.actionSuccess(
          copy.tasks.statuses.action[
            payload.action === "mark-blocked" ? "markBlocked" : payload.action
          ]
        )
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy.tasks.listPage.actionError;
      toast.error(message);
      throw error;
    }
  }

  function handleTaskHubResolved(result: TaskHubCommandSubmissionResult) {
    const locationUpdate = resolveTaskHubLocationUpdate({
      missionId: result.autoSelectedMissionId || result.missionId,
      currentSearch: search,
      filteredTaskIds: filteredTasks.map(task => task.id),
      allTaskIds: tasks.map(task => task.id),
    });

    if (locationUpdate.nextSearch !== search) {
      setSearch(locationUpdate.nextSearch);
    }

    if (locationUpdate.focusTaskId) {
      startTransition(() => {
        selectTask(locationUpdate.focusTaskId);
      });
    }

    if (locationUpdate.highlightTaskId) {
      setHighlightedTaskId(locationUpdate.highlightTaskId);
    }
  }

  return (
    <div
      className={cn(
        "workspace-page min-h-screen pb-28 pt-[calc(env(safe-area-inset-top)+96px)] text-stone-900 md:pb-36 md:pt-0 xl:h-[100svh] xl:overflow-hidden",
        className
      )}
    >
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-3 py-3 md:px-5 md:py-4 xl:h-full xl:min-h-0">
        <header className="workspace-shell shrink-0 rounded-[28px] px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="workspace-eyebrow">
                {copy.tasks.listPage.eyebrow}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--workspace-text-strong)] md:text-[2rem]">
                {copy.tasks.listPage.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--workspace-text-muted)] md:line-clamp-2">
                {copy.tasks.listPage.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="rounded-full bg-[linear-gradient(180deg,#c98257,#b86f45)] text-white shadow-[0_14px_28px_rgba(184,111,69,0.22)] hover:brightness-105"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="size-4" />
                {copy.tasks.listPage.create}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="workspace-control rounded-full"
                onClick={() =>
                  void refresh({ preferredTaskId: activeTaskId || null })
                }
              >
                <RefreshCw className="size-4" />
                {copy.tasks.listPage.refresh}
              </Button>
            </div>
          </div>
        </header>

        <TaskHubCommandPanel
          createMission={createMission}
          tasks={tasks}
          onTaskResolved={handleTaskHubResolved}
        />

        <div className="mt-3 grid min-h-0 flex-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="workspace-panel workspace-panel-strong flex min-h-0 flex-col overflow-hidden rounded-[28px]">
            <div className="shrink-0 border-b border-stone-200/80 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                    {copy.tasks.listPage.queueTitle}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
                    {copy.tasks.listPage.visibleCount(
                      filteredTasks.length,
                      tasks.length
                    )}
                  </div>
                </div>
                {loading && !ready ? (
                  <LoaderCircle className="size-4 animate-spin text-stone-500" />
                ) : null}
              </div>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={copy.tasks.listPage.searchPlaceholder}
                  className="workspace-control rounded-full border-none pl-10"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2.5 px-3 py-3">
                {error ? (
                  <RetryInlineNotice
                    title={copy.chat.errorTitle}
                    description={error}
                    actionLabel={copy.tasks.listPage.refresh}
                    onRetry={() =>
                      void refresh({ preferredTaskId: activeTaskId || null })
                    }
                  />
                ) : null}

                {!error && filteredTasks.length === 0 && !loading ? (
                  <EmptyHintBlock
                    icon={<FolderKanban className="size-5" />}
                    title={copy.tasks.listPage.emptyTitle}
                    description={copy.tasks.listPage.emptyDescription}
                    hint={copy.tasks.listPage.searchPlaceholder}
                    tone="info"
                  />
                ) : null}

                {filteredTasks.map(task => {
                  const active = task.id === activeTaskId;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      ref={node => {
                        if (node) {
                          taskButtonRefs.current.set(task.id, node);
                          return;
                        }

                        taskButtonRefs.current.delete(task.id);
                      }}
                      className={cn(
                        "w-full rounded-[22px] border px-3.5 py-3.5 text-left transition-all",
                        active
                          ? "border-[rgba(201,130,87,0.32)] bg-[linear-gradient(180deg,rgba(255,249,235,0.96),rgba(255,243,224,0.94))] shadow-[0_16px_44px_rgba(164,113,29,0.12)]"
                          : "border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.52)] hover:border-[rgba(151,120,90,0.3)] hover:bg-[rgba(255,255,255,0.72)]",
                        task.id === highlightedTaskId &&
                          "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#fff7eb]"
                      )}
                      onClick={() => {
                        startTransition(() => {
                          selectTask(task.id);
                        });
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={cn(
                                "workspace-status px-2.5 py-1 text-[11px]",
                                missionStatusTone(task.status)
                              )}
                            >
                              {missionStatusLabel(task.status, locale)}
                            </span>
                            {task.operatorState !== "active" ? (
                              <span
                                className={cn(
                                  "workspace-status px-2.5 py-1 text-[11px]",
                                  missionOperatorStateTone(task.operatorState)
                                )}
                              >
                                {missionOperatorStateLabel(
                                  task.operatorState,
                                  locale
                                )}
                              </span>
                            ) : null}
                            {task.hasWarnings ? (
                              <span
                                className={workspaceStatusClass(
                                  "warning",
                                  "px-2.5 py-1 text-[11px]"
                                )}
                              >
                                {copy.tasks.listPage.warnings}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2.5 line-clamp-2 text-sm font-medium leading-6 text-stone-900">
                            {task.title}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-stone-500">
                          <div>{task.progress}%</div>
                          <div className="mt-1">
                            {formatTaskRelative(task.updatedAt, locale)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 text-xs leading-5 text-stone-500">
                        {task.currentStageLabel || copy.tasks.listPage.noStage}
                        {task.waitingFor ? ` • ${task.waitingFor}` : ""}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-stone-600">
                        {compactText(task.summary || task.sourceText, 160)}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-stone-500">
                        <span
                          className={workspaceStatusClass(
                            "neutral",
                            "px-2.5 py-1 text-[11px] font-medium"
                          )}
                        >
                          {copy.tasks.listPage.tasksCount(task.taskCount)}
                        </span>
                        <span
                          className={workspaceStatusClass(
                            "neutral",
                            "px-2.5 py-1 text-[11px] font-medium"
                          )}
                        >
                          {copy.tasks.listPage.messagesCount(task.messageCount)}
                        </span>
                        <span
                          className={workspaceStatusClass(
                            "neutral",
                            "px-2.5 py-1 text-[11px] font-medium"
                          )}
                        >
                          {copy.tasks.listPage.attachmentsCount(
                            task.attachmentCount
                          )}
                        </span>
                        {task.attempt > 1 ? (
                          <span
                            className={workspaceStatusClass(
                              "neutral",
                              "px-2.5 py-1 text-[11px] font-medium"
                            )}
                          >
                            {copy.tasks.listPage.attemptCount(task.attempt)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          <main className="min-w-0 xl:min-h-0 xl:overflow-hidden">
            <TaskDetailView
              detail={selectedDetail || null}
              decisionNote={decisionNote}
              onDecisionNoteChange={value => {
                if (!activeTaskId) return;
                setDecisionNote(activeTaskId, value);
              }}
              onLaunchDecision={handleLaunchDecision}
              launchingPresetId={launchingPresetId}
              onSubmitOperatorAction={handleSubmitOperatorAction}
              operatorActionLoading={
                activeTaskId
                  ? (operatorActionLoadingByMissionId[activeTaskId] ?? {})
                  : {}
              }
              onDecisionSubmitted={() =>
                void refresh({ preferredTaskId: activeTaskId || null })
              }
              className="min-w-0 xl:h-full xl:min-h-0"
            />
          </main>
        </div>
      </div>

      <CreateMissionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateMission}
      />
    </div>
  );
}
