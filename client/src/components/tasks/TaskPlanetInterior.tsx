import type { CSSProperties } from "react";

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
}: {
  detail: MissionTaskDetail;
  className?: string;
}) {
  const ringGradient = detail.stages
    .map(stage => {
      return `${STAGE_COLORS[stage.status]} ${stage.arcStart}deg ${stage.arcEnd}deg`;
    })
    .join(", ");

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[28px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(252,211,77,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.18),transparent_34%),linear-gradient(180deg,#fffdf7,#f6efe3)] p-4 shadow-[0_24px_70px_rgba(120,91,54,0.12)]",
        className
      )}
    >
      <div className="grid gap-4 xl:items-start xl:grid-cols-[minmax(0,1.12fr)_320px]">
        <div className="self-start rounded-[24px] border border-white/75 bg-white/70 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                2D Star Map
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-800">
                Mission orbit view
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-stone-600">
              <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1">
                {detail.stages.length} stages
              </span>
              <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1">
                {detail.agents.length} crew
              </span>
            </div>
          </div>

          <div className="mt-4 flex min-w-0 items-center justify-center">
            <div className="relative aspect-square w-full max-w-[334px]">
              <div className="absolute inset-5 rounded-full bg-[radial-gradient(circle,rgba(255,250,240,0.96)_0%,rgba(255,245,231,0.92)_34%,rgba(240,231,214,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" />
              <div
                className="absolute inset-7 rounded-full p-[8px] shadow-[0_18px_44px_rgba(99,71,41,0.12)]"
                style={{ background: `conic-gradient(${ringGradient})` }}
              >
                <div className="size-full rounded-full border border-white/75 bg-[radial-gradient(circle,#fffdf8_0%,#f9f2e6_72%,#efe3cf_100%)]" />
              </div>

              <div className="absolute inset-[28%] rounded-full border border-white/70 bg-[radial-gradient(circle,rgba(255,250,244,0.96),rgba(246,236,221,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_14px_32px_rgba(124,95,62,0.12)]" />

              <div className="absolute inset-[34%] flex items-center justify-center">
                <div className="rounded-[24px] border border-stone-200/90 bg-white/82 px-5 py-4 text-center shadow-[0_14px_36px_rgba(107,77,44,0.12)] backdrop-blur">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                    Mission Core
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-stone-800">
                    {detail.progress}%
                  </div>
                  <div className="mt-1 text-sm text-stone-600">
                    {detail.currentStageLabel || "Preparing"}
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-stone-500">
                    {detail.activeAgentCount} active robots
                  </div>
                </div>
              </div>

              {detail.stages.map(stage => (
                <div
                  key={stage.key}
                  className="absolute z-10"
                  style={orbitStyle(stage.midAngle, 118)}
                >
                  <div
                    className={cn(
                      "min-w-[82px] rounded-full px-2.5 py-1.5 text-center text-[10px] font-medium shadow-sm backdrop-blur",
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
                  style={orbitStyle(agent.angle, 150)}
                >
                  <div
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-[11px] font-semibold shadow-sm backdrop-blur",
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

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Focus
              </div>
              <div className="mt-1 text-sm font-medium text-stone-800">
                {detail.currentStageLabel || "No active stage"}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Waiting
              </div>
              <div className="mt-1 text-sm font-medium text-stone-800">
                {compactText(detail.waitingFor || "No blocking signal", 42)}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Signal
              </div>
              <div className="mt-1 text-sm font-medium text-stone-800">
                {compactText(detail.lastSignal || "No recent signal", 42)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="rounded-[24px] border border-stone-200/80 bg-white/75 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-stone-800">
                Orbit Stages
              </div>
              <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] text-stone-600">
                {detail.stages.length} nodes
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {detail.stages.map(stage => (
                <div
                  key={stage.key}
                  className="rounded-[16px] border border-stone-200/80 bg-stone-50/85 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-800">
                        {stage.label}
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] leading-5 text-stone-500">
                        {stage.detail || "No detail captured yet."}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
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

          <div className="rounded-[24px] border border-stone-200/80 bg-white/75 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-stone-800">
                Agent Crew
              </div>
              <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] text-stone-600">
                {detail.agents.length} members
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {detail.agents.map(agent => (
                <div
                  key={agent.id}
                  className="rounded-[16px] border border-stone-200/80 bg-stone-50/85 px-3 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold shadow-sm",
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
                            {roleLabel(agent.role)} / {agent.department}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-1 text-[10px] font-medium",
                            agentStatusTone(agent.status)
                          )}
                        >
                          {agentStatusLabel(agent.status)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-stone-200 bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          {compactText(agent.stageLabel, 16)}
                        </span>
                        {typeof agent.progress === "number" ? (
                          <span className="rounded-full border border-stone-200 bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
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
