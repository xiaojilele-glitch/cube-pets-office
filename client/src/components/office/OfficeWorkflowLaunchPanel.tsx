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
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { prepareWorkflowAttachments } from "@/lib/workflow-attachments";
import { useWorkflowStore } from "@/lib/workflow-store";

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
  bare = false,
  dense = false,
  hideHeader = false,
  hideDirectiveLabel = false,
  className,
}: {
  pendingLaunch: OfficeLaunchResolution | null;
  onLaunchSubmitted: (resolution: OfficeLaunchResolution) => void;
  compact?: boolean;
  embedded?: boolean;
  bare?: boolean;
  dense?: boolean;
  hideHeader?: boolean;
  hideDirectiveLabel?: boolean;
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
  const isBare = bare;
  const isDense = dense;
  const showHeaderCopy = !hideHeader;
  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return t(locale, "提交中...", "Submitting...");
    }
    if (canUpgrade) {
      return t(locale, "切换到高级执行", "Switch to Advanced");
    }
    if (isFrontend) {
      return t(locale, "预览高级发起", "Preview advanced launch");
    }
    return t(locale, "发起团队流", "Launch workflow");
  }, [canUpgrade, isFrontend, isSubmitting, locale]);
  const runtimeSummary = useMemo(
    () =>
      isFrontend
        ? t(locale, "前端预览", "Frontend preview")
        : t(locale, "高级执行", "Advanced runtime"),
    [isFrontend, locale]
  );
  const quickSuggestions = useMemo(
    () => [
      t(
        locale,
        "为当前任务组一个执行小队，附带约束和交付物上下文。",
        "Spin up a delivery squad for the current task with constraints and deliverable context."
      ),
      t(
        locale,
        "基于附件内容先整理 brief，再拆出工作包和角色分工。",
        "Turn the attachment context into a brief, then split it into work packages and roles."
      ),
      t(
        locale,
        "先做方案评审和风险排查，再决定是否正式发起执行。",
        "Run a solution review and risk sweep before the full workflow launch."
      ),
    ],
    [locale]
  );

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
            `最多附件 ${MAX_WORKFLOW_ATTACHMENTS} 个，超出的文件已忽略。`,
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

  if (isBare && isDense) {
    return (
      <section className={cn("grid h-full min-h-0 gap-3", className)}>
        {pendingLaunch ? (
          <div className="rounded-[22px] border border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,249,235,0.96),rgba(255,242,214,0.9))] px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-amber-600" />
              {t(
                locale,
                "团队已经开始准备，等待 mission 关联完成。",
                "The team is preparing and waiting for the mission link."
              )}
            </div>
            <div className="mt-2 text-xs leading-6 text-amber-800/80">
              {pendingLaunch.directive}
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div className="rounded-[22px] border border-rose-200/80 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
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

        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_252px]">
          <div className="min-h-0 rounded-[26px] border border-stone-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,244,237,0.92))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]">
            <div className="flex flex-wrap gap-2">
              <span className="workspace-status workspace-tone-neutral px-2.5 py-1 text-[10px] font-semibold">
                {runtimeSummary}
              </span>
              <span className="workspace-status workspace-tone-info px-2.5 py-1 text-[10px] font-semibold">
                {attachments.length} / {MAX_WORKFLOW_ATTACHMENTS}{" "}
                {t(locale, "附件", "attachments")}
              </span>
              {canUpgrade ? (
                <span className="workspace-status workspace-tone-warning px-2.5 py-1 text-[10px] font-semibold">
                  {t(
                    locale,
                    "切换到高级执行后才会正式发起。",
                    "Switch to Advanced for a real workflow launch."
                  )}
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-[22px] border border-stone-200/80 bg-white/78 px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {t(locale, "上下文附件", "Context attachments")}
                </div>
                <div className="mt-1 text-[13px] leading-5 text-stone-600">
                  {t(
                    locale,
                    "支持 txt / md / json / PDF / Word / Excel / 图片，尽量自动提取摘要与 OCR。",
                    "Supports txt / md / json / PDF / Word / Excel / images with automatic excerpting when possible."
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="workspace-control rounded-full"
                disabled={
                  isPreparingFiles ||
                  attachments.length >= MAX_WORKFLOW_ATTACHMENTS
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

            <div className="mt-3 rounded-[24px] border border-stone-200/80 bg-white/84 px-3.5 py-3">
              {!hideDirectiveLabel ? (
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {t(locale, "Directive", "Directive")}
                </label>
              ) : null}
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
                  "描述目标、约束、附件上下文，以及希望系统先组织出的团队形态...",
                  "Describe the goal, constraints, attachment context, and the team shape you want the system to organize first..."
                )}
                rows={6}
                className={cn(
                  "w-full resize-none rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-[13px] leading-5 text-stone-700 outline-none transition-colors focus:border-stone-300",
                  hideDirectiveLabel ? "mt-0" : "mt-3"
                )}
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] leading-5 text-stone-500">
                  {t(
                    locale,
                    "发起后会先进入“团队准备中”，完成 workflow 关联后自动回落到任务。",
                    "After launch, the team enters a preparing state and falls back into the task once the workflow is linked."
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

            <div className="mt-3 flex flex-wrap gap-2">
              {quickSuggestions.map(suggestion => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDirective(suggestion)}
                  className="rounded-full border border-stone-200/80 bg-white/78 px-3 py-1.5 text-[11px] font-medium text-stone-600 transition-colors hover:bg-white hover:text-stone-900"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {attachmentError ? (
              <div className="mt-3 rounded-[18px] border border-amber-200/80 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-5 text-amber-700">
                {attachmentError}
              </div>
            ) : null}
          </div>

          <aside className="grid auto-rows-min gap-2.5">
            <div className="rounded-[20px] border border-stone-200/80 bg-white/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                {t(locale, "发起模式", "Launch mode")}
              </div>
              <div className="mt-1.5 text-sm font-semibold text-stone-900">
                {runtimeSummary}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-stone-500">
                {canUpgrade
                  ? t(
                      locale,
                      "当前还是预览模式，切到高级执行后才会真正发起。",
                      "You are in preview mode until Advanced is enabled."
                    )
                  : t(
                      locale,
                      "指令和附件会一起打包进 workflow 入口。",
                      "Directive and attachments stay bundled in the workflow entry."
                    )}
              </div>
            </div>

            <div className="rounded-[20px] border border-stone-200/80 bg-white/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                {t(locale, "附件上下文", "Attachment context")}
              </div>
              <div className="mt-1.5 text-sm font-semibold text-stone-900">
                {attachments.length > 0
                  ? t(
                      locale,
                      `${attachments.length} 个附件已装载`,
                      `${attachments.length} attachments loaded`
                    )
                  : t(locale, "暂未加入附件", "No attachments yet")}
              </div>
              <div className="mt-2 space-y-2">
                {attachments.length > 0 ? (
                  attachments.slice(0, 3).map(attachment => (
                    <div
                      key={attachment.id}
                      className="rounded-[16px] border border-stone-200/80 bg-stone-50/70 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-stone-900">
                            {attachment.name}
                          </div>
                          <div className="mt-1 text-[10px] text-stone-500">
                            {formatAttachmentSize(attachment.size)} ·{" "}
                            {attachment.excerptStatus}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments(current =>
                              current.filter(item => item.id !== attachment.id)
                            )
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-200/80 bg-white text-stone-500 transition-colors hover:text-stone-900"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[16px] border border-dashed border-stone-300/80 bg-stone-50/60 px-3 py-3 text-[11px] leading-5 text-stone-500">
                    {t(
                      locale,
                      "可添加文档、表格、图片或 brief，作为团队发起时的上下文包。",
                      "Add docs, spreadsheets, images, or briefs as the context bundle for launch."
                    )}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        !isBare &&
          (isEmbedded
            ? "rounded-[24px] border border-white/70 bg-white/78 px-4 py-4 shadow-[0_14px_36px_rgba(99,73,45,0.08)]"
            : "workspace-panel workspace-panel-strong rounded-[30px] border border-stone-200/80 px-4 py-4 shadow-[0_24px_70px_rgba(98,73,48,0.14)]"),
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        {showHeaderCopy ? (
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
                      "这里继续走现有 workflow directive 链路，适合需要附件、补充上下文，或先组织团队再落到 mission 的任务。",
                      "This keeps the existing workflow directive path for launches that need attachments, extra context, or a team setup before the mission lands."
                    )}
            </p>
          </div>
        ) : null}

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
          isCompact ? (isDense ? "mt-2.5" : "mt-3") : "mt-4",
          isDense && "px-3.5 py-2.5"
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
        <div className={cn(isDense ? "mt-2.5" : "mt-3", "grid gap-2")}>
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
        <div
          className={cn(
            isDense
              ? "mt-2.5 px-3.5 py-2.5 text-[13px] leading-5"
              : "mt-3 px-4 py-3 text-sm leading-6",
            "rounded-[22px] border border-amber-200/80 bg-amber-50 text-amber-700"
          )}
        >
          {attachmentError}
        </div>
      ) : null}

      <div
        className={cn(
          isDense ? "mt-2.5 px-3.5 py-3" : "mt-3 px-4 py-4",
          "rounded-[26px] border border-stone-200/80 bg-white/82"
        )}
      >
        {!hideDirectiveLabel ? (
          <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {t(locale, "Directive", "Directive")}
          </label>
        ) : null}
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
          rows={isDense ? 2 : isCompact ? 3 : 4}
          className={cn(
            "w-full resize-none rounded-[22px] border border-stone-200/80 bg-stone-50/80 px-4 py-3 text-sm leading-6 text-stone-700 outline-none transition-colors focus:border-stone-300",
            hideDirectiveLabel ? "mt-0" : "mt-3",
            isDense && "px-3 py-2 text-[13px] leading-5"
          )}
        />

        <div
          className={cn(
            isDense ? "mt-2.5 gap-2.5" : "mt-3 gap-3",
            "flex flex-wrap items-center justify-between"
          )}
        >
          <div
            className={cn(
              isDense ? "text-[11px] leading-5" : "text-xs leading-6",
              "text-stone-500"
            )}
          >
            {isCompact
              ? t(
                  locale,
                  "成功后会先进入“团队准备中”，完成关联后自动聚焦到任务。",
                  "After launch the team enters a preparing state, then automatically focuses the mission once linked."
                )
              : t(
                  locale,
                  "高级发起成功后会先显示“团队准备中”，等 workflow 关联到 mission 后自动聚焦回任务队列。",
                  "After a successful advanced launch, the dock shows a team-preparing state and automatically focuses the task once the workflow links to a mission."
                )}
          </div>

          <Button
            type="button"
            className={cn(
              "rounded-full bg-[#d07a4f] text-white hover:bg-[#bf6c43]",
              isDense && "h-10 px-3.5"
            )}
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
