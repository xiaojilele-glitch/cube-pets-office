import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileJson,
  FileText,
  LoaderCircle,
  ScrollText,
} from "lucide-react";
import { Streamdown } from "streamdown";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";

import {
  fetchArtifactPreview,
  formatArtifactPreviewContent,
  resolveArtifactPreviewMode,
} from "./artifact-preview";

export interface ArtifactPreviewDialogProps {
  missionId: string;
  artifactIndex: number | null;
  artifactName: string;
  format?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PreviewState =
  | { status: "idle"; content: string; contentType: string | null; truncated: false }
  | { status: "loading"; content: string; contentType: string | null; truncated: false }
  | { status: "error"; content: string; contentType: string | null; truncated: false; error: string }
  | { status: "ready"; content: string; contentType: string | null; truncated: boolean };

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function getPreviewIcon(mode: "markdown" | "json" | "text") {
  if (mode === "json") {
    return FileJson;
  }

  if (mode === "text") {
    return ScrollText;
  }

  return FileText;
}

export function ArtifactPreviewDialog({
  missionId,
  artifactIndex,
  artifactName,
  format,
  open,
  onOpenChange,
}: ArtifactPreviewDialogProps) {
  const { locale } = useI18n();
  const [state, setState] = useState<PreviewState>({
    status: "idle",
    content: "",
    contentType: null,
    truncated: false,
  });

  useEffect(() => {
    if (!open || artifactIndex === null) {
      setState({
        status: "idle",
        content: "",
        contentType: null,
        truncated: false,
      });
      return;
    }

    const controller = new AbortController();

    setState({
      status: "loading",
      content: "",
      contentType: null,
      truncated: false,
    });

    void fetchArtifactPreview(missionId, artifactIndex, controller.signal)
      .then(payload => {
        setState({
          status: "ready",
          content: payload.content,
          contentType: payload.contentType,
          truncated: payload.truncated,
        });
      })
      .catch(error => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          status: "error",
          content: "",
          contentType: null,
          truncated: false,
          error:
            error instanceof Error
              ? error.message
              : t(locale, "Preview failed.", "Preview failed."),
        });
      });

    return () => controller.abort();
  }, [artifactIndex, locale, missionId, open]);

  const previewMode = useMemo(
    () => resolveArtifactPreviewMode(format, state.contentType),
    [format, state.contentType]
  );
  const PreviewIcon = getPreviewIcon(previewMode);
  const renderedContent = useMemo(
    () => formatArtifactPreviewContent(state.content, format, state.contentType),
    [format, state.content, state.contentType]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
        <DialogHeader className="border-b border-stone-200/80 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-stone-900">
            <PreviewIcon className="size-4 text-stone-500" />
            {artifactName}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-stone-500">
            {t(
              locale,
              "Previewing mission artifact content.",
              "Previewing mission artifact content."
            )}
          </DialogDescription>
        </DialogHeader>

        {state.truncated ? (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">
            {t(
              locale,
              "Preview truncated to the first 1 MB.",
              "Preview truncated to the first 1 MB."
            )}
          </div>
        ) : null}

        {state.status === "loading" ? (
          <div className="flex min-h-[320px] items-center justify-center gap-2 px-6 py-10 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            {t(locale, "Loading preview...", "Loading preview...")}
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="flex min-h-[220px] items-center justify-center px-6 py-10">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4" />
                {t(locale, "Preview unavailable", "Preview unavailable")}
              </div>
              <p className="mt-2 leading-6">{state.error}</p>
            </div>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <ScrollArea className="max-h-[70vh] w-full">
            <div className="px-6 py-5">
              {previewMode === "markdown" ? (
                <div className="prose prose-stone max-w-none">
                  <Streamdown mode="static">{renderedContent}</Streamdown>
                </div>
              ) : (
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-[20px] bg-stone-950 px-4 py-4 text-sm leading-6 text-stone-100">
                  {renderedContent}
                </pre>
              )}
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
