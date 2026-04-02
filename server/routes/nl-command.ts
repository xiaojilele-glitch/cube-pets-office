/**
 * NL Command Center REST API 路由
 *
 * 实现所有 NL Command Center REST 端点。
 * 路由挂载在 /api/nl-command 基路径下。
 *
 * @see Requirements: 所有 API 相关需求
 */

import { Router } from 'express';

import type {
  SubmitCommandRequest,
  SubmitCommandResponse,
  ListCommandsRequest,
  ListCommandsResponse,
  GetCommandResponse,
  SubmitClarificationRequest,
  SubmitClarificationResponse,
  GetDialogResponse,
  GetPlanResponse,
  ApprovePlanRequest,
  ApprovePlanResponse,
  AdjustPlanRequest,
  AdjustPlanResponse,
  DashboardResponse,
  ListAlertsRequest,
  ListAlertsResponse,
  CreateAlertRuleRequest,
  CreateAlertRuleResponse,
  GetRisksResponse,
  GetSuggestionsResponse,
  ApplySuggestionRequest,
  ApplySuggestionResponse,
  AddCommentRequest,
  AddCommentResponse,
  ListCommentsRequest,
  ListCommentsResponse,
  GetReportResponse,
  GenerateReportRequest,
  GenerateReportResponse,
  ListHistoryRequest,
  ListHistoryResponse,
  ListTemplatesRequest,
  ListTemplatesResponse,
  SaveTemplateRequest,
  SaveTemplateResponse,
  ListAuditRequest,
  ListAuditResponse,
  ExportAuditRequest,
  ExportAuditResponse,
} from '../../shared/nl-command/api.js';

// ─── Dependency injection interface ───

/** Will be provided by the NLCommandOrchestrator (Task 18). */
export interface NLCommandRouterDeps {
  orchestrator?: unknown;
}

// ─── Helpers ───

function notImplemented(res: import('express').Response, endpoint: string) {
  res.status(501).json({ error: 'Not implemented', endpoint, message: 'Orchestrator not yet integrated' });
}

// ─── Router factory ───

export function createNLCommandRouter(deps: NLCommandRouterDeps = {}): Router {
  const router = Router();

  // ─── 1. POST /commands — Submit strategic command ───
  router.post('/commands', (req, res) => {
    try {
      const body = req.body as SubmitCommandRequest;
      if (!body?.commandText || !body?.userId) {
        res.status(400).json({ error: 'Bad request', message: 'commandText and userId are required' });
        return;
      }
      notImplemented(res, 'POST /commands');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 2. GET /commands — List commands ───
  router.get('/commands', (req, res) => {
    try {
      notImplemented(res, 'GET /commands');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 3. GET /commands/:id — Get command details ───
  router.get('/commands/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Command ID is required' });
        return;
      }
      notImplemented(res, 'GET /commands/:id');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 4. POST /commands/:id/clarify — Submit clarification answer ───
  router.post('/commands/:id/clarify', (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as SubmitClarificationRequest;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Command ID is required' });
        return;
      }
      if (!body?.answer?.questionId) {
        res.status(400).json({ error: 'Bad request', message: 'answer with questionId is required' });
        return;
      }
      notImplemented(res, 'POST /commands/:id/clarify');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 5. GET /commands/:id/dialog — Get clarification dialog ───
  router.get('/commands/:id/dialog', (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Command ID is required' });
        return;
      }
      notImplemented(res, 'GET /commands/:id/dialog');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 6. GET /plans/:id — Get execution plan ───
  router.get('/plans/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Plan ID is required' });
        return;
      }
      notImplemented(res, 'GET /plans/:id');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 7. POST /plans/:id/approve — Approve plan ───
  router.post('/plans/:id/approve', (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as ApprovePlanRequest;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Plan ID is required' });
        return;
      }
      if (!body?.approverId || !body?.decision) {
        res.status(400).json({ error: 'Bad request', message: 'approverId and decision are required' });
        return;
      }
      notImplemented(res, 'POST /plans/:id/approve');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 8. POST /plans/:id/adjust — Adjust plan ───
  router.post('/plans/:id/adjust', (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as AdjustPlanRequest;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Plan ID is required' });
        return;
      }
      if (!body?.reason || !Array.isArray(body?.changes)) {
        res.status(400).json({ error: 'Bad request', message: 'reason and changes array are required' });
        return;
      }
      notImplemented(res, 'POST /plans/:id/adjust');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 9. GET /dashboard — Dashboard data ───
  router.get('/dashboard', (req, res) => {
    try {
      notImplemented(res, 'GET /dashboard');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 10. GET /alerts — List alerts ───
  router.get('/alerts', (req, res) => {
    try {
      notImplemented(res, 'GET /alerts');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 11. POST /alerts/rules — Create alert rule ───
  router.post('/alerts/rules', (req, res) => {
    try {
      const body = req.body as CreateAlertRuleRequest;
      if (!body?.type || !body?.condition || !body?.priority) {
        res.status(400).json({ error: 'Bad request', message: 'type, condition, and priority are required' });
        return;
      }
      notImplemented(res, 'POST /alerts/rules');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 12. GET /plans/:id/risks — Risk analysis ───
  router.get('/plans/:id/risks', (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Plan ID is required' });
        return;
      }
      notImplemented(res, 'GET /plans/:id/risks');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 13. GET /plans/:id/suggestions — Optimization suggestions ───
  router.get('/plans/:id/suggestions', (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Plan ID is required' });
        return;
      }
      notImplemented(res, 'GET /plans/:id/suggestions');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 14. POST /plans/:id/apply-suggestion — Apply suggestion ───
  router.post('/plans/:id/apply-suggestion', (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body as ApplySuggestionRequest;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Plan ID is required' });
        return;
      }
      if (!body?.suggestionId) {
        res.status(400).json({ error: 'Bad request', message: 'suggestionId is required' });
        return;
      }
      notImplemented(res, 'POST /plans/:id/apply-suggestion');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 15. POST /comments — Add comment ───
  router.post('/comments', (req, res) => {
    try {
      const body = req.body as AddCommentRequest;
      if (!body?.entityId || !body?.entityType || !body?.authorId || !body?.content) {
        res.status(400).json({ error: 'Bad request', message: 'entityId, entityType, authorId, and content are required' });
        return;
      }
      notImplemented(res, 'POST /comments');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 16. GET /comments — List comments ───
  router.get('/comments', (req, res) => {
    try {
      const entityId = req.query.entityId as string | undefined;
      if (!entityId) {
        res.status(400).json({ error: 'Bad request', message: 'entityId query parameter is required' });
        return;
      }
      notImplemented(res, 'GET /comments');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 17. GET /reports/:id — Get report ───
  router.get('/reports/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Bad request', message: 'Report ID is required' });
        return;
      }
      notImplemented(res, 'GET /reports/:id');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 18. POST /reports/generate — Generate report ───
  router.post('/reports/generate', (req, res) => {
    try {
      const body = req.body as GenerateReportRequest;
      if (!body?.planId) {
        res.status(400).json({ error: 'Bad request', message: 'planId is required' });
        return;
      }
      notImplemented(res, 'POST /reports/generate');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 19. GET /history — Historical commands ───
  router.get('/history', (req, res) => {
    try {
      notImplemented(res, 'GET /history');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 20. GET /templates — List templates ───
  router.get('/templates', (req, res) => {
    try {
      notImplemented(res, 'GET /templates');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 21. POST /templates — Save template ───
  router.post('/templates', (req, res) => {
    try {
      const body = req.body as SaveTemplateRequest;
      if (!body?.planId || !body?.name || !body?.description || !body?.createdBy) {
        res.status(400).json({ error: 'Bad request', message: 'planId, name, description, and createdBy are required' });
        return;
      }
      notImplemented(res, 'POST /templates');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 22. GET /audit — Audit logs ───
  router.get('/audit', (req, res) => {
    try {
      notImplemented(res, 'GET /audit');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 23. POST /audit/export — Export audit logs ───
  router.post('/audit/export', (req, res) => {
    try {
      const body = req.body as ExportAuditRequest;
      if (!body?.filter || !body?.format) {
        res.status(400).json({ error: 'Bad request', message: 'filter and format are required' });
        return;
      }
      notImplemented(res, 'POST /audit/export');
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export default createNLCommandRouter();
