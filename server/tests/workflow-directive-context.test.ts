import { describe, expect, it } from "vitest";
import {
  buildWorkflowDirectiveContext,
  type WorkflowInputAttachment,
} from "../../shared/workflow-input.js";

function makeAttachment(
  overrides: Partial<WorkflowInputAttachment> = {}
): WorkflowInputAttachment {
  return {
    id: "test-id",
    name: "file.txt",
    mimeType: "text/plain",
    size: 100,
    content: "hello world",
    excerpt: "hello world",
    excerptStatus: "parsed",
    ...overrides,
  };
}

describe("buildWorkflowDirectiveContext", () => {
  it("returns directive only when no attachments", () => {
    const result = buildWorkflowDirectiveContext("do something", []);
    expect(result).toBe("do something");
  });

  it("includes basic attachment metadata without vision analysis", () => {
    const att = makeAttachment({
      name: "readme.md",
      mimeType: "text/markdown",
      size: 500,
    });
    const result = buildWorkflowDirectiveContext("task", [att]);

    expect(result).toContain("[Attachment 1] readme.md");
    expect(result).toContain("MIME type: text/markdown");
    expect(result).toContain("File size: 500 bytes");
    expect(result).toContain("Full parsed content:");
    expect(result).not.toContain("[Vision Analysis]");
  });

  it("includes [Vision Analysis] section when visualDescription is present", () => {
    const att = makeAttachment({
      name: "screenshot.png",
      mimeType: "image/png",
      size: 12345,
      content: "OCR text fallback",
      visionReady: true,
      visualDescription:
        "A dashboard showing revenue charts with upward trends.",
    });
    const result = buildWorkflowDirectiveContext("analyze this", [att]);

    expect(result).toContain("[Attachment 1] screenshot.png");
    expect(result).toContain("MIME type: image/png");
    expect(result).toContain("File size: 12345 bytes");
    expect(result).toContain("[Vision Analysis] screenshot.png");
    expect(result).toContain(
      "A dashboard showing revenue charts with upward trends."
    );
    expect(result).toContain("Full parsed content:");
  });

  it("places vision analysis after metadata and before full parsed content", () => {
    const att = makeAttachment({
      name: "chart.png",
      mimeType: "image/png",
      size: 5000,
      content: "parsed text content",
      visualDescription: "A bar chart showing Q1 results.",
    });
    const result = buildWorkflowDirectiveContext("review", [att]);

    const visionIdx = result.indexOf("[Vision Analysis]");
    const metadataIdx = result.indexOf("File size:");
    const contentIdx = result.indexOf("Full parsed content:");

    expect(visionIdx).toBeGreaterThan(metadataIdx);
    expect(visionIdx).toBeLessThan(contentIdx);
  });

  it("handles multiple attachments with mixed vision/non-vision", () => {
    const imgAtt = makeAttachment({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      size: 8000,
      content: "ocr text",
      visualDescription: "A photo of a cat.",
    });
    const textAtt = makeAttachment({
      name: "notes.txt",
      mimeType: "text/plain",
      size: 200,
      content: "some notes",
    });
    const result = buildWorkflowDirectiveContext("process files", [
      imgAtt,
      textAtt,
    ]);

    // Image attachment has vision analysis
    expect(result).toContain("[Vision Analysis] photo.jpg");
    expect(result).toContain("A photo of a cat.");

    // Text attachment does not
    expect(result).toContain("[Attachment 2] notes.txt");
    expect(result).not.toContain("[Vision Analysis] notes.txt");
  });

  it("does not include vision analysis for empty visualDescription", () => {
    const att = makeAttachment({
      name: "img.png",
      visualDescription: "",
    });
    const result = buildWorkflowDirectiveContext("check", [att]);
    expect(result).not.toContain("[Vision Analysis]");
  });
});
