/**
 * 自然语言指挥中心 REST API 路由常量与请求/响应类型
 *
 * 定义所有 NL Command Center REST 端点的路由常量、
 * 请求体（Request）和响应体（Response）类型。
 */

import type {
  StrategicCommand,
  CommandPriority,
  CommandConstraint,
  CommandTimeframe,
  CommandAnalysis,
  ClarificationQuestion,
  ClarificationDialog,
  ClarificationAnswer,
  FinalizedCommand,
  MissionDecomposition,
  NLExecutionPlan,
  PlanApprovalRequest,
  PlanAdjustment,
  AdjustmentImpact,
  Alert,
  AlertRule,
  AlertCondition,
  AlertType,
  AlertPriority,
  RiskAssessment,
  Comment,
  AuditEntry,
  AuditQueryFilter,
  AuditOperationType,
  ExecutionReport,
  PlanTemplate,
} from "./contracts.js";

// ─────────────────────────────────────────────────────────────────────────────
// 路由常量
// ─────────────────────────────────────────────────────────────────────────────

export const NL_COMMAND_API_BASE = "/api/nl-command" as const;

export const NL_COMMAND_API_ROUTES = {
  // 指令管理
  commands: `${NL_COMMAND_API_BASE}/commands`,
  commandById: (id: string) => `${NL_COMMAND_API_BASE}/commands/${id}`,

  // 澄清对话
  clarificationPreview: `${NL_COMMAND_API_BASE}/clarification-preview`,
  commandClarify: (id: string) => `${NL_COMMAND_API_BASE}/commands/${id}/clarify`,
  commandDialog: (id: string) => `${NL_COMMAND_API_BASE}/commands/${id}/dialog`,

  // 执行计划
  planById: (id: string) => `${NL_COMMAND_API_BASE}/plans/${id}`,
  planApprove: (id: string) => `${NL_COMMAND_API_BASE}/plans/${id}/approve`,
  planAdjust: (id: string) => `${NL_COMMAND_API_BASE}/plans/${id}/adjust`,

  // 监控与告警
  dashboard: `${NL_COMMAND_API_BASE}/dashboard`,
  alerts: `${NL_COMMAND_API_BASE}/alerts`,
  alertRules: `${NL_COMMAND_API_BASE}/alerts/rules`,

  // 决策支持
  planRisks: (id: string) => `${NL_COMMAND_API_BASE}/plans/${id}/risks`,
  planSuggestions: (id: string) => `${NL_COMMAND_API_BASE}/plans/${id}/suggestions`,
  planApplySuggestion: (id: string) =>
    `${NL_COMMAND_API_BASE}/plans/${id}/apply-suggestion`,

  // 协作
  comments: `${NL_COMMAND_API_BASE}/comments`,

  // 报告
  reportById: (id: string) => `${NL_COMMAND_API_BASE}/reports/${id}`,
  reportsGenerate: `${NL_COMMAND_API_BASE}/reports/generate`,

  // 历史与模板
  history: `${NL_COMMAND_API_BASE}/history`,
  templates: `${NL_COMMAND_API_BASE}/templates`,

  // 审计
  audit: `${NL_COMMAND_API_BASE}/audit`,
  auditExport: `${NL_COMMAND_API_BASE}/audit/export`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 指令管理 — POST /api/nl-command/commands
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmitCommandRequest {
  commandText: string;
  userId: string;
  priority?: CommandPriority;
  constraints?: CommandConstraint[];
  objectives?: string[];
  timeframe?: CommandTimeframe;
}

export interface SubmitCommandResponse {
  command: StrategicCommand;
  analysis: CommandAnalysis;
  needsClarification: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 指令管理 — GET /api/nl-command/commands
// ─────────────────────────────────────────────────────────────────────────────

export interface ListCommandsRequest {
  status?: StrategicCommand["status"];
  priority?: CommandPriority;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface ListCommandsResponse {
  commands: StrategicCommand[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 指令管理 — GET /api/nl-command/commands/:id
// ─────────────────────────────────────────────────────────────────────────────

export interface GetCommandResponse {
  command: StrategicCommand;
  analysis?: CommandAnalysis;
  finalized?: FinalizedCommand;
  decomposition?: MissionDecomposition;
  plan?: NLExecutionPlan;
}

export interface ClarificationPreviewRequest {
  commandText: string;
  userId: string;
  priority?: CommandPriority;
  timeframe?: CommandTimeframe;
  locale?: "zh-CN" | "en-US";
}

export interface ClarificationPreviewResponse {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 澄清对话 — POST /api/nl-command/commands/:id/clarify
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmitClarificationRequest {
  answer: ClarificationAnswer;
}

export interface SubmitClarificationResponse {
  dialog: ClarificationDialog;
  updatedAnalysis: CommandAnalysis;
  isComplete: boolean;
  finalized?: FinalizedCommand;
}

// ─────────────────────────────────────────────────────────────────────────────
// 澄清对话 — GET /api/nl-command/commands/:id/dialog
// ─────────────────────────────────────────────────────────────────────────────

export interface GetDialogResponse {
  dialog: ClarificationDialog;
}

// ─────────────────────────────────────────────────────────────────────────────
// 执行计划 — GET /api/nl-command/plans/:id
// ─────────────────────────────────────────────────────────────────────────────

export interface GetPlanResponse {
  plan: NLExecutionPlan;
  approval?: PlanApprovalRequest;
  adjustments?: PlanAdjustment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 执行计划 — POST /api/nl-command/plans/:id/approve
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovePlanRequest {
  approverId: string;
  decision: "approved" | "rejected" | "revision_requested";
  comments?: string;
}

export interface ApprovePlanResponse {
  approval: PlanApprovalRequest;
  plan: NLExecutionPlan;
}

// ─────────────────────────────────────────────────────────────────────────────
// 执行计划 — POST /api/nl-command/plans/:id/adjust
// ─────────────────────────────────────────────────────────────────────────────

export interface AdjustPlanRequest {
  reason: string;
  changes: {
    entityId: string;
    entityType: "mission" | "task" | "resource" | "timeline";
    field: string;
    newValue: unknown;
  }[];
}

export interface AdjustPlanResponse {
  adjustment: PlanAdjustment;
  updatedPlan: NLExecutionPlan;
}

// ─────────────────────────────────────────────────────────────────────────────
// 监控与告警 — GET /api/nl-command/dashboard
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardResponse {
  totalCommands: number;
  activeCommands: number;
  totalMissions: number;
  completedMissions: number;
  totalTasks: number;
  completedTasks: number;
  overallProgress: number;
  overallRiskLevel: "low" | "medium" | "high" | "critical";
  recentAlerts: Alert[];
  costSummary: {
    totalBudget: number;
    totalSpent: number;
    currency: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 监控与告警 — GET /api/nl-command/alerts
// ─────────────────────────────────────────────────────────────────────────────

export interface ListAlertsRequest {
  type?: AlertType;
  priority?: AlertPriority;
  acknowledged?: boolean;
  entityId?: string;
  limit?: number;
  offset?: number;
}

export interface ListAlertsResponse {
  alerts: Alert[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 监控与告警 — POST /api/nl-command/alerts/rules
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateAlertRuleRequest {
  type: AlertType;
  condition: AlertCondition;
  priority: AlertPriority;
  enabled?: boolean;
}

export interface CreateAlertRuleResponse {
  rule: AlertRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// 决策支持 — GET /api/nl-command/plans/:id/risks
// ─────────────────────────────────────────────────────────────────────────────

export interface GetRisksResponse {
  riskAssessment: RiskAssessment;
}

// ─────────────────────────────────────────────────────────────────────────────
// 决策支持 — GET /api/nl-command/plans/:id/suggestions
// ─────────────────────────────────────────────────────────────────────────────

export interface Suggestion {
  suggestionId: string;
  type: "cost" | "resource" | "timeline" | "risk";
  title: string;
  description: string;
  estimatedImpact: AdjustmentImpact;
  changes: AdjustPlanRequest["changes"];
}

export interface GetSuggestionsResponse {
  suggestions: Suggestion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 决策支持 — POST /api/nl-command/plans/:id/apply-suggestion
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplySuggestionRequest {
  suggestionId: string;
}

export interface ApplySuggestionResponse {
  adjustment: PlanAdjustment;
  updatedPlan: NLExecutionPlan;
}

// ─────────────────────────────────────────────────────────────────────────────
// 协作 — POST /api/nl-command/comments
// ─────────────────────────────────────────────────────────────────────────────

export interface AddCommentRequest {
  entityId: string;
  entityType: "command" | "mission" | "task" | "plan";
  authorId: string;
  content: string;
}

export interface AddCommentResponse {
  comment: Comment;
}

// ─────────────────────────────────────────────────────────────────────────────
// 协作 — GET /api/nl-command/comments
// ─────────────────────────────────────────────────────────────────────────────

export interface ListCommentsRequest {
  entityId: string;
  entityType?: "command" | "mission" | "task" | "plan";
  limit?: number;
  offset?: number;
}

export interface ListCommentsResponse {
  comments: Comment[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 报告 — GET /api/nl-command/reports/:id
// ─────────────────────────────────────────────────────────────────────────────

export interface GetReportResponse {
  report: ExecutionReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// 报告 — POST /api/nl-command/reports/generate
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateReportRequest {
  planId: string;
  sections?: ("summary" | "progress" | "cost" | "risk")[];
  format?: "json" | "markdown";
}

export interface GenerateReportResponse {
  report: ExecutionReport;
  exportedContent?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 历史与模板 — GET /api/nl-command/history
// ─────────────────────────────────────────────────────────────────────────────

export interface ListHistoryRequest {
  userId?: string;
  status?: StrategicCommand["status"];
  limit?: number;
  offset?: number;
}

export interface ListHistoryResponse {
  commands: StrategicCommand[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 历史与模板 — GET /api/nl-command/templates
// ─────────────────────────────────────────────────────────────────────────────

export interface ListTemplatesRequest {
  createdBy?: string;
  limit?: number;
  offset?: number;
}

export interface ListTemplatesResponse {
  templates: PlanTemplate[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 历史与模板 — POST /api/nl-command/templates
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveTemplateRequest {
  planId: string;
  name: string;
  description: string;
  createdBy: string;
}

export interface SaveTemplateResponse {
  template: PlanTemplate;
}

// ─────────────────────────────────────────────────────────────────────────────
// 审计 — GET /api/nl-command/audit
// ─────────────────────────────────────────────────────────────────────────────

export interface ListAuditRequest {
  startTime?: number;
  endTime?: number;
  operator?: string;
  operationType?: AuditOperationType;
  entityId?: string;
  limit?: number;
  offset?: number;
}

export interface ListAuditResponse {
  entries: AuditEntry[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 审计 — POST /api/nl-command/audit/export
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportAuditRequest {
  filter: AuditQueryFilter;
  format: "json";
}

export interface ExportAuditResponse {
  content: string;
  format: "json";
  entryCount: number;
}
