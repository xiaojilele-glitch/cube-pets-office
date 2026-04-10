import { CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActionFeedbackTone = "success" | "error" | "info";

const FEEDBACK_STYLES: Record<
  ActionFeedbackTone,
  {
    container: string;
    icon: string;
    title: string;
    description: string;
    button: string;
  }
> = {
  success: {
    container: "border-emerald-200 bg-emerald-50/85 text-emerald-900",
    icon: "text-emerald-700",
    title: "text-emerald-950",
    description: "text-emerald-800",
    button: "border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-100",
  },
  error: {
    container: "border-rose-200 bg-rose-50/90 text-rose-900",
    icon: "text-rose-700",
    title: "text-rose-950",
    description: "text-rose-800",
    button: "border-rose-200 bg-white text-rose-900 hover:bg-rose-100",
  },
  info: {
    container: "border-sky-200 bg-sky-50/90 text-sky-900",
    icon: "text-sky-700",
    title: "text-sky-950",
    description: "text-sky-800",
    button: "border-sky-200 bg-white text-sky-900 hover:bg-sky-100",
  },
};

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
  const styles = FEEDBACK_STYLES[tone];

  return (
    <div
      className={cn(
        "rounded-[20px] border px-4 py-3 text-sm",
        styles.container,
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-2 font-semibold",
              styles.title
            )}
          >
            <span className={styles.icon}>
              <FeedbackIcon tone={tone} />
            </span>
            {title}
          </div>
          {description ? (
            <div className={cn("mt-1 text-sm leading-6", styles.description)}>
              {description}
            </div>
          ) : null}
        </div>
        {actionLabel && onAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("rounded-full", styles.button)}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
