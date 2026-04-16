import { describe, expect, it, vi } from "vitest";

vi.mock("streamdown", () => ({
  Streamdown: () => null,
}));

import { TaskDetailView } from "@/components/tasks/TaskDetailView";

describe("TaskDetailView", () => {
  it("exports a renderable component after mission cancel wiring", () => {
    expect(TaskDetailView).toBeTypeOf("function");
  });
});
