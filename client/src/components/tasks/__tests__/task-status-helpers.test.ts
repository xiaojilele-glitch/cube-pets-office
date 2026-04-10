import { describe, expect, it } from "vitest";

import {
  isMissionCancellable,
  isMissionTerminal,
  missionStatusLabel,
  missionStatusTone,
} from "@/components/tasks/task-helpers";

describe("task status helpers", () => {
  it("returns the expected label and tone for cancelled missions", () => {
    expect(missionStatusLabel("cancelled")).toBe("Cancelled");
    expect(missionStatusTone("cancelled")).toContain("slate");
  });

  it("marks queued, running, and waiting missions as cancellable", () => {
    expect(isMissionCancellable("queued")).toBe(true);
    expect(isMissionCancellable("running")).toBe(true);
    expect(isMissionCancellable("waiting")).toBe(true);
  });

  it("marks only final mission states as terminal", () => {
    expect(isMissionTerminal("done")).toBe(true);
    expect(isMissionTerminal("failed")).toBe(true);
    expect(isMissionTerminal("cancelled")).toBe(true);
    expect(isMissionTerminal("running")).toBe(false);
  });
});
