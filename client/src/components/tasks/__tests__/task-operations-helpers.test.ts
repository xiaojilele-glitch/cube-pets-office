import { describe, expect, it } from "vitest";

import type { MissionTaskDetail, TaskInteriorAgent } from "@/lib/tasks-store";
import type {
  MissionDecision,
  MissionOperatorActionRecord,
} from "@shared/mission/contracts";

import {
  deriveCurrentOwner,
  deriveNextStep,
  derivePrimaryActions,
  deriveTaskBlocker,
} from "../task-helpers";

function makeOperatorAction(
  overrides?: Partial<MissionOperatorActionRecord>
): MissionOperatorActionRecord {
  return {
    id: "action-1",
    action: "pause",
    createdAt: Date.now(),
    result: "completed",
    ...overrides,
  };
}

function makeDecision(overrides?: Partial<MissionDecision>): MissionDecision {
  return {
    prompt: "Approve the next execution step?",
    options: [
      {
        id: "approve",
        label: "Approve",
        description: "Continue execution",
      },
    ],
    allowFreeText: true,
    placeholder: "Add optional context",
    decisionId: "decision-1",
    ...overrides,
  };
}

function makeAgent(overrides?: Partial<TaskInteriorAgent>): TaskInteriorAgent {
  return {
    id: "agent-1",
    name: "Agent Alpha",
    role: "worker",
    department: "Engineering",
    title: "Executor",
    status: "working",
    stageKey: "execute",
    stageLabel: "Run execution",
    progress: 52,
    currentAction: "Producing the next artifact bundle.",
    angle: 0,
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<MissionTaskDetail>): MissionTaskDetail {
  return {
    id: "mission-1",
    title: "Mission Operations",
    kind: "analysis",
    sourceText: "Review and deliver the mission output.",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 48,
    currentStageKey: "execute",
    currentStageLabel: "Run execution",
    summary: "Mission is currently being executed.",
    waitingFor: null,
    blocker: null,
    attempt: 2,
    latestOperatorAction: null,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    startedAt: Date.now() - 45_000,
    completedAt: null,
    departmentLabels: ["Engineering"],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: "Executor is preparing the next artifact.",
    workflow: {
      id: "workflow-1",
      directive: "Review and deliver the mission output.",
      status: "running",
      current_stage: "execute",
      departments_involved: ["Engineering"],
      started_at: new Date(Date.now() - 45_000).toISOString(),
      completed_at: null,
      results: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [],
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: true,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    ...overrides,
  };
}

describe("task operation helper derivations", () => {
  it("derives waiting-state summaries when a decision is pending", () => {
    const detail = makeDetail({
      status: "waiting",
      workflowStatus: "running",
      waitingFor: "Approve release packaging before the runtime continues.",
      decisionPrompt: "Choose how the runtime should continue.",
      decisionPresets: [
        {
          id: "approve",
          label: "Approve",
          description: "Continue the mission",
          prompt: "Approve the next step",
          tone: "primary",
          action: "mission",
        },
      ],
      decision: makeDecision(),
    });

    const primary = derivePrimaryActions(detail);
    const owner = deriveCurrentOwner(detail);
    const blocker = deriveTaskBlocker(detail);
    const nextStep = deriveNextStep(detail);

    expect(primary.decisionRequired).toBe(true);
    expect(primary.recommended.map(action => action.key)).toContain(
      "submit-decision"
    );
    expect(primary.normalActions).toEqual(["mark-blocked"]);
    expect(owner.title).toBe("User decision required");
    expect(blocker.title).toBe("Waiting for decision");
    expect(nextStep.title).toBe("Submit the pending decision");
  });

  it("derives running-state summaries from the active agent and runtime", () => {
    const detail = makeDetail({
      status: "running",
      agents: [makeAgent()],
      executor: {
        name: "lobster",
        jobId: "job-1",
        status: "running",
      },
    });

    const primary = derivePrimaryActions(detail);
    const owner = deriveCurrentOwner(detail);
    const nextStep = deriveNextStep(detail);

    expect(primary.recommended.map(action => action.key)).toContain("pause");
    expect(owner.title).toBe("Agent Alpha");
    expect(owner.meta).toContain("Engineering");
    expect(nextStep.title).toBe("Wait for the next executor update");
  });

  it("prioritizes blocker summaries over waiting copy for blocked missions", () => {
    const detail = makeDetail({
      status: "waiting",
      operatorState: "blocked",
      waitingFor: "Still waiting for the next reviewer.",
      blocker: {
        reason: "Need PM sign-off before release.",
        createdAt: Date.now() - 120_000,
        createdBy: "ops-user",
      },
      latestOperatorAction: makeOperatorAction({
        action: "mark-blocked",
        requestedBy: "ops-user",
        reason: "Need PM sign-off before release.",
        detail: "Waiting on release approval.",
      }),
    });

    const primary = derivePrimaryActions(detail);
    const owner = deriveCurrentOwner(detail);
    const blocker = deriveTaskBlocker(detail);
    const nextStep = deriveNextStep(detail);

    expect(primary.recommended.map(action => action.key)).toContain("resume");
    expect(primary.normalActions).toEqual(["resume", "retry"]);
    expect(owner.title).toBe("ops-user");
    expect(blocker.title).toBe("Blocked");
    expect(blocker.detail).toContain("Need PM sign-off before release.");
    expect(nextStep.title).toBe("Resolve the blocker and resume mission");
  });

  it("derives paused-state summaries and resume guidance", () => {
    const detail = makeDetail({
      operatorState: "paused",
      latestOperatorAction: makeOperatorAction({
        action: "pause",
        requestedBy: "qa-reviewer",
        reason: "Pause until the verification notes are confirmed.",
      }),
    });

    const primary = derivePrimaryActions(detail);
    const blocker = deriveTaskBlocker(detail);
    const nextStep = deriveNextStep(detail);

    expect(primary.recommended.map(action => action.key)).toContain("resume");
    expect(blocker.title).toBe("Paused");
    expect(blocker.detail).toContain("Pause until the verification notes");
    expect(nextStep.title).toBe("Resume the mission when ready");
  });

  it("derives failure-state retry guidance", () => {
    const detail = makeDetail({
      status: "failed",
      workflowStatus: "failed",
      failureReasons: ["Artifact packaging step failed to upload."],
      lastSignal: "Artifact upload failed after executor completion.",
    });

    const primary = derivePrimaryActions(detail);
    const owner = deriveCurrentOwner(detail);
    const nextStep = deriveNextStep(detail);

    expect(primary.normalActions).toEqual(["retry"]);
    expect(owner.title).toBe("Human follow-up");
    expect(nextStep.title).toBe(
      "Review failure details and retry if appropriate"
    );
    expect(nextStep.detail).toContain("Artifact packaging step failed");
  });

  it("derives completed-state summaries with no active blocker", () => {
    const detail = makeDetail({
      status: "done",
      workflowStatus: "completed",
      completedAt: Date.now() - 180_000,
      artifacts: [
        {
          id: "artifact-1",
          title: "Mission Report",
          description: "Final report",
          kind: "report",
          format: "md",
          filename: "report.md",
          downloadKind: "server",
          downloadUrl: "/api/tasks/mission-1/artifacts/0/download",
          previewUrl: "/api/tasks/mission-1/artifacts/0/preview",
        },
      ],
    });

    const primary = derivePrimaryActions(detail);
    const owner = deriveCurrentOwner(detail);
    const blocker = deriveTaskBlocker(detail);
    const nextStep = deriveNextStep(detail);

    expect(primary.recommended).toHaveLength(0);
    expect(primary.passiveMessage).toContain("No manual action is needed");
    expect(owner.title).toBe("Mission complete");
    expect(blocker.title).toBe("No active blocker");
    expect(nextStep.title).toBe("Review deliverables and share the outcome");
  });
});
