import { type ChangeEvent, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Monitor,
  Paperclip,
  Send,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { MAX_WORKFLOW_ATTACHMENTS } from "@shared/workflow-input";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { prepareWorkflowAttachments } from "@/lib/workflow-attachments";
import { useAppStore } from "@/lib/store";
import { useWorkflowStore } from "@/lib/workflow-store";
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { cn } from "@/lib/utils";

import type { OfficeLaunchResolution } from "./office-task-cockpit-types";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

export function OfficeWorkflowLaunchPanel({
  pendingLaunch,
  onLaunchSubmitted,
  compact = false,
  embedded = false,
  className,
}: {
  pendingLaunch: OfficeLaunchResolution | null;
  onLaunchSubmitted: (resolution: OfficeLaunchResolution) => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const submitDirective = useWorkflowStore(state => state.submitDirective);
  const isSubmitting = useWorkflowStore(state => state.isSubmitting);
  const submitError = useWorkflowStore(state => state.submitError);
  const [directive, setDirective] = useState("");
  const [attachments, setAttachments] = useState<
    Awaited<ReturnType<typeof prepareWorkflowAttachments>>
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isFrontend = runtimeMode === "frontend";
  const canUpgrade = isFrontend && CAN_USE_ADVANCED_RUNTIME;
  const isCompact = compact;
  const isEmbedded = embedded;
  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return t(locale, "提交中...", "Submitting...");
    }
    if (canUpgrade) {
      return t(locale, "切换到 Advanced 后发起", "Switch to Advanced");
    }
    if (isFrontend) {
      return t(locale, "预览高级发起", "Preview advanced launch");
    }
    return t(locale, "发起团队流", "Launch workflow");
  }, [canUpgrade, isFrontend, isSubmitting, locale]);

  async function handleSubmit() {
    if (!directive.trim() || isSubmitting || isPreparingFiles) {
      return;
    }

    if (canUpgrade) {
      await setRuntimeMode("advanced");
      return;
    }

    const workflowId = await submitDirective({
      directive: directive.trim(),
      attachments,
    });

    if (!workflowId) {
      return;
    }

    onLaunchSubmitted({
      workflowId,
      directive: directive.trim(),
      attachmentCount: attachments.length,
      requestedAt: Date.now(),
    });
    setDirective("");
    setAttachments([]);
    setAttachmentError(null);
  }

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    setAttachmentError(null);
    setIsPreparingFiles(true);

    try {
      const prepared = await prepareWorkflowAttachments(files);
      let overflowed = false;

      setAttachments(current => {
        const seen = new Set(
          current.map(item => `${item.name}:${item.size}:${item.mimeType}`)
        );
        const next = [...current];

        for (const item of prepared) {
          const key = `${item.name}:${item.size}:${item.mimeType}`;
          if (seen.has(key)) {
            continue;
          }
          if (next.length >= MAX_WORKFLOW_ATTACHMENTS) {
            overflowed = true;
            break;
          }
          next.push(item);
          seen.add(key);
        }

        return next;
      });

      if (overflowed) {
        setAttachmentError(
          t(
            locale,
            `最多附加 ${MAX_WORKFLOW_ATTACHMENTS} 个文件，超出的文件已忽略。`,
            `You can attach up to ${MAX_WORKFLOW_ATTACHMENTS} files. Extra files were ignored.`
          )
        );
      }
    } catch (error) {
      console.error(
        "[OfficeWorkflowLaunchPanel] Failed to prepare attachments:",
        error
      );
      setAttachmentError(
        t(
          locale,
          "文件解析失败，请重试或改用更容易提取内容的格式。",
          "The selected files could not be parsed. Try again or use a text-friendly format."
        )
      );
    } finally {
      setIsPreparingFiles(false);
    }
  }

  return (
    <section
      className={cn(
        isEmbedded
          ? "rounded-[24px] border border-white/70 bg-white/78 px-4 py-4 shadow-[0_14px_36px_rgba(99,73,45,0.08)]"
          : "workspace-panel workspace-panel-strong rounded-[30px] border border-stone-200/80 px-4 py-4 shadow-[0_24px_70px_rgba(98,73,48,0.14)]",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="workspace-eyebrow">
            {isEmbedded
              ? t(locale, "高级发起", "Advanced launch")
              : t(locale, "统一发起 / 高级通道", "Unified launch / workflow lane")}
          </div>
          <h2
            className={cn(
              "mt-2 font-semibold tracking-tight text-[var(--workspace-text-strong)]",
              isEmbedded
                ? "text-[1.1rem]"
                : isCompact
                  ? "text-[1.2rem]"
                  : "text-xl"
            )}
          >
            {isEmbedded
              ? t(locale, "带上下文的团队发起", "Team launch with context")
              : t(locale, "带附件的高级发起", "Advanced launch with attachments")}
          </h2>
          <p
            className={cn(
              "mt-2 max-w-3xl text-[var(--workspace-text-muted)]",
              isEmbedded
                ? "text-[13px] leading-5"
                : isCompact
                  ? "text-[13px] leading-5"
                  : "text-sm leading-6"
            )}
          >
            {isEmbedded
              ? t(
                  locale,
                  "适合带附件、复杂约束或需要先组织团队的任务，完成后会自动回落到 mission。",
                  "Use this for attachment-heavy or team-shaped launches, then fall back into the mission automatically."
                )
              : isCompact
              ? t(
                  locale,
                  "适合带附件或复杂上下文的任务，先走 workflow，再自动回落到 mission。",
                  "Use this for attachment-heavy or context-rich work. It launches through workflow first, then falls back into the mission."
                )
              : t(
                  locale,
                  "这里继续走现有 workflow directive 链路，适合带附件、带上下文、需要先组织团队再落到 mission 的任务。",
                  "This keeps the existing workflow directive path for launches that need attachments, extra context, or a team setup before the mission lands."
                )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="workspace-status px-2.5 py-1 text-[10px] font-semibold">
            {attachments.length} / {MAX_WORKFLOW_ATTACHMENTS}{" "}
            {t(locale, "附件", "attachments")}
          </span>
          {pendingLaunch ? (
            <span className="workspace-status workspace-tone-warning px-2.5 py-1 text-[10px] font-semibold">
              {t(locale, "团队准备中", "Team preparing")}
            </span>
          ) : null}
        </div>
      </div>

      {pendingLaunch ? (
        <div className="mt-4 rounded-[22px] border border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,249,235,0.96),rgba(255,242,214,0.9))] px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-amber-600" />
            {t(
              locale,
              "团队已经开始准备，等待 mission 关联完成",
              "The team is preparing and waiting for the mission link"
            )}
          </div>
          <div className="mt-2 text-xs leading-6 text-amber-800/80">
            {pendingLaunch.directive}
          </div>
        </div>
      ) : null}

      {submitError ? (
        <div className="mt-4 rounded-[22px] border border-rose-200/80 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
          {submitError.detail || submitError.message}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={event => {
          void handleFilesSelected(event);
        }}
      />

      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 rounded-[24px] border border-stone-200/80 bg-white/78 px-4 py-3",
          isCompact ? "mt-3" : "mt-4"
        )}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {t(locale, "上下文附件", "Context attachments")}
          </div>
          <div className="mt-1 text-sm leading-6 text-stone-600">
            {t(
              locale,
              "支持 txt / md / json / PDF / Word / Excel / 图片，尽量自动提取摘要与 OCR。",
              "Supports txt / md / json / PDF / Word / Excel / images, with automatic excerpting and OCR when possible."
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="workspace-control rounded-full"
          disabled={
            isPreparingFiles || attachments.length >= MAX_WORKFLOW_ATTACHMENTS
          }
          onClick={() => fileInputRef.current?.click()}
        >
          {isPreparingFiles ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
          {t(locale, "添加文件", "Add files")}
        </Button>
      </div>

      {attachments.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {attachments.map(attachment => (
            <div
              key={attachment.id}
              className="rounded-[22px] border border-stone-200/80 bg-white/76 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-stone-900">
                    {attachment.name}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-stone-500">
                    <span>{formatAttachmentSize(attachment.size)}</span>
                    <span>
                      {attachment.mimeType || "application/octet-stream"}
                    </span>
                    <span>{attachment.excerptStatus}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setAttachments(current =>
                      current.filter(item => item.id !== attachment.id)
                    )
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200/80 bg-white text-stone-500 transition-colors hover:text-stone-900"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-6 text-stone-600">
                {attachment.excerpt}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {attachmentError ? (
        <div className="mt-3 rounded-[22px] border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
          {attachmentError}
        </div>
      ) : null}

      <div className="mt-3 rounded-[26px] border border-stone-200/80 bg-white/82 px-4 py-4">
        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
          {t(locale, "Directive", "Directive")}
        </label>
        <textarea
          value={directive}
          onChange={event => setDirective(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={t(
            locale,
            "描述目标、约束、交付物和关键附件上下文...",
            "Describe the goal, constraints, deliverable, and key attachment context..."
          )}
          rows={isCompact ? 3 : 4}
          className="mt-3 w-full resize-none rounded-[22px] border border-stone-200/80 bg-stone-50/80 px-4 py-3 text-sm leading-6 text-stone-700 outline-none transition-colors focus:border-stone-300"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs leading-6 text-stone-500">
            {isCompact
              ? t(
                  locale,
                  "成功后会先进入“团队准备中”，完成关联后自动聚焦到任务。",
                  "After launch the team enters a preparing state, then automatically focuses the mission once linked."
                )
              : t(
                  locale,
                  "高级发起成功后会先显示“团队准备中”，待 workflow 关联到 mission 后自动聚焦回任务队列。",
                  "After a successful advanced launch, the dock shows a team-preparing state and automatically focuses the task once the workflow links to a mission."
                )}
          </div>

          <Button
            type="button"
            className="rounded-full bg-[#d07a4f] text-white hover:bg-[#bf6c43]"
            disabled={!directive.trim() || isSubmitting || isPreparingFiles}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : canUpgrade ? (
              <Server className="size-4" />
            ) : isFrontend ? (
              <Monitor className="size-4" />
            ) : (
              <Send className="size-4" />
            )}
            {submitLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
