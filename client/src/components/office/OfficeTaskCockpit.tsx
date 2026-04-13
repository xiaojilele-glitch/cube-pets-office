import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Command, Waves } from "lucide-react";
import { toast } from "sonner";

import { CreateMissionDialog } from "@/components/tasks/CreateMissionDialog";
import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import { TasksCommandDock } from "@/components/tasks/TasksCommandDock";
import { TasksQueueRail } from "@/components/tasks/TasksQueueRail";
import {
  compactText,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
} from "@/components/tasks/task-helpers";
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

function CockpitMetaStat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "info" | "warning" | "success" | "danger";
}) {
  return (
    <div
      className={cn(
        "min-w-[112px] rounded-[18px] px-3 py-2.5",
        `workspace-tone-${tone}`
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-[11px] leading-4 opacity-80">{hint}</div>
      ) : null}
    </div>
  );
}

function CockpitContextShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/65 bg-[rgba(255,255,255,0.42)]">
      <div className="shrink-0 border-b border-stone-200/70 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
          {title}
        </div>
        <div className="mt-1 text-sm leading-6 text-stone-600">{description}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-1 py-1">{children}</div>
    </div>
  );
}

export function OfficeTaskCockpit({ className }: { className?: string }) {
  const { locale } = useI18n();
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
          "团队准备完成，已自动把焦点切回新任务。",
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
        toast.success(
          t(locale, "任务已创建并落入队列。", "Mission created and added to the queue.")
        );
      }
      return missionId;
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : t(locale, "创建任务失败。", "Failed to create mission.");
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
        t(locale, "任务操作已提交。", "Mission operator action submitted.")
      );
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : t(locale, "任务操作提交失败。", "Failed to submit operator action.");
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

  const queuedCount = tasks.filter(task => task.status === "queued").length;
  const runningCount = tasks.filter(task => task.status === "running").length;
  const waitingCount = tasks.filter(task => task.status === "waiting").length;
  const warningCount = tasks.filter(task => task.hasWarnings).length;
  const focusSignal =
    selectedDetail?.lastSignal ||
    selectedDetail?.waitingFor ||
    selectedDetail?.summary ||
    pendingLaunch?.directive ||
    t(
      locale,
      "点击左侧任务或场景 Agent，把焦点钉在当前场景里。",
      "Pick a task or scene agent to focus the current scene."
    );
  const focusStage =
    selectedDetail?.currentStageLabel ||
    pendingWorkflow?.current_stage ||
    t(locale, "等待焦点", "Awaiting focus");
  const focusTone =
    pendingLaunch
      ? "warning"
      : selectedDetail?.status === "failed"
        ? "danger"
        : selectedDetail?.status === "done"
          ? "success"
          : selectedDetail
            ? "info"
            : "neutral";
  const focusStatusLabel = selectedDetail
    ? missionStatusLabel(selectedDetail.status, locale)
    : pendingLaunch
      ? t(locale, "团队准备中", "Team preparing")
      : t(locale, "场景待命", "Scene ready");
  const focusOperatorLabel = selectedDetail
    ? missionOperatorStateLabel(selectedDetail.operatorState, locale)
    : selectedPet
      ? t(locale, "Agent 已联动", "Agent linked")
      : t(locale, "等待联动", "Waiting for link");
  const focusProgress =
    selectedDetail?.progress ?? selectedTaskSummary?.progress ?? 0;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-4 bottom-[96px] top-[84px] z-[52] flex min-h-0 flex-col gap-3 2xl:bottom-[104px]",
        className
      )}
    >
      <section className="pointer-events-auto rounded-[24px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,252,248,0.84),rgba(247,239,229,0.76))] px-4 py-3 shadow-[0_16px_40px_rgba(92,66,40,0.1)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="workspace-eyebrow">
              {t(locale, "运行中枢", "Runtime strip")}
            </div>
            <div className="mt-1 text-sm leading-6 text-stone-600">
              {t(
                locale,
                "首屏只保留运行态摘要，把操作和详情都压回执行主轴。",
                "Keep only runtime summary on top and push operations back into the execution axis."
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <CockpitMetaStat
              label={t(locale, "运行模式", "Runtime")}
              value={runtimeMode}
              hint={t(locale, "当前执行环境", "Current environment")}
            />
            <CockpitMetaStat
              label={t(locale, "队列", "Queue")}
              value={`${queuedCount} / ${runningCount}`}
              hint={t(locale, "排队 / 运行", "Queued / running")}
              tone={runningCount > 0 ? "warning" : "neutral"}
            />
            <CockpitMetaStat
              label={t(locale, "关注项", "Attention")}
              value={`${waitingCount} / ${warningCount}`}
              hint={t(locale, "等待 / 预警", "Waiting / warnings")}
              tone={warningCount > 0 ? "warning" : "info"}
            />
            <CockpitMetaStat
              label="Agent"
              value={String(agents.length)}
              hint={t(locale, "场景联动中", "Scene-linked")}
              tone={agents.length > 0 ? "success" : "neutral"}
            />
          </div>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-[clamp(224px,18vw,260px)_minmax(0,1fr)_clamp(396px,29vw,472px)] gap-3 2xl:grid-cols-[clamp(236px,17vw,276px)_minmax(0,1fr)_clamp(420px,30vw,520px)] 2xl:gap-4">
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

        <section className="flex min-h-0 flex-col justify-between gap-4">
          <div className="pointer-events-auto">
            <div className="rounded-[26px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,252,248,0.82),rgba(247,239,229,0.72))] px-4 py-4 shadow-[0_16px_38px_rgba(92,66,40,0.1)] backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                      Scene HUD
                    </span>
                    <span
                      className={cn(
                        "workspace-status px-2.5 py-1 text-[10px] font-semibold",
                        `workspace-tone-${focusTone}`
                      )}
                    >
                      {focusStatusLabel}
                    </span>
                    {selectedDetail ? (
                      <span
                        className={cn(
                          "workspace-status px-2.5 py-1 text-[10px] font-semibold",
                          missionOperatorStateTone(selectedDetail.operatorState)
                        )}
                      >
                        {focusOperatorLabel}
                      </span>
                    ) : (
                      <span className="workspace-status workspace-tone-neutral px-2.5 py-1 text-[10px] font-semibold">
                        {focusOperatorLabel}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-2 max-w-3xl text-[1.15rem] font-semibold tracking-tight text-stone-900">
                    {selectedDetail?.title ||
                      pendingLaunch?.directive ||
                      t(
                        locale,
                        "等待把执行焦点钉在场景里",
                        "Waiting to pin an execution focus into the scene"
                      )}
                  </h2>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-stone-600">
                    {compactText(focusSignal, 180)}
                  </p>
                </div>

                <div className="grid min-w-[240px] gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <CockpitMetaStat
                    label={t(locale, "当前阶段", "Current stage")}
                    value={focusStage}
                    hint={
                      selectedPet
                        ? t(locale, "已联动场景 Agent", "Scene agent linked")
                        : t(locale, "主视觉保持沉浸", "Scene remains primary")
                    }
                    tone={focusTone}
                  />
                  <CockpitMetaStat
                    label={t(locale, "推进度", "Progress")}
                    value={`${focusProgress}%`}
                    hint={
                      pendingLaunch
                        ? t(locale, "等待 workflow 关联 mission", "Waiting for workflow-to-mission link")
                        : t(locale, "任务与场景同步", "Scene and task stay in sync")
                    }
                    tone={
                      selectedDetail?.status === "done"
                        ? "success"
                        : selectedDetail?.status === "failed"
                          ? "danger"
                          : "info"
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-auto mt-auto">
            <div className="rounded-[28px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,252,248,0.86),rgba(246,238,229,0.82))] px-4 py-4 shadow-[0_22px_56px_rgba(98,73,48,0.14)] backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="workspace-eyebrow">
                    {t(locale, "统一驾驶台", "Unified command dock")}
                  </div>
                  <h3 className="mt-2 text-[1.1rem] font-semibold tracking-tight text-stone-900">
                    {t(
                      locale,
                      "保留双通道，但只感知一个主操作中心",
                      "Keep two launch lanes, but one primary operator zone"
                    )}
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                    {launchMode === "mission"
                      ? t(
                          locale,
                          "普通任务命令、澄清回合和落队结果都在这里闭环。",
                          "Natural-language commands, clarifications, and mission landing stay in one loop here."
                        )
                      : t(
                          locale,
                          "需要附件或团队组织时先走 workflow，再自动回到 mission 执行。",
                          "Attachment-heavy or team-shaped work launches through workflow first, then falls back into the mission."
                        )}
                  </p>
                </div>

                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <div className="flex rounded-full border border-white/65 bg-white/78 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                    <button
                      type="button"
                      onClick={() => setLaunchMode("mission")}
                      className={cn(
                        "rounded-full px-3 py-2 text-sm font-semibold transition-colors",
                        launchMode === "mission"
                          ? "bg-[#d07a4f] text-white shadow-[0_10px_24px_rgba(184,111,69,0.22)]"
                          : "text-stone-600 hover:bg-white"
                      )}
                    >
                      <Command className="mr-2 inline size-4" />
                      {t(locale, "任务命令", "Mission lane")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLaunchMode("workflow")}
                      className={cn(
                        "rounded-full px-3 py-2 text-sm font-semibold transition-colors",
                        launchMode === "workflow"
                          ? "bg-[#5E8B72] text-white shadow-[0_10px_24px_rgba(94,139,114,0.22)]"
                          : "text-stone-600 hover:bg-white"
                      )}
                    >
                      <Waves className="mr-2 inline size-4" />
                      {t(locale, "高级发起", "Workflow lane")}
                    </button>
                  </div>
                  {pendingLaunch ? (
                    <span className="workspace-status workspace-tone-warning px-2.5 py-1 text-[10px] font-semibold">
                      {t(
                        locale,
                        "团队准备中，完成后自动切回任务视角",
                        "Team preparing, then auto-return to the task view"
                      )}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
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
                    embedded
                  />
                ) : (
                  <OfficeWorkflowLaunchPanel
                    pendingLaunch={pendingLaunch}
                    compact
                    embedded
                    onLaunchSubmitted={resolution => {
                      setPendingLaunch(resolution);
                      setActiveTab("flow");
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="pointer-events-auto min-h-0">
          <Tabs
            value={activeTab}
            onValueChange={value => setActiveTab(value as OfficeCockpitTab)}
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,252,248,0.84),rgba(246,238,229,0.8))] p-3 shadow-[0_22px_60px_rgba(99,73,45,0.12)] backdrop-blur"
          >
            <TabsList className="grid h-auto w-full grid-cols-5 gap-1.5 rounded-[20px] bg-white/72 p-1.5">
              <TabsTrigger
                className="rounded-[16px] px-1.5 py-2 text-[11px] whitespace-nowrap disabled:opacity-45"
                value="task"
              >
                {t(locale, "任务", "Task")}
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[16px] px-1.5 py-2 text-[11px] whitespace-nowrap disabled:opacity-45"
                value="flow"
                disabled={!availability.flow}
              >
                {t(locale, "团队流", "Flow")}
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[16px] px-1.5 py-2 text-[11px] whitespace-nowrap disabled:opacity-45"
                value="agent"
                disabled={!availability.agent}
              >
                Agent
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[16px] px-1.5 py-2 text-[11px] whitespace-nowrap disabled:opacity-45"
                value="memory"
                disabled={!availability.memory}
              >
                {t(locale, "记忆", "Memory")}
              </TabsTrigger>
              <TabsTrigger
                className="rounded-[16px] px-1.5 py-2 text-[11px] whitespace-nowrap disabled:opacity-45"
                value="history"
                disabled={!availability.history}
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
              <CockpitContextShell
                title={t(locale, "团队流", "Flow")}
                description={t(
                  locale,
                  "把 workflow 的阶段、组织和输入上下文压进统一的右栏节奏里。",
                  "Keep workflow stages, org context, and attachments inside one shared right-panel shell."
                )}
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
              </CockpitContextShell>
            </TabsContent>

            <TabsContent
              value="agent"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              <CockpitContextShell
                title="Agent"
                description={t(
                  locale,
                  "场景 Agent、团队节点和 heartbeat 都在同一个检查视图里联动。",
                  "Scene agents, org placement, and heartbeat reports stay linked in one inspector view."
                )}
              >
                {agents.length > 0 ? (
                  <OfficeAgentInspectorPanel className="h-full" embedded />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-stone-300/80 bg-white/62 px-8 py-10 text-center text-sm leading-6 text-stone-500">
                    {t(
                      locale,
                      "场景 Agent 建立后，这里会显示办公室 Agent 详情视图。",
                      "Once scene agents are available, this tab shows the office agent detail view."
                    )}
                  </div>
                )}
              </CockpitContextShell>
            </TabsContent>

            <TabsContent
              value="memory"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              <CockpitContextShell
                title={t(locale, "记忆与报告", "Memory and reports")}
                description={t(
                  locale,
                  "把最近记忆、搜索结果和 heartbeat 报告统一在同一种上下文壳层里。",
                  "Recent memory, search results, and heartbeat reports share the same context shell."
                )}
              >
                <OfficeMemoryReportsPanel workflow={activeWorkflow} />
              </CockpitContextShell>
            </TabsContent>

            <TabsContent
              value="history"
              className="mt-0 min-h-0 flex-1 overflow-hidden pt-3"
            >
              <CockpitContextShell
                title={t(locale, "历史与兼容", "History and compatibility")}
                description={t(
                  locale,
                  "保留 workflow 连续性和兼容入口，但不再抢首屏主轴。",
                  "Preserve workflow continuity and compatibility access without stealing the first-screen axis."
                )}
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
              </CockpitContextShell>
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
