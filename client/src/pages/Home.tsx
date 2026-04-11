import { useCallback, useEffect, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

import { ChatPanel } from "@/components/ChatPanel";
import { GitHubRepoBadge } from "@/components/GitHubRepoBadge";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AgentDetailDrawer } from "@/components/scene/AgentDetailDrawer";
import { OfficeNoticeBoard } from "@/components/scene/OfficeNoticeBoard";
import { Scene3D } from "@/components/Scene3D";
import { TelemetryDashboard } from "@/components/TelemetryDashboard";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useI18n } from "@/i18n";
import { getAgentToolbarLabel } from "@/lib/agent-config";
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
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const agents = useWorkflowStore(state => state.agents);
  const workflows = useWorkflowStore(state => state.workflows);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const toggleWorkflowPanel = useWorkflowStore(
    state => state.toggleWorkflowPanel
  );
  const openWorkflowPanel = useWorkflowStore(state => state.openWorkflowPanel);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();
  const { startDemo } = useDemoMode();

  const handleStartDemo = useCallback(async () => {
    try {
      const { DEMO_BUNDLE } = await import("@/runtime/demo-data/bundle");
      await startDemo(DEMO_BUNDLE as any);
      setLocation("/tasks");
    } catch (err) {
      console.warn("[Home] Demo bundle not available yet:", err);
    }
  }, [startDemo, setLocation]);

  useEffect(() => {
    hydrateAIConfig().catch(error => {
      console.error("[Home] Failed to load AI config:", error);
    });
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (runtimeMode === "frontend") disconnectSocket();
  }, [disconnectSocket, runtimeMode]);

  useEffect(() => {
    if (isSceneReady && runtimeMode === "advanced") fetchTelemetry();
  }, [isSceneReady, runtimeMode, fetchTelemetry]);

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
  const focusLabel = selectedPet
    ? getAgentToolbarLabel(selectedPet, locale)
    : locale === "zh-CN"
      ? "点击 Agent 打开侧栏"
      : "Tap an agent to open details";

  const managerNames = useMemo(() => {
    const liveManagers = agents
      .filter(agent => agent.role === "ceo" || agent.role === "manager")
      .slice(0, 5)
      .map(agent => agent.name.split("·")[0].trim());

    return liveManagers.length > 0
      ? liveManagers
      : ["CEO", "Pixel", "Nexus", "Echo", "Warden"];
  }, [agents]);

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
      locale,
      runtimeMode,
      missionTasks,
      missionDetailsById,
      workflows,
      heartbeatStatuses,
      telemetrySnapshot,
    ]
  );

  const handleOpenCurrentMission = selectedTaskId
    ? () => {
        selectTask(selectedTaskId);
        setLocation(`/tasks/${selectedTaskId}`);
      }
    : undefined;

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[linear-gradient(180deg,#d8e5f0_0%,#e9dfd2_48%,#e3d2c0_100%)]">
      <Scene3D />

      {/* Gradient overlays */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(228,241,252,0.72),rgba(228,241,252,0)_38%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,251,247,0.42),rgba(255,251,247,0)_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(157,119,83,0.09),rgba(157,119,83,0)_32%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(94,139,114,0.08),rgba(94,139,114,0)_24%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f5f9fd]/46 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#ddc8b2]/34 to-transparent" />
        <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(79,58,38,0.12)]" />
      </div>

      {isSceneReady && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-[18] flex justify-center px-3 ${
            isMobile
              ? "top-[calc(env(safe-area-inset-top)+108px)]"
              : "top-20 px-4"
          }`}
        >
          <div
            className={`pointer-events-auto w-full studio-shell shadow-[0_18px_45px_rgba(78,58,38,0.12)] ${
              isMobile
                ? "max-w-none rounded-[28px] px-4 py-4"
                : "max-w-[min(760px,calc(100vw-25rem))] rounded-[34px] px-6 py-5"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#A08972]">
              {copy.home.officeEyebrow}
            </p>
            <div
              className={`mt-3 ${isMobile ? "space-y-3" : "flex items-end justify-between gap-6"}`}
            >
              <div className="min-w-0">
                <h1
                  className={`${isMobile ? "text-xl" : "text-[2rem]"} font-semibold tracking-tight text-[#3A2A1A]`}
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {copy.home.officeTitle}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5C4A39]">
                  {isMobile
                    ? copy.home.mobileHint
                    : copy.home.officeDescription}
                </p>
              </div>

              <div
                className={`flex ${isMobile ? "flex-col" : "flex-wrap justify-end"} gap-2`}
              >
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
      )}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && !isMobile && (
        <>
          {/* Top bar: office identity | mode switch | github */}
          <div
            className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-between px-5 py-3"
            style={{ pointerEvents: "auto" }}
          >
            <div className="flex items-center gap-2 rounded-full studio-surface px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-[#C98257]" />
              <span className="text-xs font-bold text-[#3A2A1A]">
                {copy.home.desktopOfficeLabel}
              </span>
            </div>

            <div className="flex items-center gap-1 rounded-full studio-surface p-1">
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
              {IS_GITHUB_PAGES && <GitHubRepoBadge />}
              <div className="rounded-full studio-surface px-3 py-1.5 text-xs font-semibold text-[#5A4A3A]">
                {copy.home.runtimeChip(
                  copy.toolbar.runtimeLabels[
                    runtimeMode === "advanced" ? "advanced" : "frontend"
                  ]
                )}
              </div>
            </div>
          </div>

          {/* Left sidebar: task hub + system status */}
          <div
            className="fixed left-4 top-16 z-[60] flex w-[160px] flex-col gap-3"
            style={{ pointerEvents: "auto" }}
          >
            <div className="rounded-2xl studio-shell p-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#C98257]" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {copy.home.taskHubTitle}
                </span>
              </div>
              <button
                onClick={() => setLocation("/tasks")}
                className="mt-2 w-full rounded-xl bg-[#C98257] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-[#B86F45]"
              >
                {copy.home.enterTasks}
              </button>
              <button
                onClick={() => setLocation("/tasks?new=1")}
                className="mt-1.5 w-full rounded-xl studio-surface px-3 py-1.5 text-[11px] font-semibold text-[#5A4A3A] transition-colors hover:bg-white/70"
              >
                {copy.home.newMission}
              </button>
              <button
                onClick={handleStartDemo}
                className="mt-1.5 w-full text-center text-[11px] font-medium text-[#5E8B72] transition-colors hover:text-[#456B58]"
              >
                {copy.home.liveDemo}
              </button>
            </div>

            <div className="rounded-2xl studio-shell p-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#5E8B72]" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {locale === "zh-CN" ? "系统状态" : "System status"}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-[10px] text-[#5A4A3A]">
                <div className="flex justify-between">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#5E8B72]" />
                    {locale === "zh-CN" ? "Agent 在线" : "Agents online"}
                  </span>
                  <span className="font-semibold">{agentCount} / 18</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#C98257]" />
                    {locale === "zh-CN" ? "活跃工作流" : "Active workflows"}
                  </span>
                  <span className="font-semibold">{activeWorkflows}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#87AFC7]" />
                    {locale === "zh-CN" ? "运行模式" : "Runtime mode"}
                  </span>
                  <span className="font-semibold">
                    {runtimeMode === "advanced" ? "Advanced" : "Frontend"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right sidebar: active agents + token usage */}
          <div
            className="fixed right-4 top-16 z-[60] flex w-[240px] flex-col gap-3"
            style={{ pointerEvents: "auto" }}
          >
            <OfficeNoticeBoard
              locale={locale}
              snapshot={noticeBoardSnapshot}
              onOpenTasks={() => setLocation("/tasks")}
              onOpenWorkflow={() => openWorkflowPanel()}
              onOpenCurrentTask={handleOpenCurrentMission}
            />

            <div className="rounded-[26px] studio-shell p-4">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#C98257]" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {locale === "zh-CN" ? "活跃 Agent" : "Active agents"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {managerNames.map(name => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-full studio-surface px-2.5 py-1 text-[10px] font-medium text-[#5A4A3A]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#C98257]" />
                    {name}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[10px] leading-5 text-[#8B7355]">
                {focusLabel}
              </p>
            </div>
          </div>

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
        open={Boolean(selectedPet)}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            setSelectedPet(null);
          }
        }}
      />
    </div>
  );
}
