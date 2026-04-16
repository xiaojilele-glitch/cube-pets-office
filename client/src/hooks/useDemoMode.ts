/**
 * useDemoMode — Demo 模式 React Hook
 *
 * 封装 DemoPlaybackEngine 和 DemoStoreAdapter 的生命周期。
 * 组件卸载时自动清理资源。
 *
 * @Requirements 3.1, 3.5, 4.5
 */

import { useCallback, useEffect, useRef } from "react";
import { useDemoStore } from "../lib/demo-store";
import { DemoPlaybackEngine } from "../runtime/demo-playback/engine";
import { DemoStoreAdapter } from "../runtime/demo-playback/store-adapter";
import type { DemoDataBundle } from "@shared/demo/contracts";
import type { PlaybackState } from "../runtime/demo-playback/engine";
import type { DemoMemoryEntry, DemoEvolutionLog } from "../lib/demo-store";

export function useDemoMode() {
  const engineRef = useRef<DemoPlaybackEngine | null>(null);
  const adapterRef = useRef<DemoStoreAdapter | null>(null);

  const isActive = useDemoStore(s => s.isActive);
  const playbackState = useDemoStore(s => s.playbackState);

  const startDemo = useCallback(async (bundle: DemoDataBundle) => {
    // Prevent double-start
    if (engineRef.current) return;

    const adapter = new DemoStoreAdapter(bundle);
    adapterRef.current = adapter;

    try {
      await adapter.initializeDemoMission();
    } catch {
      return;
    }

    // Build memory / evolution entries from the bundle for scheduled dispatch
    const memoryEntries = buildMemoryEntries(bundle);
    const evolutionLogs = buildEvolutionLogs(bundle);

    const engine = new DemoPlaybackEngine(bundle, {
      onEvent: entry => {
        adapter.handleEvent(entry);

        // Dispatch memory entries whose offset has been reached
        const elapsed = entry.offsetMs;
        while (
          memoryEntries.length > 0 &&
          memoryEntries[0].timestampOffset <= elapsed
        ) {
          adapter.appendMemoryEntry(memoryEntries.shift()!);
        }

        // Dispatch evolution logs when entering evolution stage
        if (
          entry.event.type === "stage_change" &&
          entry.event.stage === "evolution"
        ) {
          adapter.setEvolutionLogs(evolutionLogs);
        }
      },
      onStateChange: (state: PlaybackState) => {
        useDemoStore.getState().setPlaybackState(state);
      },
      onError: (error: Error) => {
        console.error("[useDemoMode] Playback error:", error);
        useDemoStore.getState().setPlaybackState("failed");
      },
    });

    engineRef.current = engine;
    engine.start();
  }, []);

  const pauseDemo = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const resumeDemo = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  const stopDemo = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    adapterRef.current?.cleanup();
    adapterRef.current = null;
  }, []);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      adapterRef.current?.cleanup();
      adapterRef.current = null;
    };
  }, []);

  return {
    isActive,
    playbackState,
    startDemo,
    pauseDemo,
    resumeDemo,
    stopDemo,
  };
}

// ---------------------------------------------------------------------------
// Helpers: extract memory entries and evolution logs from the bundle
// ---------------------------------------------------------------------------

function buildMemoryEntries(bundle: DemoDataBundle): DemoMemoryEntry[] {
  // Map evolution patches and timeline stages to memory entries.
  // The actual DemoDataBundle may provide these directly once L01 is complete.
  // For now, synthesize from timeline events.
  const entries: DemoMemoryEntry[] = [];
  const totalDuration = bundle.meta.totalDurationMs;

  // Short-term: during execution phase (~17-40% of timeline)
  for (const agent of bundle.agents) {
    entries.push({
      agentId: agent.id,
      kind: "short_term",
      stage: "execution",
      content: `${agent.name} LLM interaction log`,
      timestampOffset: Math.round(totalDuration * 0.2),
    });
  }

  // Medium-term: during summary phase (~77-83% of timeline)
  entries.push({
    agentId: bundle.agents[0]?.id ?? "ceo",
    kind: "medium_term",
    stage: "summary",
    content: "Workflow summary materialized",
    timestampOffset: Math.round(totalDuration * 0.8),
  });

  // Long-term: during evolution phase (~90-100% of timeline)
  for (const patch of bundle.evolutionPatches) {
    entries.push({
      agentId: patch.agentId,
      kind: "long_term",
      stage: "evolution",
      content: `SOUL.md patch: ${patch.dimension} ${patch.oldScore}→${patch.newScore}`,
      timestampOffset: Math.round(totalDuration * 0.93),
    });
  }

  return entries.sort((a, b) => a.timestampOffset - b.timestampOffset);
}

function buildEvolutionLogs(bundle: DemoDataBundle): DemoEvolutionLog[] {
  return bundle.evolutionPatches.map(p => ({
    agentId: p.agentId,
    dimension: p.dimension,
    oldScore: p.oldScore,
    newScore: p.newScore,
    patchContent: p.patchContent,
    applied: true,
  }));
}
