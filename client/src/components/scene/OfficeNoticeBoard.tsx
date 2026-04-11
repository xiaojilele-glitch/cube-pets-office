import { Activity, ArrowRight, Coins, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OfficeNoticeBoardSnapshot } from "@/lib/scene-agent-detail";

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "warm" | "danger" | "cool";
}) {
  const tones = {
    warm: "border-[#E9D6C2] bg-[#FFF8F0] text-[#8B6C53]",
    danger: "border-[#F0D3CB] bg-[#FFF3F0] text-[#A0574A]",
    cool: "border-[#D7E4EF] bg-[#F4F8FB] text-[#4D6C85]",
  } as const;

  return (
    <div className={`rounded-[22px] border px-4 py-3 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-[#3F2F22]">{value}</p>
    </div>
  );
}

export function OfficeNoticeBoard({
  locale,
  snapshot,
  onOpenTasks,
  onOpenWorkflow,
  onOpenCurrentTask,
}: {
  locale: string;
  snapshot: OfficeNoticeBoardSnapshot;
  onOpenTasks: () => void;
  onOpenWorkflow: () => void;
  onOpenCurrentTask?: () => void;
}) {
  const tokenLabel =
    snapshot.totalTokens > 0
      ? `${snapshot.totalTokens.toLocaleString()} tokens`
      : locale === "zh-CN"
        ? "尚无 token 记录"
        : "No token usage yet";

  return (
    <div className="rounded-[30px] border border-[#E4D4C2] bg-[linear-gradient(180deg,rgba(255,250,244,0.96),rgba(246,237,227,0.92))] p-4 shadow-[0_20px_45px_rgba(78,58,38,0.12)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#A08972]">
            {locale === "zh-CN" ? "办公室公告板" : "Office notice board"}
          </p>
          <h2
            className="mt-2 text-[1.05rem] font-semibold text-[#3A2A1A]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {locale === "zh-CN" ? "先看现在最重要的事" : "What matters right now"}
          </h2>
        </div>
        <span className="flex size-10 items-center justify-center rounded-[20px] bg-[#F4E6D8] text-[#C17A4E]">
          <Activity className="size-5" />
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <MetricCard
          label={locale === "zh-CN" ? "执行中任务" : "Active missions"}
          value={String(snapshot.activeMissionCount)}
          tone="warm"
        />
        <MetricCard
          label={locale === "zh-CN" ? "阻塞 Agent" : "Blocked agents"}
          value={String(snapshot.blockedAgentCount)}
          tone={snapshot.blockedAgentCount > 0 ? "danger" : "cool"}
        />
        <MetricCard
          label={locale === "zh-CN" ? "成本 / Token" : "Cost / Token"}
          value={`$${snapshot.totalCost.toFixed(4)}`}
          tone="cool"
        />
      </div>

      <div className="mt-4 rounded-[22px] border border-[#EADFD1] bg-white/85 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-2xl bg-[#F8EFE5] text-[#A17248]">
            {snapshot.blockedAgentCount > 0 ? (
              <TriangleAlert className="size-4" />
            ) : (
              <Coins className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-6 text-[#453427]">
              {snapshot.focusLine}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#8B735C]">
              {tokenLabel}
            </p>
            {snapshot.modeHint ? (
              <p className="mt-2 text-xs leading-5 text-[#6A7F92]">
                {snapshot.modeHint}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          className="rounded-full bg-[#C98257] text-white hover:bg-[#B86F45]"
          onClick={onOpenTasks}
        >
          {locale === "zh-CN" ? "进入任务台" : "Open tasks"}
          <ArrowRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full border-[#DCC9B6] bg-white/90 text-[#5C493A] hover:bg-[#FFF8F0]"
          onClick={onOpenWorkflow}
        >
          {locale === "zh-CN" ? "工作流面板" : "Workflow panel"}
        </Button>
        {onOpenCurrentTask ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-[#DCC9B6] bg-white/90 text-[#5C493A] hover:bg-[#FFF8F0]"
            onClick={onOpenCurrentTask}
          >
            {locale === "zh-CN" ? "当前 Mission" : "Current mission"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
