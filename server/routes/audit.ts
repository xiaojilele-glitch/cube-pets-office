/**
 * 审计链 REST API 路由
 *
 * 提供审计日志查询、验证、导出、合规报告、异常告警、权限审计、
 * 数据血缘、保留策略等 REST 接口。
 *
 * Requirements: US-6, US-7, US-8, US-9, US-10, US-11, US-13, US-14
 */

import { Router } from "express";

import { AUDIT_API } from "../../shared/audit/api.js";
import {
  DEFAULT_RETENTION_POLICIES,
  DEFAULT_EVENT_TYPE_REGISTRY,
} from "../../shared/audit/contracts.js";
import type { AuditQueryFilters, PageOptions, AuditEventType, AuditSeverity, AuditCategory, ComplianceFramework } from "../../shared/audit/contracts.js";
import type { AuditChain } from "../audit/audit-chain.js";
import type { AuditQuery } from "../audit/audit-query.js";
import type { AuditVerifier } from "../audit/audit-verifier.js";
import type { AnomalyDetector } from "../audit/anomaly-detector.js";
import type { ComplianceMapper } from "../audit/compliance-mapper.js";
import type { AuditExport } from "../audit/audit-export.js";
import type { AuditRetention } from "../audit/audit-retention.js";
import type { AuditCollector } from "../audit/audit-collector.js";

// ---------------------------------------------------------------------------
// Route prefix — strip so we can mount at /api/audit
// ---------------------------------------------------------------------------

const PREFIX = "/api/audit";

function stripPrefix(routeDef: string): string {
  const path = routeDef.replace(/^[A-Z]+\s+/, "");
  return path.startsWith(PREFIX) ? path.slice(PREFIX.length) || "/" : path;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface AuditRouterDeps {
  chain: AuditChain;
  query: AuditQuery;
  verifier: AuditVerifier;
  anomalyDetector: AnomalyDetector;
  complianceMapper: ComplianceMapper;
  auditExport: AuditExport;
  auditRetention: AuditRetention;
  collector: AuditCollector;
}

export function createAuditRouter(deps: AuditRouterDeps): Router {
  const {
    chain,
    query,
    verifier,
    anomalyDetector,
    complianceMapper,
    auditExport,
    auditRetention,
  } = deps;
  const router = Router();

  // =====================================================================
  // 12.3 GET /events/search — Full-text search (BEFORE :id)
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.searchEvents), (req, res) => {
    try {
      const keyword = (req.query.q as string) ?? "";
      const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
      const pageNum = parseInt(req.query.pageNum as string, 10) || 1;
      const page: PageOptions = { pageSize, pageNum };
      const result = query.search(keyword, page);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.2 GET /events/:id — Single audit log entry
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.getEvent), (req, res) => {
    try {
      const entry = chain.getEntry(req.params.id);
      if (!entry) {
        return res.status(404).json({ ok: false, error: "Audit entry not found" });
      }
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.1 GET /events — Query audit logs with filters + pagination
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.listEvents), (req, res) => {
    try {
      const filters = buildFilters(req.query);
      const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
      const pageNum = parseInt(req.query.pageNum as string, 10) || 1;
      const page: PageOptions = { pageSize, pageNum };
      const result = query.query(filters, page);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.4 POST /verify — Manual chain verification
  // =====================================================================

  router.post(stripPrefix(AUDIT_API.verify), (req, res) => {
    try {
      const { startSeq, endSeq } = req.body ?? {};
      const result = verifier.verifyChain(
        startSeq !== undefined ? Number(startSeq) : undefined,
        endSeq !== undefined ? Number(endSeq) : undefined,
      );
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.5 GET /verify/status — Latest verification result
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.verifyStatus), (_req, res) => {
    try {
      const result = verifier.getLastResult();
      if (!result) {
        return res.json({ ok: true, valid: null, message: "No verification has been run yet" });
      }
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.6 GET /stats — Audit statistics
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.stats), (_req, res) => {
    try {
      const totalEntries = chain.getEntryCount();
      const eventTypeCounts: Record<string, number> = {};
      const severityCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};

      if (totalEntries > 0) {
        const entries = chain.getEntries(0, totalEntries - 1);
        for (const entry of entries) {
          const et = entry.event.eventType;
          eventTypeCounts[et] = (eventTypeCounts[et] || 0) + 1;

          const def = DEFAULT_EVENT_TYPE_REGISTRY[et];
          if (def) {
            severityCounts[def.severity] = (severityCounts[def.severity] || 0) + 1;
            categoryCounts[def.category] = (categoryCounts[def.category] || 0) + 1;
          }
        }
      }

      res.json({ ok: true, totalEntries, eventTypeCounts, severityCounts, categoryCounts });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.7 GET /export — Export audit logs
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.exportLog), (req, res) => {
    try {
      const format = (req.query.format as string) === "csv" ? "csv" : "json";
      const filters = buildFilters(req.query);
      const result = auditExport.exportLog(filters, format);

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
      } else {
        res.setHeader("Content-Type", "application/json");
      }

      res.json({ ok: true, data: result.data, hash: result.hash, signature: result.signature });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.8 POST /compliance/report — Generate compliance report
  // =====================================================================

  router.post(stripPrefix(AUDIT_API.complianceReport), (req, res) => {
    try {
      const { framework, startTime, endTime } = req.body ?? {};
      if (!framework) {
        return res.status(400).json({ ok: false, error: "framework is required" });
      }
      const timeRange = {
        start: Number(startTime) || 0,
        end: Number(endTime) || Date.now(),
      };
      const report = complianceMapper.generateReport(framework as ComplianceFramework, timeRange);
      res.json({ ok: true, report });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.9 GET /anomalies — Get anomaly alerts
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.listAnomalies), (req, res) => {
    try {
      const startTime = req.query.startTime as string | undefined;
      const endTime = req.query.endTime as string | undefined;
      const timeRange = startTime && endTime
        ? { start: Number(startTime), end: Number(endTime) }
        : undefined;
      const alerts = anomalyDetector.getAlerts(timeRange);
      res.json({ ok: true, alerts });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.10 PATCH /anomalies/:id — Update alert status
  // =====================================================================

  router.patch(stripPrefix(AUDIT_API.updateAnomaly), (req, res) => {
    try {
      const { status } = req.body ?? {};
      if (!status) {
        return res.status(400).json({ ok: false, error: "status is required" });
      }
      const alert = anomalyDetector.updateAlertStatus(req.params.id, status);
      if (!alert) {
        return res.status(404).json({ ok: false, error: "Alert not found" });
      }
      res.json({ ok: true, alert });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.12 GET /permissions/violations — BEFORE :agentId
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.permissionViolations), (req, res) => {
    try {
      const startTime = req.query.startTime as string | undefined;
      const endTime = req.query.endTime as string | undefined;
      const timeRange = startTime && endTime
        ? { start: Number(startTime), end: Number(endTime) }
        : undefined;
      const entries = query.getPermissionViolations(timeRange);
      res.json({ ok: true, entries });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.11 GET /permissions/:agentId — Agent permission trail
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.permissionTrail), (req, res) => {
    try {
      const { agentId } = req.params;
      const startTime = req.query.startTime as string | undefined;
      const endTime = req.query.endTime as string | undefined;
      const timeRange = startTime && endTime
        ? { start: Number(startTime), end: Number(endTime) }
        : undefined;
      const entries = query.getPermissionTrail(agentId, timeRange);
      res.json({ ok: true, entries });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.13 GET /lineage/:dataId — Data lineage audit
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.dataLineage), (req, res) => {
    try {
      const entries = query.getDataLineageAudit(req.params.dataId);
      res.json({ ok: true, entries });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.14 GET /retention/policies — Get retention policies
  // =====================================================================

  router.get(stripPrefix(AUDIT_API.retentionPolicies), (_req, res) => {
    try {
      res.json({ ok: true, policies: DEFAULT_RETENTION_POLICIES });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  // =====================================================================
  // 12.15 POST /retention/archive — Manual archive trigger
  // =====================================================================

  router.post(stripPrefix(AUDIT_API.retentionArchive), (req, res) => {
    try {
      const { startSeq, endSeq, targetPath } = req.body ?? {};
      if (startSeq === undefined || endSeq === undefined) {
        return res.status(400).json({ ok: false, error: "startSeq and endSeq are required" });
      }
      const archivePath = targetPath ?? `data/audit/archive/manual_${startSeq}_${endSeq}_${Date.now()}.json`;
      const result = auditRetention.archiveEntries(Number(startSeq), Number(endSeq), archivePath);
      res.json({ ok: true, archivePath: result.archivePath, hash: result.hash, signature: result.signature });
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

/** Build AuditQueryFilters from query params */
function buildFilters(query: Record<string, unknown>): AuditQueryFilters {
  const filters: AuditQueryFilters = {};

  if (query.eventType) {
    const raw = query.eventType as string;
    const types = raw.includes(",") ? raw.split(",") : [raw];
    filters.eventType = types.length === 1
      ? types[0] as AuditEventType
      : types as AuditEventType[];
  }
  if (query.actorId) filters.actorId = query.actorId as string;
  if (query.actorType) filters.actorType = query.actorType as "user" | "agent" | "system";
  if (query.resourceType) filters.resourceType = query.resourceType as string;
  if (query.resourceId) filters.resourceId = query.resourceId as string;
  if (query.result) filters.result = query.result as "success" | "failure" | "denied" | "error";
  if (query.severity) filters.severity = query.severity as AuditSeverity;
  if (query.category) filters.category = query.category as AuditCategory;
  if (query.keyword) filters.keyword = query.keyword as string;

  const startTime = query.startTime as string | undefined;
  const endTime = query.endTime as string | undefined;
  if (startTime && endTime) {
    filters.timeRange = { start: Number(startTime), end: Number(endTime) };
  }

  return filters;
}
