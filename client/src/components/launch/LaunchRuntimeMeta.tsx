import type { ReactNode } from "react";
import { Loader2, Monitor, Paperclip, Send, Server } from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { Button } from "@/components/ui/button";
import type { RuntimeMode } from "@/lib/store";
import { cn } from "@/lib/utils";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function getLaunchRuntimeLabel(
  locale: string,
  runtimeMode: RuntimeMode
) {
  return runtimeMode === "advanced"
    ? t(locale, "当前：高级执行", "Current: advanced runtime")
    : t(locale, "当前：前端预览", "Current: frontend preview");
}

export function getLaunchAttachmentCountLabel(
  locale: string,
  attachmentCount: number
) {
  return t(
    locale,
    `已附 ${attachmentCount} 个文件`,
    `${attachmentCount} attachment(s) added`
  );
}

export function LaunchRuntimeMeta({
  locale,
  runtimeMode,
  attachmentCount,
  isPreparingFiles = false,
  maxAttachments,
  onPickFiles,
  operatorActionRail,
  onSubmit,
  submitLabel,
  submitDisabled = false,
}: {
  locale: string;
  runtimeMode: RuntimeMode;
  attachmentCount: number;
  isPreparingFiles?: boolean;
  maxAttachments?: number;
  onPickFiles?: () => void;
  operatorActionRail?: ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
}) {
  const hasSharedActionRail = Boolean(operatorActionRail);

  return (
    <div
      className={cn(
        "mt-2 flex gap-2 text-xs text-stone-500",
        hasSharedActionRail
          ? "flex-wrap items-end"
          : "overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2",
          hasSharedActionRail ? "flex-wrap" : "whitespace-nowrap"
        )}
      >
        {onPickFiles ? (
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-full px-3 text-xs whitespace-nowrap"
            disabled={
              isPreparingFiles ||
              (typeof maxAttachments === "number" &&
                attachmentCount >= maxAttachments)
            }
            onClick={onPickFiles}
          >
            {isPreparingFiles ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Paperclip className="size-3.5" />
            )}
            {t(locale, "添加文件", "Add files")}
          </Button>
        ) : null}

        <span className="inline-flex items-center gap-1 rounded-full border border-stone-200/80 bg-stone-50 px-2 py-1 whitespace-nowrap">
          {runtimeMode === "advanced" ? (
            <Server className="size-3.5" />
          ) : (
            <Monitor className="size-3.5" />
          )}
          {getLaunchRuntimeLabel(locale, runtimeMode)}
        </span>

        {attachmentCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-stone-200/80 bg-stone-50 px-2 py-1 whitespace-nowrap">
            {getLaunchAttachmentCountLabel(locale, attachmentCount)}
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "flex min-w-0 gap-2",
          hasSharedActionRail
            ? "ml-auto flex-1 flex-wrap items-end justify-end"
            : "ml-auto items-center"
        )}
      >
        {operatorActionRail}

        {!hasSharedActionRail && onSubmit && submitLabel ? (
          <GlowButton
            type="button"
            disabled={submitDisabled}
            className="h-8 shrink-0 rounded-full px-3 text-xs font-semibold shadow-[0_10px_24px_rgba(94,139,114,0.18)]"
            onClick={onSubmit}
          >
            <Send className="size-3.5" />
            {submitLabel}
          </GlowButton>
        ) : null}
      </div>
    </div>
  );
}
