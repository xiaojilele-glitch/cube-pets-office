import type { MissionTaskDetail } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  pending: "rgba(214, 211, 209, 0.9)",
  running: "rgba(245, 158, 11, 0.95)",
  done: "rgba(16, 185, 129, 0.95)",
  failed: "rgba(244, 63, 94, 0.95)",
};

export function CompactPlanetInterior({
  detail,
  className,
}: {
  detail: MissionTaskDetail;
  className?: string;
}) {
  const ringGradient = detail.stages
    .map(
      (stage) =>
        `${STAGE_COLORS[stage.status]} ${stage.arcStart}deg ${stage.arcEnd}deg`
    )
    .join(", ");

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[240px] rounded-[20px] border border-stone-200/80 bg-white/70 p-3 shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-center">
        <div className="relative aspect-square w-full max-w-[200px]">
          {/* Outer glow background */}
          <div className="absolute inset-3 rounded-full bg-[radial-gradient(circle,rgba(255,250,240,0.96)_0%,rgba(255,245,231,0.92)_34%,rgba(240,231,214,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" />

          {/* Conic-gradient ring */}
          <div
            className="absolute inset-4 rounded-full p-[6px] shadow-[0_12px_30px_rgba(99,71,41,0.10)]"
            style={{ background: `conic-gradient(${ringGradient})` }}
          >
            <div className="size-full rounded-full border border-white/75 bg-[radial-gradient(circle,#fffdf8_0%,#f9f2e6_72%,#efe3cf_100%)]" />
          </div>

          {/* Inner circle */}
          <div className="absolute inset-[28%] rounded-full border border-white/70 bg-[radial-gradient(circle,rgba(255,250,244,0.96),rgba(246,236,221,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_rgba(124,95,62,0.10)]" />

          {/* Center progress + phase label */}
          <div className="absolute inset-[32%] flex items-center justify-center">
            <div className="text-center">
              <div className="text-xl font-semibold leading-tight text-stone-800">
                {detail.progress}%
              </div>
              <div className="mt-0.5 text-[10px] leading-tight text-stone-500">
                {detail.currentStageLabel || "Preparing"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stage legend */}
      <div className="mt-1 flex flex-wrap justify-center gap-1.5">
        {detail.stages.map((stage) => (
          <span
            key={stage.key}
            className="inline-flex items-center gap-1 rounded-full bg-stone-50/80 px-1.5 py-0.5 text-[9px] font-medium text-stone-600"
          >
            <span
              className="inline-block size-1.5 rounded-full"
              style={{
                backgroundColor: STAGE_COLORS[stage.status] ?? "#d6d3d1",
              }}
            />
            {stage.label}
          </span>
        ))}
      </div>
    </div>
  );
}
