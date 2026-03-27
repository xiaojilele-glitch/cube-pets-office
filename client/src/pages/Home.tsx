import { useEffect } from 'react';

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
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();

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
          <Toolbar />
          <ConfigPanel />
          <ChatPanel />
          <WorkflowPanel />
        </>
      )}
    </div>
  );
}
