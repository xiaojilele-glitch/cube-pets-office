import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getMimeType,
  isTextMime,
  resolveArtifactAbsolutePath,
  validateArtifactPath,
} from "../routes/artifact-utils.js";

describe("artifact-utils", () => {
  it("maps known extensions to the expected mime type", () => {
    expect(getMimeType("report.json")).toBe("application/json");
    expect(getMimeType("summary.md")).toBe("text/markdown");
    expect(getMimeType("run.log")).toBe("text/plain");
    expect(getMimeType("archive.bin")).toBe("application/octet-stream");
  });

  it("rejects path traversal segments", () => {
    expect(validateArtifactPath("reports/final.json")).toBe(true);
    expect(validateArtifactPath("../secret.txt")).toBe(false);
    expect(validateArtifactPath("reports/../../secret.txt")).toBe(false);
  });

  it("resolves the artifact path under the executor job workspace", () => {
    const absolutePath = resolveArtifactAbsolutePath(
      "mission-1",
      "job-9",
      "reports/final.json"
    );

    expect(absolutePath).toBe(
      path.join(
        process.cwd(),
        "tmp/lobster-executor/jobs",
        "mission-1",
        "job-9",
        "reports/final.json"
      )
    );
  });

  it("treats text and json mime types as previewable text", () => {
    expect(isTextMime("text/plain")).toBe(true);
    expect(isTextMime("text/markdown")).toBe(true);
    expect(isTextMime("application/json")).toBe(true);
    expect(isTextMime("application/octet-stream")).toBe(false);
  });
});
