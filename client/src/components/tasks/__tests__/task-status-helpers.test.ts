import { describe, expect, it } from "vitest";

import {
  availableMissionOperatorActions,
  isMissionCancellable,
  isMissionTerminal,
  missionOperatorStateLabel,
  missionOperatorStateTone,
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

  it("returns operator state labels and tones", () => {
    expect(missionOperatorStateLabel("paused")).toBe("Paused");
    expect(missionOperatorStateLabel("blocked")).toBe("Blocked");
    expect(missionOperatorStateTone("paused")).toContain("sky");
    expect(missionOperatorStateTone("blocked")).toContain("amber");
    expect(missionOperatorStateTone("terminating")).toContain("rose");
  });

  it("resolves available operator actions from mission and operator state", () => {
    expect(availableMissionOperatorActions("running", "active")).toEqual([
      "pause",
      "mark-blocked",
      "terminate",
    ]);
    expect(availableMissionOperatorActions("running", "paused")).toEqual([
      "resume",
      "terminate",
    ]);
    expect(availableMissionOperatorActions("waiting", "blocked")).toEqual([
      "resume",
      "retry",
      "terminate",
    ]);
    expect(availableMissionOperatorActions("failed", "active")).toEqual([
      "retry",
    ]);
  });
});
