import { useCallback, useEffect } from 'react';
import { ArrowRight, Orbit, Play, Plus } from 'lucide-react';
import { useLocation } from 'wouter';

import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Scene3D } from '@/components/Scene3D';
import { TelemetryDashboard } from '@/components/TelemetryDashboard';
import { Toolbar } from '@/components/Toolbar';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useDemoMode } from '@/hooks/useDemoMode';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/lib/store';
import { useTelemetryStore } from '@/lib/telemetry-store';
import { useWorkflowStore } from '@/lib/workflow-store';

export default function Home() {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const locale = useAppStore(state => state.locale);
  const fetchTelemetry = useTelemetryStore(state => state.fetchInitial);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();
  const { startDemo } = useDemoMode();

  const handleStartDemo = useCallback(async () => {
    try {
      // Dynamic import — the bundle module is provided by demo-data-engine (L01).
      // Falls back gracefully if not yet available.
      const { DEMO_BUNDLE } = await import('@/runtime/demo-data/bundle');
      await startDemo(DEMO_BUNDLE);
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
    if (runtimeMode === 'frontend') {
      disconnectSocket();
    }
  }, [disconnectSocket, runtimeMode]);

  useEffect(() => {
    if (isSceneReady && runtimeMode === 'advanced') {
      fetchTelemetry();
    }
  }, [isSceneReady, runtimeMode, fetchTelemetry]);

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[#CFE5FA]">
      <Scene3D />

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

      {isSceneReady && (
        <>
          <div
            className={`fixed z-[60] ${isMobile ? 'left-3 right-3 top-[calc(env(safe-area-inset-top)+124px)]' : 'left-6 top-6 w-[260px]'}`}
            style={{ pointerEvents: 'auto' }}
          >
            <div className="rounded-[22px] border border-white/60 bg-white/84 p-3 shadow-[0_12px_32px_rgba(60,44,28,0.12)] backdrop-blur-2xl">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F4EDE4] text-[#D07A4F] shadow-sm">
                  <Orbit className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-bold text-[#3A2A1A]">
                    {locale === 'zh-CN' ? '任务宇宙' : 'Mission Universe'}
                  </h3>
                </div>
              </div>

              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={() => setLocation('/tasks')}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#D07A4F] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#C26D42]"
                >
                  {locale === 'zh-CN' ? '打开' : 'Open'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setLocation('/tasks?new=1')}
                  className="inline-flex items-center justify-center rounded-xl border border-[#D7C4AF] bg-white/80 px-3 py-2 text-xs font-semibold text-[#6B5A4A] shadow-sm transition-colors hover:bg-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                onClick={handleStartDemo}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#7CB9E8]/40 bg-[#E8F4FD] px-3 py-2 text-xs font-semibold text-[#2E86C1] shadow-sm transition-colors hover:bg-[#D6EAF8]"
              >
                🎬 Live Demo
                <Play className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

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
