import { Send, Server, Sparkles, WandSparkles } from "lucide-react";

import type { LaunchRouteDecision } from "@/lib/launch-router";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function getLaunchRouteBannerTitle(
  locale: string,
  kind: LaunchRouteDecision["kind"]
) {
  return kind === "workflow"
    ? t(locale, "系统判断：高级编排", "System decision: workflow")
    : kind === "upgrade-required"
      ? t(locale, "系统判断：需要高级执行", "System decision: advanced runtime")
      : kind === "clarify"
        ? t(locale, "系统判断：先补问", "System decision: clarify first")
        : t(locale, "系统判断：快速任务", "System decision: mission");
}

export function LaunchRouteBanner({
  locale,
  decision,
  hint,
}: {
  locale: string;
  decision: LaunchRouteDecision;
  hint: string;
}) {
  return (
    <div className="rounded-[18px] border border-stone-200/80 bg-white/80 px-3 py-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          {decision.kind === "workflow" ? (
            <WandSparkles className="size-4 shrink-0 text-[#5E8B72]" />
          ) : decision.kind === "upgrade-required" ? (
            <Server className="size-4 shrink-0 text-[#d07a4f]" />
          ) : decision.kind === "clarify" ? (
            <Sparkles className="size-4 shrink-0 text-amber-600" />
          ) : (
            <Send className="size-4 shrink-0 text-[#d07a4f]" />
          )}
          <span className="truncate">
            {getLaunchRouteBannerTitle(locale, decision.kind)}
          </span>
        </div>
        <div className="text-xs leading-5 text-stone-700 md:max-w-[420px] md:text-right">
          {hint}
        </div>
      </div>
    </div>
  );
}
