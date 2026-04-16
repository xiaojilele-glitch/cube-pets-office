/**
 * PerformancePanel — Performance metrics dashboard, bottleneck markers.
 *
 * Requirements: 13.1, 13.2, 13.4
 */

import { useMemo } from "react";

import type { ExecutionTimeline } from "../../../../shared/replay/contracts";
import { PerformanceAnalyzer } from "@/lib/replay/performance-analyzer";

export interface PerformancePanelProps {
  timeline: ExecutionTimeline;
}

export function PerformancePanel({ timeline }: PerformancePanelProps) {
  const analyzer = useMemo(() => new PerformanceAnalyzer(), []);
  const metrics = useMemo(
    () => analyzer.calculateMetrics(timeline),
    [analyzer, timeline]
  );
  const bottlenecks = useMemo(
    () => analyzer.detectBottlenecks(timeline),
    [analyzer, timeline]
  );

  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a2e]/95 p-3 text-xs backdrop-blur">
      <p className="mb-2 text-[11px] font-semibold text-white/80">
        Performance
      </p>

      {/* Key metrics */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Metric
          label="Duration"
          value={`${(metrics.totalDuration / 1000).toFixed(1)}s`}
        />
        <Metric
          label="LLM Calls"
          value={String(metrics.llmMetrics.callCount)}
        />
        <Metric
          label="Avg Response"
          value={`${metrics.llmMetrics.avgResponseTime.toFixed(0)}ms`}
        />
        <Metric
          label="Max Concurrent"
          value={String(metrics.concurrency.maxConcurrentAgents)}
        />
      </div>

      {/* Stage metrics */}
      {metrics.stageMetrics.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] text-white/50">Stages</p>
          {metrics.stageMetrics.map(s => (
            <div
              key={s.stageKey}
              className="flex items-center justify-between py-0.5"
            >
              <span
                className={`text-[10px] ${s.isBottleneck ? "font-semibold text-red-400" : "text-white/60"}`}
              >
                {s.stageKey} {s.isBottleneck && "⚠"}
              </span>
              <span className="text-[10px] text-white/80">{s.duration}ms</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottleneck summary */}
      {bottlenecks.length > 0 && (
        <p className="text-[10px] text-red-400">
          {bottlenecks.length} bottleneck{bottlenecks.length > 1 ? "s" : ""}{" "}
          detected
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/5 p-1.5 text-center">
      <p className="text-[10px] text-white/40">{label}</p>
      <p className="text-sm font-semibold text-white/90">{value}</p>
    </div>
  );
}
