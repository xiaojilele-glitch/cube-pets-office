import type { MissionTaskSummary } from "@/lib/tasks-store";
import { useI18n } from "@/i18n";

import { missionStatusLabel, missionStatusTone } from "./task-helpers";
import { truncateTitle } from "./mission-island-helpers";

export interface MissionMiniViewProps {
  mission: MissionTaskSummary | null;
  onExpand: () => void;
  onCreateMission: () => void;
}

export function MissionMiniView({
  mission,
  onExpand,
  onCreateMission,
}: MissionMiniViewProps) {
  const { locale } = useI18n();
  if (!mission) {
    return (
      <div
        className="flex max-w-[200px] flex-col items-center gap-2 rounded-xl border border-stone-200/80 bg-[linear-gradient(180deg,#fffdf7,#f6efe3)] px-3 py-3 shadow-[0_4px_16px_rgba(120,91,54,0.10)]"
        data-testid="mission-mini-idle"
      >
        <span className="text-xs text-stone-500">
          {locale === "zh-CN" ? "暂无活跃任务" : "No active mission"}
        </span>
        <button
          type="button"
          onClick={onCreateMission}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
          data-testid="mission-mini-create"
        >
          {locale === "zh-CN" ? "创建任务" : "Create mission"}
        </button>
      </div>
    );
  }

  const progressPct = Math.round(mission.progress);
  const displayTitle = truncateTitle(
    mission.title || (locale === "zh-CN" ? "未命名任务" : "Untitled mission"),
    40
  );
  const phaseLabel =
    mission.currentStageLabel ?? missionStatusLabel(mission.status, locale);

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex max-w-[200px] cursor-pointer flex-col gap-1.5 rounded-xl border border-stone-200/80 bg-[linear-gradient(180deg,#fffdf7,#f6efe3)] px-3 py-2.5 text-left shadow-[0_4px_16px_rgba(120,91,54,0.10)] transition-shadow hover:shadow-[0_6px_20px_rgba(120,91,54,0.16)]"
      data-testid="mission-mini-active"
    >
      {/* Title */}
      <span
        className="line-clamp-1 text-xs font-semibold text-stone-800"
        title={mission.title}
        data-testid="mission-mini-title"
      >
        {displayTitle}
      </span>

      {/* Phase label + progress percentage */}
      <div className="flex items-center justify-between gap-1">
        <span
          className={`inline-block truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight ${missionStatusTone(mission.status)}`}
          data-testid="mission-mini-phase"
        >
          {phaseLabel}
        </span>
        <span
          className="shrink-0 text-[10px] font-semibold tabular-nums text-stone-600"
          data-testid="mission-mini-progress"
        >
          {progressPct}%
        </span>
      </div>

      {/* Mini progress bar */}
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-stone-200/60"
        data-testid="mission-mini-bar"
      >
        <div
          className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
        />
      </div>

      {/* Active agents (up to 3 emoji) */}
      {mission.activeAgentCount > 0 && (
        <div
          className="flex items-center gap-0.5"
          data-testid="mission-mini-agents"
        >
          {Array.from({ length: Math.min(3, mission.activeAgentCount) }).map(
            (_, i) => (
              <span
                key={i}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stone-200 bg-white/80 text-[11px]"
              >
                🤖
              </span>
            ),
          )}
          {mission.activeAgentCount > 3 && (
            <span className="ml-0.5 text-[10px] text-stone-500">
              +{mission.activeAgentCount - 3}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
