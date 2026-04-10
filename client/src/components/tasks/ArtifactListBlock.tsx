import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  LoaderCircle,
  ScrollText,
} from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { useI18n } from "@/i18n";
import type { TaskArtifact } from "@/lib/tasks-store";

import { isArtifactPreviewable } from "./artifact-preview";
import { EmptyHintBlock } from "./EmptyHintBlock";

export interface ArtifactListBlockProps {
  missionId: string;
  artifacts: TaskArtifact[];
  missionStatus: string;
  variant: "compact" | "full";
  downloadingArtifactId?: string | null;
  onDownload?: (artifact: TaskArtifact, index: number) => void | Promise<void>;
  onPreview?: (artifact: TaskArtifact, index: number) => void;
  showEmptyState?: boolean;
}

const KIND_ICON: Record<string, typeof FileText> = {
  attachment: FileCode,
  department_report: FileText,
  file: FileCode,
  log: ScrollText,
  report: FileText,
  url: ExternalLink,
};

const KIND_COLORS: Record<string, string> = {
  attachment: "bg-stone-500/20 text-stone-200",
  department_report: "bg-emerald-500/20 text-emerald-300",
  file: "bg-cyan-500/20 text-cyan-300",
  log: "bg-white/10 text-white/60",
  report: "bg-amber-500/20 text-amber-300",
  url: "bg-indigo-500/20 text-indigo-300",
};

const itemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function kindLabel(kind: string, locale: string): string {
  return (
    {
      attachment: t(locale, "Attachment", "Attachment"),
      department_report: t(locale, "Dept Report", "Dept Report"),
      file: t(locale, "File", "File"),
      log: t(locale, "Log", "Log"),
      report: t(locale, "Report", "Report"),
      url: t(locale, "Link", "Link"),
    }[kind] ?? kind
  );
}

export function isArtifactListCompletedStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "completed_with_errors" ||
    status === "done"
  );
}

export function isArtifactListRunningStatus(status: string): boolean {
  return status === "pending" || status === "running";
}

export function shouldHighlightArtifact(
  artifact: Pick<TaskArtifact, "kind">,
  missionStatus: string
): boolean {
  return (
    artifact.kind === "report" && isArtifactListCompletedStatus(missionStatus)
  );
}

function openArtifactUrl(url?: string) {
  if (!url || typeof window === "undefined") {
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function ArtifactListBlock({
  missionId,
  artifacts,
  missionStatus,
  variant,
  downloadingArtifactId = null,
  onDownload,
  onPreview,
  showEmptyState = variant === "full",
}: ArtifactListBlockProps) {
  const { locale, copy } = useI18n();
  const isCompact = variant === "compact";
  const isRunning = isArtifactListRunningStatus(missionStatus);
  const isCompleted = isArtifactListCompletedStatus(missionStatus);

  const handleDownload = useCallback(
    (artifact: TaskArtifact, index: number) => {
      if (onDownload) {
        void onDownload(artifact, index);
        return;
      }

      openArtifactUrl(artifact.downloadUrl || artifact.href);
    },
    [onDownload]
  );

  const handlePreview = useCallback(
    (artifact: TaskArtifact, index: number) => {
      if (onPreview) {
        onPreview(artifact, index);
        return;
      }

      openArtifactUrl(artifact.previewUrl);
    },
    [onPreview]
  );

  if (artifacts.length === 0) {
    if (!showEmptyState) {
      return null;
    }

    return (
      <EmptyHintBlock
        icon={<FileText className="size-4" />}
        title={
          isRunning
            ? copy.tasks.artifacts.emptyRunningTitle
            : copy.tasks.artifacts.emptyTerminalTitle
        }
        description={
          isRunning
            ? copy.tasks.artifacts.emptyRunningDescription
            : copy.tasks.artifacts.emptyTerminalDescription
        }
        tone={isRunning ? "info" : isCompleted ? "neutral" : "warning"}
      />
    );
  }

  return (
    <div
      className="rounded-2xl glass-panel p-3"
      data-mission-id={missionId}
      data-variant={variant}
    >
      <div className="mb-2 flex items-center gap-2">
        <FileText className="h-4 w-4 text-white/40" />
        <span className="text-[11px] font-semibold text-white/50">
          {t(locale, "Artifacts", "Artifacts")} · {artifacts.length}
        </span>
        {isRunning ? (
          <span className="relative ml-auto flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
          </span>
        ) : null}
      </div>

      {isRunning ? (
        <p className="mb-2 text-[10px] text-white/30">
          {copy.tasks.artifacts.runningHint}
        </p>
      ) : null}

      <div
        className={`space-y-2 ${isCompact ? "max-h-48 overflow-y-auto" : ""}`}
      >
        <AnimatePresence initial={false}>
          {artifacts.map((artifact, index) => {
            const Icon = KIND_ICON[artifact.kind] ?? FileText;
            const colorCls = KIND_COLORS[artifact.kind] ?? KIND_COLORS.file;
            const isUrl = artifact.kind === "url";
            const isDownloadable =
              artifact.kind === "attachment" ||
              artifact.kind === "department_report" ||
              artifact.kind === "file" ||
              artifact.kind === "log" ||
              artifact.kind === "report";
            const highlight = shouldHighlightArtifact(artifact, missionStatus);
            const previewEnabled =
              isArtifactPreviewable(artifact) &&
              (!isCompact || (artifact.kind === "report" && isCompleted));
            const downloadDisabled =
              downloadingArtifactId === artifact.id ||
              (!isUrl && !(artifact.downloadUrl || artifact.href));

            return (
              <motion.div
                key={artifact.id}
                layout
                variants={itemVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`flex items-start gap-3 rounded-xl p-2 ${
                  highlight
                    ? "glass-panel border-amber-400/20 bg-amber-500/10"
                    : "bg-white/5"
                }`}
              >
                <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                  <Icon className="h-4 w-4 text-white/50" />
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${colorCls}`}
                  >
                    {kindLabel(artifact.kind, locale)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-white">
                    {artifact.title}
                  </p>
                  {artifact.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/40">
                      {artifact.description}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {previewEnabled ? (
                    <GlowButton
                      type="button"
                      variant="ghost"
                      className="!px-2 !py-1 !text-[10px]"
                      onClick={() => handlePreview(artifact, index)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      {!isCompact ? t(locale, "Preview", "Preview") : null}
                    </GlowButton>
                  ) : null}

                  {isDownloadable ? (
                    <GlowButton
                      type="button"
                      variant="primary"
                      className="!px-2 !py-1 !text-[10px]"
                      onClick={() => handleDownload(artifact, index)}
                      disabled={downloadDisabled}
                    >
                      {downloadingArtifactId === artifact.id ? (
                        <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-3 w-3" />
                      )}
                      {!isCompact ? t(locale, "Download", "Download") : null}
                    </GlowButton>
                  ) : null}

                  {isUrl ? (
                    <a
                      href={artifact.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-[10px] font-semibold text-white/70 transition-colors hover:bg-white/10"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {!isCompact ? t(locale, "Open Link", "Open Link") : null}
                    </a>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
