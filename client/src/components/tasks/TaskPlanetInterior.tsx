import type { CSSProperties } from "react";

import type { MissionTaskDetail } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

import {
  agentStatusLabel,
  agentStatusTone,
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
        "overflow-hidden rounded-[28px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(252,211,77,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.18),transparent_34%),linear-gradient(180deg,#fffdf7,#f6efe3)] p-5 shadow-[0_24px_70px_rgba(120,91,54,0.12)]",
        className
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,320px)]">
        <div className="flex min-w-0 items-center justify-center">
          <div className="relative aspect-square w-full max-w-[420px]">
            <div className="absolute inset-6 rounded-full bg-[radial-gradient(circle,rgba(255,250,240,0.96)_0%,rgba(255,245,231,0.92)_34%,rgba(240,231,214,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" />
            <div
              className="absolute inset-8 rounded-full p-[10px] shadow-[0_20px_60px_rgba(99,71,41,0.12)]"
              style={{ background: `conic-gradient(${ringGradient})` }}
            >
              <div className="size-full rounded-full border border-white/70 bg-[radial-gradient(circle,#fffdf8_0%,#f9f2e6_72%,#efe3cf_100%)]" />
            </div>

            <div className="absolute inset-[24%] rounded-full border border-white/70 bg-[radial-gradient(circle,rgba(255,250,244,0.96),rgba(246,236,221,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_16px_40px_rgba(124,95,62,0.12)]" />

            <div className="absolute inset-[31%] flex items-center justify-center">
              <div className="rounded-[26px] border border-stone-200/90 bg-white/80 px-6 py-5 text-center shadow-[0_18px_50px_rgba(107,77,44,0.12)] backdrop-blur">
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">
                  Planet Interior
                </div>
                <div className="mt-3 text-3xl font-semibold text-stone-800">
                  {detail.progress}%
                </div>
                <div className="mt-1 text-sm text-stone-600">
                  {detail.currentStageLabel || "Preparing"}
                </div>
                <div className="mt-3 text-xs leading-5 text-stone-500">
                  {detail.activeAgentCount} active robots • {detail.taskCount}{" "}
                  work packages
                </div>
              </div>
            </div>

            {detail.stages.map(stage => (
              <div
                key={stage.key}
                className="absolute z-10"
                style={orbitStyle(stage.midAngle, 132)}
              >
                <div
                  className={cn(
                    "min-w-[88px] rounded-full px-3 py-1.5 text-center text-[11px] font-medium shadow-sm",
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
                style={orbitStyle(agent.angle, 160)}
              >
                <div className="flex min-w-[96px] flex-col items-center gap-1 text-center">
                  <div
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm backdrop-blur",
                      agentStatusTone(agent.status)
                    )}
                  >
                    {agent.name}
                  </div>
                  <div className="max-w-[110px] text-[10px] leading-4 text-stone-600">
                    {agent.stageLabel}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-stone-200/80 bg-white/75 p-4 shadow-sm">
            <div className="text-sm font-semibold text-stone-800">
              Orbit Stages
            </div>
            <div className="mt-3 space-y-2">
              {detail.stages.map(stage => (
                <div
                  key={stage.key}
                  className="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-800">
                        {stage.label}
                      </div>
                      <div className="text-xs text-stone-500">
                        {stage.detail}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
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
            <div className="text-sm font-semibold text-stone-800">
              Agent Crew
            </div>
            <div className="mt-3 space-y-2.5">
              {detail.agents.map(agent => (
                <div
                  key={agent.id}
                  className="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-800">
                        {agent.name}
                      </div>
                      <div className="mt-0.5 text-xs text-stone-500">
                        {roleLabel(agent.role)} • {agent.department}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        agentStatusTone(agent.status)
                      )}
                    >
                      {agentStatusLabel(agent.status)}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-stone-600">
                    {agent.title} • {agent.stageLabel}
                    {typeof agent.progress === "number"
                      ? ` • ${agent.progress}%`
                      : ""}
                  </div>
                  {agent.currentAction ? (
                    <div className="mt-2 text-xs leading-5 text-stone-500">
                      {agent.currentAction}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
