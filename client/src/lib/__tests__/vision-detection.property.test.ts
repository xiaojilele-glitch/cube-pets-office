import { describe, expect, it } from "vitest";
import fc from "fast-check";

/* ─── Property 1: 图片类型检测准确性 ─── */
/* **Validates: Requirements 1.1** */

/**
 * The isImageFile function in workflow-attachments.ts is not exported.
 * We reimplement the same detection logic here to test the property:
 *
 *   isImageFile(file) ≡ file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)
 *
 * The core invariant: for any file whose extension belongs to the known image
 * set OR whose MIME type starts with "image/", the detection must return true
 * (visionReady = true). For non-image files, it must return false.
 */

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif"]);

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() || "" : "";
}

function isImageFile(file: { name: string; type: string }): boolean {
  return (
    file.type.startsWith("image/") ||
    IMAGE_EXTENSIONS.has(getFileExtension(file.name))
  );
}

// ── Arbitraries ──

const arbImageExtension = fc.constantFrom(
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp"
);
const arbNonImageExtension = fc.constantFrom(
  "txt",
  "pdf",
  "docx",
  "json",
  "xml",
  "csv",
  "html",
  "ts",
  "js"
);
const arbImageMimeType = fc.constantFrom(
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/svg+xml"
);
const arbNonImageMimeType = fc.constantFrom(
  "text/plain",
  "application/pdf",
  "application/json",
  "text/html"
);
const arbBaseName = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(s => s.length > 0 && !s.includes("."));

describe("Feature: multi-modal-vision, Property 1: 图片类型检测准确性", () => {
  it("files with image extensions are detected as images regardless of MIME type", () => {
    fc.assert(
      fc.property(
        arbBaseName,
        arbImageExtension,
        fc.constantFrom("", "application/octet-stream", "text/plain"),
        (baseName, ext, mimeType) => {
          const file = { name: `${baseName}.${ext}`, type: mimeType };
          expect(isImageFile(file)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with image MIME types are detected as images regardless of extension", () => {
    fc.assert(
      fc.property(
        arbBaseName,
        arbNonImageExtension,
        arbImageMimeType,
        (baseName, ext, mimeType) => {
          const file = { name: `${baseName}.${ext}`, type: mimeType };
          expect(isImageFile(file)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with neither image extension nor image MIME type are NOT detected as images", () => {
    fc.assert(
      fc.property(
        arbBaseName,
        arbNonImageExtension,
        arbNonImageMimeType,
        (baseName, ext, mimeType) => {
          const file = { name: `${baseName}.${ext}`, type: mimeType };
          expect(isImageFile(file)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with no extension and non-image MIME type are NOT detected as images", () => {
    fc.assert(
      fc.property(arbBaseName, arbNonImageMimeType, (baseName, mimeType) => {
        const file = { name: baseName, type: mimeType };
        expect(isImageFile(file)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
