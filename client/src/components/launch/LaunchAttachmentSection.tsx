import { X } from "lucide-react";
import type { WorkflowInputAttachment } from "@shared/workflow-input";

export function formatLaunchAttachmentSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

export function LaunchAttachmentSection({
  attachments,
  attachmentError,
  onRemoveAttachment,
}: {
  attachments: WorkflowInputAttachment[];
  attachmentError: string | null;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  return (
    <>
      {attachments.length > 0 ? (
        <div className="grid gap-2">
          {attachments.map(attachment => (
            <div
              key={attachment.id}
              className="rounded-[16px] border border-stone-200/80 bg-white/82 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-stone-900">
                    {attachment.name}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-stone-500">
                    <span>{formatLaunchAttachmentSize(attachment.size)}</span>
                    <span>
                      {attachment.mimeType || "application/octet-stream"}
                    </span>
                    <span>{attachment.excerptStatus}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200/80 bg-white text-stone-500 transition-colors hover:text-stone-900"
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-stone-600">
                {attachment.excerpt}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {attachmentError ? (
        <div className="rounded-[16px] border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {attachmentError}
        </div>
      ) : null}
    </>
  );
}
