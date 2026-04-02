/**
 * ReplayPage — Main replay page with four-area layout.
 *
 * Layout: 3D scene (center), timeline (bottom), event details (right), controls (top).
 * Loads replay on mount via URL param, supports fullscreen toggle.
 *
 * Requirements: 18.1, 18.5
 */

import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useReplayStore } from '@/lib/replay/replay-store-ui';

import { ReplayScene3D } from './ReplayScene3D';
import { TimelineBar } from './TimelineBar';
import { ControlPanel } from './ControlPanel';
import { EventDetailPanel } from './EventDetailPanel';
import { SnapshotManager } from './SnapshotManager';
import { CostTrackerPanel } from './CostTracker';
import { PerformancePanel } from './PerformancePanel';
import { DataLineageGraph } from './DataLineageGraph';
import { ComparisonView } from './ComparisonView';
import { TeachingOverlay } from './TeachingOverlay';

export interface ReplayPageProps {
  missionId: string;
}

export function ReplayPage({ missionId }: ReplayPageProps) {
  const {
    engine, timeline, isFullscreen, isDemoMode,
    isComparisonMode, selectedEventId,
    showCostTracker, showPerformance, showDataLineage,
    loadReplay, toggleFullscreen, reset,
  } = useReplayStore();

  useEffect(() => {
    loadReplay(missionId);
    return () => reset();
  }, [missionId, loadReplay, reset]);

  if (!engine || !timeline) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1a1a2e] text-white">
        Loading replay for {missionId}…
      </div>
    );
  }

  return (
    <div className={`flex h-screen flex-col bg-[#0f0f23] text-white ${isFullscreen ? 'fixed inset-0 z-[100]' : ''}`}>
      {/* Top: Controls */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#16213e] px-4 py-2">
        <ControlPanel engine={engine} timeline={timeline} />
        <div className="ml-auto flex items-center gap-2">
          <SnapshotManager />
          <Button variant="ghost" size="icon-sm" onClick={toggleFullscreen} className="text-white/70 hover:text-white">
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Middle: 3D scene + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* 3D Scene (center) */}
        <div className="relative flex-1">
          {isDemoMode && <TeachingOverlay />}
          <Canvas camera={{ position: [0, 5, 10], fov: 50 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 8, 5]} intensity={0.8} />
            <ReplayScene3D engine={engine} timeline={timeline} />
            <OrbitControls />
          </Canvas>

          {/* Analysis overlays */}
          {showCostTracker && (
            <div className="absolute bottom-2 left-2 w-72"><CostTrackerPanel events={timeline.events} /></div>
          )}
          {showPerformance && (
            <div className="absolute bottom-2 right-2 w-72"><PerformancePanel timeline={timeline} /></div>
          )}
          {showDataLineage && (
            <div className="absolute left-2 top-2 h-64 w-80"><DataLineageGraph events={timeline.events} /></div>
          )}
        </div>

        {/* Right: Event details */}
        {!isDemoMode && (
          <div className="w-80 overflow-y-auto border-l border-white/10 bg-[#16213e]">
            {isComparisonMode ? (
              <ComparisonView />
            ) : (
              <EventDetailPanel
                event={selectedEventId ? timeline.events.find(e => e.eventId === selectedEventId) ?? null : null}
                allEvents={timeline.events}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom: Timeline */}
      <div className="border-t border-white/10 bg-[#16213e]">
        <TimelineBar engine={engine} timeline={timeline} />
      </div>
    </div>
  );
}
