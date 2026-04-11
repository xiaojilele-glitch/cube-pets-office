import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
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
import {
  compactText,
  formatTaskRelative,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
  missionStatusTone,
} from "@/components/tasks/task-helpers";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

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
  const submitOperatorAction = useTasksStore(state => state.submitOperatorAction);
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
  }) {
    try {
      const missionId = await createMission(input);
      if (missionId) {
        toast.success(copy.tasks.listPage.createSuccess);
      }
      return missionId;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : copy.tasks.listPage.createError;
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

  return (
    <div
      className={cn(
        "min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.1),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.1),transparent_22%),linear-gradient(180deg,#fffdf8,#f3ecdf)] text-stone-900 xl:h-[100svh] xl:overflow-hidden",
        className
      )}
    >
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-3 py-3 md:px-5 md:py-4 xl:h-full xl:min-h-0">
        <header className="shrink-0 rounded-[28px] border border-stone-200/80 bg-white/75 px-4 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur md:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-stone-500">
                {copy.tasks.listPage.eyebrow}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900 md:text-[2rem]">
                {copy.tasks.listPage.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 md:line-clamp-2">
                {copy.tasks.listPage.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="rounded-full bg-[#d07a4f] text-white hover:bg-[#c26d42]"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="size-4" />
                {copy.tasks.listPage.create}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-stone-200 bg-white/80"
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

        <div className="mt-3 grid min-h-0 flex-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-stone-200/80 bg-white/78 shadow-[0_24px_70px_rgba(112,84,51,0.08)] backdrop-blur">
            <div className="shrink-0 border-b border-stone-200/80 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-stone-900">
                    {copy.tasks.listPage.queueTitle}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-stone-500">
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
                  className="rounded-full border-stone-200 bg-stone-50/80 pl-10"
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
                  <Empty className="rounded-[28px] border-stone-300/90 bg-stone-50/70">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FolderKanban />
                      </EmptyMedia>
                      <EmptyTitle>{copy.tasks.listPage.emptyTitle}</EmptyTitle>
                      <EmptyDescription>
                        {copy.tasks.listPage.emptyDescription}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : null}

                {filteredTasks.map(task => {
                  const active = task.id === activeTaskId;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[22px] border px-3.5 py-3.5 text-left transition-all",
                        active
                          ? "border-amber-300 bg-[linear-gradient(180deg,rgba(255,249,235,0.96),rgba(255,243,224,0.94))] shadow-[0_16px_44px_rgba(164,113,29,0.12)]"
                          : "border-stone-200/80 bg-stone-50/70 hover:border-stone-300 hover:bg-white/85"
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
                                "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                                missionStatusTone(task.status)
                              )}
                            >
                              {missionStatusLabel(task.status, locale)}
                            </span>
                            {task.operatorState !== "active" ? (
                              <span
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-[11px] font-semibold",
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
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
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
                        <span className="rounded-full border border-white/80 bg-white/70 px-2.5 py-1">
                          {copy.tasks.listPage.tasksCount(task.taskCount)}
                        </span>
                        <span className="rounded-full border border-white/80 bg-white/70 px-2.5 py-1">
                          {copy.tasks.listPage.messagesCount(task.messageCount)}
                        </span>
                        <span className="rounded-full border border-white/80 bg-white/70 px-2.5 py-1">
                          {copy.tasks.listPage.attachmentsCount(
                            task.attachmentCount
                          )}
                        </span>
                        {task.attempt > 1 ? (
                          <span className="rounded-full border border-white/80 bg-white/70 px-2.5 py-1">
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
                  ? operatorActionLoadingByMissionId[activeTaskId] ?? {}
                  : {}
              }
              onDecisionSubmitted={() => void refresh({ preferredTaskId: activeTaskId || null })}
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
