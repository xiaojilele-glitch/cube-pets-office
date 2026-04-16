/**
 * EvolutionScoreCard — 进化评分卡组件
 *
 * 展示每个 Agent 的四维评分变化（accuracy、completeness、actionability、format）。
 * 数值从 oldScore 到 newScore 的平滑过渡动画（CSS transition）。
 *
 * @Requirements 7.5, 7.6
 */

import { useEffect, useState } from "react";
import { useDemoStore } from "@/lib/demo-store";
import type { DemoEvolutionLog } from "@/lib/demo-store";

const DIMENSION_LABELS: Record<string, string> = {
  accuracy: "准确性",
  completeness: "完整性",
  actionability: "可操作性",
  format: "格式规范",
};

function ScoreBar({
  label,
  oldScore,
  newScore,
  animate,
}: {
  label: string;
  oldScore: number;
  newScore: number;
  animate: boolean;
}) {
  const [displayScore, setDisplayScore] = useState(oldScore);

  useEffect(() => {
    if (animate) {
      // Small delay to trigger CSS transition
      const timer = setTimeout(() => setDisplayScore(newScore), 50);
      return () => clearTimeout(timer);
    } else {
      setDisplayScore(newScore);
    }
  }, [animate, newScore]);

  const delta = newScore - oldScore;
  const deltaColor =
    delta > 0
      ? "text-emerald-600"
      : delta < 0
        ? "text-red-500"
        : "text-gray-400";

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-16 shrink-0 text-[10px] text-gray-500">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-400 to-blue-500"
          style={{
            width: `${Math.min(100, displayScore)}%`,
            transition: animate ? "width 0.8s ease-out" : "none",
          }}
        />
      </div>
      <span className="w-8 text-right text-[11px] font-semibold text-gray-700">
        {Math.round(displayScore)}
      </span>
      <span className={`w-8 text-right text-[10px] font-medium ${deltaColor}`}>
        {delta > 0
          ? `+${delta.toFixed(0)}`
          : delta === 0
            ? "—"
            : delta.toFixed(0)}
      </span>
    </div>
  );
}

function AgentCard({
  agentId,
  logs,
  animate,
}: {
  agentId: string;
  logs: DemoEvolutionLog[];
  animate: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white/80 p-3">
      <p className="mb-1.5 text-[11px] font-semibold text-gray-700">
        {agentId}
      </p>
      {logs.map(log => (
        <ScoreBar
          key={log.dimension}
          label={DIMENSION_LABELS[log.dimension] ?? log.dimension}
          oldScore={log.oldScore}
          newScore={log.newScore}
          animate={animate}
        />
      ))}
    </div>
  );
}

export function EvolutionScoreCard({ animate = true }: { animate?: boolean }) {
  const logs = useDemoStore(s => s.evolutionLogs);

  if (logs.length === 0) return null;

  // Group logs by agentId
  const byAgent = new Map<string, DemoEvolutionLog[]>();
  for (const log of logs) {
    const arr = byAgent.get(log.agentId) ?? [];
    arr.push(log);
    byAgent.set(log.agentId, arr);
  }

  return (
    <div className="space-y-2 px-3 py-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Evolution Scores
      </h4>
      {Array.from(byAgent.entries()).map(([agentId, agentLogs]) => (
        <AgentCard
          key={agentId}
          agentId={agentId}
          logs={agentLogs}
          animate={animate}
        />
      ))}
    </div>
  );
}
