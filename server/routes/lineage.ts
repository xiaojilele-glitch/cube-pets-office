/**
 * 数据血缘追踪 REST API 路由
 *
 * 提供血缘查询、审计、导入导出、变更检测等 REST 接口。
 * 遵循 audit.ts 路由模式：factory function + stripPrefix + try/catch。
 *
 * Requirements: US-5, US-6, US-8, US-10
 */

import { Router } from "express";

import { LINEAGE_API } from "../../shared/lineage/api.js";
import type { LineageQueryService } from "../lineage/lineage-query.js";
import type { LineageAuditService } from "../lineage/lineage-audit.js";
import type { LineageExportService } from "../lineage/lineage-export.js";
import type { ChangeDetectionService } from "../lineage/change-detection.js";
import type { LineageStorageAdapter } from "../lineage/lineage-store.js";

// ---------------------------------------------------------------------------
// Route prefix — strip so we can mount at /api/lineage
// ---------------------------------------------------------------------------

const PREFIX = "/api/lineage";

function stripPrefix(routeDef: string): string {
  const path = routeDef.replace(/^[A-Z]+\s+/, "");
  return path.startsWith(PREFIX) ? path.slice(PREFIX.length) || "/" : path;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface LineageRouterDeps {
  queryService: LineageQueryService;
  auditService: LineageAuditService;
  exportService: LineageExportService;
  changeDetectionService: ChangeDetectionService;
  store: LineageStorageAdapter;
}

export function createLineageRouter(deps: LineageRouterDeps): Router {
  const {
    queryService,
    auditService,
    exportService,
    changeDetectionService,
    store,
  } = deps;
  const router = Router();

  // =====================================================================
  // Audit routes (specific paths BEFORE parameterized /:id routes)
  // =====================================================================

  // GET /audit/trail
  router.get(stripPrefix(LINEAGE_API.getAuditTrail), async (req, res) => {
    try {
      const userId = req.query.userId as string;
      const start = Number(req.query.start);
      const end = Number(req.query.end);
      if (!userId || isNaN(start) || isNaN(end)) {
        return res.status(400).json({ ok: false, error: "userId, start, and end are required" });
      }
      const entries = await auditService.getAuditTrail(userId, { start, end });
      res.json({ ok: true, entries });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /audit/report/:decisionId
  router.get(stripPrefix(LINEAGE_API.exportReport), async (req, res) => {
    try {
      const { decisionId } = req.params;
      const report = await auditService.exportLineageReport(decisionId);
      res.json({ ok: true, report });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /audit/anomalies
  router.get(stripPrefix(LINEAGE_API.detectAnomalies), async (req, res) => {
    try {
      const start = Number(req.query.start);
      const end = Number(req.query.end);
      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ ok: false, error: "start and end are required" });
      }
      const alerts = await auditService.detectAnomalies({ start, end });
      res.json({ ok: true, alerts });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // Static GET routes (BEFORE parameterized /:id routes)
  // =====================================================================

  // GET /path
  router.get(stripPrefix(LINEAGE_API.getFullPath), async (req, res) => {
    try {
      const sourceId = req.query.sourceId as string;
      const decisionId = req.query.decisionId as string;
      if (!sourceId || !decisionId) {
        return res.status(400).json({ ok: false, error: "sourceId and decisionId are required" });
      }
      const graph = await queryService.getFullPath(sourceId, decisionId);
      res.json({ ok: true, graph });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /export
  router.get(stripPrefix(LINEAGE_API.exportLineage), async (req, res) => {
    try {
      const startTime = Number(req.query.startTime);
      const endTime = Number(req.query.endTime);
      const format = (req.query.format as string) === "csv" ? "csv" : "json";
      if (isNaN(startTime) || isNaN(endTime)) {
        return res.status(400).json({ ok: false, error: "startTime and endTime are required" });
      }
      const data = await exportService.exportLineage(startTime, endTime, format);
      res.json({ ok: true, data: data.toString("utf-8") });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /stats
  router.get(stripPrefix(LINEAGE_API.getStats), async (_req, res) => {
    try {
      const stats = await store.getStats();
      res.json({ ok: true, stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /quality/:dataId
  router.get(stripPrefix(LINEAGE_API.getQualityMetrics), async (req, res) => {
    try {
      const { dataId } = req.params;
      const metrics = await changeDetectionService.measureQuality(dataId);
      res.json({ ok: true, metrics });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // POST routes
  // =====================================================================

  // POST /import
  router.post(stripPrefix(LINEAGE_API.importLineage), async (req, res) => {
    try {
      const { format, data } = req.body ?? {};
      if (!data) {
        return res.status(400).json({ ok: false, error: "data is required" });
      }
      const fmt = format === "csv" ? "csv" : "json";
      const buffer = Buffer.from(data, "utf-8");
      const result = await exportService.importLineage(buffer, fmt);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // POST /changes/detect
  router.post(stripPrefix(LINEAGE_API.detectChanges), async (req, res) => {
    try {
      const { sourceId } = req.body ?? {};
      if (!sourceId) {
        return res.status(400).json({ ok: false, error: "sourceId is required" });
      }
      const alert = await changeDetectionService.detectChanges(sourceId);
      res.json({ ok: true, alert });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // Parameterized /:id routes (AFTER all specific routes)
  // =====================================================================

  // GET /:id/upstream
  router.get(stripPrefix(LINEAGE_API.getUpstream), async (req, res) => {
    try {
      const depth = req.query.depth ? Number(req.query.depth) : undefined;
      const graph = await queryService.getUpstream(req.params.id, depth);
      res.json({ ok: true, graph });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /:id/downstream
  router.get(stripPrefix(LINEAGE_API.getDownstream), async (req, res) => {
    try {
      const depth = req.query.depth ? Number(req.query.depth) : undefined;
      const graph = await queryService.getDownstream(req.params.id, depth);
      res.json({ ok: true, graph });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /:id/impact
  router.get(stripPrefix(LINEAGE_API.getImpactAnalysis), async (req, res) => {
    try {
      const result = await queryService.getImpactAnalysis(req.params.id);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // GET /:id (LAST among GET /:id routes)
  router.get(stripPrefix(LINEAGE_API.getNode), async (req, res) => {
    try {
      const node = await store.getNode(req.params.id);
      if (!node) {
        return res.status(404).json({ ok: false, error: "Node not found" });
      }
      res.json({ ok: true, node });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // GET / (queryNodes — root route)
  // =====================================================================

  router.get(stripPrefix(LINEAGE_API.queryNodes), async (req, res) => {
    try {
      const filter: Record<string, unknown> = {};
      if (req.query.type) filter.type = req.query.type;
      if (req.query.agentId) filter.agentId = req.query.agentId;
      if (req.query.sessionId) filter.sessionId = req.query.sessionId;
      if (req.query.missionId) filter.missionId = req.query.missionId;
      if (req.query.decisionId) filter.decisionId = req.query.decisionId;
      if (req.query.fromTimestamp) filter.fromTimestamp = Number(req.query.fromTimestamp);
      if (req.query.toTimestamp) filter.toTimestamp = Number(req.query.toTimestamp);
      if (req.query.limit) filter.limit = Number(req.query.limit);
      const nodes = await store.queryNodes(filter);
      res.json({ ok: true, nodes });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}
