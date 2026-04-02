/**
 * CostTrackerPanel — Cost cumulative display, distribution, anomalies.
 *
 * Requirements: 12.1, 12.2, 12.3
 */

import { useMemo } from 'react';

import type { ExecutionEvent } from '../../../../shared/replay/contracts';
import { CostTracker } from '@/lib/replay/cost-tracker';

export interface CostTrackerPanelProps {
  events: ExecutionEvent[];
  upToTime?: number;
}

export function CostTrackerPanel({ events, upToTime }: CostTrackerPanelProps) {
  const tracker = useMemo(() => new CostTracker(), []);

  const maxTime = upToTime ?? (events.length > 0 ? events[events.length - 1].timestamp : 0);

  const summary = useMemo(
    () => tracker.calculateCumulativeCost(events, maxTime),
    [tracker, events, maxTime],
  );

  const anomalies = useMemo(
    () => tracker.detectCostAnomalies(events, summary.totalCost * 0.3 || 0.01),
    [tracker, events, summary.totalCost],
  );

  const agentEntries = Object.entries(summary.byAgent).sort((a, b) => b[1] - a[1]);
  const maxAgentCost = agentEntries[0]?.[1] ?? 1;

  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a2e]/95 p-3 text-xs backdrop-blur">
      <p className="mb-2 text-[11px] font-semibold text-white/80">Cost Tracker</p>

      {/* Total */}
      <div className="mb-3 text-lg font-bold text-emerald-400">
        ${summary.totalCost.toFixed(4)}
      </div>

      {/* Distribution by agent */}
      <p className="mb-1 text-[10px] text-white/50">By Agent</p>
      <div className="mb-3 space-y-1">
        {agentEntries.slice(0, 5).map(([agent, cost]) => (
          <div key={agent}>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/60">{agent}</span>
              <span className="text-white/80">${cost.toFixed(4)}</span>
            </div>
            <div className="h-1 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500/60"
                style={{ width: `${(cost / maxAgentCost) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-red-400">
            Anomalies ({anomalies.length})
          </p>
          {anomalies.slice(0, 3).map((a) => (
            <p key={a.eventId} className="truncate text-[10px] text-red-300/70">
              {a.eventId.slice(0, 8)}… ${a.cost.toFixed(4)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
