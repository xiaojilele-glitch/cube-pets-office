/**
 * TimelineBar — Event distribution visualization with playback position.
 *
 * Renders colored dots by event type along a horizontal bar.
 * Click to jump to a time point. Shows current playback position indicator.
 *
 * Requirements: 18.2
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ExecutionTimeline,
  ReplayEventType,
} from "../../../../shared/replay/contracts";
import type { ReplayEngine } from "@/lib/replay/replay-engine";

/* ─── Event type → color mapping ─── */

const EVENT_COLORS: Record<ReplayEventType, string> = {
  AGENT_STARTED: "#22c55e",
  AGENT_STOPPED: "#6b7280",
  MESSAGE_SENT: "#3b82f6",
  MESSAGE_RECEIVED: "#60a5fa",
  DECISION_MADE: "#f59e0b",
  CODE_EXECUTED: "#a855f7",
  RESOURCE_ACCESSED: "#14b8a6",
  ERROR_OCCURRED: "#ef4444",
  MILESTONE_REACHED: "#ec4899",
};

export interface TimelineBarProps {
  engine: ReplayEngine;
  timeline: ExecutionTimeline;
}

export function TimelineBar({ engine, timeline }: TimelineBarProps) {
  const [currentTime, setCurrentTime] = useState(timeline.startTime);

  useEffect(() => {
    const unsub = engine.onStateChange(state => {
      setCurrentTime(state.currentTime);
    });
    return unsub;
  }, [engine]);

  const duration = timeline.totalDuration || 1;

  const progress = useMemo(
    () => Math.min(((currentTime - timeline.startTime) / duration) * 100, 100),
    [currentTime, timeline.startTime, duration]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const targetTime = timeline.startTime + pct * duration;
      engine.seek(targetTime);
    },
    [engine, timeline.startTime, duration]
  );

  return (
    <div className="px-4 py-3">
      {/* Legend */}
      <div className="mb-1.5 flex flex-wrap gap-3 text-[10px] text-white/60">
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: color }}
            />
            {type.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      {/* Timeline track */}
      <div
        className="relative h-8 cursor-pointer rounded bg-white/5"
        onClick={handleClick}
        role="slider"
        aria-label="Timeline"
        aria-valuenow={currentTime}
        aria-valuemin={timeline.startTime}
        aria-valuemax={timeline.endTime}
        tabIndex={0}
      >
        {/* Event dots */}
        {timeline.events.map(evt => {
          const left = ((evt.timestamp - timeline.startTime) / duration) * 100;
          return (
            <span
              key={evt.eventId}
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80"
              style={{
                left: `${left}%`,
                background: EVENT_COLORS[evt.eventType] ?? "#888",
              }}
            />
          );
        })}

        {/* Playback position indicator */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)]"
          style={{ left: `${progress}%` }}
        />
      </div>

      {/* Time labels */}
      <div className="mt-1 flex justify-between text-[10px] text-white/40">
        <span>{new Date(timeline.startTime).toLocaleTimeString()}</span>
        <span>{new Date(timeline.endTime).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
