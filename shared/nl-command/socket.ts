import type {
  StrategicCommand,
  CommandAnalysis,
  ClarificationQuestion,
  MissionDecomposition,
  NLExecutionPlan,
  PlanAdjustment,
  Alert,
} from "./contracts.js";

/**
 * NL Command Center Socket.IO 事件常量与 payload 类型
 *
 * 所有事件由服务端推送至前端，用于实时状态同步。
 */

// ---------------------------------------------------------------------------
// 事件名常量
// ---------------------------------------------------------------------------

export const NL_COMMAND_SOCKET_EVENTS = {
  /** 指令创建 */
  commandCreated: "nl_command_created",
  /** 指令解析完成 */
  commandAnalysis: "nl_command_analysis",
  /** 澄清问题生成 */
  clarificationQuestion: "nl_clarification_question",
  /** 分解完成 */
  decompositionComplete: "nl_decomposition_complete",
  /** 执行计划生成 */
  planGenerated: "nl_plan_generated",
  /** 计划审批通过 */
  planApproved: "nl_plan_approved",
  /** 计划调整 */
  planAdjusted: "nl_plan_adjusted",
  /** 告警通知 */
  alert: "nl_alert",
  /** 进度更新 */
  progressUpdate: "nl_progress_update",
  /** 决策建议 */
  suggestion: "nl_suggestion",
} as const;

export type NLCommandSocketEventName =
  (typeof NL_COMMAND_SOCKET_EVENTS)[keyof typeof NL_COMMAND_SOCKET_EVENTS];

// ---------------------------------------------------------------------------
// 事件 Payload 类型
// ---------------------------------------------------------------------------

export interface NLCommandCreatedEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.commandCreated;
  issuedAt: number;
  command: StrategicCommand;
}

export interface NLCommandAnalysisEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.commandAnalysis;
  issuedAt: number;
  commandId: string;
  analysis: CommandAnalysis;
}

export interface NLClarificationQuestionEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.clarificationQuestion;
  issuedAt: number;
  commandId: string;
  questions: ClarificationQuestion[];
}

export interface NLDecompositionCompleteEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.decompositionComplete;
  issuedAt: number;
  commandId: string;
  decomposition: MissionDecomposition;
}

export interface NLPlanGeneratedEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.planGenerated;
  issuedAt: number;
  commandId: string;
  plan: NLExecutionPlan;
}

export interface NLPlanApprovedEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.planApproved;
  issuedAt: number;
  planId: string;
  approvedBy: string[];
}

export interface NLPlanAdjustedEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.planAdjusted;
  issuedAt: number;
  planId: string;
  adjustment: PlanAdjustment;
}

export interface NLAlertEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.alert;
  issuedAt: number;
  alert: Alert;
}

export interface NLProgressUpdateEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.progressUpdate;
  issuedAt: number;
  commandId: string;
  planId?: string;
  missionId?: string;
  taskId?: string;
  progress: number;
  status: string;
}

export interface NLSuggestionEvent {
  type: typeof NL_COMMAND_SOCKET_EVENTS.suggestion;
  issuedAt: number;
  planId: string;
  suggestionType: "risk" | "cost" | "resource";
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 统一 Payload 联合类型
// ---------------------------------------------------------------------------

export type NLCommandSocketPayload =
  | NLCommandCreatedEvent
  | NLCommandAnalysisEvent
  | NLClarificationQuestionEvent
  | NLDecompositionCompleteEvent
  | NLPlanGeneratedEvent
  | NLPlanApprovedEvent
  | NLPlanAdjustedEvent
  | NLAlertEvent
  | NLProgressUpdateEvent
  | NLSuggestionEvent;
