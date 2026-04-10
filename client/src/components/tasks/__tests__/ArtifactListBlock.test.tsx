import { describe, expect, it, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useAppStore } from "@/lib/store";
import type { TaskArtifact } from "@/lib/tasks-store";

import {
  ArtifactListBlock,
  isArtifactListCompletedStatus,
  shouldHighlightArtifact,
} from "../ArtifactListBlock";

function makeArtifact(overrides?: Partial<TaskArtifact>): TaskArtifact {
  return {
    id: "artifact-1",
    title: "Mission Report",
    description: "Final mission report",
    kind: "report",
    format: "md",
    filename: "report.md",
    downloadKind: "server",
    href: "/api/tasks/m1/artifacts/0/download",
    downloadUrl: "/api/tasks/m1/artifacts/0/download",
    previewUrl: "/api/tasks/m1/artifacts/0/preview",
    ...overrides,
  };
}

function renderBlock(
  artifacts: TaskArtifact[],
  missionStatus = "running",
  variant: "compact" | "full" = "full"
) {
  return renderToStaticMarkup(
    <ArtifactListBlock
      missionId="mission-1"
      artifacts={artifacts}
      missionStatus={missionStatus}
      variant={variant}
    />
  );
}

describe("ArtifactListBlock", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "en-US" });
  });

  it("renders an explanatory empty state for the full variant", () => {
    const markup = renderBlock([]);

    expect(markup).toContain("尚未产生产物");
    expect(markup).toContain("任务仍在运行中");
  });

  it("keeps the compact variant silent when there are no artifacts", () => {
    expect(renderBlock([], "running", "compact")).toBe("");
  });

  it("renders the correct action for url artifacts", () => {
    const markup = renderBlock([
      makeArtifact({
        id: "artifact-url",
        title: "Dashboard",
        kind: "url",
        format: undefined,
        href: "https://example.com/dashboard",
        downloadKind: "external",
        downloadUrl: undefined,
        previewUrl: undefined,
      }),
    ]);

    expect(markup).toContain("Dashboard");
    expect(markup).toContain("Open Link");
    expect(markup).toContain("https://example.com/dashboard");
  });

  it("shows preview and download controls for a completed report", () => {
    const markup = renderBlock([makeArtifact()], "completed");

    expect(markup).toContain("Preview");
    expect(markup).toContain("Download");
    expect(markup).toContain("bg-amber-500/10");
  });

  it("shows the running indicator when the mission is still active", () => {
    const markup = renderBlock([makeArtifact()], "running", "compact");

    expect(markup).toContain("animate-ping");
    expect(markup).toContain("Artifacts");
  });

  it("exports helper logic for completed highlighting", () => {
    expect(isArtifactListCompletedStatus("completed")).toBe(true);
    expect(isArtifactListCompletedStatus("done")).toBe(true);
    expect(shouldHighlightArtifact(makeArtifact(), "completed")).toBe(true);
    expect(shouldHighlightArtifact(makeArtifact(), "running")).toBe(false);
  });
});
