import { describe, expect, it } from "vitest";

import { getMessages } from "./messages";

describe("execution language refresh copy", () => {
  it("uses execution-oriented workflow copy in zh-CN", () => {
    const copy = getMessages("zh-CN");

    expect(copy.workflow.directive.title).toBe("发布执行简报");
    expect(copy.workflow.directive.stepsTitle).toBe("执行协同流程");
    expect(copy.workflow.progress.noTasks).toBe("当前还没有可查看的执行任务。");
    expect(copy.tasks.listPage.title).toBe("任务执行台");
    expect(copy.tasks.detailPage.eyebrow).toBe("执行详情");
  });

  it("uses execution-oriented workflow copy in en-US", () => {
    const copy = getMessages("en-US");

    expect(copy.workflow.directive.title).toBe("Launch an execution brief");
    expect(copy.workflow.directive.stepsTitle).toBe(
      "Execution coordination flow"
    );
    expect(copy.workflow.progress.noTasks).toBe(
      "There are no execution tasks to inspect yet."
    );
    expect(copy.tasks.listPage.title).toBe("Mission Execution Desk");
    expect(copy.tasks.detailPage.eyebrow).toBe("Execution Detail");
  });
});
