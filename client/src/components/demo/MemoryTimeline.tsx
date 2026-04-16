/**
 * MemoryTimeline — 记忆时间线组件
 *
 * 在 WorkflowPanel 的 memory 视图中展示记忆写入时间线。
 * 每条记忆条目显示类型标签、Agent 名称、阶段标签、内容摘要。
 *
 * @Requirements 7.1, 7.2, 7.3, 7.4
 */

import { useDemoStore } from "@/lib/demo-store";
import type { DemoMemoryEntry, MemoryEntryKind } from "@/lib/demo-store";

const KIND_CONFIG: Record<
  MemoryEntryKind,
  { label: string; color: string; bg: string }
> = {
  short_term: {
    label: "短期",
    color: "text-emerald-700",
    bg: "bg-emerald-100",
  },
  medium_term: { label: "中期", color: "text-amber-700", bg: "bg-amber-100" },
  long_term: { label: "长期", color: "text-violet-700", bg: "bg-violet-100" },
};

function MemoryEntry({ entry }: { entry: DemoMemoryEntry }) {
  const cfg = KIND_CONFIG[entry.kind];

  return (
    <div className="flex gap-3 py-2">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1">
        <div
          className={`h-2.5 w-2.5 rounded-full ${cfg.bg} ring-2 ring-white`}
        />
        <div className="w-px flex-1 bg-gray-200" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cfg.color} ${cfg.bg}`}
          >
            {cfg.label}
          </span>
          <span className="text-[10px] font-medium text-gray-500">
            {entry.agentId}
          </span>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] text-gray-400">{entry.stage}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-700">
          {entry.content}
        </p>
      </div>
    </div>
  );
}

export function MemoryTimeline() {
  const entries = useDemoStore(s => s.memoryTimeline);

  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-gray-400">
        等待记忆写入…
      </div>
    );
  }

  const sorted = [...entries].sort(
    (a, b) => a.timestampOffset - b.timestampOffset
  );

  return (
    <div className="px-3 py-2">
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Memory Timeline
      </h4>
      <div>
        {sorted.map((entry, i) => (
          <MemoryEntry
            key={`${entry.agentId}-${entry.kind}-${i}`}
            entry={entry}
          />
        ))}
      </div>
    </div>
  );
}
