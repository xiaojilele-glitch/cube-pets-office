import path from "node:path";

/**
 * Maps file extensions to MIME types for artifact content delivery.
 */
export const EXTENSION_MIME_MAP: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".log": "text/plain",
  ".txt": "text/plain",
  ".py": "text/plain",
  ".ts": "text/plain",
  ".js": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

/**
 * MIME type prefixes (or exact values) considered as text for preview purposes.
 */
export const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
];

/**
 * Returns the MIME type for a given filename based on its extension.
 * Falls back to `application/octet-stream` for unknown extensions.
 */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * Checks whether a MIME type represents text content that can be previewed.
 */
export function isTextMime(mime: string): boolean {
  return TEXT_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
}

/**
 * Validates that an artifact path does not contain path traversal sequences.
 * Returns `false` if the path contains `..`.
 */
export function validateArtifactPath(artifactPath: string): boolean {
  return !artifactPath.includes("..");
}

function sanitizeJobPathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function resolveExecutorJobAbsolutePath(
  missionId: string,
  jobId: string,
  ...segments: string[]
): string {
  return path.join(
    process.cwd(),
    "tmp/lobster-executor/jobs",
    sanitizeJobPathSegment(missionId),
    sanitizeJobPathSegment(jobId),
    ...segments
  );
}

/**
 * Resolves the absolute filesystem path for an artifact file.
 */
export function resolveArtifactAbsolutePath(
  missionId: string,
  jobId: string,
  relativePath: string
): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (path.isAbsolute(relativePath)) {
    return path.normalize(relativePath);
  }

  if (normalized.startsWith("tmp/lobster-executor/jobs/")) {
    return path.join(process.cwd(), normalized);
  }

  return resolveExecutorJobAbsolutePath(missionId, jobId, normalized);
}
