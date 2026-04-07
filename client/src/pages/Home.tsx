import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { HoloDock } from '@/components/HoloDock';
import { HoloDrawer } from '@/components/HoloDrawer';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Scene3D } from '@/components/Scene3D';
import { TelemetryDashboard } from '@/components/TelemetryDashboard';
import { Toolbar } from '@/components/Toolbar';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useI18n } from '@/i18n';
import { IS_GITHUB_PAGES } from '@/lib/deploy-target';
import { useAppStore } from '@/lib/store';
import { useTelemetryStore } from '@/lib/telemetry-store';
import { useWorkflowStore } from '@/lib/workflow-store';

export default function Home() {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const isConfigOpen = useAppStore(state => state.isConfigOpen);
  const toggleConfig = useAppStore(state => state.toggleConfig);
  const isChatOpen = useAppStore(state => state.isChatOpen);
  const toggleChat = useAppStore(state => state.toggleChat);
  const fetchTelemetry = useTelemetryStore(state => state.fetchInitial);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const isWorkflowPanelOpen = useWorkflowStore(state => state.isWorkflowPanelOpen);
  const toggleWorkflowPanel = useWorkflowStore(state => state.toggleWorkflowPanel);
  const { isMobile } = useViewportTier();
  const { copy } = useI18n();

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

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[#0a0e1a]">
      {/* ── 5.3: 3D Canvas 全屏底层 ── */}
      <Scene3D />

      {/* Gradient overlays — dark sci-fi tones */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(59,130,246,0.06),transparent_50%)]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/20 to-transparent" />
      </div>

      {/* ── 5.4: Preview Bar — 顶部半透明小条 (AC-5.5) ── */}
      {IS_GITHUB_PAGES && isSceneReady && (
        <div
          className="fixed inset-x-0 top-0 z-[65] flex h-7 items-center justify-center gap-1.5 bg-amber-500/15 backdrop-blur-sm"
          style={{ pointerEvents: 'auto' }}
        >
          <AlertTriangle className="h-3 w-3 text-amber-200/80" />
          <span className="text-xs text-amber-200/80">
            {copy.toolbar.runtimeLabels.frontend} — GitHub Pages Preview
          </span>
        </div>
      )}

      {/* ── Mobile hint ── */}
      {isMobile && isSceneReady && (
        <div className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-[18] rounded-2xl border border-white/15 bg-white/8 px-3 py-2 text-[11px] leading-5 text-white/60 backdrop-blur-md">
          {copy.home.mobileHint}
        </div>
      )}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && (
        <>
          {/* ── Toolbar: 左上角系统状态 + 右上角功能按钮 ── */}
          <Toolbar />

          {/* ── 5.1: HoloDock 替代 Toolbar (AC-2.1, AC-2.2) ── */}
          <HoloDock />

          {/* ── 5.2: 面板包裹在 HoloDrawer 中 (AC-3.1, AC-3.3, AC-3.5) ── */}
          <HoloDrawer
            open={isConfigOpen}
            onClose={toggleConfig}
            title={copy.config.title}
            width={400}
          >
            <ConfigPanel embedded />
          </HoloDrawer>

          <HoloDrawer
            open={isChatOpen}
            onClose={toggleChat}
            title={copy.toolbar.dockButtons.chat.label}
            width={400}
          >
            <ChatPanel embedded />
          </HoloDrawer>

          <HoloDrawer
            open={isWorkflowPanelOpen}
            onClose={toggleWorkflowPanel}
            title={copy.workflow.title}
            width={420}
          >
            <WorkflowPanel embedded />
          </HoloDrawer>

          <TelemetryDashboard />
        </>
      )}
    </div>
  );
}
