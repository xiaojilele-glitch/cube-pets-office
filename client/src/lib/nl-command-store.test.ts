import { describe, expect, it } from "vitest";

import {
  selectTaskHubLaunchSession,
  type TaskHubCommandSubmissionResult,
} from "./nl-command-store";

describe("nl-command-store task hub launch session selector", () => {
  it("collects launch-session fields into a single unified entry slice", () => {
    const lastSubmission: TaskHubCommandSubmissionResult = {
      commandId: "cmd-1",
      commandText: "整理支付模块任务",
      missionId: "mission-1",
      relatedMissionIds: ["mission-1"],
      autoSelectedMissionId: "mission-1",
      status: "created",
      createdAt: Date.now(),
    };

    const session = selectTaskHubLaunchSession({
      commands: [
        {
          commandId: "cmd-1",
          commandText: "整理支付模块任务",
          userId: "user-1",
          timestamp: Date.now(),
          status: "executing",
          parsedIntent: "plan work",
          constraints: [],
          objectives: ["拆任务"],
          priority: "medium",
        },
      ],
      draftText: "继续推进",
      currentCommand: null,
      currentAnalysis: null,
      currentDialog: null,
      currentPlan: null,
      lastSubmission,
      loading: false,
      error: null,
    });

    expect(session.commands).toHaveLength(1);
    expect(session.commands[0]?.commandText).toBe("整理支付模块任务");
    expect(session.draftText).toBe("继续推进");
    expect(session.lastSubmission).toBe(lastSubmission);
    expect(session.loading).toBe(false);
    expect(session.error).toBeNull();
  });
});
