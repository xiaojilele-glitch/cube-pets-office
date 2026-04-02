import {
  MAX_WORKFLOW_ATTACHMENTS,
  buildWorkflowAttachmentExcerpt,
  normalizeWorkflowAttachmentContent,
  type WorkflowInputAttachment,
} from "@shared/workflow-input";

type TesseractModule = typeof import("tesseract.js");
type OCRWorker = Awaited<ReturnType<TesseractModule["createWorker"]>>;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "less",
  "py",
  "java",
  "go",
  "rs",
  "sql",
  "log",
  "sh",
  "bat",
  "ps1",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);
const WORD_EXTENSIONS = new Set(["docx", "doc"]);
const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "csv", "tsv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif"]);
const IMAGE_COMPRESS_THRESHOLD = 4 * 1024 * 1024; // 4MB
const OCR_LANGUAGES = ["eng", "chi_sim"];
const OCR_TIMEOUT_MS = 30_000;
const OCR_WORKER_PATH =
  import.meta.env.BASE_URL === "/"
    ? "/tesseract-worker-proxy.js"
    : `${import.meta.env.BASE_URL.replace(/\/+$/, "/")}tesseract-worker-proxy.js`;

let ocrWorkerPromise: Promise<OCRWorker> | null = null;

function getFileExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() || "" : "";
}

function isTextLikeFile(file: File) {
  const extension = getFileExtension(file.name);
  return (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    file.type === "application/xml" ||
    file.type === "application/javascript" ||
    file.type === "application/typescript" ||
    TEXT_EXTENSIONS.has(extension)
  );
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || PDF_EXTENSIONS.has(getFileExtension(file.name));
}

function isWordFile(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/msword" ||
    WORD_EXTENSIONS.has(getFileExtension(file.name))
  );
}

function isSpreadsheetFile(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "text/csv" ||
    SPREADSHEET_EXTENSIONS.has(getFileExtension(file.name))
  );
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(getFileExtension(file.name));
}

function buildMetadataNote(file: File, reason?: string) {
  if (isImageFile(file)) {
    return reason
      ? `Image attached. OCR could not complete in the browser preview. ${reason}`
      : "Image attached. OCR is not available for this file yet.";
  }

  if (isPdfFile(file)) {
    return reason
      ? `PDF attached. Text extraction could not complete. ${reason}`
      : "PDF attached. Text extraction is not available for this file yet.";
  }

  if (isWordFile(file)) {
    return reason
      ? `Word document attached. Text extraction could not complete. ${reason}`
      : "Word document attached. Text extraction is not available for this file yet.";
  }

  if (isSpreadsheetFile(file)) {
    return reason
      ? `Spreadsheet attached. Table extraction could not complete. ${reason}`
      : "Spreadsheet attached. Table extraction is not available for this file yet.";
  }

  return reason
    ? `Binary attachment added. Inline extraction failed. ${reason}`
    : "Binary attachment added. The workflow can use the file metadata, but inline text extraction is not available for this format yet.";
}

function makeAttachmentId(file: File) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${file.name}-${file.size}-${Date.now()}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const tesseract = await import("tesseract.js");
      tesseract.setLogging(false);

      return tesseract.createWorker(OCR_LANGUAGES, undefined, {
        workerPath: OCR_WORKER_PATH,
        logger: () => {
          // OCR progress stays silent in the UI.
        },
        errorHandler: error => {
          console.warn("[WorkflowAttachments] OCR worker warning:", error);
        },
      });
    })().catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

interface VisionFields {
  visionReady?: boolean;
  base64DataUrl?: string;
  visualDescription?: string;
}

function finalizeAttachment(
  file: File,
  content: string,
  source: "parsed" | "metadata_only" | "vision_analyzed" | "vision_fallback",
  visionFields?: VisionFields
): WorkflowInputAttachment {
  const normalizedContent = normalizeWorkflowAttachmentContent(content);
  const excerpt = buildWorkflowAttachmentExcerpt(normalizedContent);

  let excerptStatus: WorkflowInputAttachment["excerptStatus"];
  if (source === "vision_analyzed" || source === "vision_fallback") {
    excerptStatus = source;
  } else if (source === "metadata_only") {
    excerptStatus = "metadata_only";
  } else {
    excerptStatus = excerpt.truncated ? "truncated" : "parsed";
  }

  const attachment: WorkflowInputAttachment = {
    id: makeAttachmentId(file),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    content: normalizedContent,
    excerpt: excerpt.text,
    excerptStatus,
  };

  if (visionFields?.visionReady !== undefined) {
    attachment.visionReady = visionFields.visionReady;
  }
  if (visionFields?.base64DataUrl) {
    attachment.base64DataUrl = visionFields.base64DataUrl;
  }
  if (visionFields?.visualDescription) {
    attachment.visualDescription = visionFields.visualDescription;
  }

  return attachment;
}

async function parseTextFile(file: File) {
  const rawText = await file.text();
  return finalizeAttachment(file, rawText, "parsed");
}

async function parsePdfFile(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const pageTexts: string[] = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      pageTexts.push(`[Page ${pageIndex}] ${text}`);
    }
  }

  return finalizeAttachment(file, pageTexts.join("\n\n"), "parsed");
}

async function parseWordFile(file: File) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  const warningText = (result.messages || [])
    .slice(0, 3)
    .map(message => `[${message.type}] ${message.message}`)
    .join("\n");
  const combined = warningText
    ? `${result.value}\n\nWarnings:\n${warningText}`
    : result.value;
  return finalizeAttachment(file, combined, "parsed");
}

async function parseSpreadsheetFile(file: File) {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array" });
  const sections = workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    }) as Array<Array<string | number | boolean | null | undefined>>;

    const contentRows = rows.map(row =>
      row
        .map(cell => (cell === null || cell === undefined ? "" : String(cell)))
        .join(" | ")
        .trim()
    );

    return `[Sheet] ${sheetName}\n${contentRows.filter(Boolean).join("\n")}`;
  });

  return finalizeAttachment(file, sections.join("\n\n"), "parsed");
}

/**
 * Compress an image using Canvas API by downsampling proportionally.
 * Returns a JPEG blob with reduced dimensions and quality.
 */
async function compressImage(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image for compression."));
      image.src = objectUrl;
    });

    // Calculate scale factor to bring the encoded size under the threshold.
    // A rough heuristic: scale down proportionally based on the ratio of
    // the file size to the threshold, then apply JPEG quality reduction.
    const ratio = Math.sqrt(IMAGE_COMPRESS_THRESHOLD / file.size);
    const targetWidth = Math.max(1, Math.round(img.width * ratio));
    const targetHeight = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context is not available.");
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error("Canvas toBlob returned null."));
          }
        },
        "image/jpeg",
        0.8
      );
    });

    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Read a File and encode it as a Base64 data URL.
 * If the file exceeds 4MB, compress it first using Canvas downsampling.
 */
export async function fileToBase64DataUrl(file: File): Promise<string> {
  let source: Blob = file;
  let mimeType = file.type || "application/octet-stream";

  if (file.size > IMAGE_COMPRESS_THRESHOLD) {
    source = await compressImage(file);
    mimeType = "image/jpeg"; // compressImage always outputs JPEG
  }

  const buffer = await source.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return `data:${mimeType};base64,${base64}`;
}

interface VisionApiResult {
  description: string;
  elements: string[];
  textContent: string;
  rawResponse: string;
}

/**
 * POST to /api/vision/analyze to request server-side Vision LLM analysis.
 * Returns the structured analysis result for a single image.
 */
async function requestVisionAnalysis(
  base64DataUrl: string,
  name: string
): Promise<VisionApiResult> {
  const response = await fetch("/api/vision/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: [{ base64DataUrl, name }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision API returned ${response.status}`);
  }

  const data = await response.json();
  const results: Array<{ name: string; analysis: VisionApiResult }> = data.results || [];
  const match = results.find(r => r.name === name);
  if (!match) {
    throw new Error("Vision API returned no result for this image.");
  }

  return match.analysis;
}

/**
 * Format a VisionAnalysisResult into a human-readable visual description string.
 */
function formatVisualContext(result: VisionApiResult): string {
  const parts: string[] = [];

  if (result.description) {
    parts.push(result.description);
  }

  if (result.elements.length > 0) {
    parts.push("Key elements: " + result.elements.join(", "));
  }

  if (result.textContent) {
    parts.push("Text content: " + result.textContent);
  }

  return parts.join("\n");
}

/**
 * OCR-based image parsing — the original fallback path.
 */
async function parseImageFileOcr(file: File): Promise<WorkflowInputAttachment> {
  const worker = await withTimeout(getOcrWorker(), OCR_TIMEOUT_MS, "OCR worker setup");
  const result = await withTimeout(
    worker.recognize(file, {
      rotateAuto: true,
    }),
    OCR_TIMEOUT_MS,
    "OCR"
  );
  const text = normalizeWorkflowAttachmentContent(result.data.text || "");

  if (!text) {
    return finalizeAttachment(
      file,
      buildMetadataNote(file, "No readable text was detected in the image."),
      "metadata_only"
    );
  }

  return finalizeAttachment(file, text, "parsed");
}

/**
 * Parse an image file: try Vision LLM analysis first, fall back to OCR on failure.
 *
 * When Vision succeeds: visionReady=true, base64DataUrl set, visualDescription set,
 * excerptStatus="vision_analyzed".
 * When Vision fails: fall back to OCR, excerptStatus="vision_fallback".
 *
 * Requirements: 1.1, 1.4, 4.1, 4.2, 4.5
 */
async function parseImageFile(file: File) {
  // 1. Encode to Base64 Data URL
  let base64DataUrl: string;
  try {
    base64DataUrl = await fileToBase64DataUrl(file);
  } catch {
    // Base64 encoding failed — fall back to OCR directly
    const ocrResult = await parseImageFileOcr(file);
    ocrResult.excerptStatus = "vision_fallback";
    return ocrResult;
  }

  // 2. Try Vision analysis via server API
  try {
    const visionResult = await requestVisionAnalysis(base64DataUrl, file.name);
    const visualDescription = formatVisualContext(visionResult);
    const content = visualDescription || visionResult.rawResponse || "(no visual description)";

    return finalizeAttachment(file, content, "vision_analyzed", {
      visionReady: true,
      base64DataUrl,
      visualDescription,
    });
  } catch (visionError) {
    console.warn(
      "[WorkflowAttachments] Vision analysis failed, falling back to OCR:",
      file.name,
      visionError
    );
  }

  // 3. Fallback to OCR
  try {
    const ocrResult = await parseImageFileOcr(file);
    ocrResult.excerptStatus = "vision_fallback";
    ocrResult.visionReady = false;
    ocrResult.base64DataUrl = base64DataUrl;
    return ocrResult;
  } catch (ocrError) {
    console.warn(
      "[WorkflowAttachments] OCR also failed:",
      file.name,
      ocrError
    );
    return finalizeAttachment(
      file,
      buildMetadataNote(
        file,
        ocrError instanceof Error ? ocrError.message : "Vision and OCR both failed."
      ),
      "vision_fallback",
      { visionReady: false, base64DataUrl }
    );
  }
}

async function fileToAttachment(file: File): Promise<WorkflowInputAttachment> {
  try {
    if (isTextLikeFile(file)) {
      return await parseTextFile(file);
    }

    if (isPdfFile(file)) {
      return await parsePdfFile(file);
    }

    if (isWordFile(file) && getFileExtension(file.name) === "docx") {
      return await parseWordFile(file);
    }

    if (isSpreadsheetFile(file)) {
      return await parseSpreadsheetFile(file);
    }

    if (isImageFile(file)) {
      return await parseImageFile(file);
    }
  } catch (error) {
    console.error("[WorkflowAttachments] Failed to parse file:", file.name, error);
    return finalizeAttachment(
      file,
      buildMetadataNote(
        file,
        error instanceof Error ? error.message : "Unknown parsing error."
      ),
      "metadata_only"
    );
  }

  return finalizeAttachment(file, buildMetadataNote(file), "metadata_only");
}

export async function prepareWorkflowAttachments(files: File[]) {
  const limited = files.slice(0, MAX_WORKFLOW_ATTACHMENTS);
  return Promise.all(limited.map(fileToAttachment));
}
