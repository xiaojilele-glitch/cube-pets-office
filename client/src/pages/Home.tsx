/**
 * Home Page - Cube Pets Office
 * Full-screen 3D scene with layered workspace UI
 */
import { Scene3D } from '@/components/Scene3D';
import { PdfViewer } from '@/components/PdfViewer';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ChatPanel } from '@/components/ChatPanel';
import { Toolbar } from '@/components/Toolbar';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useAppStore } from '@/lib/store';
import { useEffect } from 'react';

export default function Home() {
  const isSceneReady = useAppStore((state) => state.isSceneReady);
  const hydrateAIConfig = useAppStore((state) => state.hydrateAIConfig);

  useEffect(() => {
    hydrateAIConfig().catch((error) => {
      console.error('[Home] Failed to load AI config:', error);
    });
  }, [hydrateAIConfig]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#E2D6C7]">
      <Scene3D />

      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,250,244,0.28),rgba(255,250,244,0)_34%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(120,88,56,0.12),rgba(120,88,56,0)_32%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(103,80,58,0.14),rgba(103,80,58,0)_28%)]" />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#D7C8B8]/35 to-transparent" />
        <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(79,58,38,0.12)]" />
      </div>

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && (
        <>
          <Toolbar />
          <PdfViewer />
          <ConfigPanel />
          <ChatPanel />
          <WorkflowPanel />
        </>
      )}
    </div>
  );
}
