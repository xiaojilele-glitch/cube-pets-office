/**
 * ModelDowngradeManager — 单元测试
 *
 * 覆盖 applyDowngrade（正常链 + 链末端）、rollback、
 * getEffectiveModel（有/无灰度）、getRecords、审计记录。
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ModelDowngradeManager } from "../core/governance/downgrade-manager.js";
import { DOWNGRADE_CHAIN } from "../../shared/cost-governance.js";
import { AuditTrail } from "../core/governance/audit-trail.js";
import { resolve } from "node:path";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";

const TEST_DIR = resolve(import.meta.dirname, "../../data/__test_downgrade__");
const TEST_FILE = resolve(TEST_DIR, "audit.json");

function cleanup() {
  try {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  } catch {
    /* ignore */
  }
}

describe("ModelDowngradeManager", () => {
  let mgr: ModelDowngradeManager;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    cleanup();
    mgr = new ModelDowngradeManager();
  });

  // ---------------------------------------------------------------------------
  // applyDowngrade
  // ---------------------------------------------------------------------------
  describe("applyDowngrade", () => {
    it("should downgrade gpt-4o to gpt-4o-mini", () => {
      const record = mgr.applyDowngrade("m1", "gpt-4o");
      expect(record.sourceModel).toBe("gpt-4o");
      expect(record.targetModel).toBe("gpt-4o-mini");
      expect(record.status).toBe("APPLIED");
      expect(record.missionId).toBe("m1");
      expect(record.id).toBeTruthy();
      expect(record.timestamp).toBeGreaterThan(0);
    });

    it("should follow the full downgrade chain", () => {
      for (const [source, target] of Object.entries(DOWNGRADE_CHAIN)) {
        const record = mgr.applyDowngrade("m1", source);
        expect(record.targetModel).toBe(target);
        expect(record.status).toBe("APPLIED");
      }
    });

    it("should return FAILED when model is at end of chain", () => {
      const record = mgr.applyDowngrade("m1", "glm-5-turbo");
      expect(record.status).toBe("FAILED");
      expect(record.targetModel).toBe("glm-5-turbo");
      expect(record.expectedSaving).toBe(0);
    });

    it("should return FAILED for unknown model", () => {
      const record = mgr.applyDowngrade("m1", "unknown-model");
      expect(record.status).toBe("FAILED");
      expect(record.targetModel).toBe("unknown-model");
    });

    it("should accept grayPercent parameter", () => {
      const record = mgr.applyDowngrade("m1", "gpt-4o", 50);
      expect(record.status).toBe("APPLIED");
      expect(record.sourceModel).toBe("gpt-4o");
      expect(record.targetModel).toBe("gpt-4o-mini");
    });

    it("should generate unique ids for each record", () => {
      const r1 = mgr.applyDowngrade("m1", "gpt-4o");
      const r2 = mgr.applyDowngrade("m1", "gpt-4o-mini");
      expect(r1.id).not.toBe(r2.id);
    });
  });

  // ---------------------------------------------------------------------------
  // rollback
  // ---------------------------------------------------------------------------
  describe("rollback", () => {
    it("should set status to ROLLED_BACK", () => {
      const record = mgr.applyDowngrade("m1", "gpt-4o");
      mgr.rollback(record.id, "Model call failed");

      const records = mgr.getRecords("m1");
      const rolled = records.find(r => r.id === record.id)!;
      expect(rolled.status).toBe("ROLLED_BACK");
      expect(rolled.rollbackReason).toBe("Model call failed");
    });

    it("should do nothing for nonexistent recordId", () => {
      // Should not throw
      mgr.rollback("nonexistent", "reason");
    });

    it("should only affect the targeted record", () => {
      const r1 = mgr.applyDowngrade("m1", "gpt-4o");
      const r2 = mgr.applyDowngrade("m1", "gpt-4o-mini");
      mgr.rollback(r1.id, "rollback r1");

      const records = mgr.getRecords("m1");
      expect(records.find(r => r.id === r1.id)!.status).toBe("ROLLED_BACK");
      expect(records.find(r => r.id === r2.id)!.status).toBe("APPLIED");
    });
  });

  // ---------------------------------------------------------------------------
  // getEffectiveModel
  // ---------------------------------------------------------------------------
  describe("getEffectiveModel", () => {
    it("should return original model when no downgrade exists", () => {
      const model = mgr.getEffectiveModel("m1", "gpt-4o", "agent-1");
      expect(model).toBe("gpt-4o");
    });

    it("should return target model when downgrade is active (no gray)", () => {
      mgr.applyDowngrade("m1", "gpt-4o");
      const model = mgr.getEffectiveModel("m1", "gpt-4o", "agent-1");
      expect(model).toBe("gpt-4o-mini");
    });

    it("should return target model when grayPercent is 100", () => {
      mgr.applyDowngrade("m1", "gpt-4o", 100);
      const model = mgr.getEffectiveModel("m1", "gpt-4o", "agent-1");
      expect(model).toBe("gpt-4o-mini");
    });

    it("should return original model when grayPercent is 0", () => {
      mgr.applyDowngrade("m1", "gpt-4o", 0);
      const model = mgr.getEffectiveModel("m1", "gpt-4o", "agent-1");
      expect(model).toBe("gpt-4o");
    });

    it("should be deterministic for the same agentId", () => {
      mgr.applyDowngrade("m1", "gpt-4o", 50);
      const model1 = mgr.getEffectiveModel("m1", "gpt-4o", "agent-x");
      const model2 = mgr.getEffectiveModel("m1", "gpt-4o", "agent-x");
      expect(model1).toBe(model2);
    });

    it("should return original model after rollback", () => {
      const record = mgr.applyDowngrade("m1", "gpt-4o");
      mgr.rollback(record.id, "failed");
      const model = mgr.getEffectiveModel("m1", "gpt-4o", "agent-1");
      expect(model).toBe("gpt-4o");
    });

    it("should not affect other missions", () => {
      mgr.applyDowngrade("m1", "gpt-4o");
      const model = mgr.getEffectiveModel("m2", "gpt-4o", "agent-1");
      expect(model).toBe("gpt-4o");
    });

    it("should not affect other models in the same mission", () => {
      mgr.applyDowngrade("m1", "gpt-4o");
      const model = mgr.getEffectiveModel("m1", "gpt-4o-mini", "agent-1");
      expect(model).toBe("gpt-4o-mini");
    });

    it("with gray percent, different agents may get different models", () => {
      mgr.applyDowngrade("m1", "gpt-4o", 50);
      // Test with many agents — some should be downgraded, some not
      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        results.add(mgr.getEffectiveModel("m1", "gpt-4o", `agent-${i}`));
      }
      // With 50% gray and 100 agents, we expect both models to appear
      expect(results.size).toBe(2);
      expect(results.has("gpt-4o")).toBe(true);
      expect(results.has("gpt-4o-mini")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getRecords
  // ---------------------------------------------------------------------------
  describe("getRecords", () => {
    it("should return empty array when no records", () => {
      expect(mgr.getRecords("m1")).toEqual([]);
    });

    it("should return records for the specified mission only", () => {
      mgr.applyDowngrade("m1", "gpt-4o");
      mgr.applyDowngrade("m2", "gpt-4o");
      mgr.applyDowngrade("m1", "gpt-4o-mini");

      const m1Records = mgr.getRecords("m1");
      expect(m1Records).toHaveLength(2);
      expect(m1Records.every(r => r.missionId === "m1")).toBe(true);

      const m2Records = mgr.getRecords("m2");
      expect(m2Records).toHaveLength(1);
    });

    it("should not expose internal grayPercent field", () => {
      mgr.applyDowngrade("m1", "gpt-4o", 50);
      const records = mgr.getRecords("m1");
      expect(records).toHaveLength(1);
      // grayPercent should not be on the public record
      expect("grayPercent" in records[0]).toBe(false);
    });
  });
});
