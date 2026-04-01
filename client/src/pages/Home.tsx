import { useCallback, useEffect } from 'react';
import { ArrowRight, Monitor, Play, Plus, Server } from 'lucide-react';
import { useLocation } from 'wouter';

import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { GitHubRepoBadge } from '@/components/GitHubRepoBadge';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Scene3D } from '@/components/Scene3D';
import { TelemetryDashboard } from '@/components/TelemetryDashboard';
import { Toolbar } from '@/components/Toolbar';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useDemoMode } from '@/hooks/useDemoMode';
import { useI18n } from '@/i18n';
import { getAgentToolbarLabel } from '@/lib/agent-config';
import { CAN_USE_ADVANCED_RUNTIME, IS_GITHUB_PAGES } from '@/lib/deploy-target';
import { useAppStore } from '@/lib/store';
import { useTelemetryStore } from '@/lib/telemetry-store';
import { useWorkflowStore } from '@/lib/workflow-store';

export default function Home() {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const locale = useAppStore(state => state.locale);
  const toggleLocale = useAppStore(state => state.toggleLocale);
  const selectedPet = useAppStore(state => state.selectedPet);
  const fetchTelemetry = useTelemetryStore(state => state.fetchInitial);
  const telemetrySnapshot = useTelemetryStore(state => state.snapshot);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const agents = useWorkflowStore(state => state.agents);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();
  const { startDemo } = useDemoMode();

  const handleStartDemo = useCallback(async () => {
    try {
      const { DEMO_BUNDLE } = await import('@/runtime/demo-data/bundle');
      await startDemo(DEMO_BUNDLE as any);
      setLocation('/tasks');
    } catch (err) {
      console.warn('[Home] Demo bundle not available yet:', err);
    }
  }, [startDemo, setLocation]);

  useEffect(() => {
    hydrateAIConfig().catch(error => {
      console.error('[Home] Failed to load AI config:', error);
    });
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (runtimeMode === 'frontend') disconnectSocket();
  }, [disconnectSocket, runtimeMode]);

  useEffect(() => {
    if (isSceneReady && runtimeMode === 'advanced') fetchTelemetry();
  }, [isSceneReady, runtimeMode, fetchTelemetry]);

  const localeLabel = locale === 'zh-CN' ? 'EN' : '中';
  const agentCount = agents.length || 18;
  const activeWorkflows = currentWorkflow ? 1 : 0;
  const focusLabel = selectedPet
    ? getAgentToolbarLabel(selectedPet, locale)
    : locale === 'zh-CN' ? '点击 Agent 查看' : 'Click agent to inspect';

  // Manager names for Active agents card
  const managerNames = ['CEO', 'Pixel', 'Nexus', 'Echo', 'Warden'];

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[#CFE5FA]">
      <Scene3D />

      {/* Gradient overlays */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(214,236,255,0.62),rgba(214,236,255,0)_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.3),rgba(255,255,255,0)_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(120,88,56,0.08),rgba(120,88,56,0)_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(103,80,58,0.1),rgba(103,80,58,0)_26%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#EAF5FF]/42 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#D7C8B8]/35 to-transparent" />
        <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(79,58,38,0.12)]" />
      </div>

      {isMobile && (
        <div className="pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+72px)] z-[18] rounded-2xl border border-white/40 bg-white/45 px-3 py-2 text-[11px] leading-5 text-[#5C4A39] shadow-sm backdrop-blur-md">
          {copy.home.mobileHint}
        </div>
      )}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && !isMobile && (
        <>
          {/* ── Top bar: logo | mode switch | github + locale ── */}
          <div className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-between px-5 py-3" style={{ pointerEvents: 'auto' }}>
            {/* Left: Logo */}
            <div className="flex items-center gap-2 rounded-full border border-white/50 bg-white/70 px-3 py-1.5 shadow-sm backdrop-blur-xl">
              <span className="h-2 w-2 rounded-full bg-[#D07A4F]" />
              <span className="text-xs font-bold text-[#3A2A1A]">Cube Pets Office</span>
            </div>

            {/* Center: Mode switch */}
            <div className="flex items-center gap-1 rounded-full border border-white/50 bg-white/70 p-1 shadow-sm backdrop-blur-xl">
              <button
                onClick={() => void setRuntimeMode('frontend')}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  runtimeMode === 'frontend'
                    ? 'bg-white text-[#3A2A1A] shadow-sm'
                    : 'text-[#8B7355] hover:text-[#5A4A3A]'
                }`}
              >
                Frontend
              </button>
              {CAN_USE_ADVANCED_RUNTIME && (
                <button
                  onClick={() => void setRuntimeMode('advanced')}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                    runtimeMode === 'advanced'
                      ? 'bg-[#D07A4F] text-white shadow-sm'
                      : 'text-[#8B7355] hover:text-[#5A4A3A]'
                  }`}
                >
                  Advanced
                </button>
              )}
            </div>

            {/* Right: GitHub + Locale */}
            <div className="flex items-center gap-2">
              {IS_GITHUB_PAGES && <GitHubRepoBadge />}
              <button
                onClick={toggleLocale}
                className="rounded-full border border-white/50 bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#5A4A3A] shadow-sm backdrop-blur-xl transition-colors hover:bg-white"
              >
                {locale === 'zh-CN' ? 'EN / 中' : 'EN / 中'}
              </button>
            </div>
          </div>

          {/* ── Left sidebar: Mission control + System status ── */}
          <div className="fixed left-4 top-16 z-[60] flex w-[150px] flex-col gap-3" style={{ pointerEvents: 'auto' }}>
            {/* Mission control */}
            <div className="rounded-2xl border border-white/50 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {locale === 'zh-CN' ? '任务中心' : 'Mission control'}
                </span>
              </div>
              <button
                onClick={() => setLocation('/tasks?new=1')}
                className="mt-2 w-full rounded-xl bg-[#D07A4F] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-[#C26D42]"
              >
                {locale === 'zh-CN' ? '新建任务' : 'New mission'}
              </button>
              <button
                onClick={handleStartDemo}
                className="mt-1.5 w-full text-center text-[11px] font-medium text-[#2E86C1] transition-colors hover:text-[#1A6FA0]"
              >
                Live Demo
              </button>
            </div>

            {/* System status */}
            <div className="rounded-2xl border border-white/50 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {locale === 'zh-CN' ? '系统状态' : 'System status'}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-[10px] text-[#5A4A3A]">
                <div className="flex justify-between">
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{locale === 'zh-CN' ? 'Agent 在线' : 'Agents online'}</span>
                  <span className="font-semibold">{agentCount} / 18</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{locale === 'zh-CN' ? '活跃工作流' : 'Active workflows'}</span>
                  <span className="font-semibold">{activeWorkflows}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" />{locale === 'zh-CN' ? '运行模式' : 'Runtime mode'}</span>
                  <span className="font-semibold">{runtimeMode === 'advanced' ? 'Advanced' : 'Frontend'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right sidebar: Active agents + Token usage ── */}
          <div className="fixed right-4 top-16 z-[60] flex w-[160px] flex-col gap-3" style={{ pointerEvents: 'auto' }}>
            {/* Active agents */}
            <div className="rounded-2xl border border-white/50 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {locale === 'zh-CN' ? '活跃 Agent' : 'Active agents'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {managerNames.map(name => (
                  <span key={name} className="flex items-center gap-1 rounded-full bg-[#F4EDE4] px-2 py-0.5 text-[9px] font-medium text-[#5A4A3A]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#D07A4F]" />
                    {name}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[9px] text-[#8B7355]">{focusLabel}</p>
            </div>

            {/* Token usage */}
            <div className="rounded-2xl border border-white/50 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-[11px] font-bold text-[#3A2A1A]">
                  {locale === 'zh-CN' ? 'Token 用量' : 'Token usage'}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-[10px] text-[#D07A4F]">
                  {(telemetrySnapshot?.totalTokensIn ?? 0).toLocaleString()} tokens
                </span>
                <span className="text-[10px] font-semibold text-[#3A2A1A]">
                  ${(telemetrySnapshot?.totalCost ?? 0).toFixed(4)}
                </span>
              </div>
            </div>
          </div>

          <Toolbar />
          <ConfigPanel />
          <ChatPanel />
          <WorkflowPanel />
          <TelemetryDashboard />
        </>
      )}

      {/* Mobile fallback — keep existing toolbar-driven layout */}
      {isSceneReady && isMobile && (
        <>
          <Toolbar />
          <ConfigPanel />
          <ChatPanel />
          <WorkflowPanel />
          <TelemetryDashboard />
        </>
      )}
    </div>
  );
}
