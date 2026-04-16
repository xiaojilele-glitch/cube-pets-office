import { beforeEach, describe, expect, it, vi } from "vitest";

const { previewClarificationQuestions } = vi.hoisted(() => ({
  previewClarificationQuestions: vi.fn(),
}));

vi.mock("./nl-command-client", () => ({
  previewClarificationQuestions,
}));

import { useNLCommandStore } from "./nl-command-store";

function resetStore() {
  useNLCommandStore.setState({
    commands: [],
    currentCommand: null,
    currentAnalysis: null,
    currentDialog: null,
    currentFinalized: null,
    currentDecomposition: null,
    currentPlan: null,
    currentApproval: null,
    currentAdjustments: [],
    alerts: [],
    comments: [],
    dashboard: null,
    draftText: "",
    lastSubmission: null,
    loading: false,
    error: null,
  });
}

describe("nl-command-store clarification resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("lets the mission proceed when AI says no clarification is needed", async () => {
    previewClarificationQuestions.mockResolvedValue({
      needsClarification: false,
      questions: [],
    });
    const createMission = vi.fn().mockResolvedValue("mission-1");

    const result = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: "fix the homepage bug",
      userId: "user-1",
      createMission,
    });

    expect(result.status).toBe("created");
    expect(result.missionId).toBe("mission-1");
    expect(createMission).toHaveBeenCalledTimes(1);
    expect(useNLCommandStore.getState().currentDialog).toBeNull();
  });

  it("still falls back to local clarification when the preview request fails", async () => {
    previewClarificationQuestions.mockRejectedValue(
      new Error("preview unavailable")
    );
    const createMission = vi.fn().mockResolvedValue("mission-1");

    const result = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: "ship script today with rollback",
      userId: "user-1",
      createMission,
    });

    expect(result.status).toBe("needs_clarification");
    expect(createMission).not.toHaveBeenCalled();
    expect(
      useNLCommandStore.getState().currentDialog?.questions.length
    ).toBeGreaterThan(0);
  });

  it("falls back to local questions when AI asks for clarification but returns none", async () => {
    previewClarificationQuestions.mockResolvedValue({
      needsClarification: true,
      questions: [],
    });
    const createMission = vi.fn().mockResolvedValue("mission-1");

    const result = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: "ship script today with rollback",
      userId: "user-1",
      createMission,
    });

    expect(result.status).toBe("needs_clarification");
    expect(createMission).not.toHaveBeenCalled();
    expect(
      useNLCommandStore.getState().currentDialog?.questions.length
    ).toBeGreaterThan(0);
  });

  it("uses AI-generated choice questions when the preview returns dynamic options", async () => {
    previewClarificationQuestions.mockResolvedValue({
      needsClarification: true,
      questions: [
        {
          questionId: "timeline",
          text: "希望按哪个时间窗口推进？",
          type: "single_choice",
          options: ["今天内", "本周内", "时间灵活"],
        },
      ],
    });
    const createMission = vi.fn().mockResolvedValue("mission-1");

    const result = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: "optimize the office homepage and ship soon",
      userId: "user-1",
      createMission,
    });

    expect(result.status).toBe("needs_clarification");
    expect(createMission).not.toHaveBeenCalled();
    expect(useNLCommandStore.getState().currentDialog?.questions).toEqual([
      expect.objectContaining({
        questionId: "timeline",
        type: "single_choice",
        options: ["今天内", "本周内", "时间灵活"],
      }),
    ]);
  });
});
