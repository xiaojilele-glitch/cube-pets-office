import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getMimeType,
  isTextMime,
  resolveArtifactAbsolutePath,
  resolveExecutorJobAbsolutePath,
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

  it("keeps repo-relative executor artifact paths stable", () => {
    const absolutePath = resolveArtifactAbsolutePath(
      "mission-1",
      "mission-1:analyze:1",
      "tmp/lobster-executor/jobs/mission-1/mission-1_analyze_1/executor.log"
    );

    expect(absolutePath).toBe(
      path.join(
        process.cwd(),
        "tmp/lobster-executor/jobs/mission-1/mission-1_analyze_1/executor.log"
      )
    );
    expect(
      resolveExecutorJobAbsolutePath(
        "mission-1",
        "mission-1:analyze:1",
        "events.jsonl"
      )
    ).toBe(
      path.join(
        process.cwd(),
        "tmp/lobster-executor/jobs",
        "mission-1",
        "mission-1_analyze_1",
        "events.jsonl"
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
