/**
 * AnomalyDetector (审计链) 单元测试
 * 覆盖 Task 8.1 ~ 8.5
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { AnomalyDetector } from "../audit/anomaly-detector.js";
import { AuditChain } from "../audit/audit-chain.js";
import { AuditCollector } from "../audit/audit-collector.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
import type { AuditEvent, AnomalyRule } from "../../shared/audit/contracts.js";
import { AuditEventType } from "../../shared/audit/contracts.js";

// ─── 辅助：生成测试用 ECDSA-P256 密钥对 ────────────────────────────────────

function generateTestKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey: privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

// ─── 辅助：创建测试事件 ─────────────────────────────────────────────────────

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

describe("AnomalyDetector (Audit)", () => {
  let chain: AuditChain;
  let collector: AuditCollector;
  let detector: AnomalyDetector;
  let keys: { privateKey: string; publicKey: string };

  beforeEach(() => {
    keys = generateTestKeys();
    chain = new AuditChain({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
    const tsProvider = new TimestampProvider();
    collector = new AuditCollector(chain, tsProvider);
    detector = new AnomalyDetector(chain, collector);
  });

  // ─── 8.1 规则引擎框架 ──────────────────────────────────────────────────

  describe("8.1 Rule engine framework", () => {
    it("should load 5 built-in rules on construction", () => {
      const rules = detector.getRules();
      expect(rules).toHaveLength(5);
      const ruleIds = rules.map((r) => r.ruleId);
      expect(ruleIds).toContain("high_frequency_access");
      expect(ruleIds).toContain("off_hours_access");
      expect(ruleIds).toContain("privilege_escalation_abuse");
      expect(ruleIds).toContain("brute_force_pattern");
      expect(ruleIds).toContain("bulk_data_export");
    });

    it("should add a custom rule", () => {
      const customRule: AnomalyRule = {
        ruleId: "custom_rule",
        name: "Custom Rule",
        description: "A custom test rule",
        severity: "low",
        threshold: 10,
        timeWindowMs: 60_000,
        eventTypes: [AuditEventType.CONFIG_CHANGED],
        enabled: true,
      };
      detector.addRule(customRule);
      expect(detector.getRules()).toHaveLength(6);
      expect(detector.getRules().find((r) => r.ruleId === "custom_rule")).toBeTruthy();
    });

    it("should remove a rule by ruleId", () => {
      detector.removeRule("high_frequency_access");
      const rules = detector.getRules();
      expect(rules).toHaveLength(4);
      expect(rules.find((r) => r.ruleId === "high_frequency_access")).toBeUndefined();
    });

    it("should not throw when removing non-existent rule", () => {
      expect(() => detector.removeRule("nonexistent")).not.toThrow();
      expect(detector.getRules()).toHaveLength(5);
    });

    it("should overwrite rule with same ruleId", () => {
      const updated: AnomalyRule = {
        ruleId: "high_frequency_access",
        name: "Updated Rule",
        description: "Updated",
        severity: "critical",
        threshold: 50,
        timeWindowMs: 30_000,
        eventTypes: [AuditEventType.DATA_ACCESSED],
        enabled: true,
      };
      detector.addRule(updated);
      expect(detector.getRules()).toHaveLength(5);
      const rule = detector.getRules().find((r) => r.ruleId === "high_frequency_access");
      expect(rule?.name).toBe("Updated Rule");
      expect(rule?.threshold).toBe(50);
    });
  });

  // ─── 8.2 Built-in rules ───────────────────────────────────────────────

  describe("8.2 Built-in rules configuration", () => {
    it("high_frequency_access has correct config", () => {
      const rule = detector.getRules().find((r) => r.ruleId === "high_frequency_access");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("high");
      expect(rule!.threshold).toBe(100);
      expect(rule!.timeWindowMs).toBe(60_000);
      expect(rule!.eventTypes).toContain(AuditEventType.DATA_ACCESSED);
      expect(rule!.eventTypes).toContain(AuditEventType.AGENT_EXECUTED);
    });

    it("off_hours_access has correct config", () => {
      const rule = detector.getRules().find((r) => r.ruleId === "off_hours_access");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("medium");
      expect(rule!.threshold).toBe(1);
      expect(rule!.timeWindowMs).toBe(3_600_000);
    });

    it("privilege_escalation_abuse has correct config", () => {
      const rule = detector.getRules().find((r) => r.ruleId === "privilege_escalation_abuse");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("critical");
      expect(rule!.threshold).toBe(1);
      expect(rule!.timeWindowMs).toBe(300_000);
    });

    it("brute_force_pattern has correct config", () => {
      const rule = detector.getRules().find((r) => r.ruleId === "brute_force_pattern");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("high");
      expect(rule!.threshold).toBe(5);
      expect(rule!.timeWindowMs).toBe(300_000);
    });

    it("bulk_data_export has correct config", () => {
      const rule = detector.getRules().find((r) => r.ruleId === "bulk_data_export");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("medium");
      expect(rule!.threshold).toBe(1000);
      expect(rule!.timeWindowMs).toBe(3_600_000);
    });
  });

  // ─── 8.3 detectAnomalies() ─────────────────────────────────────────────

  describe("8.3 detectAnomalies()", () => {
    it("should return empty array when chain is empty", () => {
      const alerts = detector.detectAnomalies({ start: 0, end: Date.now() });
      expect(alerts).toEqual([]);
    });

    it("should detect high frequency access", () => {
      const now = Date.now();
      // Disable other rules to isolate this test
      for (const rule of detector.getRules()) {
        if (rule.ruleId !== "high_frequency_access") {
          detector.removeRule(rule.ruleId);
        }
      }

      // Append > 100 DATA_ACCESSED events
      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.DATA_ACCESSED,
            timestamp: now + i,
          }),
        );
      }

      const alerts = detector.detectAnomalies({ start: now - 1, end: now + 200 });
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const hfAlert = alerts.find((a) => a.ruleId === "high_frequency_access");
      expect(hfAlert).toBeDefined();
      expect(hfAlert!.severity).toBe("high");
      expect(hfAlert!.status).toBe("open");
      expect(hfAlert!.affectedEvents.length).toBe(105);
    });

    it("should NOT trigger high frequency when below threshold", () => {
      const now = Date.now();
      for (const rule of detector.getRules()) {
        if (rule.ruleId !== "high_frequency_access") {
          detector.removeRule(rule.ruleId);
        }
      }

      for (let i = 0; i < 50; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.DATA_ACCESSED,
            timestamp: now + i,
          }),
        );
      }

      const alerts = detector.detectAnomalies({ start: now - 1, end: now + 100 });
      expect(alerts).toHaveLength(0);
    });

    it("should detect brute force pattern", () => {
      const now = Date.now();
      for (const rule of detector.getRules()) {
        if (rule.ruleId !== "brute_force_pattern") {
          detector.removeRule(rule.ruleId);
        }
      }

      // 6 failures then 1 success
      for (let i = 0; i < 6; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.USER_LOGIN,
            timestamp: now + i * 1000,
            result: "failure",
            actor: { type: "user", id: "user-1" },
          }),
        );
      }
      chain.append(
        makeEvent({
          eventType: AuditEventType.USER_LOGIN,
          timestamp: now + 7000,
          result: "success",
          actor: { type: "user", id: "user-1" },
        }),
      );

      const alerts = detector.detectAnomalies({ start: now - 1, end: now + 10000 });
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const bfAlert = alerts.find((a) => a.ruleId === "brute_force_pattern");
      expect(bfAlert).toBeDefined();
      expect(bfAlert!.severity).toBe("high");
      expect(bfAlert!.description).toContain("6 failures");
    });

    it("should NOT trigger brute force when failures <= threshold", () => {
      const now = Date.now();
      for (const rule of detector.getRules()) {
        if (rule.ruleId !== "brute_force_pattern") {
          detector.removeRule(rule.ruleId);
        }
      }

      // Only 3 failures then success (threshold is 5)
      for (let i = 0; i < 3; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.USER_LOGIN,
            timestamp: now + i * 1000,
            result: "failure",
          }),
        );
      }
      chain.append(
        makeEvent({
          eventType: AuditEventType.USER_LOGIN,
          timestamp: now + 4000,
          result: "success",
        }),
      );

      const alerts = detector.detectAnomalies({ start: now - 1, end: now + 5000 });
      expect(alerts).toHaveLength(0);
    });

    it("should skip disabled rules", () => {
      const now = Date.now();
      // Disable all rules
      for (const rule of detector.getRules()) {
        detector.addRule({ ...rule, enabled: false });
      }

      for (let i = 0; i < 200; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.DATA_ACCESSED,
            timestamp: now + i,
          }),
        );
      }

      const alerts = detector.detectAnomalies({ start: now - 1, end: now + 300 });
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── 8.4 告警状态管理 ──────────────────────────────────────────────────

  describe("8.4 Alert status management", () => {
    function triggerAlert(): void {
      const now = Date.now();
      for (const rule of detector.getRules()) {
        if (rule.ruleId !== "high_frequency_access") {
          detector.removeRule(rule.ruleId);
        }
      }
      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.DATA_ACCESSED,
            timestamp: now + i,
          }),
        );
      }
      detector.detectAnomalies({ start: now - 1, end: now + 200 });
    }

    it("should store alerts and retrieve via getAlerts()", () => {
      triggerAlert();
      const alerts = detector.getAlerts();
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].alertId).toMatch(/^aa_\d+_[0-9a-f]{8}$/);
    });

    it("should retrieve alert by alertId", () => {
      triggerAlert();
      const alerts = detector.getAlerts();
      const alert = detector.getAlert(alerts[0].alertId);
      expect(alert).not.toBeNull();
      expect(alert!.alertId).toBe(alerts[0].alertId);
    });

    it("should return null for unknown alertId", () => {
      expect(detector.getAlert("aa_nonexistent")).toBeNull();
    });

    it("should filter alerts by timeRange", () => {
      triggerAlert();
      const now = Date.now();
      // All alerts should be recent
      const recent = detector.getAlerts({ start: now - 5000, end: now + 5000 });
      expect(recent.length).toBeGreaterThanOrEqual(1);

      // No alerts in far future
      const future = detector.getAlerts({ start: now + 100000, end: now + 200000 });
      expect(future).toHaveLength(0);
    });

    it("should update alert status to acknowledged", () => {
      triggerAlert();
      const alerts = detector.getAlerts();
      const updated = detector.updateAlertStatus(alerts[0].alertId, "acknowledged");
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("acknowledged");
    });

    it("should update alert status to resolved", () => {
      triggerAlert();
      const alerts = detector.getAlerts();
      const updated = detector.updateAlertStatus(alerts[0].alertId, "resolved");
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("resolved");
    });

    it("should update alert status to dismissed", () => {
      triggerAlert();
      const alerts = detector.getAlerts();
      const updated = detector.updateAlertStatus(alerts[0].alertId, "dismissed");
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("dismissed");
    });

    it("should return null when updating non-existent alert", () => {
      const result = detector.updateAlertStatus("aa_nonexistent", "resolved");
      expect(result).toBeNull();
    });
  });

  // ─── 8.5 告警写入审计链 ───────────────────────────────────────────────

  describe("8.5 ANOMALY_DETECTED event recording", () => {
    it("should record ANOMALY_DETECTED event when anomaly is detected", () => {
      const now = Date.now();
      for (const rule of detector.getRules()) {
        if (rule.ruleId !== "high_frequency_access") {
          detector.removeRule(rule.ruleId);
        }
      }

      for (let i = 0; i < 105; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.DATA_ACCESSED,
            timestamp: now + i,
          }),
        );
      }

      const countBefore = chain.getEntryCount();
      detector.detectAnomalies({ start: now - 1, end: now + 200 });

      // Flush the collector buffer to write the ANOMALY_DETECTED event
      collector.flush();

      const countAfter = chain.getEntryCount();
      expect(countAfter).toBeGreaterThan(countBefore);

      // Find the ANOMALY_DETECTED entry
      const allEntries = chain.getEntries(0, countAfter - 1);
      const anomalyEntry = allEntries.find(
        (e) => e.event.eventType === AuditEventType.ANOMALY_DETECTED,
      );
      expect(anomalyEntry).toBeDefined();
      expect(anomalyEntry!.event.actor.type).toBe("system");
      expect(anomalyEntry!.event.actor.id).toBe("anomaly-detector");
      expect(anomalyEntry!.event.action).toContain("anomaly_detected:");
      expect(anomalyEntry!.event.metadata?.ruleId).toBe("high_frequency_access");
      expect(anomalyEntry!.event.metadata?.severity).toBe("high");
    });

    it("should NOT record event when no anomaly is detected", () => {
      const now = Date.now();
      // Only a few events, below any threshold
      for (let i = 0; i < 3; i++) {
        chain.append(
          makeEvent({
            eventType: AuditEventType.AGENT_EXECUTED,
            timestamp: now + i,
          }),
        );
      }

      const countBefore = chain.getEntryCount();
      detector.detectAnomalies({ start: now - 1, end: now + 100 });
      collector.flush();
      const countAfter = chain.getEntryCount();

      // No new entries should be added (no anomaly detected)
      expect(countAfter).toBe(countBefore);
    });
  });
});
