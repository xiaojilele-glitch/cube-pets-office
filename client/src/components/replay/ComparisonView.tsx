/**
 * ComparisonView — Side-by-side comparison of two mission replays.
 *
 * Dual timeline view, metrics comparison table, diff event highlighting.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4
 */

import { useEffect, useMemo, useState } from "react";

import type { ExecutionTimeline } from "../../../../shared/replay/contracts";
import { ReplayComparison } from "@/lib/replay/comparison";
import type {
  EventStreamDiff,
  MetricsComparison,
} from "@/lib/replay/comparison";
import { useReplayStore } from "@/lib/replay/replay-store-ui";
import { BrowserReplayStore } from "@/lib/replay/browser-replay-store";
import { Button } from "@/components/ui/button";

export function ComparisonView() {
  const { timeline, comparisonMissionId, stopComparison } = useReplayStore();
  const [compTimeline, setCompTimeline] = useState<ExecutionTimeline | null>(
    null
  );

  useEffect(() => {
    if (!comparisonMissionId) return;
    const store = new BrowserReplayStore();
    store
      .getTimeline(comparisonMissionId)
      .then(setCompTimeline)
      .catch(console.error);
  }, [comparisonMissionId]);

  const comparison = useMemo(() => new ReplayComparison(), []);

  const diff: EventStreamDiff | null = useMemo(
    () =>
      timeline && compTimeline
        ? comparison.diffEventStreams(timeline, compTimeline)
        : null,
    [comparison, timeline, compTimeline]
  );

  const metrics: MetricsComparison | null = useMemo(
    () =>
      timeline && compTimeline
        ? comparison.compareMetrics(timeline, compTimeline)
        : null,
    [comparison, timeline, compTimeline]
  );

  if (!timeline || !compTimeline || !diff || !metrics) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-white/40">
        {comparisonMissionId ? "Loading comparison…" : "No comparison active"}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 text-xs">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-white/80">Comparison</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={stopComparison}
          className="text-[10px] text-white/50"
        >
          Close
        </Button>
      </div>

      {/* Dual timeline summary */}
      <div className="grid grid-cols-2 gap-2">
        <TimelineSummary label="A" timeline={timeline} />
        <TimelineSummary label="B" timeline={compTimeline} />
      </div>

      {/* Metrics comparison */}
      <div>
        <p className="mb-1 text-[10px] text-white/50">Metrics</p>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-white/40">
              <th className="text-left">Metric</th>
              <th>A</th>
              <th>B</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <MetricRow
              label="Duration"
              a={`${metrics.a.totalDuration}ms`}
              b={`${metrics.b.totalDuration}ms`}
              diff={`${metrics.durationDiff > 0 ? "+" : ""}${metrics.durationDiff}ms`}
            />
            <MetricRow
              label="LLM Calls"
              a={String(metrics.a.llmMetrics.callCount)}
              b={String(metrics.b.llmMetrics.callCount)}
              diff={`${metrics.llmCallCountDiff > 0 ? "+" : ""}${metrics.llmCallCountDiff}`}
            />
            <MetricRow
              label="Concurrency"
              a={String(metrics.a.concurrency.maxConcurrentAgents)}
              b={String(metrics.b.concurrency.maxConcurrentAgents)}
              diff={`${metrics.concurrencyDiff > 0 ? "+" : ""}${metrics.concurrencyDiff}`}
            />
          </tbody>
        </table>
      </div>

      {/* Event diff */}
      <div>
        <p className="mb-1 text-[10px] text-white/50">Event Differences</p>
        {diff.onlyInA.length > 0 && (
          <p className="text-red-300">Only in A: {diff.onlyInA.join(", ")}</p>
        )}
        {diff.onlyInB.length > 0 && (
          <p className="text-green-300">Only in B: {diff.onlyInB.join(", ")}</p>
        )}
        {diff.common.length > 0 && (
          <p className="text-white/50">Common: {diff.common.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

function TimelineSummary({
  label,
  timeline,
}: {
  label: string;
  timeline: ExecutionTimeline;
}) {
  return (
    <div className="rounded bg-white/5 p-2">
      <p className="text-[10px] font-semibold text-white/60">Mission {label}</p>
      <p className="truncate text-[10px] text-white/80">{timeline.missionId}</p>
      <p className="text-[10px] text-white/50">{timeline.eventCount} events</p>
    </div>
  );
}

function MetricRow({
  label,
  a,
  b,
  diff,
}: {
  label: string;
  a: string;
  b: string;
  diff: string;
}) {
  return (
    <tr>
      <td className="py-0.5 text-white/40">{label}</td>
      <td className="text-center">{a}</td>
      <td className="text-center">{b}</td>
      <td className="text-center">{diff}</td>
    </tr>
  );
}
