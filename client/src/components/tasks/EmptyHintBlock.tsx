import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
} from "@/components/workspace/workspace-tone";
import { cn } from "@/lib/utils";

type EmptyHintTone = "neutral" | "info" | "warning" | "danger";

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
  return (
    <div
      className={cn(
        workspaceCalloutClass(tone),
        "border-dashed px-4 py-5",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={cn(
              workspaceStatusClass(tone),
              "flex size-10 shrink-0 items-center justify-center rounded-2xl p-0"
            )}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
            {title}
          </div>
          <div className="mt-1 text-sm leading-6 text-[var(--workspace-text)]">
            {description}
          </div>
          {hint ? (
            <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
              {hint}
            </div>
          ) : null}
          {actionLabel && onAction ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="workspace-control mt-3 rounded-full"
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
