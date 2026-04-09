import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileCode,
  ScrollText,
} from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { useI18n } from "@/i18n";
import type { TaskArtifact } from "@/lib/tasks-store";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ArtifactListBlockProps {
  missionId: string;
  artifacts: TaskArtifact[];
  missionStatus: string;
  variant: "compact" | "full";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const KIND_ICON: Record<string, typeof FileText> = {
  file: FileCode,
  report: FileText,
  log: ScrollText,
  url: ExternalLink,
};

const KIND_COLORS: Record<string, string> = {
  file: "bg-cyan-500/20 text-cyan-300",
  report: "bg-amber-500/20 text-amber-300",
  log: "bg-white/10 text-white/60",
  url: "bg-indigo-500/20 text-indigo-300",
};

function kindLabel(kind: string, locale: string): string {
  const labels: Record<string, Record<string, string>> = {
    "zh-CN": { file: "文件", report: "报告", log: "日志", url: "链接" },
    "en-US": { file: "File", report: "Report", log: "Log", url: "Link" },
  };
  return labels[locale]?.[kind] ?? kind;
}

function sectionTitle(locale: string): string {
  return locale === "zh-CN" ? "产物" : "Artifacts";
}

function previewLabel(locale: string): string {
  return locale === "zh-CN" ? "预览" : "Preview";
}

function downloadLabel(locale: string): string {
  return locale === "zh-CN" ? "下载" : "Download";
}

function openLinkLabel(locale: string): string {
  return locale === "zh-CN" ? "打开链接" : "Open Link";
}

function runningHint(locale: string): string {
  return locale === "zh-CN"
    ? "执行中，可能有新产物..."
    : "Running — new artifacts may appear...";
}

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const itemVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ArtifactListBlock({
  artifacts,
  missionStatus,
  variant,
}: ArtifactListBlockProps) {
  const { locale } = useI18n();

  const handleDownload = useCallback((url: string | undefined) => {
    if (url) window.open(url, "_blank");
  }, []);

  /* Req 3.6 — empty → render nothing */
  if (!artifacts.length) return null;

  const isRunning = missionStatus === "running";
  const isCompleted = missionStatus === "completed";
  const isCompact = variant === "compact";

  return (
    <div className="rounded-2xl glass-panel p-3">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <FileText className="h-4 w-4 text-white/40" />
        <span className="text-[11px] font-semibold text-white/50">
          {sectionTitle(locale)} · {artifacts.length}
        </span>

        {/* Req 6.4 — pulse indicator while running */}
        {isRunning && (
          <span className="relative ml-auto flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
          </span>
        )}
      </div>

      {isRunning && (
        <p className="mb-2 text-[10px] text-white/30">{runningHint(locale)}</p>
      )}

      {/* Artifact list with entrance animation (Req 6.3) */}
      <div className={`space-y-2 ${isCompact ? "max-h-48 overflow-y-auto" : ""}`}>
        <AnimatePresence initial={false}>
          {artifacts.map((artifact) => {
            const Icon = KIND_ICON[artifact.kind] ?? FileText;
            const colorCls = KIND_COLORS[artifact.kind] ?? KIND_COLORS.file;
            const isReport = artifact.kind === "report";
            const isUrl = artifact.kind === "url";
            const isDownloadable =
              artifact.kind === "file" ||
              artifact.kind === "report" ||
              artifact.kind === "log";
            /* Req 5.1 — highlight report when mission completed */
            const highlighted = isReport && isCompleted;

            return (
              <motion.div
                key={artifact.id}
                layout
                variants={itemVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`flex items-start gap-3 rounded-xl p-2 ${
                  highlighted
                    ? "glass-panel border-amber-400/20 bg-amber-500/10"
                    : "bg-white/5"
                }`}
              >
                {/* Icon + kind tag */}
                <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                  <Icon className="h-4 w-4 text-white/50" />
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${colorCls}`}
                  >
                    {kindLabel(artifact.kind, locale)}
                  </span>
                </div>

                {/* Name + description */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-white">
                    {artifact.title}
                  </p>
                  {artifact.description && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/40">
                      {artifact.description}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Req 5.2 — report completed: preview + download dual buttons */}
                  {isReport && isCompleted && (
                    <GlowButton
                      variant="ghost"
                      className="!px-2 !py-1 !text-[10px]"
                      onClick={() => handleDownload(artifact.previewUrl)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      {previewLabel(locale)}
                    </GlowButton>
                  )}

                  {/* Req 3.3 — download button for file/report/log */}
                  {isDownloadable && (
                    <GlowButton
                      variant="primary"
                      className="!px-2 !py-1 !text-[10px]"
                      onClick={() => handleDownload(artifact.downloadUrl)}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      {!isCompact && downloadLabel(locale)}
                    </GlowButton>
                  )}

                  {/* Req 3.4 — external link button for url kind */}
                  {isUrl && (
                    <a
                      href={artifact.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-[10px] font-semibold text-white/70 transition-colors hover:bg-white/10"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {!isCompact && openLinkLabel(locale)}
                    </a>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
