import type { CSSProperties } from "react";

import { useI18n } from "@/i18n";
import type { MissionTaskDetail } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

import {
  agentStatusLabel,
  agentStatusTone,
  compactText,
  roleLabel,
  stageTone,
} from "./task-helpers";

const STAGE_COLORS: Record<string, string> = {
  pending: "rgba(214, 211, 209, 0.9)",
  running: "rgba(245, 158, 11, 0.95)",
  done: "rgba(16, 185, 129, 0.95)",
  failed: "rgba(244, 63, 94, 0.95)",
};

const PLANET_PANEL_CLASS =
  "workspace-panel-inset rounded-[24px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.72)] shadow-sm";
const PLANET_TILE_CLASS =
  "workspace-panel-inset rounded-[18px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.62)] px-3 py-2.5";
const PLANET_LIST_CARD_CLASS =
  "workspace-panel-inset rounded-[16px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.62)] px-3 py-2.5";
const PLANET_PILL_CLASS =
  "workspace-status workspace-tone-neutral bg-white/75 px-2.5 py-1 text-[11px] text-stone-600";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function orbitStyle(angle: number, radius: number): CSSProperties {
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = Math.cos(radians) * radius;
  const y = Math.sin(radians) * radius;
  return {
    left: "50%",
    top: "50%",
    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
  };
}

function agentBadge(agentName: string): string {
  return agentName.trim().slice(0, 1).toUpperCase() || "?";
}

export function TaskPlanetInterior({
  detail,
  className,
  compact = false,
}: {
  detail: MissionTaskDetail;
  className?: string;
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const ringGradient = detail.stages
    .map(
      stage =>
        `${STAGE_COLORS[stage.status]} ${stage.arcStart}deg ${stage.arcEnd}deg`
    )
    .join(", ");
  const stageRadius = compact ? 82 : 118;
  const agentRadius = compact ? 112 : 150;

  return (
    <section
      className={cn(
        "workspace-panel workspace-panel-strong overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_top_left,rgba(252,211,77,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.18),transparent_34%),linear-gradient(180deg,#fffdf7,#f6efe3)] shadow-[0_24px_70px_rgba(120,91,54,0.12)]",
        compact ? "p-3 xl:max-h-[360px]" : "p-4",
        className
      )}
    >
      <div
        className={cn(
          "grid xl:items-start",
          compact
            ? "gap-3 xl:grid-cols-[minmax(0,1fr)_260px]"
            : "gap-4 xl:grid-cols-[minmax(0,1.12fr)_320px]"
        )}
      >
        <div className={cn(PLANET_PANEL_CLASS, compact ? "p-3" : "p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                {t(locale, "二维星图", "2D Star Map")}
              </div>
              <div
                className={cn(
                  "mt-1 font-semibold text-stone-800",
                  compact ? "text-[13px]" : "text-sm"
                )}
              >
                {t(locale, "任务轨道视图", "Mission orbit view")}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-stone-600">
              <span className={PLANET_PILL_CLASS}>
                {t(locale, `${detail.stages.length} 个阶段`, `${detail.stages.length} stages`)}
              </span>
              <span className={PLANET_PILL_CLASS}>
                {t(locale, `${detail.agents.length} 名成员`, `${detail.agents.length} crew`)}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "flex min-w-0 items-center justify-center",
              compact ? "mt-3" : "mt-4"
            )}
          >
            <div
              className={cn(
                "relative aspect-square w-full",
                compact ? "max-w-[236px]" : "max-w-[334px]"
              )}
            >
              <div className="absolute inset-5 rounded-full bg-[radial-gradient(circle,rgba(255,250,240,0.96)_0%,rgba(255,245,231,0.92)_34%,rgba(240,231,214,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" />
              <div
                className="absolute inset-7 rounded-full p-[8px] shadow-[0_18px_44px_rgba(99,71,41,0.12)]"
                style={{ background: `conic-gradient(${ringGradient})` }}
              >
                <div className="size-full rounded-full border border-white/75 bg-[radial-gradient(circle,#fffdf8_0%,#f9f2e6_72%,#efe3cf_100%)]" />
              </div>
              <div className="absolute inset-[28%] rounded-full border border-white/70 bg-[radial-gradient(circle,rgba(255,250,244,0.96),rgba(246,236,221,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_14px_32px_rgba(124,95,62,0.12)]" />

              <div className="absolute inset-[34%] flex items-center justify-center">
                <div
                  className={cn(
                    "workspace-panel-inset border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.82)] text-center shadow-[0_14px_36px_rgba(107,77,44,0.12)] backdrop-blur",
                    compact ? "rounded-[20px] px-3.5 py-3" : "rounded-[24px] px-5 py-4"
                  )}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                    {t(locale, "任务核心", "Mission Core")}
                  </div>
                  <div
                    className={cn(
                      "mt-2 font-semibold text-stone-800",
                      compact ? "text-2xl" : "text-3xl"
                    )}
                  >
                    {detail.progress}%
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-stone-600",
                      compact ? "text-xs" : "text-sm"
                    )}
                  >
                    {detail.currentStageLabel || t(locale, "准备中", "Preparing")}
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-stone-500">
                    {t(
                      locale,
                      `${detail.activeAgentCount} 个活跃执行体`,
                      `${detail.activeAgentCount} active agents`
                    )}
                  </div>
                </div>
              </div>

              {detail.stages.map(stage => (
                <div
                  key={stage.key}
                  className="absolute z-10"
                  style={orbitStyle(stage.midAngle, stageRadius)}
                >
                  <div
                    className={cn(
                      "workspace-status text-center text-[10px] font-medium shadow-sm backdrop-blur",
                      compact ? "min-w-[62px] px-2 py-1" : "min-w-[82px] px-2.5 py-1.5",
                      stageTone(stage.status)
                    )}
                  >
                    <div className="truncate">{stage.label}</div>
                    <div className="mt-0.5 text-[10px] opacity-75">
                      {stage.progress}%
                    </div>
                  </div>
                </div>
              ))}

              {detail.agents.map(agent => (
                <div
                  key={agent.id}
                  className="absolute z-20"
                  style={orbitStyle(agent.angle, agentRadius)}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center rounded-full border text-[11px] font-semibold shadow-sm backdrop-blur",
                      compact ? "size-7" : "size-8",
                      agentStatusTone(agent.status)
                    )}
                    title={`${agent.name} - ${agent.stageLabel}`}
                  >
                    {agentBadge(agent.name)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className={cn(
              "grid gap-2 sm:grid-cols-3",
              compact ? "mt-3" : "mt-4"
            )}
          >
            <div className={PLANET_TILE_CLASS}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                {t(locale, "当前焦点", "Focus")}
              </div>
              <div className="mt-1 text-sm font-medium text-stone-800">
                {detail.currentStageLabel || t(locale, "当前无活跃阶段", "No active stage")}
              </div>
            </div>
            <div className={PLANET_TILE_CLASS}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                {t(locale, "等待原因", "Waiting")}
              </div>
              <div className="mt-1 text-sm font-medium text-stone-800">
                {compactText(
                  detail.waitingFor || t(locale, "当前无阻塞信号", "No blocking signal"),
                  42
                )}
              </div>
            </div>
            <div className={PLANET_TILE_CLASS}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                {t(locale, "最新信号", "Signal")}
              </div>
              <div className="mt-1 text-sm font-medium text-stone-800">
                {compactText(
                  detail.lastSignal || t(locale, "当前没有新的执行信号", "No recent signal"),
                  42
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className={cn(PLANET_PANEL_CLASS, compact ? "p-3" : "p-4")}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-stone-800">
                {t(locale, "执行阶段", "Orbit Stages")}
              </div>
              <span className={PLANET_PILL_CLASS}>
                {t(locale, `${detail.stages.length} 个节点`, `${detail.stages.length} nodes`)}
              </span>
            </div>
            <div
              className={cn(
                "mt-3 grid gap-2 sm:grid-cols-2",
                compact && "max-h-[116px] overflow-y-auto pr-1"
              )}
            >
              {detail.stages.map(stage => (
                <div key={stage.key} className={PLANET_LIST_CARD_CLASS}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-800">
                        {stage.label}
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] leading-5 text-stone-500">
                        {stage.detail || t(locale, "当前还没有记录详细内容。", "No detail captured yet.")}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "workspace-status shrink-0 px-2 py-1 text-[10px] font-semibold",
                        stageTone(stage.status)
                      )}
                    >
                      {stage.progress}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={cn(PLANET_PANEL_CLASS, compact ? "p-3" : "p-4")}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-stone-800">
                {t(locale, "执行成员", "Agent Crew")}
              </div>
              <span className={PLANET_PILL_CLASS}>
                {t(locale, `${detail.agents.length} 名成员`, `${detail.agents.length} members`)}
              </span>
            </div>
            <div
              className={cn(
                "mt-3 grid gap-2 sm:grid-cols-2",
                compact && "max-h-[132px] overflow-y-auto pr-1"
              )}
            >
              {detail.agents.map(agent => (
                <div key={agent.id} className={PLANET_LIST_CARD_CLASS}>
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        "mt-0.5 flex shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold shadow-sm",
                        compact ? "size-7" : "size-8",
                        agentStatusTone(agent.status)
                      )}
                    >
                      {agentBadge(agent.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-stone-800">
                            {agent.name}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-stone-500">
                            {roleLabel(agent.role, locale)} / {agent.department}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "workspace-status shrink-0 px-2 py-1 text-[10px] font-medium",
                            agentStatusTone(agent.status)
                          )}
                        >
                          {agentStatusLabel(agent.status, locale)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="workspace-status workspace-tone-neutral bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          {compactText(agent.stageLabel, 16)}
                        </span>
                        {typeof agent.progress === "number" ? (
                          <span className="workspace-status workspace-tone-neutral bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                            {agent.progress}%
                          </span>
                        ) : null}
                      </div>
                      {agent.currentAction ? (
                        <div className="mt-1 line-clamp-1 text-[11px] leading-5 text-stone-500">
                          {agent.currentAction}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
