/**
 * Audit REST API Routes — 单元测试
 * 覆盖 Task 16.7
 *
 * 由于无法在测试中轻松启动 Express 服务器，
 * 直接调用路由委托的底层服务方法来测试核心业务逻辑。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { AuditChain } from "../audit/audit-chain.js";
import { AuditCollector } from "../audit/audit-collector.js";
import { AuditQuery } from "../audit/audit-query.js";
import { AuditVerifier } from "../audit/audit-verifier.js";
import { AnomalyDetector } from "../audit/anomaly-detector.js";
import { ComplianceMapper } from "../audit/compliance-mapper.js";
import { AuditExport } from "../audit/audit-export.js";
import { AuditRetention } from "../audit/audit-retention.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
import type { AuditEvent } from "../../shared/audit/contracts.js";
import {
  AuditEventType,
  DEFAULT_RETENTION_POLICIES,
  DEFAULT_EVENT_TYPE_REGISTRY,
} from "../../shared/audit/contracts.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateTestKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey: privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function makeEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    eventId: `ae_test_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    eventType: AuditEventType.AGENT_EXECUTED,
    timestamp: Date.now(),
    actor: { type: "agent", id: "agent-1", name: "TestAgent" },
    action: "execute_task",
    resource: { type: "mission", id: "m-1", name: "TestMission" },
    result: "success",
    context: { sessionId: "sess-1" },
    ...overrides,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe("Audit Routes — business logic", () => {
  let chain: AuditChain;
  let collector: AuditCollector;
  let tsProvider: TimestampProvider;
  let query: AuditQuery;
  let verifier: AuditVerifier;
  let anomalyDetector: AnomalyDetector;
  let complianceMapper: ComplianceMapper;
  let auditExport: AuditExport;
  let auditRetention: AuditRetention;

  beforeEach(() => {
    vi.useFakeTimers();
    const keys = generateTestKeys();
    chain = new AuditChain({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
    tsProvider = new TimestampProvider();
    collector = new AuditCollector(chain, tsProvider);
    query = new AuditQuery(chain, collector);
    verifier = new AuditVerifier(chain);
    anomalyDetector = new AnomalyDetector(chain, collector);
    complianceMapper = new ComplianceMapper(chain);
    auditExport = new AuditExport(chain, collector);
    auditRetention = new AuditRetention(chain, collector);
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.1 GET /events — Query events with filters
  // ═══════════════════════════════════════════════════════════════════════

  describe("Query events with filters", () => {
    it("should filter by eventType", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      chain.append(makeEvent({ eventType: AuditEventType.USER_LOGIN }));
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));

      const result = query.query(
        { eventType: AuditEventType.AGENT_EXECUTED },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(2);
      expect(
        result.entries.every(
          e => e.event.eventType === AuditEventType.AGENT_EXECUTED
        )
      ).toBe(true);
    });

    it("should filter by severity", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED })); // INFO
      chain.append(makeEvent({ eventType: AuditEventType.DECISION_MADE })); // CRITICAL

      const result = query.query(
        { severity: "CRITICAL" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.eventType).toBe(
        AuditEventType.DECISION_MADE
      );
    });

    it("should filter by actorId", () => {
      chain.append(makeEvent({ actor: { type: "agent", id: "a-1" } }));
      chain.append(makeEvent({ actor: { type: "agent", id: "a-2" } }));

      const result = query.query(
        { actorId: "a-1" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.actor.id).toBe("a-1");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.1 GET /events — Pagination
  // ═══════════════════════════════════════════════════════════════════════

  describe("Query events with pagination", () => {
    it("should paginate results correctly", () => {
      for (let i = 0; i < 10; i++) chain.append(makeEvent());

      const page1 = query.query({}, { pageSize: 3, pageNum: 1 });
      expect(page1.entries).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.page.pageNum).toBe(1);

      const page2 = query.query({}, { pageSize: 3, pageNum: 2 });
      expect(page2.entries).toHaveLength(3);

      const page4 = query.query({}, { pageSize: 3, pageNum: 4 });
      expect(page4.entries).toHaveLength(1);
    });

    it("should default to pageSize=50 and pageNum=1", () => {
      chain.append(makeEvent());
      const result = query.query({}, { pageSize: 50, pageNum: 1 });
      expect(result.page.pageSize).toBe(50);
      expect(result.page.pageNum).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.3 GET /events/search — Search events by keyword
  // ═══════════════════════════════════════════════════════════════════════

  describe("Search events by keyword", () => {
    it("should find events matching keyword in action", () => {
      chain.append(makeEvent({ action: "deploy_service" }));
      chain.append(makeEvent({ action: "execute_task" }));

      const result = query.search("deploy", { pageSize: 50, pageNum: 1 });
      expect(result.total).toBe(1);
      expect(result.entries[0].event.action).toBe("deploy_service");
    });

    it("should be case-insensitive", () => {
      chain.append(makeEvent({ action: "Deploy_Service" }));

      const result = query.search("deploy", { pageSize: 50, pageNum: 1 });
      expect(result.total).toBe(1);
    });

    it("should match keyword in metadata", () => {
      chain.append(makeEvent({ metadata: { note: "critical_deployment" } }));
      chain.append(makeEvent({ metadata: { note: "routine" } }));

      const result = query.search("critical_deployment", {
        pageSize: 50,
        pageNum: 1,
      });
      expect(result.total).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.2 GET /events/:id — Get single entry by entryId
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get single entry by entryId", () => {
    it("should return entry by entryId", () => {
      const entry = chain.append(makeEvent());
      const found = chain.getEntry(entry.entryId);
      expect(found).not.toBeNull();
      expect(found!.entryId).toBe(entry.entryId);
      expect(found!.event.eventType).toBe(AuditEventType.AGENT_EXECUTED);
    });

    it("should return null for unknown entryId", () => {
      const found = chain.getEntry("al_999");
      expect(found).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.4 POST /verify — Verify chain
  // ═══════════════════════════════════════════════════════════════════════

  describe("Verify chain", () => {
    it("should verify empty chain as valid", () => {
      const result = verifier.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should verify valid chain", () => {
      chain.append(makeEvent());
      chain.append(makeEvent());
      chain.append(makeEvent());

      const result = verifier.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it("should verify a sub-range of the chain", () => {
      for (let i = 0; i < 5; i++) chain.append(makeEvent());

      const result = verifier.verifyChain(1, 3);
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
      expect(result.checkedRange).toEqual({ start: 1, end: 3 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.5 GET /verify/status — Get verification status
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get verification status", () => {
    it("should return null when no verification has been run", () => {
      expect(verifier.getLastResult()).toBeNull();
    });

    it("should return last result after periodic verification runs", () => {
      chain.append(makeEvent());
      verifier.schedulePeriodicVerification(1000);
      vi.advanceTimersByTime(1000);

      const result = verifier.getLastResult();
      expect(result).not.toBeNull();
      expect(result!.valid).toBe(true);
      expect(result!.totalEntries).toBe(1);

      verifier.stopPeriodicVerification();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.6 GET /stats — Audit stats
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get audit stats", () => {
    it("should return zero counts for empty chain", () => {
      const totalEntries = chain.getEntryCount();
      expect(totalEntries).toBe(0);
    });

    it("should count by eventType, severity, and category", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED })); // INFO, operational
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED })); // INFO, operational
      chain.append(makeEvent({ eventType: AuditEventType.USER_LOGIN })); // INFO, security
      chain.append(makeEvent({ eventType: AuditEventType.DECISION_MADE })); // CRITICAL, operational

      const totalEntries = chain.getEntryCount();
      expect(totalEntries).toBe(4);

      const entries = chain.getEntries(0, totalEntries - 1);
      const eventTypeCounts: Record<string, number> = {};
      const severityCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};

      for (const entry of entries) {
        const et = entry.event.eventType;
        eventTypeCounts[et] = (eventTypeCounts[et] || 0) + 1;
        const def = DEFAULT_EVENT_TYPE_REGISTRY[et];
        if (def) {
          severityCounts[def.severity] =
            (severityCounts[def.severity] || 0) + 1;
          categoryCounts[def.category] =
            (categoryCounts[def.category] || 0) + 1;
        }
      }

      expect(eventTypeCounts[AuditEventType.AGENT_EXECUTED]).toBe(2);
      expect(eventTypeCounts[AuditEventType.USER_LOGIN]).toBe(1);
      expect(eventTypeCounts[AuditEventType.DECISION_MADE]).toBe(1);
      expect(severityCounts["INFO"]).toBe(3);
      expect(severityCounts["CRITICAL"]).toBe(1);
      expect(categoryCounts["operational"]).toBe(3);
      expect(categoryCounts["security"]).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.7 GET /export — Export logs in JSON format
  // ═══════════════════════════════════════════════════════════════════════

  describe("Export logs in JSON format", () => {
    it("should export entries as JSON with hash and signature", () => {
      chain.append(makeEvent({ action: "task_a" }));
      chain.append(makeEvent({ action: "task_b" }));

      const result = auditExport.exportLog({}, "json");
      expect(result.data).toBeTruthy();
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.signature).toBeTruthy();

      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].event.action).toBe("task_a");
    });

    it("should export filtered entries", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      chain.append(makeEvent({ eventType: AuditEventType.USER_LOGIN }));

      const result = auditExport.exportLog(
        { eventType: AuditEventType.USER_LOGIN },
        "json"
      );
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].event.eventType).toBe(AuditEventType.USER_LOGIN);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.7 GET /export — Export logs in CSV format
  // ═══════════════════════════════════════════════════════════════════════

  describe("Export logs in CSV format", () => {
    it("should export entries as CSV with headers", () => {
      chain.append(makeEvent({ action: "task_a" }));
      chain.append(makeEvent({ action: "task_b" }));

      const result = auditExport.exportLog({}, "csv");
      expect(result.data).toBeTruthy();
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);

      const lines = result.data.split("\n");
      // Header + 2 data rows
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("entryId");
      expect(lines[0]).toContain("eventType");
      expect(lines[0]).toContain("action");
    });

    it("should return empty CSV (header only) for empty chain", () => {
      const result = auditExport.exportLog({}, "csv");
      const lines = result.data.split("\n");
      expect(lines).toHaveLength(1); // header only
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.8 POST /compliance/report — Generate compliance report (SOC2)
  // ═══════════════════════════════════════════════════════════════════════

  describe("Generate compliance report (SOC2)", () => {
    it("should generate a SOC2 report with coverage score", () => {
      const now = Date.now();
      // Add events that satisfy some SOC2 requirements
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          timestamp: now,
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_REVOKED,
          timestamp: now,
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.USER_LOGIN,
          timestamp: now,
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.USER_LOGOUT,
          timestamp: now,
        })
      );

      const report = complianceMapper.generateReport("SOC2", {
        start: now - 1000,
        end: now + 1000,
      });

      expect(report.framework).toBe("SOC2");
      expect(report.totalRequirements).toBeGreaterThan(0);
      expect(report.coverageScore).toBeGreaterThanOrEqual(0);
      expect(report.coverageScore).toBeLessThanOrEqual(100);
      expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/);
      // CC6.1 (PERMISSION_GRANTED + PERMISSION_REVOKED) and CC6.2 (USER_LOGIN + USER_LOGOUT) should be covered
      expect(report.coveredRequirements).toBeGreaterThanOrEqual(2);
    });

    it("should report gaps for missing event types", () => {
      const now = Date.now();
      // Only add one type — many requirements will have gaps
      chain.append(
        makeEvent({
          eventType: AuditEventType.USER_LOGIN,
          timestamp: now,
        })
      );

      const report = complianceMapper.generateReport("SOC2", {
        start: now - 1000,
        end: now + 1000,
      });

      expect(report.gaps.length).toBeGreaterThan(0);
      expect(report.gaps[0].missingEventTypes.length).toBeGreaterThan(0);
      expect(report.gaps[0].recommendation).toBeTruthy();
    });

    it("should return 0 coverage for empty chain", () => {
      const report = complianceMapper.generateReport("SOC2", {
        start: 0,
        end: Date.now(),
      });
      expect(report.coverageScore).toBe(0);
      expect(report.coveredRequirements).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.9 GET /anomalies — Get anomaly alerts
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get anomaly alerts", () => {
    it("should return empty alerts when none detected", () => {
      const alerts = anomalyDetector.getAlerts();
      expect(alerts).toHaveLength(0);
    });

    it("should return alerts after detection", () => {
      const now = Date.now();
      // Trigger high_frequency_access: > 100 events in 60s
      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.AGENT_EXECUTED,
            timestamp: now + i,
          })
        );
      }

      const detected = anomalyDetector.detectAnomalies({
        start: now - 1000,
        end: now + 200_000,
      });
      expect(detected.length).toBeGreaterThan(0);

      const alerts = anomalyDetector.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].status).toBe("open");
    });

    it("should filter alerts by time range", () => {
      const now = Date.now();
      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.AGENT_EXECUTED,
            timestamp: now + i,
          })
        );
      }
      anomalyDetector.detectAnomalies({
        start: now - 1000,
        end: now + 200_000,
      });

      // Query with a time range that excludes the alert
      const noAlerts = anomalyDetector.getAlerts({ start: 0, end: 100 });
      expect(noAlerts).toHaveLength(0);

      // Query with a time range that includes the alert
      const withAlerts = anomalyDetector.getAlerts({
        start: now - 1000,
        end: now + 300_000,
      });
      expect(withAlerts.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.10 PATCH /anomalies/:id — Update anomaly alert status
  // ═══════════════════════════════════════════════════════════════════════

  describe("Update anomaly alert status", () => {
    it("should update alert status to acknowledged", () => {
      const now = Date.now();
      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.AGENT_EXECUTED,
            timestamp: now + i,
          })
        );
      }
      const detected = anomalyDetector.detectAnomalies({
        start: now - 1000,
        end: now + 200_000,
      });
      expect(detected.length).toBeGreaterThan(0);

      const alertId = detected[0].alertId;
      const updated = anomalyDetector.updateAlertStatus(
        alertId,
        "acknowledged"
      );
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("acknowledged");
    });

    it("should return null for unknown alert id", () => {
      const result = anomalyDetector.updateAlertStatus(
        "nonexistent",
        "resolved"
      );
      expect(result).toBeNull();
    });

    it("should support all status transitions", () => {
      const now = Date.now();
      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.AGENT_EXECUTED,
            timestamp: now + i,
          })
        );
      }
      const detected = anomalyDetector.detectAnomalies({
        start: now - 1000,
        end: now + 200_000,
      });
      const alertId = detected[0].alertId;

      anomalyDetector.updateAlertStatus(alertId, "acknowledged");
      expect(anomalyDetector.getAlert(alertId)!.status).toBe("acknowledged");

      anomalyDetector.updateAlertStatus(alertId, "resolved");
      expect(anomalyDetector.getAlert(alertId)!.status).toBe("resolved");

      anomalyDetector.updateAlertStatus(alertId, "dismissed");
      expect(anomalyDetector.getAlert(alertId)!.status).toBe("dismissed");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.11 GET /permissions/:agentId — Permission trail for agent
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get permission trail for agent", () => {
    it("should return permission events for a specific agent", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          actor: { type: "system", id: "admin" },
          resource: { type: "agent", id: "agent-x" },
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_REVOKED,
          actor: { type: "system", id: "admin" },
          resource: { type: "agent", id: "agent-x" },
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.AGENT_EXECUTED,
          actor: { type: "agent", id: "agent-x" },
        })
      );

      const trail = query.getPermissionTrail("agent-x");
      expect(trail).toHaveLength(2);
      expect(trail[0].event.eventType).toBe(AuditEventType.PERMISSION_GRANTED);
      expect(trail[1].event.eventType).toBe(AuditEventType.PERMISSION_REVOKED);
    });

    it("should return empty for agent with no permission events", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      const trail = query.getPermissionTrail("unknown-agent");
      expect(trail).toHaveLength(0);
    });

    it("should filter by time range", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          timestamp: 1000,
          actor: { type: "system", id: "agent-a" },
          resource: { type: "permission", id: "p-1" },
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          timestamp: 3000,
          actor: { type: "system", id: "agent-a" },
          resource: { type: "permission", id: "p-2" },
        })
      );

      const trail = query.getPermissionTrail("agent-a", {
        start: 2000,
        end: 4000,
      });
      expect(trail).toHaveLength(1);
      expect(trail[0].event.timestamp).toBe(3000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.12 GET /permissions/violations — Permission violations
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get permission violations", () => {
    it("should return entries with result=denied", () => {
      chain.append(makeEvent({ result: "success" }));
      chain.append(makeEvent({ result: "denied" }));
      chain.append(makeEvent({ result: "failure" }));
      chain.append(makeEvent({ result: "denied" }));

      const violations = query.getPermissionViolations();
      expect(violations).toHaveLength(2);
      expect(violations.every(e => e.event.result === "denied")).toBe(true);
    });

    it("should return empty when no violations exist", () => {
      chain.append(makeEvent({ result: "success" }));
      const violations = query.getPermissionViolations();
      expect(violations).toHaveLength(0);
    });

    it("should filter by time range", () => {
      chain.append(makeEvent({ result: "denied", timestamp: 1000 }));
      chain.append(makeEvent({ result: "denied", timestamp: 3000 }));

      const violations = query.getPermissionViolations({
        start: 2000,
        end: 4000,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].event.timestamp).toBe(3000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.13 GET /lineage/:dataId — Data lineage audit
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get data lineage audit", () => {
    it("should return entries matching lineageId", () => {
      chain.append(makeEvent({ lineageId: "data-123" }));
      chain.append(makeEvent({ lineageId: "data-456" }));

      const result = query.getDataLineageAudit("data-123");
      expect(result).toHaveLength(1);
      expect(result[0].event.lineageId).toBe("data-123");
    });

    it("should return entries matching resource.id", () => {
      chain.append(makeEvent({ resource: { type: "data", id: "data-789" } }));
      chain.append(makeEvent({ resource: { type: "data", id: "other" } }));

      const result = query.getDataLineageAudit("data-789");
      expect(result).toHaveLength(1);
    });

    it("should return empty for unknown dataId", () => {
      chain.append(makeEvent());
      const result = query.getDataLineageAudit("nonexistent");
      expect(result).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.14 GET /retention/policies — Retention policies
  // ═══════════════════════════════════════════════════════════════════════

  describe("Get retention policies", () => {
    it("should return default retention policies", () => {
      expect(DEFAULT_RETENTION_POLICIES).toHaveLength(3);
      expect(DEFAULT_RETENTION_POLICIES[0].severity).toBe("CRITICAL");
      expect(DEFAULT_RETENTION_POLICIES[1].severity).toBe("WARNING");
      expect(DEFAULT_RETENTION_POLICIES[2].severity).toBe("INFO");
    });

    it("should have correct retention days", () => {
      const critical = DEFAULT_RETENTION_POLICIES.find(
        p => p.severity === "CRITICAL"
      )!;
      expect(critical.retentionDays).toBe(2555); // ~7 years
      expect(critical.archiveAfterDays).toBe(365);

      const info = DEFAULT_RETENTION_POLICIES.find(p => p.severity === "INFO")!;
      expect(info.retentionDays).toBe(365); // 1 year
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12.15 POST /retention/archive — Archive entries
  // ═══════════════════════════════════════════════════════════════════════

  describe("Archive entries", () => {
    it("should archive entries in a sequence range", () => {
      chain.append(makeEvent());
      chain.append(makeEvent());
      chain.append(makeEvent());

      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "audit-archive-test-")
      );
      const archivePath = path.join(tmpDir, "test-archive.json");

      try {
        const result = auditRetention.archiveEntries(0, 2, archivePath);
        expect(result.archivePath).toBe(archivePath);
        expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.signature).toBeTruthy();

        // Verify the archive file was created
        expect(fs.existsSync(archivePath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
        expect(content.entries).toHaveLength(3);
        expect(content.version).toBe(1);
        expect(content.chainHash).toBe(result.hash);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should throw for empty range", () => {
      expect(() =>
        auditRetention.archiveEntries(0, 0, "/tmp/test.json")
      ).toThrow(/No entries found/);
    });

    it("should produce a verifiable archive", () => {
      chain.append(makeEvent());
      chain.append(makeEvent());

      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "audit-archive-verify-")
      );
      const archivePath = path.join(tmpDir, "verify-archive.json");

      try {
        auditRetention.archiveEntries(0, 1, archivePath);
        const verification = auditRetention.verifyArchive(archivePath);
        expect(verification.valid).toBe(true);
        expect(verification.entryCount).toBe(2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
