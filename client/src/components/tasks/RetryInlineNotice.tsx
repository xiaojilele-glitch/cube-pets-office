import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
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
        "flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-amber-200 bg-amber-50/85 px-4 py-3 text-sm text-amber-900",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold">
          <TriangleAlert className="size-4 text-amber-700" />
          {title}
        </div>
        <div className="mt-1 text-sm leading-6 text-amber-800">
          {description}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-full border-amber-200 bg-white text-amber-900 hover:bg-amber-100"
        onClick={onRetry}
      >
        <RotateCcw className="size-4" />
        {actionLabel}
      </Button>
    </div>
  );
}
