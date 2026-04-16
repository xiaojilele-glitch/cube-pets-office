import type {
  DecisionHistoryEntry,
  DecisionType,
  MissionDecisionResolved,
  MissionDecisionSubmission,
  MissionRecord,
} from "../../shared/mission/contracts.js";
import type { LineageCollectorLike } from "../../shared/runtime-agent.js";

// ─── Lineage Collector Integration (module-level, opt-in) ──────────────────

let _decisionLineageCollector: LineageCollectorLike | null = null;

export function setDecisionLineageCollector(
  collector: LineageCollectorLike | null
): void {
  _decisionLineageCollector = collector;
}

export function getDecisionLineageCollector(): LineageCollectorLike | null {
  return _decisionLineageCollector;
}

export function generateDecisionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `dec_${timestamp}_${random}`;
}

export interface MissionDecisionRuntime {
  getTask(id: string): MissionRecord | undefined;
  resumeMissionFromDecision(
    id: string,
    submission: { detail: string; progress?: number }
  ): MissionRecord | undefined;
}

export interface SubmitMissionDecisionOptions {
  idempotentIfNotWaiting?: boolean;
}

export interface MissionDecisionSuccess {
  ok: true;
  task: MissionRecord;
  decision: MissionDecisionResolved;
  detail: string;
  alreadyResolved?: boolean;
}

export interface MissionDecisionFailure {
  ok: false;
  statusCode: number;
  error: string;
}

export function formatMissionDecisionDetail(
  optionLabel: string | undefined,
  freeText: string | undefined
): string {
  if (optionLabel && freeText) {
    return `Decision received: ${optionLabel} - ${freeText}`;
  }
  if (optionLabel) return `Decision received: ${optionLabel}`;
  if (freeText) return `Decision received: ${freeText}`;
  return "Decision received";
}

export function describeMissionDecisionAlreadyProcessed(
  task: MissionRecord,
  decision: MissionDecisionResolved
): string {
  const selected =
    decision.optionLabel || decision.freeText || decision.optionId;
  if (task.status === "done") {
    return selected
      ? `Decision already processed (${selected}); mission is complete`
      : "Decision already processed; mission is complete";
  }
  if (task.status === "failed") {
    return selected
      ? `Decision already processed (${selected}); mission has ended`
      : "Decision already processed; mission has ended";
  }
  return selected
    ? `Decision already processed (${selected}); mission has resumed`
    : "Decision already processed; mission has resumed";
}

export function submitMissionDecision(
  runtime: MissionDecisionRuntime,
  taskId: string,
  request: MissionDecisionSubmission,
  options: SubmitMissionDecisionOptions = {}
): MissionDecisionSuccess | MissionDecisionFailure {
  const task = runtime.getTask(taskId);
  if (!task) {
    return {
      ok: false,
      statusCode: 404,
      error: "Task not found",
    };
  }

  const optionId = request.optionId?.trim() || undefined;
  const freeText = request.freeText?.trim() || undefined;
  const decision: MissionDecisionResolved = {
    optionId,
    freeText,
  };

  if (task.status !== "waiting") {
    if (!options.idempotentIfNotWaiting) {
      return {
        ok: false,
        statusCode: 409,
        error: "Task is not waiting for a decision",
      };
    }

    return {
      ok: true,
      task,
      decision,
      detail: describeMissionDecisionAlreadyProcessed(task, decision),
      alreadyResolved: true,
    };
  }

  const prompt = task.decision;
  const selectedOption = optionId
    ? prompt?.options.find(option => option.id === optionId)
    : undefined;

  if (optionId && !selectedOption) {
    return {
      ok: false,
      statusCode: 400,
      error: "Invalid decision option",
    };
  }

  if (selectedOption?.requiresComment && !freeText) {
    return {
      ok: false,
      statusCode: 400,
      error: "This option requires a comment",
    };
  }

  if (!optionId && !freeText) {
    return {
      ok: false,
      statusCode: 400,
      error: "optionId or freeText is required",
    };
  }

  if (freeText && prompt && prompt.allowFreeText !== true && !optionId) {
    return {
      ok: false,
      statusCode: 400,
      error: "This decision does not allow free text only submissions",
    };
  }

  if (
    freeText &&
    prompt &&
    prompt.allowFreeText !== true &&
    optionId &&
    !selectedOption?.requiresComment
  ) {
    return {
      ok: false,
      statusCode: 400,
      error: "This decision does not allow free text notes",
    };
  }

  const detail =
    request.detail?.trim() ||
    formatMissionDecisionDetail(selectedOption?.label, freeText);
  const updated = runtime.resumeMissionFromDecision(task.id, {
    detail,
    progress: request.progress ?? task.progress,
  });

  if (!updated) {
    return {
      ok: false,
      statusCode: 409,
      error: "Task decision could not be applied",
    };
  }

  const resolvedDecision: MissionDecisionResolved = {
    optionId: selectedOption?.id,
    optionLabel: selectedOption?.label,
    freeText,
  };

  // Build DecisionHistoryEntry and append to decisionHistory
  const historyEntry: DecisionHistoryEntry = {
    decisionId: prompt?.decisionId || generateDecisionId(),
    type: (prompt?.type ?? "custom-action") as DecisionType,
    prompt: prompt?.prompt ?? "",
    options: prompt?.options ?? [],
    templateId: prompt?.templateId,
    payload: prompt?.payload,
    resolved: resolvedDecision,
    submittedAt: Date.now(),
    reason: freeText,
    stageKey: task.currentStageKey,
  };

  if (!updated.decisionHistory) {
    updated.decisionHistory = [];
  }
  updated.decisionHistory.push(historyEntry);

  // Lineage hook: record decision lineage after successful submission
  try {
    const collector = _decisionLineageCollector;
    if (collector?.recordDecision) {
      collector.recordDecision({
        decisionId: historyEntry.decisionId,
        agentId: undefined,
        inputLineageIds: [],
        result: optionId ?? freeText ?? "unknown",
        context: { missionId: taskId },
        metadata: {
          optionId,
          optionLabel: selectedOption?.label,
          freeText,
          type: historyEntry.type,
        },
      });
    }
  } catch {
    // Graceful degradation: lineage failure must not affect decision submission
  }

  return {
    ok: true,
    task: updated,
    detail,
    decision: resolvedDecision,
  };
}
