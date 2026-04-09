import type { TaskArtifact } from "@/lib/tasks-store";

export type ArtifactPreviewMode = "markdown" | "json" | "text";

export interface ArtifactPreviewPayload {
  content: string;
  contentType: string | null;
  truncated: boolean;
}

const MARKDOWN_FORMATS = new Set(["md", "markdown", "mdx"]);
const JSON_FORMATS = new Set(["json", "jsonl"]);
const TEXT_FORMATS = new Set([
  "csv",
  "css",
  "html",
  "js",
  "jsx",
  "log",
  "md",
  "mdx",
  "py",
  "sh",
  "text",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

function normalizeFormat(format?: string | null): string | null {
  const normalized = format?.trim().toLowerCase();
  return normalized || null;
}

function extractErrorMessage(raw: string): string {
  if (!raw) {
    return "Preview request failed.";
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Ignore JSON parsing errors and fall back to the raw text.
  }

  return raw.trim();
}

export function resolveArtifactPreviewMode(
  format?: string | null,
  contentType?: string | null
): ArtifactPreviewMode {
  const normalizedFormat = normalizeFormat(format);
  const normalizedType = contentType?.toLowerCase() || "";

  if (
    (normalizedFormat && MARKDOWN_FORMATS.has(normalizedFormat)) ||
    normalizedType.includes("markdown")
  ) {
    return "markdown";
  }

  if (
    (normalizedFormat && JSON_FORMATS.has(normalizedFormat)) ||
    normalizedType.includes("application/json")
  ) {
    return "json";
  }

  return "text";
}

export function formatArtifactPreviewContent(
  content: string,
  format?: string | null,
  contentType?: string | null
): string {
  if (resolveArtifactPreviewMode(format, contentType) !== "json") {
    return content;
  }

  try {
    return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
  } catch {
    return content;
  }
}

export function isArtifactPreviewable(
  artifact: Pick<TaskArtifact, "kind" | "format" | "previewUrl">
): boolean {
  if (!artifact.previewUrl) {
    return false;
  }

  if (artifact.kind === "log" || artifact.kind === "report") {
    return true;
  }

  const normalizedFormat = normalizeFormat(artifact.format);
  return normalizedFormat ? TEXT_FORMATS.has(normalizedFormat) : false;
}

export async function fetchArtifactPreview(
  missionId: string,
  artifactIndex: number,
  signal?: AbortSignal
): Promise<ArtifactPreviewPayload> {
  const response = await fetch(
    `/api/tasks/${missionId}/artifacts/${artifactIndex}/preview`,
    {
      signal,
    }
  );

  if (!response.ok) {
    const rawError = await response.text().catch(() => "");
    throw new Error(extractErrorMessage(rawError));
  }

  return {
    content: await response.text(),
    contentType: response.headers.get("content-type"),
    truncated: response.headers.get("x-truncated") === "true",
  };
}
