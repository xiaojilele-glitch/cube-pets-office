import { useEffect } from 'react';
import { ArrowRight, Orbit, Plus } from 'lucide-react';
import { useLocation } from 'wouter';

import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Scene3D } from '@/components/Scene3D';
import { Toolbar } from '@/components/Toolbar';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';

export default function Home() {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const locale = useAppStore(state => state.locale);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();

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
            className={`fixed z-[60] ${isMobile ? 'left-3 right-3 top-[calc(env(safe-area-inset-top)+124px)]' : 'left-6 top-6 w-[320px]'}`}
            style={{ pointerEvents: 'auto' }}
          >
            <div className="rounded-[28px] border border-white/60 bg-white/84 p-4 shadow-[0_16px_44px_rgba(60,44,28,0.14)] backdrop-blur-2xl">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F4EDE4] text-[#D07A4F] shadow-sm">
                  <Orbit className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
                    {locale === 'zh-CN' ? 'Mission 入口' : 'Mission Entry'}
                  </p>
                  <h3
                    className="mt-1 text-sm font-bold text-[#3A2A1A]"
                    style={{ fontFamily: "'Playfair Display', serif" }}
                  >
                    {locale === 'zh-CN' ? '任务宇宙' : 'Mission Universe'}
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#6B5A4A]">
                    {locale === 'zh-CN'
                      ? '查看 mission 列表、详情、决策入口、时间线和工件，不再只停留在首页工作流面板。'
                      : 'Open the live mission list, details, decisions, timeline, and artifacts instead of staying only in the home workflow panel.'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setLocation('/tasks')}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D07A4F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#C26D42]"
              >
                {locale === 'zh-CN' ? '打开任务宇宙' : 'Open Mission Universe'}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => setLocation('/tasks?new=1')}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#D7C4AF] bg-white/80 px-4 py-2.5 text-sm font-semibold text-[#6B5A4A] shadow-sm transition-colors hover:bg-white"
              >
                {locale === 'zh-CN' ? '快速新建 Mission' : 'Quick Create Mission'}
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <Toolbar />
          <ConfigPanel />
          <ChatPanel />
          <WorkflowPanel />
        </>
      )}
    </div>
  );
}
