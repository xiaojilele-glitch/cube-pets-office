import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Alert, AlertRule } from "../../../shared/nl-command/contracts.js";
import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import {
  AlertEngine,
  type AlertContext,
  type OnAlertCallback,
} from "../../core/nl-command/alert-engine.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_alert_engine__/nl-audit.json"
);

function cleanup() {
  const dir = dirname(TEST_AUDIT_PATH);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    ruleId: overrides.ruleId ?? "rule-1",
    type: overrides.type ?? "COST_EXCEEDED",
    condition: overrides.condition ?? {
      metric: "cost",
      operator: "gt",
      threshold: 100,
    },
    priority: overrides.priority ?? "warning",
    enabled: overrides.enabled ?? true,
  };
}

function makeContext(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    metrics: overrides.metrics ?? { cost: 150 },
    entityId: overrides.entityId ?? "task-1",
    entityType: overrides.entityType ?? "task",
  };
}

describe("AlertEngine", () => {
  let auditTrail: AuditTrail;
  let engine: AlertEngine;
  let notified: Alert[];
  const onAlert: OnAlertCallback = alert => {
    notified.push(alert);
  };

  beforeEach(() => {
    cleanup();
    notified = [];
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    engine = new AlertEngine({ auditTrail, onAlert });
  });

  afterEach(() => {
    cleanup();
  });

  describe("registerRule()", () => {
    it("should store a rule and retrieve it", () => {
      const rule = makeRule();
      engine.registerRule(rule);
      expect(engine.getRule("rule-1")).toEqual(rule);
    });

    it("should replace a rule with the same ruleId", () => {
      engine.registerRule(makeRule({ priority: "warning" }));
      engine.registerRule(makeRule({ priority: "critical" }));
      expect(engine.getRule("rule-1")!.priority).toBe("critical");
      expect(engine.getRules()).toHaveLength(1);
    });

    it("should store multiple rules", () => {
      engine.registerRule(makeRule({ ruleId: "r1" }));
      engine.registerRule(makeRule({ ruleId: "r2" }));
      expect(engine.getRules()).toHaveLength(2);
    });
  });

  describe("evaluate()", () => {
    it("should trigger alert when metric exceeds gt threshold", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "cost", operator: "gt", threshold: 100 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { cost: 150 } })
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe("COST_EXCEEDED");
      expect(alerts[0].priority).toBe("warning");
    });

    it("should NOT trigger alert when metric does not exceed gt threshold", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "cost", operator: "gt", threshold: 100 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { cost: 50 } })
      );
      expect(alerts).toHaveLength(0);
    });

    it("should NOT trigger for gt when value equals threshold", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "cost", operator: "gt", threshold: 100 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { cost: 100 } })
      );
      expect(alerts).toHaveLength(0);
    });

    it("should trigger for lt operator", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "progress", operator: "lt", threshold: 50 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { progress: 30 } })
      );
      expect(alerts).toHaveLength(1);
    });

    it("should trigger for eq operator", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "errors", operator: "eq", threshold: 0 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { errors: 0 } })
      );
      expect(alerts).toHaveLength(1);
    });

    it("should trigger for gte operator at boundary", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "cost", operator: "gte", threshold: 100 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { cost: 100 } })
      );
      expect(alerts).toHaveLength(1);
    });

    it("should trigger for lte operator at boundary", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "progress", operator: "lte", threshold: 10 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { progress: 10 } })
      );
      expect(alerts).toHaveLength(1);
    });

    it("should skip disabled rules", async () => {
      engine.registerRule(makeRule({ enabled: false }));
      const alerts = await engine.evaluate(
        makeContext({ metrics: { cost: 999 } })
      );
      expect(alerts).toHaveLength(0);
    });

    it("should skip rules when metric is missing from context", async () => {
      engine.registerRule(
        makeRule({
          condition: { metric: "cost", operator: "gt", threshold: 100 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({ metrics: { progress: 50 } })
      );
      expect(alerts).toHaveLength(0);
    });

    it("should evaluate multiple rules and trigger matching ones", async () => {
      engine.registerRule(
        makeRule({
          ruleId: "r1",
          type: "COST_EXCEEDED",
          condition: { metric: "cost", operator: "gt", threshold: 100 },
        })
      );
      engine.registerRule(
        makeRule({
          ruleId: "r2",
          type: "TASK_DELAYED",
          condition: { metric: "delay", operator: "gt", threshold: 5 },
        })
      );
      engine.registerRule(
        makeRule({
          ruleId: "r3",
          type: "RISK_ESCALATED",
          condition: { metric: "risk", operator: "gt", threshold: 80 },
        })
      );

      const alerts = await engine.evaluate(
        makeContext({
          metrics: { cost: 200, delay: 3, risk: 90 },
        })
      );
      expect(alerts).toHaveLength(2);
      expect(alerts.map(a => a.type).sort()).toEqual([
        "COST_EXCEEDED",
        "RISK_ESCALATED",
      ]);
    });

    it("should carry correct alert fields", async () => {
      engine.registerRule(
        makeRule({
          ruleId: "r1",
          type: "ERROR_OCCURRED",
          priority: "critical",
          condition: { metric: "errors", operator: "gt", threshold: 0 },
        })
      );
      const alerts = await engine.evaluate(
        makeContext({
          metrics: { errors: 3 },
          entityId: "task-42",
          entityType: "task",
        })
      );
      expect(alerts).toHaveLength(1);
      const a = alerts[0];
      expect(a.alertId).toBeTruthy();
      expect(a.type).toBe("ERROR_OCCURRED");
      expect(a.priority).toBe("critical");
      expect(a.entityId).toBe("task-42");
      expect(a.entityType).toBe("task");
      expect(a.acknowledged).toBe(false);
      expect(a.triggeredAt).toBeGreaterThan(0);
    });

    it("should support all 5 alert types", async () => {
      const types: Array<AlertRule["type"]> = [
        "TASK_DELAYED",
        "COST_EXCEEDED",
        "RISK_ESCALATED",
        "ERROR_OCCURRED",
        "APPROVAL_REQUIRED",
      ];
      types.forEach((type, i) => {
        engine.registerRule(
          makeRule({
            ruleId: `r-${i}`,
            type,
            condition: { metric: `m${i}`, operator: "gt", threshold: 0 },
          })
        );
      });
      const metrics: Record<string, number> = {};
      types.forEach((_, i) => {
        metrics[`m${i}`] = 1;
      });

      const alerts = await engine.evaluate(makeContext({ metrics }));
      expect(alerts).toHaveLength(5);
      expect(alerts.map(a => a.type).sort()).toEqual([...types].sort());
    });
  });

  describe("deduplication", () => {
    it("should deduplicate same type + same entityId within 5 minutes", async () => {
      engine.registerRule(makeRule());
      const ctx = makeContext({ metrics: { cost: 200 }, entityId: "task-1" });

      const first = await engine.evaluate(ctx);
      expect(first).toHaveLength(1);

      const second = await engine.evaluate(ctx);
      expect(second).toHaveLength(0);
    });

    it("should allow same type but different entityId", async () => {
      engine.registerRule(makeRule());

      const a1 = await engine.evaluate(
        makeContext({ metrics: { cost: 200 }, entityId: "task-1" })
      );
      const a2 = await engine.evaluate(
        makeContext({ metrics: { cost: 200 }, entityId: "task-2" })
      );
      expect(a1).toHaveLength(1);
      expect(a2).toHaveLength(1);
    });

    it("should allow different type on same entityId", async () => {
      engine.registerRule(
        makeRule({
          ruleId: "r1",
          type: "COST_EXCEEDED",
          condition: { metric: "cost", operator: "gt", threshold: 100 },
        })
      );
      engine.registerRule(
        makeRule({
          ruleId: "r2",
          type: "TASK_DELAYED",
          condition: { metric: "delay", operator: "gt", threshold: 5 },
        })
      );

      const alerts = await engine.evaluate(
        makeContext({
          metrics: { cost: 200, delay: 10 },
          entityId: "task-1",
        })
      );
      expect(alerts).toHaveLength(2);

      // Second call: both deduped
      const alerts2 = await engine.evaluate(
        makeContext({
          metrics: { cost: 200, delay: 10 },
          entityId: "task-1",
        })
      );
      expect(alerts2).toHaveLength(0);
    });

    it("should allow alert again after dedup window expires", async () => {
      engine.registerRule(makeRule());
      const ctx = makeContext({ metrics: { cost: 200 }, entityId: "task-1" });

      const first = await engine.evaluate(ctx);
      expect(first).toHaveLength(1);

      // Simulate time passing beyond 5 min window by manipulating internal state
      const dedupMap = (engine as any).recentAlerts as Map<string, number>;
      for (const [key] of dedupMap) {
        dedupMap.set(key, Date.now() - 6 * 60 * 1000);
      }

      const second = await engine.evaluate(ctx);
      expect(second).toHaveLength(1);
    });
  });

  describe("notify()", () => {
    it("should call onAlert callback for each triggered alert", async () => {
      engine.registerRule(makeRule());
      await engine.evaluate(makeContext({ metrics: { cost: 200 } }));
      expect(notified).toHaveLength(1);
      expect(notified[0].type).toBe("COST_EXCEEDED");
    });

    it("should work without onAlert callback", async () => {
      const silentEngine = new AlertEngine({ auditTrail });
      silentEngine.registerRule(makeRule());
      const alerts = await silentEngine.evaluate(
        makeContext({ metrics: { cost: 200 } })
      );
      expect(alerts).toHaveLength(1);
    });

    it("should use updated callback after setOnAlert", async () => {
      const newNotified: Alert[] = [];
      engine.setOnAlert(a => {
        newNotified.push(a);
      });
      engine.registerRule(makeRule());
      await engine.evaluate(makeContext({ metrics: { cost: 200 } }));
      expect(notified).toHaveLength(0);
      expect(newNotified).toHaveLength(1);
    });
  });

  describe("audit trail integration", () => {
    it("should record audit entry for each triggered alert", async () => {
      engine.registerRule(makeRule());
      await engine.evaluate(
        makeContext({ metrics: { cost: 200 }, entityId: "task-99" })
      );

      const entries = await auditTrail.query({
        operationType: "alert_triggered",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe("task-99");
      expect(entries[0].content).toContain("COST_EXCEEDED");
    });

    it("should NOT record audit when no alert is triggered", async () => {
      engine.registerRule(makeRule());
      await engine.evaluate(makeContext({ metrics: { cost: 10 } }));

      const entries = await auditTrail.query({
        operationType: "alert_triggered",
      });
      expect(entries).toHaveLength(0);
    });
  });

  describe("removeRule()", () => {
    it("should remove a registered rule", () => {
      engine.registerRule(makeRule({ ruleId: "r1" }));
      expect(engine.removeRule("r1")).toBe(true);
      expect(engine.getRule("r1")).toBeUndefined();
    });

    it("should return false for non-existent rule", () => {
      expect(engine.removeRule("nope")).toBe(false);
    });
  });
});
