/**
 * RAG REST API 路由
 *
 * Requirements: 1.4, 3.6, 4.1, 6.5, 7.4, 8.4, 8.5, 9.6
 */

import { Router } from 'express';
import type { IngestionPayload } from '../../shared/rag/contracts.js';
import type { IngestionPipeline } from '../rag/ingestion/ingestion-pipeline.js';
import type { RAGRetriever } from '../rag/retrieval/rag-retriever.js';
import type { RAGPipeline } from '../rag/augmentation/rag-pipeline.js';
import type { FeedbackCollector } from '../rag/feedback/feedback-collector.js';
import type { LifecycleManager } from '../rag/lifecycle/lifecycle-manager.js';
import type { HealthChecker } from '../rag/observability/health-checker.js';
import type { RAGMetrics } from '../rag/observability/metrics.js';
import type { AugmentationLogger } from '../rag/augmentation/augmentation-logger.js';

export interface RAGRouteDeps {
  ingestionPipeline: IngestionPipeline;
  retriever: RAGRetriever;
  ragPipeline: RAGPipeline;
  feedbackCollector: FeedbackCollector;
  lifecycleManager: LifecycleManager;
  healthChecker: HealthChecker;
  metrics: RAGMetrics;
  augmentationLogger: AugmentationLogger;
}

export function createRAGRouter(deps: RAGRouteDeps): Router {
  const router = Router();

  // POST /api/rag/ingest
  router.post('/ingest', async (req, res) => {
    try {
      const payload = req.body?.payload as IngestionPayload;
      if (!payload?.sourceType || !payload?.sourceId || !payload?.content) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }
      const result = await deps.ingestionPipeline.ingest(payload);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /api/rag/ingest/batch
  router.post('/ingest/batch', async (req, res) => {
    try {
      const payloads = req.body?.payloads as IngestionPayload[];
      if (!Array.isArray(payloads)) {
        return res.status(400).json({ error: 'payloads must be an array' });
      }
      const result = await deps.ingestionPipeline.ingestBatch(payloads);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/search
  router.post('/search', async (req, res) => {
    try {
      const { query, options } = req.body;
      if (!query || !options?.projectId) {
        return res.status(400).json({ error: 'query and options.projectId required' });
      }
      const start = Date.now();
      const results = await deps.retriever.search(query, options);
      return res.json({
        results,
        totalCandidates: results.length,
        latencyMs: Date.now() - start,
        mode: options.mode ?? 'hybrid',
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/rag/feedback
  router.post('/feedback', (req, res) => {
    try {
      const { taskId, agentId, helpfulChunkIds, irrelevantChunkIds, missingContext } = req.body;
      if (!taskId || !agentId) {
        return res.status(400).json({ error: 'taskId and agentId required' });
      }
      deps.feedbackCollector.recordExplicit({
        taskId, agentId, projectId: req.body.projectId ?? '',
        helpfulChunkIds: helpfulChunkIds ?? [],
        irrelevantChunkIds: irrelevantChunkIds ?? [],
        missingContext,
      });
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/rag/feedback/stats
  router.get('/feedback/stats', (req, res) => {
    const stats = deps.feedbackCollector.getStats({
      projectId: req.query.projectId as string,
      since: req.query.since as string,
      until: req.query.until as string,
    });
    return res.json(stats);
  });

  // GET /api/workflows/:workflowId/tasks/:taskId/rag
  // Note: mounted at /api/rag but we handle the full path pattern
  router.get('/task-rag/:taskId', (req, res) => {
    const logs = deps.augmentationLogger.getByTaskId(req.params.taskId);
    return res.json({ logs });
  });

  // GET /api/admin/rag/health
  router.get('/admin/health', async (_req, res) => {
    try {
      const health = await deps.healthChecker.check();
      return res.json(health);
    } catch (err) {
      return res.status(500).json({ status: 'unhealthy', error: String(err) });
    }
  });

  // POST /api/admin/rag/purge
  router.post('/admin/purge', async (req, res) => {
    try {
      const result = await deps.lifecycleManager.purge({
        projectId: req.body.projectId,
        sourceType: req.body.sourceType,
        before: req.body.before,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/admin/rag/dlq
  router.get('/admin/dlq', async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const entries = await deps.ingestionPipeline.getDeadLetters({ limit, offset });
    return res.json({ entries, total: entries.length });
  });

  // POST /api/admin/rag/dlq/:entryId/retry
  router.post('/admin/dlq/:entryId/retry', async (req, res) => {
    try {
      const result = await deps.ingestionPipeline.retryDeadLetter(req.params.entryId);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/admin/rag/metrics
  router.get('/admin/metrics', (_req, res) => {
    return res.json(deps.metrics.snapshot());
  });

  // POST /api/admin/rag/reembed — placeholder
  router.post('/admin/reembed', (_req, res) => {
    return res.json({ message: 'Re-embedding not yet implemented' });
  });

  // POST /api/admin/rag/backfill — placeholder
  router.post('/admin/backfill', (_req, res) => {
    return res.json({ message: 'Backfill not yet implemented' });
  });

  return router;
}
