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

      {isMobile && (
        <div className="pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+72px)] z-[18] rounded-2xl studio-surface px-3 py-2 text-[11px] leading-5 text-[#5C4A39]">
          {copy.home.mobileHint}
        </div>
      )}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && !isMobile && (
        <>
          {/* ── Outer Layout Wrapper ── */}
      <div className="absolute inset-0 z-[60] flex flex-col pointer-events-none p-4 md:p-6">
        
        {/* ── Top bar: logo | mode switch | github + locale ── */}
        <div className="flex items-center justify-between w-full pointer-events-auto">
          {/* Left: Logo */}
          <div className="flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-sm font-bold text-stone-800 tracking-tight">Cube Pets Office</span>
          </div>

          {/* Center: Mode switch */}
          <div className="flex items-center gap-1.5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm p-1.5">
            <button
              onClick={() => void setRuntimeMode('frontend')}
              className={`rounded-xl px-5 py-1.5 text-xs font-semibold transition-all ${
                runtimeMode === 'frontend'
                  ? 'bg-white text-stone-900 shadow-sm border border-stone-200/50'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Frontend
            </button>
            {CAN_USE_ADVANCED_RUNTIME && (
              <button
                onClick={() => void setRuntimeMode('advanced')}
                className={`rounded-xl px-5 py-1.5 text-xs font-semibold transition-all ${
                  runtimeMode === 'advanced'
                    ? 'bg-stone-900 text-white shadow-sm'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                Advanced
              </button>
            )}
          </div>

          {/* Right: GitHub + Locale */}
          <div className="flex items-center gap-3">
            {IS_GITHUB_PAGES && <GitHubRepoBadge />}
            <button
              onClick={toggleLocale}
              className="rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm px-4 py-2 text-xs font-semibold text-stone-700 transition-colors hover:bg-white"
            >
              {locale === 'zh-CN' ? 'EN / 中' : 'EN / 中'}
            </button>
          </div>
        </div>

        {/* ── Main Content Area (Sidebars) ── */}
        <div className="flex-1 flex justify-between items-start w-full mt-6 pointer-events-none">
          
          {/* ── Left sidebar: Mission control + System status ── */}
          <div className="flex flex-col gap-4 w-64 pointer-events-auto">
            {/* Mission control */}
            <div className="rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                  {locale === 'zh-CN' ? '任务中心' : 'Mission control'}
                </span>
              </div>
              <button
                onClick={() => setLocation('/tasks?new=1')}
                className="w-full rounded-xl bg-stone-900 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-stone-800 hover:-translate-y-0.5"
              >
                {locale === 'zh-CN' ? '新建任务' : 'New mission'}
              </button>
              <button
                onClick={handleStartDemo}
                className="mt-2 w-full text-center text-xs font-medium text-stone-500 transition-colors hover:text-stone-900"
              >
                Live Demo
              </button>
            </div>

            {/* System status */}
            <div className="rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                  {locale === 'zh-CN' ? '系统状态' : 'System status'}
                </span>
              </div>
              <div className="space-y-2.5 text-xs text-stone-600">
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{locale === 'zh-CN' ? 'Agent 在线' : 'Agents online'}</span>
                  <span className="font-semibold text-stone-900">{agentCount} / 18</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-orange-400" />{locale === 'zh-CN' ? '活跃工作流' : 'Active workflows'}</span>
                  <span className="font-semibold text-stone-900">{activeWorkflows}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-purple-400" />{locale === 'zh-CN' ? '运行模式' : 'Runtime mode'}</span>
                  <span className="font-semibold text-stone-900">{runtimeMode === 'advanced' ? 'Advanced' : 'Frontend'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right sidebar: Active agents + Token usage ── */}
          <div className="flex flex-col gap-4 w-64 pointer-events-auto">
            {/* Active agents */}
            <div className="rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full bg-orange-500" />
                <span className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                  {locale === 'zh-CN' ? '活跃 Agent' : 'Active agents'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {managerNames.map(name => (
                  <span key={name} className="flex items-center gap-1.5 rounded-lg bg-white/60 border border-white/40 px-2.5 py-1 text-xs font-medium text-stone-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    {name}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-stone-500 font-medium">{focusLabel}</p>
            </div>

            {/* Token usage */}
            <div className="rounded-2xl bg-white/70 backdrop-blur-md border border-white/40 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                <span className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                  {locale === 'zh-CN' ? 'Token 用量' : 'Token usage'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-stone-500">
                  {(telemetrySnapshot?.totalTokensIn ?? 0).toLocaleString()} tokens
                </span>
                <span className="text-lg font-bold text-stone-900">
                  ${(telemetrySnapshot?.totalCost ?? 0).toFixed(4)}
                </span>
              </div>
            </div>
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
