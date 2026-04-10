import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyHintTone = "neutral" | "info" | "warning" | "danger";

const TONE_STYLES: Record<
  EmptyHintTone,
  {
    container: string;
    iconWrap: string;
    title: string;
    description: string;
    hint: string;
    button: string;
  }
> = {
  neutral: {
    container: "border-stone-300 bg-stone-50/70 text-stone-700",
    iconWrap: "border-stone-200 bg-white/80 text-stone-500",
    title: "text-stone-900",
    description: "text-stone-600",
    hint: "text-stone-500",
    button: "border-stone-200 bg-white text-stone-700 hover:bg-stone-100",
  },
  info: {
    container: "border-sky-200 bg-sky-50/75 text-sky-800",
    iconWrap: "border-sky-200 bg-white/80 text-sky-600",
    title: "text-sky-950",
    description: "text-sky-800",
    hint: "text-sky-700",
    button: "border-sky-200 bg-white text-sky-800 hover:bg-sky-100",
  },
  warning: {
    container: "border-amber-200 bg-amber-50/80 text-amber-900",
    iconWrap: "border-amber-200 bg-white/80 text-amber-700",
    title: "text-amber-950",
    description: "text-amber-900",
    hint: "text-amber-800",
    button: "border-amber-200 bg-white text-amber-900 hover:bg-amber-100",
  },
  danger: {
    container: "border-rose-200 bg-rose-50/80 text-rose-900",
    iconWrap: "border-rose-200 bg-white/80 text-rose-700",
    title: "text-rose-950",
    description: "text-rose-900",
    hint: "text-rose-800",
    button: "border-rose-200 bg-white text-rose-900 hover:bg-rose-100",
  },
};

export function EmptyHintBlock({
  icon,
  title,
  description,
  hint,
  actionLabel,
  onAction,
  tone = "neutral",
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: EmptyHintTone;
  className?: string;
}) {
  const toneStyle = TONE_STYLES[tone];

  return (
    <div
      className={cn(
        "rounded-[24px] border border-dashed px-4 py-5",
        toneStyle.container,
        className
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-2xl border",
              toneStyle.iconWrap
            )}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className={cn("text-sm font-semibold", toneStyle.title)}>
            {title}
          </div>
          <div className={cn("mt-1 text-sm leading-6", toneStyle.description)}>
            {description}
          </div>
          {hint ? (
            <div className={cn("mt-2 text-xs leading-5", toneStyle.hint)}>
              {hint}
            </div>
          ) : null}
          {actionLabel && onAction ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("mt-3 rounded-full", toneStyle.button)}
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
