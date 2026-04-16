/**
 * ControlPanel — Playback controls: play/pause/stop, speed, search & filter.
 *
 * Requirements: 18.3, 18.6
 */

import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Square, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ExecutionTimeline,
  ReplayEventType,
} from "../../../../shared/replay/contracts";
import { PLAYBACK_SPEEDS } from "../../../../shared/replay/contracts";
import type {
  ReplayEngine,
  ReplayState,
  PlaybackSpeed,
} from "@/lib/replay/replay-engine";
import { useReplayStore } from "@/lib/replay/replay-store-ui";

export interface ControlPanelProps {
  engine: ReplayEngine;
  timeline: ExecutionTimeline;
}

export function ControlPanel({ engine, timeline }: ControlPanelProps) {
  const [state, setState] = useState<ReplayState>("idle");
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [keyword, setKeyword] = useState("");
  const togglePanel = useReplayStore(s => s.togglePanel);
  const toggleDemoMode = useReplayStore(s => s.toggleDemoMode);

  useEffect(() => {
    const unsub = engine.onStateChange(s => {
      setState(s.state);
      setSpeed(s.speed);
    });
    return unsub;
  }, [engine]);

  const handlePlayPause = useCallback(() => {
    if (state === "idle") engine.play();
    else if (state === "playing") engine.pause();
    else if (state === "paused") engine.resume();
    else if (state === "stopped") {
      // Reset to idle-like state by reloading
      engine.play();
    }
  }, [engine, state]);

  const handleStop = useCallback(() => engine.stop(), [engine]);

  const handleSpeedChange = useCallback(
    (s: PlaybackSpeed) => engine.setSpeed(s),
    [engine]
  );

  const handleFilterKeyword = useCallback(
    (kw: string) => {
      setKeyword(kw);
      engine.setFilters({
        ...engine.getState().filters,
        keyword: kw || undefined,
      });
    },
    [engine]
  );

  const handleFilterType = useCallback(
    (type: ReplayEventType | "") => {
      engine.setFilters({
        ...engine.getState().filters,
        eventTypes: type ? [type] : undefined,
      });
    },
    [engine]
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Play / Pause */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handlePlayPause}
        className="text-white"
      >
        {state === "playing" ? (
          <Pause className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleStop}
        className="text-white/70"
      >
        <Square className="size-3.5" />
      </Button>

      {/* Speed selector */}
      <div className="flex items-center gap-1 rounded-md bg-white/10 px-1">
        {PLAYBACK_SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => handleSpeedChange(s)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
              speed === s
                ? "bg-white/20 text-white"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Event type filter */}
      <select
        className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none"
        onChange={e => handleFilterType(e.target.value as ReplayEventType | "")}
        defaultValue=""
        aria-label="Filter by event type"
      >
        <option value="">All types</option>
        <option value="MESSAGE_SENT">Message Sent</option>
        <option value="DECISION_MADE">Decision</option>
        <option value="CODE_EXECUTED">Code Exec</option>
        <option value="RESOURCE_ACCESSED">Resource</option>
        <option value="ERROR_OCCURRED">Error</option>
      </select>

      {/* Keyword search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-white/40" />
        <Input
          value={keyword}
          onChange={e => handleFilterKeyword(e.target.value)}
          placeholder="Search…"
          className="h-7 w-32 border-white/10 bg-white/5 pl-7 text-[11px] text-white placeholder:text-white/30"
        />
      </div>

      {/* Panel toggles */}
      <div className="flex gap-1 text-[10px]">
        <button
          onClick={() => togglePanel("costTracker")}
          className="rounded bg-white/10 px-2 py-0.5 text-white/60 hover:text-white"
        >
          Cost
        </button>
        <button
          onClick={() => togglePanel("performance")}
          className="rounded bg-white/10 px-2 py-0.5 text-white/60 hover:text-white"
        >
          Perf
        </button>
        <button
          onClick={() => togglePanel("dataLineage")}
          className="rounded bg-white/10 px-2 py-0.5 text-white/60 hover:text-white"
        >
          Lineage
        </button>
        <button
          onClick={toggleDemoMode}
          className="rounded bg-white/10 px-2 py-0.5 text-white/60 hover:text-white"
        >
          Demo
        </button>
      </div>
    </div>
  );
}
