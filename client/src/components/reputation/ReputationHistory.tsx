/**
 * ReputationHistory — score trend line + recent change events list.
 * @see Requirements 9.2, 9.3
 */

import { useEffect } from "react";
import { useReputationStore } from "../../lib/reputation-store";
import type { ReputationChangeEvent } from "@shared/reputation";

interface ReputationHistoryProps {
  agentId: string;
}

// ---------------------------------------------------------------------------
// Mini sparkline (SVG) for overallScore trend
// ---------------------------------------------------------------------------

function ScoreTrend({ events }: { events: ReputationChangeEvent[] }) {
  if (events.length < 2) {
    return <p className="text-xs text-gray-500">Not enough data for trend</p>;
  }

  // events are newest-first from the API; reverse for chronological order
  const sorted = [...events].reverse();
  const scores = sorted.map((e) => e.newOverallScore);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const w = 300;
  const h = 60;
  const pad = 4;

  const points = scores.map((s, i) => {
    const x = pad + ((w - 2 * pad) / (scores.length - 1)) * i;
    const y = h - pad - ((s - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Score trend">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Event list
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<string, string> = {
  task_completed: "Task Completed",
  inactivity_decay: "Inactivity Decay",
  streak_bonus: "Streak Bonus",
  admin_adjust: "Admin Adjust",
  admin_reset: "Admin Reset",
};

function EventRow({ event }: { event: ReputationChangeEvent }) {
  const delta = event.newOverallScore - event.oldOverallScore;
  const sign = delta >= 0 ? "+" : "";
  const color = delta >= 0 ? "text-green-400" : "text-red-400";
  const label = REASON_LABELS[event.reason] ?? event.reason;
  const time = new Date(event.timestamp).toLocaleString();

  return (
    <div className="flex items-center justify-between py-1 text-xs border-b border-gray-800">
      <span className="text-gray-400 w-36 truncate" title={time}>{time}</span>
      <span className="text-gray-300 flex-1 px-2">{label}</span>
      <span className={`font-mono font-data ${color}`}>
        {sign}{delta} → {event.newOverallScore}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReputationHistory({ agentId }: ReputationHistoryProps) {
  const events = useReputationStore((s) => s.events[agentId] ?? []);
  const fetchReputation = useReputationStore((s) => s.fetchReputation);

  useEffect(() => {
    fetchReputation(agentId);
  }, [agentId, fetchReputation]);

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs text-gray-500 mb-1">Score Trend (recent)</h4>
        <ScoreTrend events={events} />
      </div>
      <div>
        <h4 className="text-xs text-gray-500 mb-1">Recent Changes</h4>
        <div className="max-h-48 overflow-y-auto">
          {events.length === 0 && (
            <p className="text-xs text-gray-600">No reputation events yet</p>
          )}
          {events.slice(0, 50).map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      </div>
    </div>
  );
}
