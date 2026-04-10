import type {
  InteriorAgentStatus,
  InteriorStageStatus,
  MissionTaskDetail,
  MissionTaskStatus,
  TaskInteriorAgent,
  TaskArtifact,
  TimelineLevel,
} from "@/lib/tasks-store";
import type {
  MissionOperatorActionType,
  MissionOperatorState,
} from "@shared/mission/contracts";
import { cn } from "@/lib/utils";

export function formatTaskDate(value: number | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

export function formatTaskRelative(value: number | null): string {
  if (!value) return "n/a";
  const diff = Date.now() - value;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function compactText(
  value: string | null | undefined,
  maxLength = 120
): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

export function missionStatusLabel(status: MissionTaskStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function missionStatusTone(status: MissionTaskStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "waiting" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "queued" && "border-stone-200 bg-stone-50 text-stone-700",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700",
    status === "cancelled" && "border-slate-200 bg-slate-50 text-slate-700"
  );
}

export function isMissionTerminal(status: MissionTaskStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export function isMissionCancellable(status: MissionTaskStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting";
}

export function missionOperatorStateLabel(state: MissionOperatorState): string {
  switch (state) {
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "terminating":
      return "Terminating";
    case "active":
    default:
      return "Active";
  }
}

export function missionOperatorStateTone(state: MissionOperatorState): string {
  return cn(
    "border",
    state === "active" && "border-stone-200 bg-stone-50 text-stone-700",
    state === "paused" && "border-sky-200 bg-sky-50 text-sky-700",
    state === "blocked" && "border-amber-200 bg-amber-50 text-amber-700",
    state === "terminating" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export type TaskInsightTone =
  | "neutral"
  | "info"
  | "warning"
  | "danger"
  | "success";

export interface TaskInsightSummary {
  label: string;
  title: string;
  detail: string;
  meta?: string;
  tone: TaskInsightTone;
}

export interface TaskPrimaryActionChip {
  key: "submit-decision" | MissionOperatorActionType;
  label: string;
  description: string;
  tone: "primary" | "secondary" | "danger";
}

export interface DerivedPrimaryActions {
  recommended: TaskPrimaryActionChip[];
  normalActions: MissionOperatorActionType[];
  dangerousActions: MissionOperatorActionType[];
  passiveMessage: string | null;
  decisionRequired: boolean;
}

export function taskInsightToneClasses(tone: TaskInsightTone): string {
  return cn(
    "border",
    tone === "neutral" && "border-stone-200 bg-stone-50/80 text-stone-700",
    tone === "info" && "border-sky-200 bg-sky-50/85 text-sky-800",
    tone === "warning" && "border-amber-200 bg-amber-50/90 text-amber-900",
    tone === "danger" && "border-rose-200 bg-rose-50/90 text-rose-900",
    tone === "success" && "border-emerald-200 bg-emerald-50/85 text-emerald-800"
  );
}

export function missionOperatorActionLabel(
  action: MissionOperatorActionType
): string {
  switch (action) {
    case "pause":
      return "Pause";
    case "resume":
      return "Resume";
    case "retry":
      return "Retry";
    case "mark-blocked":
      return "Mark Blocked";
    case "terminate":
      return "Terminate";
  }
}

export function missionOperatorActionDescription(
  action: MissionOperatorActionType,
  detail: Pick<MissionTaskDetail, "status" | "attempt">
): string {
  switch (action) {
    case "pause":
      return detail.status === "queued"
        ? "Hold this mission before executor work starts."
        : "Pause the current mission without losing execution context.";
    case "resume":
      return "Return this mission to the active execution path.";
    case "retry":
      return `Queue a fresh attempt while keeping artifacts, timeline, and action history. Current attempt: ${detail.attempt}.`;
    case "mark-blocked":
      return "Flag the mission as blocked without ending it, so the team can see what needs follow-up.";
    case "terminate":
      return "Stop the mission by reusing the cancel flow. This is a terminal action.";
  }
}

function hasPendingDecision(detail: MissionTaskDetail): boolean {
  return (
    detail.status === "waiting" &&
    (detail.decision !== null || detail.decisionPresets.length > 0)
  );
}

function activeMissionAgent(
  agents: TaskInteriorAgent[]
): TaskInteriorAgent | undefined {
  return (
    agents.find(agent => agent.status === "working") ||
    agents.find(agent => agent.status === "thinking")
  );
}

function humanOperatorLabel(detail: MissionTaskDetail): string {
  return (
    detail.latestOperatorAction?.requestedBy ||
    detail.blocker?.createdBy ||
    "Human operator"
  );
}

export function availableMissionOperatorActions(
  status: MissionTaskStatus,
  operatorState: MissionOperatorState
): MissionOperatorActionType[] {
  if (status === "failed" || status === "cancelled") {
    return ["retry"];
  }

  if (operatorState === "terminating") {
    return [];
  }

  if (operatorState === "paused") {
    return ["resume", "terminate"];
  }

  if (operatorState === "blocked") {
    return ["resume", "retry", "terminate"];
  }

  if (status === "queued" || status === "running") {
    return ["pause", "mark-blocked", "terminate"];
  }

  if (status === "waiting") {
    return ["mark-blocked", "terminate"];
  }

  return [];
}

export function derivePrimaryActions(
  detail: MissionTaskDetail
): DerivedPrimaryActions {
  const operatorActions = availableMissionOperatorActions(
    detail.status,
    detail.operatorState
  );
  const decisionRequired = hasPendingDecision(detail);
  const normalActions = operatorActions.filter(
    action => action !== "terminate"
  );
  const dangerousActions = operatorActions.filter(
    action => action === "terminate"
  );

  const recommended: TaskPrimaryActionChip[] = [];

  if (decisionRequired) {
    recommended.push({
      key: "submit-decision",
      label: "Submit decision",
      description:
        compactText(
          detail.waitingFor ||
            detail.decisionPrompt ||
            detail.decision?.prompt ||
            "Review the pending decision and continue the mission.",
          120
        ) || "Review the pending decision and continue the mission.",
      tone: "primary",
    });
  }

  const recommendedOperatorAction =
    detail.operatorState === "blocked" && normalActions.includes("resume")
      ? "resume"
      : detail.operatorState === "paused" && normalActions.includes("resume")
        ? "resume"
        : (detail.status === "failed" || detail.status === "cancelled") &&
            normalActions.includes("retry")
          ? "retry"
          : detail.status === "running" && normalActions.includes("pause")
            ? "pause"
            : detail.status === "queued" && normalActions.includes("pause")
              ? "pause"
              : undefined;

  if (recommendedOperatorAction) {
    recommended.push({
      key: recommendedOperatorAction,
      label: missionOperatorActionLabel(recommendedOperatorAction),
      description: missionOperatorActionDescription(
        recommendedOperatorAction,
        detail
      ),
      tone: "secondary",
    });
  }

  const passiveMessage = decisionRequired
    ? "A pending decision needs attention in the first screen below."
    : operatorActions.length === 0
      ? detail.operatorState === "terminating"
        ? "Termination is already in progress. No further manual action is needed right now."
        : detail.status === "done"
          ? "No manual action is needed right now. Review the completed outcome below."
          : detail.status === "running"
            ? "The mission is currently running without a manual action requirement."
            : "The current state does not require manual intervention."
      : null;

  return {
    recommended,
    normalActions,
    dangerousActions,
    passiveMessage,
    decisionRequired,
  };
}

export function deriveCurrentOwner(
  detail: MissionTaskDetail
): TaskInsightSummary {
  const activeAgent = activeMissionAgent(detail.agents);

  if (hasPendingDecision(detail)) {
    return {
      label: "Current owner",
      title: "User decision required",
      detail:
        compactText(
          detail.waitingFor ||
            detail.decisionPrompt ||
            detail.decision?.prompt ||
            "Mission is waiting for manual input before it can continue.",
          140
        ) || "Mission is waiting for manual input before it can continue.",
      meta: detail.currentStageLabel || "Waiting",
      tone: "info",
    };
  }

  if (activeAgent) {
    return {
      label: "Current owner",
      title: activeAgent.name || roleLabel(activeAgent.role),
      detail:
        compactText(
          activeAgent.currentAction ||
            `${roleLabel(activeAgent.role)} is handling ${activeAgent.stageLabel}.`,
          140
        ) ||
        `${roleLabel(activeAgent.role)} is handling ${activeAgent.stageLabel}.`,
      meta: [activeAgent.department, activeAgent.stageLabel]
        .filter(Boolean)
        .join(" / "),
      tone: activeAgent.status === "thinking" ? "info" : "neutral",
    };
  }

  if (detail.operatorState === "blocked" || detail.operatorState === "paused") {
    return {
      label: "Current owner",
      title: humanOperatorLabel(detail),
      detail:
        detail.operatorState === "blocked"
          ? "Manual follow-up is currently holding this mission."
          : "Execution is paused under manual control.",
      meta:
        compactText(
          detail.latestOperatorAction?.detail ||
            detail.latestOperatorAction?.reason,
          120
        ) || undefined,
      tone: detail.operatorState === "blocked" ? "warning" : "info",
    };
  }

  if (
    detail.executor &&
    (detail.status === "queued" || detail.status === "running")
  ) {
    return {
      label: "Current owner",
      title: "Executor runtime",
      detail:
        compactText(
          detail.lastSignal ||
            `Executor ${detail.executor.status || "runtime"} is handling the current attempt.`,
          140
        ) ||
        `Executor ${detail.executor.status || "runtime"} is handling the current attempt.`,
      meta: [detail.executor.status, detail.currentStageLabel]
        .filter(Boolean)
        .join(" / "),
      tone: "neutral",
    };
  }

  if (detail.status === "failed") {
    return {
      label: "Current owner",
      title: "Human follow-up",
      detail: "A human should review the failure before retrying.",
      meta: detail.currentStageLabel || undefined,
      tone: "danger",
    };
  }

  if (detail.status === "done") {
    return {
      label: "Current owner",
      title: "Mission complete",
      detail: "No active owner is required right now.",
      meta:
        detail.completedAt !== null
          ? `Completed ${formatTaskRelative(detail.completedAt)}`
          : undefined,
      tone: "success",
    };
  }

  return {
    label: "Current owner",
    title: detail.currentStageLabel || "Mission coordination",
    detail: "The mission is waiting for the next runtime update.",
    meta: compactText(detail.lastSignal, 120) || undefined,
    tone: "neutral",
  };
}

export function deriveTaskBlocker(
  detail: MissionTaskDetail
): TaskInsightSummary {
  if (detail.blocker || detail.operatorState === "blocked") {
    return {
      label: "Blocker / waiting",
      title: "Blocked",
      detail:
        compactText(
          detail.blocker?.reason ||
            detail.latestOperatorAction?.reason ||
            detail.latestOperatorAction?.detail ||
            "Mission is blocked pending follow-up.",
          160
        ) || "Mission is blocked pending follow-up.",
      meta: detail.blocker?.createdBy
        ? `Added by ${detail.blocker.createdBy}`
        : detail.blocker?.createdAt
          ? `Added ${formatTaskRelative(detail.blocker.createdAt)}`
          : "Resolve the blocker before resuming execution.",
      tone: "warning",
    };
  }

  if (hasPendingDecision(detail) || detail.status === "waiting") {
    return {
      label: "Blocker / waiting",
      title: "Waiting for decision",
      detail:
        compactText(
          detail.waitingFor ||
            detail.decisionPrompt ||
            detail.decision?.prompt ||
            "Mission is waiting for manual input.",
          160
        ) || "Mission is waiting for manual input.",
      meta: hasPendingDecision(detail)
        ? "Decision required to continue"
        : detail.currentStageLabel || undefined,
      tone: "info",
    };
  }

  if (detail.operatorState === "paused") {
    return {
      label: "Blocker / waiting",
      title: "Paused",
      detail:
        compactText(
          detail.latestOperatorAction?.reason ||
            detail.latestOperatorAction?.detail ||
            "Mission is paused and can be resumed at any time.",
          160
        ) || "Mission is paused and can be resumed at any time.",
      meta: detail.latestOperatorAction?.requestedBy
        ? `Requested by ${detail.latestOperatorAction.requestedBy}`
        : undefined,
      tone: "info",
    };
  }

  return {
    label: "Blocker / waiting",
    title: detail.status === "done" ? "No active blocker" : "Clear to continue",
    detail:
      detail.status === "done"
        ? "This mission has completed without an active blocker."
        : "No blocker or waiting condition is recorded right now.",
    meta: compactText(detail.lastSignal, 120) || undefined,
    tone: detail.status === "done" ? "success" : "neutral",
  };
}

export function deriveNextStep(detail: MissionTaskDetail): TaskInsightSummary {
  if (detail.operatorState === "terminating") {
    return {
      label: "Next step",
      title: "Wait for termination to finish",
      detail: "The cancel flow is already in progress for this mission.",
      meta: compactText(detail.latestOperatorAction?.reason, 120) || undefined,
      tone: "warning",
    };
  }

  if (hasPendingDecision(detail)) {
    return {
      label: "Next step",
      title: "Submit the pending decision",
      detail:
        compactText(
          detail.decisionPrompt ||
            detail.waitingFor ||
            detail.decision?.prompt ||
            "Use the decision controls below to continue execution.",
          160
        ) || "Use the decision controls below to continue execution.",
      meta: "Decision required",
      tone: "info",
    };
  }

  if (detail.operatorState === "blocked") {
    return {
      label: "Next step",
      title: "Resolve the blocker and resume mission",
      detail: detail.blocker?.reason
        ? `Clear "${compactText(detail.blocker.reason, 80)}" and then resume or retry this attempt.`
        : "Resolve the blocker and then resume or retry this attempt.",
      meta: `Attempt ${detail.attempt}`,
      tone: "warning",
    };
  }

  if (detail.operatorState === "paused") {
    return {
      label: "Next step",
      title: "Resume the mission when ready",
      detail:
        "Execution context is preserved. Resume to continue from the current point.",
      meta: `Attempt ${detail.attempt}`,
      tone: "info",
    };
  }

  if (detail.status === "queued") {
    return {
      label: "Next step",
      title: "Wait for execution to start",
      detail: detail.executor?.jobId
        ? "The executor has already accepted the job and should start soon."
        : "The mission is queued for the next available runtime.",
      meta: detail.currentStageLabel || "Queued",
      tone: "neutral",
    };
  }

  if (detail.status === "running") {
    return {
      label: "Next step",
      title: detail.executor
        ? "Wait for the next executor update"
        : "Let the current stage continue",
      detail:
        compactText(
          detail.lastSignal ||
            detail.waitingFor ||
            (detail.executor
              ? "The runtime is still working and will publish the next artifact or signal."
              : "The mission is progressing automatically through the current stage."),
          160
        ) ||
        (detail.executor
          ? "The runtime is still working and will publish the next artifact or signal."
          : "The mission is progressing automatically through the current stage."),
      meta: detail.currentStageLabel || undefined,
      tone: "neutral",
    };
  }

  if (detail.status === "failed") {
    return {
      label: "Next step",
      title: "Review failure details and retry if appropriate",
      detail:
        compactText(
          detail.failureReasons[0] ||
            "The mission stopped before it could complete.",
          160
        ) || "The mission stopped before it could complete.",
      meta: `Attempt ${detail.attempt}`,
      tone: "danger",
    };
  }

  if (detail.status === "cancelled") {
    return {
      label: "Next step",
      title: "Decide whether to retry this attempt",
      detail:
        "The mission was cancelled. Retry to queue a new attempt when you're ready.",
      meta: `Attempt ${detail.attempt}`,
      tone: "warning",
    };
  }

  return {
    label: "Next step",
    title: "Review artifacts and share the outcome",
    detail:
      detail.artifacts.length > 0
        ? `There are ${detail.artifacts.length} linked artifacts ready for review.`
        : "The mission completed successfully and is ready for handoff.",
    meta:
      detail.completedAt !== null
        ? `Completed ${formatTaskRelative(detail.completedAt)}`
        : undefined,
    tone: "success",
  };
}

export function timelineTone(level: TimelineLevel): string {
  return cn(
    "border",
    level === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    level === "info" && "border-sky-200 bg-sky-50 text-sky-700",
    level === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
    level === "error" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function stageTone(status: InteriorStageStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "pending" && "border-stone-200 bg-stone-50 text-stone-600",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function agentStatusLabel(status: InteriorAgentStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "working":
      return "Working";
    case "thinking":
      return "Thinking";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

export function agentStatusTone(status: InteriorAgentStatus): string {
  return cn(
    "border",
    status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "working" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "thinking" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "idle" && "border-stone-200 bg-stone-50 text-stone-600",
    status === "error" && "border-rose-200 bg-rose-50 text-rose-700"
  );
}

export function roleLabel(role: string): string {
  if (role === "ceo") return "CEO";
  if (role === "manager") return "Manager";
  if (role === "worker") return "Worker";
  return role;
}

export function artifactActionLabel(artifact: TaskArtifact): string {
  if (artifact.kind === "attachment") return "Download attachment";
  if (artifact.downloadKind === "external") {
    return artifact.kind === "url" ? "Open link" : "Open artifact";
  }
  if (
    !artifact.href &&
    artifact.downloadKind !== "workflow" &&
    artifact.downloadKind !== "department"
  )
    return "View metadata";
  if (artifact.format === "md") return "Download markdown";
  return "Download report";
}

export function downloadAttachmentArtifact(artifact: TaskArtifact): boolean {
  if (!artifact.content || typeof window === "undefined") {
    return false;
  }

  const blob = new Blob([artifact.content], {
    type: artifact.mimeType || "text/plain;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename || "artifact.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  return true;
}
