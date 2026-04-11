import { CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
  type WorkspaceTone,
} from "@/components/workspace/workspace-tone";
import { cn } from "@/lib/utils";

type ActionFeedbackTone = "success" | "error" | "info";

function toWorkspaceTone(tone: ActionFeedbackTone): WorkspaceTone {
  if (tone === "success") return "success";
  if (tone === "error") return "danger";
  return "info";
}

function FeedbackIcon({ tone }: { tone: ActionFeedbackTone }) {
  if (tone === "success") {
    return <CheckCircle2 className="size-4" />;
  }
  if (tone === "error") {
    return <TriangleAlert className="size-4" />;
  }
  return <Info className="size-4" />;
}

export function ActionFeedbackInline({
  tone,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  tone: ActionFeedbackTone;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  const workspaceTone = toWorkspaceTone(tone);

  return (
    <div
      className={cn(
        workspaceCalloutClass(workspaceTone),
        "px-4 py-3 text-sm",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-2 font-semibold text-[var(--workspace-text-strong)]"
            )}
          >
            <span className={workspaceStatusClass(workspaceTone, "p-0")}>
              <FeedbackIcon tone={tone} />
            </span>
            {title}
          </div>
          {description ? (
            <div className="mt-1 text-sm leading-6 text-[var(--workspace-text)]">
              {description}
            </div>
          ) : null}
        </div>
        {actionLabel && onAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="workspace-control rounded-full"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
