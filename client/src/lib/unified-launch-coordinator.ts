import type { ClarificationAnswer } from "@shared/nl-command/contracts";
import type {
  SubmitCommandRequest,
  SubmitClarificationRequest,
} from "@shared/nl-command/api";

import {
  evaluateLaunchRoute,
  type LaunchRouteDecision,
  type UnifiedLaunchInput,
} from "./launch-router";
import {
  useNLCommandStore,
  type TaskHubCommandSubmissionResult,
} from "./nl-command-store";
import { useTasksStore } from "./tasks-store";
import { useWorkflowStore, type WorkflowLaunchResult } from "./workflow-store";

export interface UnifiedLaunchSubmitInput extends UnifiedLaunchInput {
  userId?: string;
  priority?: SubmitCommandRequest["priority"];
  timeframe?: SubmitCommandRequest["timeframe"];
  routeOverride?: "mission" | "workflow";
}

export type UnifiedLaunchResult =
  | {
      route: "mission";
      decision: LaunchRouteDecision;
      missionId: string | null;
      commandId: string;
      status: "created" | "needs_clarification";
    }
  | {
      route: "workflow";
      decision: LaunchRouteDecision;
      workflowId: string;
      missionId: string | null;
      status: "created";
      deduped: boolean;
    }
  | {
      route: "upgrade-required";
      decision: LaunchRouteDecision;
      upgraded: false;
    };

export interface UnifiedClarificationSubmitInput {
  commandId: string;
  answer: ClarificationAnswer;
}

function toMissionResult(
  decision: LaunchRouteDecision,
  submission: TaskHubCommandSubmissionResult
): UnifiedLaunchResult {
  return {
    route: "mission",
    decision,
    missionId: submission.missionId,
    commandId: submission.commandId,
    status: submission.status,
  };
}

function toWorkflowResult(
  decision: LaunchRouteDecision,
  submission: WorkflowLaunchResult
): UnifiedLaunchResult {
  return {
    route: "workflow",
    decision,
    workflowId: submission.workflowId,
    missionId: submission.missionId,
    status: "created",
    deduped: submission.deduped,
  };
}

function focusMissionIfAvailable(missionId: string | null) {
  if (!missionId) return;
  useTasksStore.getState().selectTask(missionId);
}

function resolveDecision(input: UnifiedLaunchSubmitInput): LaunchRouteDecision {
  const decision = evaluateLaunchRoute(input);
  if (!input.routeOverride) {
    return decision;
  }

  if (
    input.routeOverride === "mission" &&
    decision.kind !== "upgrade-required"
  ) {
    return {
      ...decision,
      kind: "mission",
      canOverride: true,
      needsClarification: decision.kind === "clarify",
    };
  }

  if (
    input.routeOverride === "workflow" &&
    decision.kind !== "upgrade-required"
  ) {
    return {
      ...decision,
      kind: "workflow",
      canOverride: true,
      needsClarification: false,
    };
  }

  return decision;
}

export async function submitUnifiedLaunch(
  input: UnifiedLaunchSubmitInput
): Promise<UnifiedLaunchResult> {
  const decision = resolveDecision(input);
  if (decision.kind === "upgrade-required") {
    return {
      route: "upgrade-required",
      decision,
      upgraded: false,
    };
  }

  if (decision.kind === "workflow") {
    const workflowResult = await useWorkflowStore.getState().submitDirective({
      directive: input.text,
      attachments: input.attachments ?? [],
    });
    if (!workflowResult) {
      throw new Error("Workflow launch failed.");
    }
    focusMissionIfAvailable(workflowResult.missionId);
    return toWorkflowResult(decision, workflowResult);
  }

  const missionSubmission = await useNLCommandStore
    .getState()
    .submitTaskHubCommand({
      commandText: input.text,
      userId: input.userId ?? "office-user",
      priority: input.priority,
      timeframe: input.timeframe,
      createMission: useTasksStore.getState().createMission,
    });

  focusMissionIfAvailable(missionSubmission.missionId);
  return toMissionResult(decision, missionSubmission);
}

export async function submitUnifiedClarification(
  input: UnifiedClarificationSubmitInput
): Promise<UnifiedLaunchResult | null> {
  const submission = await useNLCommandStore
    .getState()
    .submitTaskHubClarification(
      input.commandId,
      {
        answer: input.answer,
      },
      {
        createMission: useTasksStore.getState().createMission,
      }
    );

  if (!submission) {
    return null;
  }

  focusMissionIfAvailable(submission.missionId);
  return {
    route: "mission",
    decision: {
      kind: submission.status === "created" ? "mission" : "clarify",
      reasons: [],
      requiresAdvancedRuntime: false,
      needsClarification: submission.status !== "created",
      canOverride: false,
    },
    missionId: submission.missionId,
    commandId: submission.commandId,
    status: submission.status,
  };
}
