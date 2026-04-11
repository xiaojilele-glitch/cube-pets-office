import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNLCommandStore } from "./nl-command-store";

function resetNLCommandStore() {
  useNLCommandStore.getState().clearTaskHubSession();
  useNLCommandStore.setState({
    commands: [],
    alerts: [],
    comments: [],
    dashboard: null,
    currentApproval: null,
    currentAdjustments: [],
  });
}

describe("useNLCommandStore task-hub flow", () => {
  beforeEach(() => {
    resetNLCommandStore();
  });

  it("holds a vague command in clarification mode before creating a mission", async () => {
    const createMission = vi.fn(async () => "mission-clarify");

    const result = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: "Refactor payments",
      userId: "user-1",
      priority: "medium",
      createMission,
    });

    const state = useNLCommandStore.getState();

    expect(result.status).toBe("needs_clarification");
    expect(result.missionId).toBeNull();
    expect(createMission).not.toHaveBeenCalled();
    expect(state.currentDialog?.status).toBe("active");
    expect(state.currentDialog?.questions.length).toBeGreaterThan(0);
    expect(state.currentPlan?.status).toBe("draft");
    expect(state.lastSubmission?.status).toBe("needs_clarification");
  });

  it("creates a mission after the final clarification answer arrives", async () => {
    const createMission = vi.fn(async () => "mission-42");

    await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: "Refactor payments",
      userId: "user-1",
      priority: "medium",
      createMission,
    });

    const dialog = useNLCommandStore.getState().currentDialog;
    expect(dialog).not.toBeNull();

    for (const [index, question] of (dialog?.questions || []).entries()) {
      const result = await useNLCommandStore
        .getState()
        .submitTaskHubClarification(
          dialog!.commandId,
          {
            answer: {
              questionId: question.questionId,
              text: `Answer ${index + 1}`,
              timestamp: Date.now() + index,
            },
          },
          { createMission }
        );

      if (index < dialog!.questions.length - 1) {
        expect(result?.status).toBe("needs_clarification");
        expect(createMission).not.toHaveBeenCalled();
      }
    }

    const state = useNLCommandStore.getState();

    expect(createMission).toHaveBeenCalledTimes(1);
    expect(state.currentDialog?.status).toBe("completed");
    expect(state.currentFinalized?.refinedText).toContain("Extra context:");
    expect(state.currentPlan?.status).toBe("executing");
    expect(state.lastSubmission?.missionId).toBe("mission-42");
  });

  it("creates a mission immediately when the command already carries enough context", async () => {
    const createMission = vi.fn(async () => "mission-ready");

    const result = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText:
        "Refactor the payment module this week with zero downtime, rollback support, and a release handoff.",
      userId: "user-1",
      priority: "medium",
      createMission,
    });

    const state = useNLCommandStore.getState();

    expect(createMission).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("created");
    expect(result.missionId).toBe("mission-ready");
    expect(state.currentDialog).toBeNull();
    expect(state.currentPlan?.status).toBe("executing");
    expect(state.currentFinalized?.originalText).toContain("payment module");
  });
});
