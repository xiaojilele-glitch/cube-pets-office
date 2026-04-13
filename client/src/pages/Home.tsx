import { useCallback, useEffect, useMemo } from "react";
import { ArrowRight, LayoutPanelTop, Settings2, Waves } from "lucide-react";
import { useLocation } from "wouter";

import { ChatPanel } from "@/components/ChatPanel";
import { GitHubRepoBadge } from "@/components/GitHubRepoBadge";
import { LoadingScreen } from "@/components/LoadingScreen";
import { OfficeTaskCockpit } from "@/components/office/OfficeTaskCockpit";
import { AgentDetailDrawer } from "@/components/scene/AgentDetailDrawer";
import { OfficeNoticeBoard } from "@/components/scene/OfficeNoticeBoard";
import { Scene3D } from "@/components/Scene3D";
import { TelemetryDashboard } from "@/components/TelemetryDashboard";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useWorkflowRuntimeBootstrap } from "@/hooks/useWorkflowRuntimeBootstrap";
import { useI18n } from "@/i18n";
import { CAN_USE_ADVANCED_RUNTIME, IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { buildOfficeNoticeBoardSnapshot } from "@/lib/scene-agent-detail";
import { useAppStore } from "@/lib/store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useTasksStore } from "@/lib/tasks-store";
import { useWorkflowStore } from "@/lib/workflow-store";

export default function Home() {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const locale = useAppStore(state => state.locale);
  const toggleConfig = useAppStore(state => state.toggleConfig);
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const fetchTelemetry = useTelemetryStore(state => state.fetchInitial);
  const telemetrySnapshot = useTelemetryStore(state => state.snapshot);
  const ensureTasksReady = useTasksStore(state => state.ensureReady);
  const missionTasks = useTasksStore(state => state.tasks);
  const missionDetailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const selectTask = useTasksStore(state => state.selectTask);
  const agents = useWorkflowStore(state => state.agents);
  const workflows = useWorkflowStore(state => state.workflows);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const toggleWorkflowPanel = useWorkflowStore(
    state => state.toggleWorkflowPanel
  );
  const openWorkflowPanel = useWorkflowStore(state => state.openWorkflowPanel);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();
  const { startDemo } = useDemoMode();

  useWorkflowRuntimeBootstrap({ heartbeatReportLimit: 18 });

  const handleStartDemo = useCallback(async () => {
    try {
      const { DEMO_BUNDLE } = await import("@/runtime/demo-data/bundle");
      await startDemo(DEMO_BUNDLE as any);
      setLocation("/tasks");
    } catch (err) {
      console.warn("[Home] Demo bundle not available yet:", err);
    }
  }, [setLocation, startDemo]);

  useEffect(() => {
    hydrateAIConfig().catch(error => {
      console.error("[Home] Failed to load AI config:", error);
    });
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (runtimeMode === "frontend") {
      disconnectSocket();
    }
  }, [disconnectSocket, runtimeMode]);

  useEffect(() => {
    if (isSceneReady && runtimeMode === "advanced") {
      fetchTelemetry();
    }
  }, [fetchTelemetry, isSceneReady, runtimeMode]);

  useEffect(() => {
    if (runtimeMode !== "advanced") return;
    ensureTasksReady().catch(error => {
      console.warn("[Home] Failed to hydrate mission summaries:", error);
    });
  }, [ensureTasksReady, runtimeMode]);

  const agentCount = agents.length || 18;
  const activeWorkflows =
    missionTasks.length > 0
      ? missionTasks.filter(
          task => task.status === "running" || task.status === "waiting"
        ).length
      : workflows.filter(
          workflow =>
            workflow.status === "running" || workflow.status === "pending"
        ).length;

  const noticeBoardSnapshot = useMemo(
    () =>
      buildOfficeNoticeBoardSnapshot({
        locale,
        runtimeMode,
        missionTasks,
        missionDetailsById,
        workflows,
        heartbeatStatuses,
        totalTokens:
          (telemetrySnapshot?.totalTokensIn ?? 0) +
          (telemetrySnapshot?.totalTokensOut ?? 0),
        totalCost: telemetrySnapshot?.totalCost ?? 0,
      }),
    [
      heartbeatStatuses,
      locale,
      missionDetailsById,
      missionTasks,
      runtimeMode,
      telemetrySnapshot,
      workflows,
    ]
  );

  const handleOpenCurrentMission = selectedTaskId
    ? () => {
        selectTask(selectedTaskId);
        setLocation(`/tasks/${selectedTaskId}`);
      }
    : undefined;
  const fullWorkbenchLabel =
    locale === "zh-CN" ? "全屏工作台" : "Fullscreen workbench";
  const compatibilityLabel =
    locale === "zh-CN" ? "兼容入口" : "Compatibility panel";
  const demoLabel = locale === "zh-CN" ? "演示模式" : "Live demo";

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[linear-gradient(180deg,#d8e5f0_0%,#e9dfd2_48%,#e3d2c0_100%)]">
      <Scene3D />

      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(228,241,252,0.72),rgba(228,241,252,0)_38%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,251,247,0.42),rgba(255,251,247,0)_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(157,119,83,0.09),rgba(157,119,83,0)_32%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(94,139,114,0.08),rgba(94,139,114,0)_24%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f5f9fd]/46 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#ddc8b2]/34 to-transparent" />
        <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(79,58,38,0.12)]" />
      </div>

      {isSceneReady && isMobile ? (
        <div className="pointer-events-none absolute inset-x-0 z-[18] flex justify-center px-3 top-[calc(env(safe-area-inset-top)+108px)]">
          <div className="pointer-events-auto w-full max-w-none rounded-[28px] studio-shell px-4 py-4 shadow-[0_18px_45px_rgba(78,58,38,0.12)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#A08972]">
              {copy.home.officeEyebrow}
            </p>
            <div className="mt-3 space-y-3">
              <div className="min-w-0">
                <h1
                  className="text-xl font-semibold tracking-tight text-[#3A2A1A]"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {copy.home.officeTitle}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5C4A39]">
                  {copy.home.mobileHint}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setLocation("/tasks")}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#d07a4f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#bf6c43]"
                >
                  {copy.home.enterTasks}
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleWorkflowPanel()}
                  className="inline-flex items-center justify-center rounded-full border border-stone-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-[#5A4A3A] transition-colors hover:bg-white"
                >
                  {copy.home.openWorkflow}
                </button>
                <button
                  type="button"
                  onClick={() => toggleConfig()}
                  className="inline-flex items-center justify-center rounded-full border border-stone-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-[#5A4A3A] transition-colors hover:bg-white"
                >
                  {copy.home.openConfig}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-[#5C4A39]">
                {copy.home.runtimeChip(
                  copy.toolbar.runtimeLabels[
                    runtimeMode === "advanced" ? "advanced" : "frontend"
                  ]
                )}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-[#5C4A39]">
                {copy.home.agentChip(agentCount)}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-[#5C4A39]">
                {copy.home.workflowChip(activeWorkflows)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && !isMobile && (
        <>
          <div
            className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-between gap-4 px-4 py-3 xl:px-5"
            style={{ pointerEvents: "auto" }}
          >
            <div className="flex min-w-0 items-center gap-3 rounded-[26px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,252,248,0.84),rgba(246,238,229,0.74))] px-4 py-2.5 shadow-[0_14px_36px_rgba(88,61,39,0.1)] backdrop-blur">
              <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#d69871,#c98257)] text-white shadow-[0_10px_24px_rgba(201,130,87,0.22)]">
                <span className="text-sm font-semibold">CP</span>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#A08972]">
                  {copy.home.desktopOfficeLabel}
                </div>
                <div className="truncate text-sm font-semibold text-[#3A2A1A]">
                  {copy.home.officeTitle}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-[22px] border border-white/50 bg-[rgba(255,252,248,0.8)] p-1 shadow-[0_10px_28px_rgba(88,61,39,0.08)] backdrop-blur">
              <button
                onClick={() => void setRuntimeMode("frontend")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  runtimeMode === "frontend"
                    ? "bg-[#F8F3ED] text-[#3A2A1A] shadow-sm"
                    : "text-[#8B7355] hover:text-[#5A4A3A]"
                }`}
              >
                Frontend
              </button>
              {CAN_USE_ADVANCED_RUNTIME && (
                <button
                  onClick={() => void setRuntimeMode("advanced")}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                    runtimeMode === "advanced"
                      ? "bg-[#C98257] text-white shadow-sm"
                      : "text-[#8B7355] hover:text-[#5A4A3A]"
                  }`}
                >
                  Advanced
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLocation("/tasks")}
                className="inline-flex items-center gap-2 rounded-full bg-[#d07a4f] px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_28px_rgba(184,111,69,0.22)] transition-colors hover:bg-[#bf6c43]"
              >
                <LayoutPanelTop className="h-4 w-4" />
                {fullWorkbenchLabel}
              </button>
              <button
                type="button"
                onClick={() => openWorkflowPanel()}
                className="inline-flex items-center gap-2 rounded-full border border-white/55 bg-[rgba(255,252,248,0.82)] px-4 py-2 text-xs font-semibold text-[#5A4A3A] shadow-[0_10px_24px_rgba(88,61,39,0.08)] backdrop-blur transition-colors hover:bg-white"
              >
                <Waves className="h-4 w-4" />
                {compatibilityLabel}
              </button>
              <button
                type="button"
                onClick={handleStartDemo}
                className="inline-flex items-center gap-2 rounded-full border border-white/55 bg-[rgba(255,252,248,0.82)] px-4 py-2 text-xs font-semibold text-[#5A4A3A] shadow-[0_10px_24px_rgba(88,61,39,0.08)] backdrop-blur transition-colors hover:bg-white"
              >
                {demoLabel}
              </button>
              <button
                type="button"
                onClick={() => toggleConfig()}
                className="inline-flex items-center gap-2 rounded-full border border-white/55 bg-[rgba(255,252,248,0.82)] px-4 py-2 text-xs font-semibold text-[#5A4A3A] shadow-[0_10px_24px_rgba(88,61,39,0.08)] backdrop-blur transition-colors hover:bg-white"
              >
                <Settings2 className="h-4 w-4" />
                {copy.home.openConfig}
              </button>
              {IS_GITHUB_PAGES && <GitHubRepoBadge />}
              <div className="rounded-full border border-white/55 bg-[rgba(255,252,248,0.82)] px-3 py-1.5 text-xs font-semibold text-[#5A4A3A] shadow-[0_10px_24px_rgba(88,61,39,0.08)] backdrop-blur">
                {copy.home.runtimeChip(
                  copy.toolbar.runtimeLabels[
                    runtimeMode === "advanced" ? "advanced" : "frontend"
                  ]
                )}
              </div>
            </div>
          </div>

          <OfficeTaskCockpit />

          <ChatPanel />
          <WorkflowPanel />
          <TelemetryDashboard />
        </>
      )}

      {isSceneReady && isMobile && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+270px)] z-[18] px-3">
            <div className="pointer-events-auto">
              <OfficeNoticeBoard
                locale={locale}
                snapshot={noticeBoardSnapshot}
                onOpenTasks={() => setLocation("/tasks")}
                onOpenWorkflow={() => openWorkflowPanel()}
                onOpenCurrentTask={handleOpenCurrentMission}
              />
            </div>
          </div>
          <ChatPanel />
          <WorkflowPanel />
          <TelemetryDashboard />
        </>
      )}

      <AgentDetailDrawer
        agentId={selectedPet}
        open={isMobile && Boolean(selectedPet)}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            setSelectedPet(null);
          }
        }}
      />
    </div>
  );
}
