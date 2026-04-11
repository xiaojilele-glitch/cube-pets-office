import { describe, expect, it } from "vitest";

import {
  LEGACY_COMMAND_CENTER_LEGACY_PATH,
  LEGACY_COMMAND_CENTER_PATH,
  MORE_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  getPrimaryNavigationId,
  isLowFrequencyPath,
} from "../navigation-config";

describe("navigation convergence config", () => {
  it("keeps the primary navigation focused on office, tasks, and more", () => {
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
    expect(getPrimaryNavigationId("/lineage")).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_PATH)).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(
      "more"
    );
  });

  it("collects low-frequency destinations in the More drawer", () => {
    expect(MORE_NAV_ITEMS.map(item => item.id)).toEqual([
      "config",
      "permissions",
      "audit",
      "lineage",
      "help",
    ]);
    expect(MORE_NAV_ITEMS.find(item => item.id === "lineage")?.href).toBe(
      "/lineage"
    );
  });

  it("treats lineage and legacy command center routes as low-frequency paths", () => {
    expect(isLowFrequencyPath("/lineage")).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_PATH)).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(true);
    expect(isLowFrequencyPath("/tasks")).toBe(false);
  });
});
