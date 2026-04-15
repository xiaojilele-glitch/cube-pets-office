/**
 * NL Command Center REST API client.
 *
 * Typed functions wrapping fetch() for every NL Command endpoint.
 * Uses route constants and request/response types from shared/nl-command/api.ts.
 */

import {
  NL_COMMAND_API_ROUTES,
  type SubmitCommandRequest,
  type SubmitCommandResponse,
  type ListCommandsRequest,
  type ListCommandsResponse,
  type GetCommandResponse,
  type SubmitClarificationRequest,
  type SubmitClarificationResponse,
  type GetDialogResponse,
  type GetPlanResponse,
  type ApprovePlanRequest,
  type ApprovePlanResponse,
  type AdjustPlanRequest,
  type AdjustPlanResponse,
  type DashboardResponse,
  type ListAlertsRequest,
  type ListAlertsResponse,
  type CreateAlertRuleRequest,
  type CreateAlertRuleResponse,
  type GetRisksResponse,
  type GetSuggestionsResponse,
  type ApplySuggestionRequest,
  type ApplySuggestionResponse,
  type AddCommentRequest,
  type AddCommentResponse,
  type ListCommentsRequest,
  type ListCommentsResponse,
  type GetReportResponse,
  type GenerateReportRequest,
  type GenerateReportResponse,
  type ListHistoryRequest,
  type ListHistoryResponse,
  type ListTemplatesRequest,
  type ListTemplatesResponse,
  type SaveTemplateRequest,
  type SaveTemplateResponse,
  type ListAuditRequest,
  type ListAuditResponse,
  type ExportAuditRequest,
  type ExportAuditResponse,
} from "@shared/nl-command/api";

// ---------------------------------------------------------------------------
// Helpers (same pattern as mission-client.ts)
// ---------------------------------------------------------------------------

function withQuery(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const error =
      typeof data?.error === "string"
        ? data.error
        : `NL Command API ${response.status}`;
    throw new Error(error);
  }
  return data as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => parseJson<T>(r));
}

function get<T>(url: string): Promise<T> {
  return fetch(url).then((r) => parseJson<T>(r));
}

function toQueryRecord<T extends object>(
  value?: T,
): Record<string, string | number | boolean | null | undefined> | undefined {
  return value as unknown as
    | Record<string, string | number | boolean | null | undefined>
    | undefined;
}

// ---------------------------------------------------------------------------
// 指令管理
// ---------------------------------------------------------------------------

export function submitCommand(
  req: SubmitCommandRequest,
): Promise<SubmitCommandResponse> {
  return post(NL_COMMAND_API_ROUTES.commands, req);
}

export function listCommands(
  params?: ListCommandsRequest,
): Promise<ListCommandsResponse> {
  return get(withQuery(NL_COMMAND_API_ROUTES.commands, toQueryRecord(params)));
}

export function getCommand(id: string): Promise<GetCommandResponse> {
  return get(NL_COMMAND_API_ROUTES.commandById(id));
}

// ---------------------------------------------------------------------------
// 澄清对话
// ---------------------------------------------------------------------------

export function submitClarification(
  commandId: string,
  req: SubmitClarificationRequest,
): Promise<SubmitClarificationResponse> {
  return post(NL_COMMAND_API_ROUTES.commandClarify(commandId), req);
}

export function getDialog(commandId: string): Promise<GetDialogResponse> {
  return get(NL_COMMAND_API_ROUTES.commandDialog(commandId));
}

// ---------------------------------------------------------------------------
// 执行计划
// ---------------------------------------------------------------------------

export function getPlan(planId: string): Promise<GetPlanResponse> {
  return get(NL_COMMAND_API_ROUTES.planById(planId));
}

export function approvePlan(
  planId: string,
  req: ApprovePlanRequest,
): Promise<ApprovePlanResponse> {
  return post(NL_COMMAND_API_ROUTES.planApprove(planId), req);
}

export function adjustPlan(
  planId: string,
  req: AdjustPlanRequest,
): Promise<AdjustPlanResponse> {
  return post(NL_COMMAND_API_ROUTES.planAdjust(planId), req);
}

// ---------------------------------------------------------------------------
// 监控与告警
// ---------------------------------------------------------------------------

export function getDashboard(): Promise<DashboardResponse> {
  return get(NL_COMMAND_API_ROUTES.dashboard);
}

export function listAlerts(
  params?: ListAlertsRequest,
): Promise<ListAlertsResponse> {
  return get(withQuery(NL_COMMAND_API_ROUTES.alerts, toQueryRecord(params)));
}

export function createAlertRule(
  req: CreateAlertRuleRequest,
): Promise<CreateAlertRuleResponse> {
  return post(NL_COMMAND_API_ROUTES.alertRules, req);
}

// ---------------------------------------------------------------------------
// 决策支持
// ---------------------------------------------------------------------------

export function getRisks(planId: string): Promise<GetRisksResponse> {
  return get(NL_COMMAND_API_ROUTES.planRisks(planId));
}

export function getSuggestions(
  planId: string,
): Promise<GetSuggestionsResponse> {
  return get(NL_COMMAND_API_ROUTES.planSuggestions(planId));
}

export function applySuggestion(
  planId: string,
  req: ApplySuggestionRequest,
): Promise<ApplySuggestionResponse> {
  return post(NL_COMMAND_API_ROUTES.planApplySuggestion(planId), req);
}

// ---------------------------------------------------------------------------
// 协作
// ---------------------------------------------------------------------------

export function addComment(
  req: AddCommentRequest,
): Promise<AddCommentResponse> {
  return post(NL_COMMAND_API_ROUTES.comments, req);
}

export function listComments(
  params: ListCommentsRequest,
): Promise<ListCommentsResponse> {
  return get(withQuery(NL_COMMAND_API_ROUTES.comments, toQueryRecord(params)));
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

export function getReport(reportId: string): Promise<GetReportResponse> {
  return get(NL_COMMAND_API_ROUTES.reportById(reportId));
}

export function generateReport(
  req: GenerateReportRequest,
): Promise<GenerateReportResponse> {
  return post(NL_COMMAND_API_ROUTES.reportsGenerate, req);
}

// ---------------------------------------------------------------------------
// 历史与模板
// ---------------------------------------------------------------------------

export function listHistory(
  params?: ListHistoryRequest,
): Promise<ListHistoryResponse> {
  return get(withQuery(NL_COMMAND_API_ROUTES.history, toQueryRecord(params)));
}

export function listTemplates(
  params?: ListTemplatesRequest,
): Promise<ListTemplatesResponse> {
  return get(withQuery(NL_COMMAND_API_ROUTES.templates, toQueryRecord(params)));
}

export function saveTemplate(
  req: SaveTemplateRequest,
): Promise<SaveTemplateResponse> {
  return post(NL_COMMAND_API_ROUTES.templates, req);
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export function listAudit(
  params?: ListAuditRequest,
): Promise<ListAuditResponse> {
  return get(withQuery(NL_COMMAND_API_ROUTES.audit, toQueryRecord(params)));
}

export function exportAudit(
  req: ExportAuditRequest,
): Promise<ExportAuditResponse> {
  return post(NL_COMMAND_API_ROUTES.auditExport, req);
}
