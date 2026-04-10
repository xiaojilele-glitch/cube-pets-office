import { describe, expect, it } from "vitest";

import { TaskDetailView } from "@/components/tasks/TaskDetailView";

describe("TaskDetailView", () => {
  it("exports a renderable component after mission cancel wiring", () => {
    expect(TaskDetailView).toBeTypeOf("function");
  });
});
