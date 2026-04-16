import { describe, expect, it } from "vitest";

import {
  isLowFrequencyPath,
  LEGACY_COMMAND_CENTER_LEGACY_PATH,
  LEGACY_COMMAND_CENTER_PATH,
  MORE_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  getPrimaryNavigationId,
} from "../navigation-config";

describe("navigation convergence config", () => {
  it("defines the three primary navigation items", () => {
    expect(PRIMARY_NAV_ITEMS.map(item => item.id)).toEqual([
      "office",
      "tasks",
      "more",
    ]);
  });

  it("maps routes into the converged primary paths", () => {
    expect(getPrimaryNavigationId("/")).toBe("office");
    expect(getPrimaryNavigationId("/tasks")).toBe("tasks");
    expect(getPrimaryNavigationId("/tasks/task-42")).toBe("tasks");
    expect(getPrimaryNavigationId("/debug")).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_PATH)).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(
      "more"
    );
  });

  it("collects low-frequency destinations in the More drawer", () => {
    expect(MORE_NAV_ITEMS.map(item => item.id)).toEqual([
      "help",
    ]);
  });

  it("treats debug and legacy command center routes as low-frequency paths", () => {
    expect(isLowFrequencyPath("/debug")).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_PATH)).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(true);
    expect(isLowFrequencyPath("/")).toBe(false);
    expect(isLowFrequencyPath("/tasks")).toBe(false);
  });
});
