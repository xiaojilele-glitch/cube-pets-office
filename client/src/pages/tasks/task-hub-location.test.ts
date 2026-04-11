import { describe, expect, it } from "vitest";

import { resolveTaskHubLocationUpdate } from "./task-hub-location";

describe("resolveTaskHubLocationUpdate", () => {
  it("clears the search when the new mission exists but is currently filtered out", () => {
    expect(
      resolveTaskHubLocationUpdate({
        missionId: "mission-2",
        currentSearch: "payments",
        filteredTaskIds: ["mission-1"],
        allTaskIds: ["mission-1", "mission-2"],
      })
    ).toEqual({
      nextSearch: "",
      focusTaskId: "mission-2",
      highlightTaskId: "mission-2",
    });
  });

  it("keeps the current search when the mission is already visible", () => {
    expect(
      resolveTaskHubLocationUpdate({
        missionId: "mission-2",
        currentSearch: "release",
        filteredTaskIds: ["mission-1", "mission-2"],
        allTaskIds: ["mission-1", "mission-2"],
      })
    ).toEqual({
      nextSearch: "release",
      focusTaskId: "mission-2",
      highlightTaskId: "mission-2",
    });
  });

  it("does nothing when the mission is not present in the task dataset", () => {
    expect(
      resolveTaskHubLocationUpdate({
        missionId: "mission-missing",
        currentSearch: "release",
        filteredTaskIds: ["mission-1", "mission-2"],
        allTaskIds: ["mission-1", "mission-2"],
      })
    ).toEqual({
      nextSearch: "release",
      focusTaskId: null,
      highlightTaskId: null,
    });
  });
});
