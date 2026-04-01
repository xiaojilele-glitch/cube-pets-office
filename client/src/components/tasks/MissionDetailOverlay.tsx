import { useCallback, useEffect, useRef } from "react";

import type { MissionTaskDetail } from "@/lib/tasks-store";

import { CompactPlanetInterior } from "./CompactPlanetInterior";
import { sliceRecentEvents } from "./mission-island-helpers";
import {
  agentStatusLabel,
  agentStatusTone,
  formatTaskRelative,
  timelineTone,
} from "./task-helpers";

export interface MissionDetailOverlayProps {
  detail: MissionTaskDetail | null;
  onClose: () => void;
  onNavigateToDetail: (taskId: string) => void;
}

export function MissionDetailOverlay({
  detail,
  onClose,
  onNavigateToDetail,
}: MissionDetailOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /* Escape key closes the overlay */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /* Click outside the panel closes the overlay */
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  if (!detail) return null;

  const recentEvents = sliceRecentEvents(detail.timeline);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleBackdropClick}
      data-testid="mission-detail-backdrop"
    >
      {/* Panel with fade-in + scale-in animation */}
      <div
        ref={panelRef}
        className="animate-in fade-in zoom-in-95 relative flex max-h-[80vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl border border-stone-200/80 bg-[linear-gradient(180deg,#fffdf7,#f6efe3)] p-5 shadow-[0_12px_40px_rgba(120,91,54,0.16)] duration-200"
        data-testid="mission-detail-panel"
      >
        {/* ── Ring Visualization ── */}
        <CompactPlanetInterior detail={detail} />

        {/* ── Recent Events Timeline ── */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-stone-700">
            最近事件
          </h3>
          {recentEvents.length === 0 ? (
            <p className="text-xs text-stone-400">暂无事件</p>
          ) : (
            <ul
              className="flex max-h-48 flex-col gap-1.5 overflow-y-auto"
              data-testid="mission-detail-timeline"
            >
              {recentEvents.map((evt) => (
                <li
                  key={evt.id}
                  className="flex items-start gap-2 rounded-lg bg-white/60 px-2.5 py-1.5"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-tight ${timelineTone(evt.level)}`}
                  >
                    {evt.level}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-stone-700">
                      {evt.title}
                    </span>
                    {evt.description && (
                      <span className="block truncate text-[10px] text-stone-500">
                        {evt.description}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-stone-400">
                    {formatTaskRelative(evt.time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Agent List ── */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-stone-700">
            Agent 列表
          </h3>
          {detail.agents.length === 0 ? (
            <p className="text-xs text-stone-400">暂无 Agent</p>
          ) : (
            <ul
              className="flex flex-col gap-1"
              data-testid="mission-detail-agents"
            >
              {detail.agents.map((agent) => (
                <li
                  key={agent.id}
                  className="flex items-center gap-2 rounded-lg bg-white/60 px-2.5 py-1.5"
                >
                  <span className="text-sm">{agent.name || agent.id}</span>
                  <span className="text-[10px] text-stone-500">
                    {agent.role}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight ${agentStatusTone(agent.status)}`}
                  >
                    {agentStatusLabel(agent.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Action Buttons ── */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100"
            data-testid="mission-detail-close"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => onNavigateToDetail(detail.id)}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
            data-testid="mission-detail-navigate"
          >
            查看完整详情
          </button>
        </div>
      </div>
    </div>
  );
}
