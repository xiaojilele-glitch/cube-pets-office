export const MAX_WORKFLOW_ATTACHMENTS = 4;
export const MAX_WORKFLOW_ATTACHMENT_EXCERPT_CHARS = 6000;

export type WorkflowAttachmentExcerptStatus =
  | "parsed"
  | "truncated"
  | "metadata_only"
  | "vision_analyzed"
  | "vision_fallback";

export interface WorkflowInputAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  content: string;
  excerpt: string;
  excerptStatus: WorkflowAttachmentExcerptStatus;
  visionReady?: boolean;
  base64DataUrl?: string;
  visualDescription?: string;
}

function normalizeDirectiveText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeWorkflowAttachmentContent(value: string) {
  const normalized = value.replace(/\0/g, "").replace(/\r\n/g, "\n").trim();
  return normalized || "(empty file)";
}

export function buildWorkflowAttachmentExcerpt(value: string) {
  const normalized = normalizeWorkflowAttachmentContent(value);
  if (normalized.length <= MAX_WORKFLOW_ATTACHMENT_EXCERPT_CHARS) {
    return { text: normalized, truncated: false };
  }

  return {
    text: `${normalized.slice(0, MAX_WORKFLOW_ATTACHMENT_EXCERPT_CHARS)}\n...[truncated]`,
    truncated: true,
  };
}

function toFiniteSize(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : 0;
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeWorkflowAttachment(
  value: unknown
): WorkflowInputAttachment | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<WorkflowInputAttachment>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) return null;

  const rawContent =
    typeof candidate.content === "string"
      ? candidate.content
      : typeof candidate.excerpt === "string"
        ? candidate.excerpt
        : "";
  const content = normalizeWorkflowAttachmentContent(rawContent);
  const excerpt = buildWorkflowAttachmentExcerpt(content).text;
  const excerptStatus =
    candidate.excerptStatus === "parsed" ||
    candidate.excerptStatus === "truncated" ||
    candidate.excerptStatus === "metadata_only" ||
    candidate.excerptStatus === "vision_analyzed" ||
    candidate.excerptStatus === "vision_fallback"
      ? candidate.excerptStatus
      : excerpt !== content
        ? "truncated"
        : "parsed";

  const result: WorkflowInputAttachment = {
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `${name}:${toFiniteSize(candidate.size)}`,
    name,
    mimeType:
      typeof candidate.mimeType === "string" && candidate.mimeType.trim()
        ? candidate.mimeType
        : "application/octet-stream",
    size: toFiniteSize(candidate.size),
    content,
    excerpt,
    excerptStatus,
  };

  if (typeof candidate.visionReady === "boolean") {
    result.visionReady = candidate.visionReady;
  }
  if (typeof candidate.base64DataUrl === "string" && candidate.base64DataUrl) {
    result.base64DataUrl = candidate.base64DataUrl;
  }
  if (typeof candidate.visualDescription === "string" && candidate.visualDescription) {
    result.visualDescription = candidate.visualDescription;
  }

  return result;
}

export function normalizeWorkflowAttachments(
  value: unknown
): WorkflowInputAttachment[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, MAX_WORKFLOW_ATTACHMENTS)
    .map(normalizeWorkflowAttachment)
    .filter((item): item is WorkflowInputAttachment => Boolean(item));
}

export function buildWorkflowInputSignature(
  directive: string,
  attachments: WorkflowInputAttachment[]
) {
  return simpleHash(
    JSON.stringify({
      directive: normalizeDirectiveText(directive),
      attachments: attachments.map(attachment => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: attachment.content,
        excerptStatus: attachment.excerptStatus,
      })),
    })
  );
}

export function buildWorkflowDirectiveContext(
  directive: string,
  attachments: WorkflowInputAttachment[]
) {
  const normalizedDirective = normalizeDirectiveText(directive);
  if (attachments.length === 0) {
    return normalizedDirective;
  }

  const attachmentSections = attachments.map((attachment, index) => {
    const lines = [
      `[Attachment ${index + 1}] ${attachment.name}`,
      `MIME type: ${attachment.mimeType || "unknown"}`,
      `File size: ${attachment.size} bytes`,
    ];

    if (attachment.visualDescription) {
      lines.push(`[Vision Analysis] ${attachment.name}`);
      lines.push(attachment.visualDescription);
    }

    if (attachment.content) {
      lines.push("Full parsed content:");
      lines.push(attachment.content);
    } else {
      lines.push("Full parsed content: (not available)");
    }

    return lines.join("\n");
  });

  return `${normalizedDirective}\n\nAttached reference files:\n\n${attachmentSections.join(
    "\n\n---\n\n"
  )}`;
}
