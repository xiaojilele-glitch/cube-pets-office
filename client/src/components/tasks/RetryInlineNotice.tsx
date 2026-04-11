import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { workspaceCalloutClass } from "@/components/workspace/workspace-tone";
import { cn } from "@/lib/utils";

export function RetryInlineNotice({
  title,
  description,
  actionLabel,
  onRetry,
  className,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        workspaceCalloutClass("warning"),
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold text-[var(--workspace-text-strong)]">
          <TriangleAlert className="size-4 text-[var(--workspace-warning)]" />
          {title}
        </div>
        <div className="mt-1 text-sm leading-6 text-[var(--workspace-text)]">
          {description}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="workspace-control rounded-full"
        onClick={onRetry}
      >
        <RotateCcw className="size-4" />
        {actionLabel}
      </Button>
    </div>
  );
}
