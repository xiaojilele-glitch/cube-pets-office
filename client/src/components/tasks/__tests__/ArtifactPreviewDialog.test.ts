import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchArtifactPreview,
  formatArtifactPreviewContent,
  isArtifactPreviewable,
  resolveArtifactPreviewMode,
} from "../artifact-preview";

describe("ArtifactPreviewDialog logic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves markdown, json, and text preview modes", () => {
    expect(resolveArtifactPreviewMode("md")).toBe("markdown");
    expect(resolveArtifactPreviewMode("json")).toBe("json");
    expect(resolveArtifactPreviewMode(undefined, "text/plain")).toBe("text");
  });

  it("formats json previews with indentation", () => {
    expect(formatArtifactPreviewContent('{"ok":true}', "json")).toBe(
      '{\n  "ok": true\n}\n'
    );
  });

  it("detects previewable artifacts from kind and preview url", () => {
    expect(
      isArtifactPreviewable({
        kind: "report",
        format: "md",
        previewUrl: "/api/tasks/m1/artifacts/0/preview",
      })
    ).toBe(true);

    expect(
      isArtifactPreviewable({
        kind: "file",
        format: "png",
        previewUrl: "/api/tasks/m1/artifacts/1/preview",
      })
    ).toBe(false);
  });

  it("fetches preview content and reads the truncation header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("preview body", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            "x-truncated": "true",
          },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await fetchArtifactPreview("mission-1", 4);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/mission-1/artifacts/4/preview",
      expect.objectContaining({})
    );
    expect(payload).toEqual({
      content: "preview body",
      contentType: "text/plain",
      truncated: true,
    });
  });
});
