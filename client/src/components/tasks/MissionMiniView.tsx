import { useI18n } from "@/i18n";
import type { MissionTaskSummary } from "@/lib/tasks-store";

import { truncateTitle } from "./mission-island-helpers";
import { missionStatusLabel, missionStatusTone } from "./task-helpers";

export interface MissionMiniViewProps {
  mission: MissionTaskSummary | null;
  onExpand: () => void;
  onCreateMission: () => void;
  mounted?: boolean;
  compactMounted?: boolean;
}

export function MissionMiniView({
  mission,
  onExpand,
  onCreateMission,
  mounted = false,
  compactMounted = false,
}: MissionMiniViewProps) {
  const { locale } = useI18n();
  const mountedShellSize = compactMounted
    ? "w-[294px] min-h-[164px]"
    : "max-w-[220px]";
  const mountedGap = compactMounted ? "gap-1.5" : "gap-2";
  const mountedPadding = compactMounted ? "px-2.5 py-2" : "px-3 py-3";
  const mountedRadius = compactMounted ? "rounded-[14px]" : "rounded-[18px]";
  const mountedShadow = compactMounted
    ? "shadow-none"
    : "shadow-[0_8px_18px_rgba(103,78,52,0.12)]";
  const idleShellClass = mounted
    ? `relative flex ${mountedShellSize} flex-col items-center ${mountedGap} ${mountedRadius} border border-[#E7D8C4] bg-[linear-gradient(180deg,rgba(255,252,246,0.98),rgba(246,237,226,0.96))] ${mountedPadding} ${mountedShadow}`
    : "flex max-w-[200px] flex-col items-center gap-2 rounded-xl border border-stone-200/80 bg-[linear-gradient(180deg,#fffdf7,#f6efe3)] px-3 py-3 shadow-[0_4px_16px_rgba(120,91,54,0.10)]";
  const activeShellClass = mounted
    ? `relative flex ${mountedShellSize} cursor-pointer flex-col gap-1.5 ${mountedRadius} border border-[#E7D8C4] bg-[linear-gradient(180deg,rgba(255,252,246,0.98),rgba(246,237,226,0.96))] ${mountedPadding} text-left ${mountedShadow} transition-shadow hover:shadow-[0_4px_10px_rgba(103,78,52,0.14)]`
    : "flex max-w-[200px] cursor-pointer flex-col gap-1.5 rounded-xl border border-stone-200/80 bg-[linear-gradient(180deg,#fffdf7,#f6efe3)] px-3 py-2.5 text-left shadow-[0_4px_16px_rgba(120,91,54,0.10)] transition-shadow hover:shadow-[0_6px_20px_rgba(120,91,54,0.16)]";
  const pinNodes = mounted && !compactMounted ? (
    <>
      <span className="pointer-events-none absolute left-4 top-2.5 h-2.5 w-2.5 rounded-full border border-[#E8D7C0] bg-[#FFF7EC] shadow-[0_1px_4px_rgba(92,68,44,0.18)]" />
      <span className="pointer-events-none absolute right-4 top-2.5 h-2.5 w-2.5 rounded-full border border-[#E8D7C0] bg-[#FFF7EC] shadow-[0_1px_4px_rgba(92,68,44,0.18)]" />
    </>
  ) : null;

  if (!mission) {
    return (
      <div className={idleShellClass} data-testid="mission-mini-idle">
        {pinNodes}
        <span className="text-xs text-stone-500">
          {locale === "zh-CN" ? "暂无活跃任务" : "No active mission"}
        </span>
        <button
          type="button"
          onClick={onCreateMission}
          className="workspace-control rounded-lg px-3 py-1 text-xs font-medium"
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
      className={activeShellClass}
      data-testid="mission-mini-active"
    >
      {pinNodes}

      <span
        className={`line-clamp-1 pr-1 font-semibold text-stone-800 ${compactMounted ? "text-[11px]" : "text-xs"}`}
        title={mission.title}
        data-testid="mission-mini-title"
      >
        {displayTitle}
      </span>

      <div className="flex items-center justify-between gap-1">
        <span
          className={`workspace-status truncate px-1.5 py-0.5 ${compactMounted ? "text-[9px]" : "text-[10px]"} font-medium leading-tight ${missionStatusTone(
            mission.status
          )}`}
          data-testid="mission-mini-phase"
        >
          {phaseLabel}
        </span>
        <span
          className={`shrink-0 font-semibold tabular-nums text-stone-600 ${compactMounted ? "text-[9px]" : "text-[10px]"}`}
          data-testid="mission-mini-progress"
        >
          {progressPct}%
        </span>
      </div>

      <div
        className="h-1 w-full overflow-hidden rounded-full bg-stone-200/60"
        data-testid="mission-mini-bar"
      >
        <div
          className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
        />
      </div>

      {mission.activeAgentCount > 0 && (
        <div className="flex items-center gap-0.5" data-testid="mission-mini-agents">
          {Array.from({ length: Math.min(3, mission.activeAgentCount) }).map(
            (_, index) => (
              <span
                key={index}
                className={`inline-flex items-center justify-center rounded-full border border-stone-200 bg-white/80 ${compactMounted ? "h-4 w-4 text-[9px]" : "h-5 w-5 text-[11px]"}`}
              >
                🐻
              </span>
            )
          )}
          {mission.activeAgentCount > 3 && (
            <span className={`ml-0.5 text-stone-500 ${compactMounted ? "text-[9px]" : "text-[10px]"}`}>
              +{mission.activeAgentCount - 3}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
