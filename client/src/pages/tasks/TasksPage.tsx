import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import { TasksQueueRail } from "@/components/tasks/TasksQueueRail";
import {
  compactText,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
  missionStatusTone,
} from "@/components/tasks/task-helpers";
import { useViewportTier, useViewportWidth } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export default function TasksPage({
  initialTaskId = null,
  className,
}: {
  initialTaskId?: string | null;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const { isMobile } = useViewportTier();
  const width = useViewportWidth();
  const ensureReady = useTasksStore(state => state.ensureReady);
  const refresh = useTasksStore(state => state.refresh);
  const selectTask = useTasksStore(state => state.selectTask);
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

  const refreshCurrent = () =>
    void refresh({ preferredTaskId: activeTaskId || null });
  const focusTitle =
    selectedDetail?.title ||
    selectedTaskSummary?.title ||
    t(locale, "等待选择任务", "Pick a task to inspect");
  const focusSignal =
    compactText(
      selectedDetail?.lastSignal ||
        selectedDetail?.summary ||
        selectedTaskSummary?.summary ||
        selectedTaskSummary?.sourceText ||
        t(
          locale,
          "任务页现在只负责展示队列、任务详情和执行轨迹；发起与补充信息入口统一保留在办公室首页。",
          "Tasks is now display-only for queue, details, and execution history. Launch and clarification live on the office home page."
        ),
      220
    ) ||
    t(
      locale,
      "任务页现在只负责展示队列、任务详情和执行轨迹；发起与补充信息入口统一保留在办公室首页。",
      "Tasks is now display-only for queue, details, and execution history. Launch and clarification live on the office home page."
    );
  const focusStage =
    selectedDetail?.currentStageLabel ||
    selectedTaskSummary?.currentStageLabel ||
    t(locale, "等待任务焦点", "Awaiting task focus");
  const focusProgress =
    selectedDetail?.progress ?? selectedTaskSummary?.progress ?? 0;
  const queueSummary = t(
    locale,
    `可见 ${filteredTasks.length} / 共 ${tasks.length} 条`,
    `${filteredTasks.length} visible / ${tasks.length} total`
  );
  const displayOnlyHint = t(
    locale,
    "此页只做查看与跟进，不再承担发起或补问入口。",
    "This page is now read-only for viewing and follow-up, without launch or clarification entry."
  );
  const taskOverviewPanel = (
    <section className="workspace-panel workspace-panel-strong rounded-[28px] border border-stone-200/70 px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="workspace-eyebrow">
            {t(locale, "任务焦点总览", "Task Focus Overview")}
          </div>
          <div className="mt-2 text-xl font-semibold tracking-tight text-stone-900">
            {focusTitle}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-stone-600">
            {focusSignal}
          </p>
        </div>

        <div className="shrink-0 rounded-full border border-stone-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-stone-600">
          {queueSummary}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span
          className={cn(
            "workspace-status px-3 py-1 text-xs font-semibold",
            selectedDetail
              ? missionStatusTone(selectedDetail.status)
              : "workspace-tone-neutral"
          )}
        >
          {selectedDetail
            ? missionStatusLabel(selectedDetail.status, locale)
            : t(locale, "待选择", "No selection")}
        </span>
        <span
          className={cn(
            "workspace-status px-3 py-1 text-xs font-semibold",
            selectedDetail
              ? missionOperatorStateTone(selectedDetail.operatorState)
              : "workspace-tone-neutral"
          )}
        >
          {selectedDetail
            ? missionOperatorStateLabel(selectedDetail.operatorState, locale)
            : t(locale, "只读展示", "Display only")}
        </span>
        <span className="workspace-status workspace-tone-info px-3 py-1 text-xs font-semibold">
          {focusStage}
        </span>
        <span className="workspace-status workspace-tone-neutral px-3 py-1 text-xs font-semibold">
          {t(locale, `进度 ${focusProgress}%`, `Progress ${focusProgress}%`)}
        </span>
        <span className="workspace-status workspace-tone-warning px-3 py-1 text-xs font-semibold">
          {displayOnlyHint}
        </span>
      </div>
    </section>
  );

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
              <div className={cn(isLockedCockpit && "shrink-0")}>
                {taskOverviewPanel}
              </div>

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
            {taskOverviewPanel}

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
    </div>
  );
}
