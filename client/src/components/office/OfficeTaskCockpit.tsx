import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Command, LayoutPanelTop, Settings2, Waves } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { CreateMissionDialog } from "@/components/tasks/CreateMissionDialog";
import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import { TasksCommandDock } from "@/components/tasks/TasksCommandDock";
import { TasksQueueRail } from "@/components/tasks/TasksQueueRail";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import type { TaskHubCommandSubmissionResult } from "@/lib/nl-command-store";
import { useAppStore } from "@/lib/store";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/workflow-store";
import { resolveTaskHubLocationUpdate } from "@/pages/tasks/task-hub-location";

import { OfficeAgentInspectorPanel } from "./OfficeAgentInspectorPanel";
import { OfficeWorkflowLaunchPanel } from "./OfficeWorkflowLaunchPanel";
import {
  OfficeMemoryReportsPanel,
  OfficeWorkflowFlowPanel,
  OfficeWorkflowHistoryPanel,
} from "./OfficeWorkflowContextPanels";
import {
  buildOfficeCockpitAvailability,
  resolveOfficeCockpitTab,
  resolveWorkflowForSelectedTask,
} from "./office-task-cockpit-utils";
import type {
  OfficeCockpitTab,
  OfficeLaunchMode,
  OfficeLaunchResolution,
} from "./office-task-cockpit-types";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function OfficeTaskCockpit({
  onOpenWorkflowPanel,
  onOpenConfig,
  onStartDemo,
  className,
}: {
  onOpenWorkflowPanel: () => void;
  onOpenConfig: () => void;
  onStartDemo?: () => void;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const [, setLocation] = useLocation();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const selectedPet = useAppStore(state => state.selectedPet);
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
  const workflows = useWorkflowStore(state => state.workflows);
  const agents = useWorkflowStore(state => state.agents);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const currentWorkflowId = useWorkflowStore(state => state.currentWorkflowId);
  const fetchWorkflowDetail = useWorkflowStore(
    state => state.fetchWorkflowDetail
  );
  const fetchWorkflows = useWorkflowStore(state => state.fetchWorkflows);
  const setCurrentWorkflow = useWorkflowStore(
    state => state.setCurrentWorkflow
  );

  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [launchMode, setLaunchMode] = useState<OfficeLaunchMode>("mission");
  const [activeTab, setActiveTab] = useState<OfficeCockpitTab>("task");
  const [launchingPresetId, setLaunchingPresetId] = useState<string | null>(
    null
  );
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const [pendingLaunch, setPendingLaunch] =
    useState<OfficeLaunchResolution | null>(null);
  const previousSelectedPetRef = useRef<string | null>(selectedPet);

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  useEffect(() => {
    if (!highlightedTaskId || typeof window === "undefined") {
      return;
    }

    const timer = window.setTimeout(() => {
      setHighlightedTaskId(current =>
        current === highlightedTaskId ? null : current
      );
    }, 2400);

    return () => window.clearTimeout(timer);
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

  const pendingWorkflow =
    (pendingLaunch
      ? workflows.find(workflow => workflow.id === pendingLaunch.workflowId) ||
        null
      : null) ||
    (currentWorkflow &&
    pendingLaunch &&
    currentWorkflow.id === pendingLaunch.workflowId
      ? currentWorkflow
      : null);

  const activeWorkflow = useMemo(() => {
    const selectedWorkflow = resolveWorkflowForSelectedTask({
      taskId: activeTaskId,
      workflows,
      currentWorkflow,
    });

    return (
      pendingWorkflow ||
      selectedWorkflow ||
      (activeTaskId ? null : currentWorkflow)
    );
  }, [activeTaskId, currentWorkflow, pendingWorkflow, workflows]);

  useEffect(() => {
    const workflowForTask = resolveWorkflowForSelectedTask({
      taskId: activeTaskId,
      workflows,
      currentWorkflow,
    });

    if (workflowForTask && workflowForTask.id !== currentWorkflowId) {
      setCurrentWorkflow(workflowForTask.id);
      return;
    }

    if (
      !workflowForTask &&
      !pendingLaunch &&
      activeTaskId &&
      currentWorkflowId
    ) {
      setCurrentWorkflow(null);
    }
  }, [
    activeTaskId,
    currentWorkflow,
    currentWorkflowId,
    pendingLaunch,
    setCurrentWorkflow,
    workflows,
  ]);

  useEffect(() => {
    if (pendingLaunch && pendingLaunch.workflowId !== currentWorkflowId) {
      setCurrentWorkflow(pendingLaunch.workflowId);
    }
  }, [currentWorkflowId, pendingLaunch, setCurrentWorkflow]);

  useEffect(() => {
    if (!pendingLaunch) {
      return;
    }

    const linkedMissionId =
      pendingWorkflow?.missionId ||
      workflows.find(workflow => workflow.id === pendingLaunch.workflowId)
        ?.missionId ||
      null;

    if (linkedMissionId) {
      setPendingLaunch(null);
      setLaunchMode("mission");
      setActiveTab("task");
      startTransition(() => {
        selectTask(linkedMissionId);
      });
      toast.success(
        t(
          locale,
          "团队准备完成，已经自动聚焦到新任务。",
          "Team setup is complete and the new task is now focused."
        )
      );
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchWorkflows();
      void fetchWorkflowDetail(pendingLaunch.workflowId);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [
    fetchWorkflowDetail,
    fetchWorkflows,
    locale,
    pendingLaunch,
    pendingWorkflow,
    selectTask,
    workflows,
  ]);

  useEffect(() => {
    if (selectedPet && selectedPet !== previousSelectedPetRef.current) {
      setActiveTab("agent");
    }
    previousSelectedPetRef.current = selectedPet;
  }, [selectedPet]);

  const availability = useMemo(
    () =>
      buildOfficeCockpitAvailability({
        detail: selectedDetail,
        workflow: activeWorkflow,
        agents,
        workflows,
      }),
    [activeWorkflow, agents, selectedDetail, workflows]
  );

  useEffect(() => {
    setActiveTab(current => resolveOfficeCockpitTab(current, availability));
  }, [availability]);

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
      setActiveTab("task");
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

  const runningCount = tasks.filter(task => task.status === "running").length;
  const waitingCount = tasks.filter(task => task.status === "waiting").length;
  const warningCount = tasks.filter(task => task.hasWarnings).length;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-4 bottom-[96px] top-[76px] z-[52] flex min-h-0 flex-col gap-3 2xl:bottom-[104px]",
        className
      )}
    >
      <section className="pointer-events-auto rounded-[28px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,249,240,0.92),rgba(255,255,255,0.84))] px-4 py-3 shadow-[0_18px_46px_rgba(92,66,40,0.12)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="workspace-eyebrow">
              {t(locale, "办公室任务驾驶舱", "Office task cockpit")}
            </div>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <h1 className="text-[1.2rem] font-semibold tracking-tight text-stone-900">
                {t(locale, "办公室执行舱", "Office execution cockpit")}
              </h1>
              <p className="text-sm text-stone-500">
                {t(
                  locale,
                  "桌面端把队列、场景、详情收进同一屏。",
                  "Queue, scene, and detail now live on one desktop screen."
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-10 rounded-full bg-[#d07a4f] px-4 text-white hover:bg-[#bf6c43]"
              onClick={() => setLocation("/tasks")}
            >
              <LayoutPanelTop className="size-4" />
              {t(locale, "全屏工作台", "Fullscreen workbench")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="workspace-control h-10 rounded-full px-4"
              onClick={onOpenWorkflowPanel}
            >
              <Waves className="size-4" />
              {t(locale, "兼容入口", "Compatibility panel")}
            </Button>
            {onStartDemo ? (
              <Button
                type="button"
                variant="outline"
                className="workspace-control h-10 rounded-full px-4"
                onClick={onStartDemo}
              >
                {t(locale, "演示模式", "Live demo")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="workspace-control h-10 rounded-full px-4"
              onClick={onOpenConfig}
            >
              <Settings2 className="size-4" />
              {copy.home.openConfig}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
            {t(locale, "运行模式", "Runtime")}: {runtimeMode}
          </span>
          <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
            {runningCount} {t(locale, "运行中", "running")}
          </span>
          <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
            {waitingCount} {t(locale, "等待中", "waiting")}
          </span>
          <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
            {warningCount} {t(locale, "关注项", "warnings")}
          </span>
          <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
            {agents.length} {t(locale, "个 Agent", "agents")}
          </span>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-[264px_minmax(0,1fr)_minmax(408px,464px)] gap-3 2xl:grid-cols-[276px_minmax(0,1fr)_minmax(428px,500px)]">
        <aside className="pointer-events-auto min-h-0">
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
            density="compact"
            className="h-full"
          />
        </aside>

        <section className="relative flex min-h-0 flex-col justify-between gap-3">
          <div className="pointer-events-auto mx-auto w-full max-w-[820px]">
            <div className="rounded-[24px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,252,248,0.92),rgba(252,245,235,0.82))] px-4 py-3 shadow-[0_14px_32px_rgba(92,66,40,0.1)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    {t(locale, "场景当前焦点", "Current scene focus")}
                  </div>
                  <div className="mt-1.5 truncate text-base font-semibold text-stone-900">
                    {selectedDetail?.title ||
                      pendingLaunch?.directive ||
                      t(
                        locale,
                        "点击任务或场景 Agent 进入联动",
                        "Pick a task or scene agent to focus"
                      )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
                      {selectedDetail?.currentStageLabel ||
                        t(locale, "等待焦点", "Awaiting focus")}
                    </span>
                    {selectedPet ? (
                      <span className="workspace-status workspace-tone-info px-2.5 py-1 text-[10px] font-semibold">
                        {t(locale, "场景 Agent 已联动", "Scene agent linked")}
                      </span>
                    ) : null}
                    {pendingLaunch ? (
                      <span className="workspace-status workspace-tone-warning px-2.5 py-1 text-[10px] font-semibold">
                        {t(locale, "团队准备中", "Team preparing")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex rounded-full bg-stone-100/90 p-1 shadow-inner">
                  <button
                    type="button"
                    onClick={() => setLaunchMode("mission")}
                    className={cn(
                      "rounded-full px-3 py-2 text-sm font-semibold transition-colors",
                      launchMode === "mission"
                        ? "bg-[#d07a4f] text-white shadow-sm"
                        : "text-stone-600 hover:bg-white/90"
                    )}
                  >
                    <Command className="mr-2 inline size-4" />
                    {t(locale, "快速任务", "Mission mode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLaunchMode("workflow")}
                    className={cn(
                      "rounded-full px-3 py-2 text-sm font-semibold transition-colors",
                      launchMode === "workflow"
                        ? "bg-[#5E8B72] text-white shadow-sm"
                        : "text-stone-600 hover:bg-white/90"
                    )}
                  >
                    <Waves className="mr-2 inline size-4" />
                    {t(locale, "高级发起", "Workflow mode")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-auto mx-auto mt-auto w-full max-w-[940px]">
            <div className="w-full">
              {launchMode === "mission" ? (
                <TasksCommandDock
                  createMission={createMission}
                  tasks={tasks}
                  activeTask={selectedTaskSummary}
                  onTaskResolved={handleTaskHubResolved}
                  onOpenCreateDialog={() => setCreateDialogOpen(true)}
                  onRefresh={refreshCurrent}
                  refreshing={loading && ready}
                  compact
                />
              ) : (
                <OfficeWorkflowLaunchPanel
                  pendingLaunch={pendingLaunch}
                  compact
                  onLaunchSubmitted={resolution => {
                    setPendingLaunch(resolution);
                    setActiveTab("flow");
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <aside className="pointer-events-auto min-h-0">
          <Tabs
            value={activeTab}
            onValueChange={value => setActiveTab(value as OfficeCockpitTab)}
            className="workspace-panel workspace-panel-strong flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-stone-200/80 px-3 py-3 shadow-[0_20px_60px_rgba(99,73,45,0.12)]"
          >
            <TabsList className="grid h-auto w-full grid-cols-5 gap-1 rounded-[18px] bg-stone-100/80 p-1">
              <TabsTrigger
                className="rounded-[14px] px-1.5 py-2 text-[11px] whitespace-nowrap"
                value="task"
              >
                {t(locale, "任务", "Task")}
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[14px] px-1.5 py-2 text-[11px] whitespace-nowrap"
                value="flow"
              >
                {t(locale, "团队", "Flow")}
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[14px] px-1.5 py-2 text-[11px] whitespace-nowrap"
                value="agent"
              >
                Agent
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[14px] px-1.5 py-2 text-[11px] whitespace-nowrap"
                value="memory"
              >
                {t(locale, "记忆", "Memory")}
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[14px] px-1.5 py-2 text-[11px] whitespace-nowrap"
                value="history"
              >
                {t(locale, "历史", "History")}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="task"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
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
                className="h-full"
              />
            </TabsContent>

            <TabsContent
              value="flow"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              <OfficeWorkflowFlowPanel
                workflow={activeWorkflow}
                missionDetail={selectedDetail}
                onOpenTask={taskId => {
                  setActiveTab("task");
                  startTransition(() => {
                    selectTask(taskId);
                  });
                }}
              />
            </TabsContent>

            <TabsContent
              value="agent"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              {agents.length > 0 ? (
                <OfficeAgentInspectorPanel className="h-full" />
              ) : (
                <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-stone-300/80 bg-white/62 px-8 py-10 text-center text-sm leading-6 text-stone-500">
                  {t(
                    locale,
                    "场景 Agent 建立后，这里会显示办公室 Agent 详情。",
                    "Once scene agents are available, this tab shows the office agent detail view."
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent
              value="memory"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              <OfficeMemoryReportsPanel workflow={activeWorkflow} />
            </TabsContent>

            <TabsContent
              value="history"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              <OfficeWorkflowHistoryPanel
                activeWorkflowId={activeWorkflow?.id || null}
                onSelectWorkflow={workflowId => {
                  setCurrentWorkflow(workflowId);
                  const matched = workflows.find(
                    workflow => workflow.id === workflowId
                  );
                  if (matched?.missionId) {
                    startTransition(() => {
                      selectTask(matched.missionId!);
                    });
                  }
                  setActiveTab("flow");
                }}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <CreateMissionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateMission}
      />
    </div>
  );
}
