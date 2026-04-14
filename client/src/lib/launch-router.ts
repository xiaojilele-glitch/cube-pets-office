import type { WorkflowInputAttachment } from "@shared/workflow-input";

export type LaunchRuntimeMode = "frontend" | "advanced";

export type LaunchRouteKind =
  | "clarify"
  | "mission"
  | "workflow"
  | "upgrade-required";

export type LaunchReason =
  | "command_too_short"
  | "missing_outcome"
  | "missing_timeline"
  | "missing_constraints"
  | "attachments_present"
  | "attachment_context_requested"
  | "team_or_workflow_requested"
  | "advanced_runtime_required"
  | "complete_task_brief";

export interface UnifiedLaunchInput {
  text: string;
  attachments?: WorkflowInputAttachment[];
  runtimeMode: LaunchRuntimeMode;
}

export interface LaunchRouteDecision {
  kind: LaunchRouteKind;
  reasons: LaunchReason[];
  requiresAdvancedRuntime: boolean;
  needsClarification: boolean;
  canOverride: boolean;
}

function normalizeLaunchText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasTimelineSignal(text: string): boolean {
  return /今天|明天|本周|本周内|下周|下周内|月底|本月|本季度|时间安排|排期|里程碑|timeline|截止|deadline|launch|release|ship|before|by\s+\w+/i.test(
    text
  );
}

function hasConstraintSignal(text: string): boolean {
  return /零停机|zero downtime|回滚|rollback|预算|budget|风险|risk|约束|constraint|兼容|compliance|sla|测试|test/i.test(
    text
  );
}

function hasOutcomeSignal(text: string): boolean {
  return /交付|deliverable|结果|outcome|验收|acceptance|完成标准|metric|指标|目标|success/i.test(
    text
  );
}

function requestsAttachmentContext(text: string): boolean {
  return /附件|文档|材料|表格|图片|ocr|pdf|excel|word|根据附件|基于附件|结合附件|from the attachment|from the document|using the file/i.test(
    text
  );
}

function requestsWorkflowOrTeamSetup(text: string): boolean {
  return /workflow|团队|小队|team|squad|工作包|brief|角色分工|组织团队|先组织|先拆分工/i.test(
    text
  );
}

function requiresAdvancedRuntime(text: string): boolean {
  return /运行命令|执行脚本|打开网页|浏览器|抓日志|容器|沙盒|sandbox|terminal|command|shell|docker|browser|screenshot|navigate/i.test(
    text
  );
}

export function evaluateLaunchRoute(
  input: UnifiedLaunchInput
): LaunchRouteDecision {
  const text = normalizeLaunchText(input.text);
  const attachments = input.attachments ?? [];
  const reasons: LaunchReason[] = [];

  const missingOutcome = !hasOutcomeSignal(text);
  const missingTimeline = !hasTimelineSignal(text);
  const missingConstraints = !hasConstraintSignal(text);
  const missingTopicsCount = [
    missingOutcome,
    missingTimeline,
    missingConstraints,
  ].filter(Boolean).length;
  const needsClarification =
    text.length < 20 ||
    missingTopicsCount >= 2 ||
    (text.length < 36 && missingTopicsCount >= 1);
  const wantsAttachmentContext = requestsAttachmentContext(text);
  const wantsWorkflowOrTeamSetup = requestsWorkflowOrTeamSetup(text);
  const wantsAdvancedRuntime = requiresAdvancedRuntime(text);

  if (text.length < 36) {
    reasons.push("command_too_short");
  }
  if (missingOutcome) {
    reasons.push("missing_outcome");
  }
  if (missingTimeline) {
    reasons.push("missing_timeline");
  }
  if (missingConstraints) {
    reasons.push("missing_constraints");
  }
  if (attachments.length > 0) {
    reasons.push("attachments_present");
  }
  if (wantsAttachmentContext) {
    reasons.push("attachment_context_requested");
  }
  if (wantsWorkflowOrTeamSetup) {
    reasons.push("team_or_workflow_requested");
  }
  if (wantsAdvancedRuntime) {
    reasons.push("advanced_runtime_required");
  }

  if (wantsAdvancedRuntime && input.runtimeMode === "frontend") {
    return {
      kind: "upgrade-required",
      reasons,
      requiresAdvancedRuntime: true,
      needsClarification,
      canOverride: false,
    };
  }

  if (needsClarification) {
    return {
      kind: "clarify",
      reasons,
      requiresAdvancedRuntime: wantsAdvancedRuntime,
      needsClarification: true,
      canOverride: false,
    };
  }

  if (attachments.length > 0 || wantsAttachmentContext || wantsWorkflowOrTeamSetup) {
    return {
      kind: "workflow",
      reasons,
      requiresAdvancedRuntime: wantsAdvancedRuntime,
      needsClarification: false,
      canOverride: true,
    };
  }

  return {
    kind: "mission",
    reasons: [...reasons, "complete_task_brief"],
    requiresAdvancedRuntime: wantsAdvancedRuntime,
    needsClarification: false,
    canOverride: true,
  };
}

