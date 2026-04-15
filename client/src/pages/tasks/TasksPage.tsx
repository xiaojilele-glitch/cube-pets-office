import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { UnifiedLaunchComposer } from "@/components/launch/UnifiedLaunchComposer";
import { CreateMissionDialog } from "@/components/tasks/CreateMissionDialog";
import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import { TasksQueueRail } from "@/components/tasks/TasksQueueRail";
import { useViewportTier, useViewportWidth } from "@/hooks/useViewportTier";
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
  const { copy } = useI18n();
  const { isMobile } = useViewportTier();
  const width = useViewportWidth();
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

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const isWideDesktop = width >= 1280;
  const isLockedCockpit = width >= 1440 && !isMobile;

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

  useEffect(() => {
    if (!highlightedTaskId || typeof window === "undefined") {
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
  }, [highlightedTaskId]);

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
  const selectedTaskSummary =
    tasks.find(task => task.id === activeTaskId) || null;
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
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
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
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : copy.tasks.listPage.actionError;
      toast.error(message);
      throw submitError;
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

  const refreshCurrent = () =>
    void refresh({ preferredTaskId: activeTaskId || null });

  return (
    <div
      className={cn(
        "workspace-page text-stone-900",
        isMobile
          ? "min-h-screen pb-28 pt-[calc(env(safe-area-inset-top)+96px)]"
          : isLockedCockpit
            ? "h-screen overflow-hidden"
            : "min-h-screen pb-32 pt-3",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1720px] flex-col px-3 md:px-4",
          isLockedCockpit ? "h-full py-4" : "min-h-screen py-3"
        )}
      >
        {isWideDesktop ? (
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-3 xl:grid-cols-[296px_minmax(0,1fr)]",
              isLockedCockpit && "overflow-hidden"
            )}
          >
            <TasksQueueRail
              tasks={filteredTasks}
              totalCount={tasks.length}
              activeTaskId={activeTaskId}
              highlightedTaskId={highlightedTaskId}
              loading={loading}
              ready={ready}
              error={error}
              search={search}
              onSearchChange={setSearch}
              onSelectTask={taskId => {
                startTransition(() => {
                  selectTask(taskId);
                });
              }}
              onRefresh={refreshCurrent}
              className={cn(
                isLockedCockpit ? "h-full min-h-0" : "min-h-[640px]"
              )}
            />

            <div className="min-w-0 flex min-h-0 flex-col gap-3">
              <UnifiedLaunchComposer
                createMission={createMission}
                activeTaskTitle={selectedTaskSummary?.title}
                activeTaskDetail={selectedDetail}
                operatorActionLoading={
                  activeTaskId
                    ? (operatorActionLoadingByMissionId[activeTaskId] ?? {})
                    : {}
                }
                onSubmitOperatorAction={handleSubmitOperatorAction}
                onTaskResolved={handleTaskHubResolved}
                onOpenCreateDialog={() => setCreateDialogOpen(true)}
                onRefresh={refreshCurrent}
                refreshing={loading && ready}
                onWorkflowResolved={resolution => {
                  if (!resolution.missionId) {
                    return;
                  }
                  handleTaskHubResolved({
                    commandId: resolution.workflowId,
                    commandText: resolution.directive,
                    missionId: resolution.missionId,
                    relatedMissionIds: [resolution.missionId],
                    autoSelectedMissionId: resolution.missionId,
                    status: "created",
                    createdAt: resolution.requestedAt,
                  });
                }}
                className={cn(isLockedCockpit && "shrink-0 xl:min-h-[304px]")}
              />

              <TasksCockpitDetail
                detail={selectedDetail}
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
                onDecisionSubmitted={refreshCurrent}
                className="min-h-0 flex-1"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <UnifiedLaunchComposer
              createMission={createMission}
              activeTaskTitle={selectedTaskSummary?.title}
              activeTaskDetail={selectedDetail}
              operatorActionLoading={
                activeTaskId
                  ? (operatorActionLoadingByMissionId[activeTaskId] ?? {})
                  : {}
              }
              onSubmitOperatorAction={handleSubmitOperatorAction}
              onTaskResolved={handleTaskHubResolved}
              onOpenCreateDialog={() => setCreateDialogOpen(true)}
              onRefresh={refreshCurrent}
              refreshing={loading && ready}
              onWorkflowResolved={resolution => {
                if (!resolution.missionId) {
                  return;
                }
                handleTaskHubResolved({
                  commandId: resolution.workflowId,
                  commandText: resolution.directive,
                  missionId: resolution.missionId,
                  relatedMissionIds: [resolution.missionId],
                  autoSelectedMissionId: resolution.missionId,
                  status: "created",
                  createdAt: resolution.requestedAt,
                });
              }}
            />

            <TasksQueueRail
              tasks={filteredTasks}
              totalCount={tasks.length}
              activeTaskId={activeTaskId}
              highlightedTaskId={highlightedTaskId}
              loading={loading}
              ready={ready}
              error={error}
              search={search}
              onSearchChange={setSearch}
              onSelectTask={taskId => {
                startTransition(() => {
                  selectTask(taskId);
                });
              }}
              onRefresh={refreshCurrent}
              className="min-h-[320px] max-h-[460px]"
            />

            <TasksCockpitDetail
              detail={selectedDetail}
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
              onDecisionSubmitted={refreshCurrent}
            />
          </div>
        )}
      </div>

      <CreateMissionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateMission}
      />
    </div>
  );
}
