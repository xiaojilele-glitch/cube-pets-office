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
      className="absolute inset-0 z-50 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(247,239,226,0.16),rgba(59,39,20,0.08)_40%,rgba(25,16,8,0.22)_100%)] px-4 py-6 backdrop-blur-[6px]"
      onClick={handleBackdropClick}
      data-testid="mission-detail-backdrop"
    >
      <div
        ref={panelRef}
        className="animate-in fade-in zoom-in-95 relative flex max-h-[min(82vh,760px)] w-full max-w-[720px] flex-col gap-4 overflow-y-auto rounded-[28px] border border-[rgba(169,136,102,0.26)] bg-[linear-gradient(180deg,rgba(255,252,247,0.98),rgba(244,235,223,0.95))] p-6 shadow-[0_24px_80px_rgba(86,60,33,0.24)] duration-200"
        data-testid="mission-detail-panel"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
              当前任务
            </p>
            <h2 className="mt-1 text-xl font-bold text-stone-900">
              {detail.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                {detail.departmentLabels.length > 0 ? detail.departmentLabels.join(" / ") : "未分配部门"}
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                {detail.status}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/72 px-3 py-2 text-xs font-semibold text-stone-600 transition-colors hover:bg-white hover:text-stone-900"
            data-testid="mission-detail-close"
          >
            关闭
          </button>
        </div>

        {/* ── Ring Visualization ── */}
        <CompactPlanetInterior detail={detail} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-2xl bg-white/58 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
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

        <section className="rounded-2xl bg-white/52 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]">
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
        </div>

        {/* ── Action Buttons ── */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onNavigateToDetail(detail.id)}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100"
            data-testid="mission-detail-navigate"
          >
            查看完整详情
          </button>
        </div>
      </div>
    </div>
  );
}
