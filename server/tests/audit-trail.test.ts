/**
 * AuditTrail — 单元测试
 *
 * 覆盖 record、query（各种过滤条件）、persist/load 循环、错误处理。
 *
 * @see Requirements 3.5, 4.4, 4.7, 5.6, 6.7, 7.5, 14.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuditTrail } from "../core/governance/audit-trail.js";
import type { AuditAction, AuditEntry } from "../../shared/cost-governance.js";

const TEST_DIR = resolve(
  import.meta.dirname,
  "../../data/__test_audit_trail__"
);
const TEST_FILE = resolve(TEST_DIR, "audit.json");

function cleanup() {
  try {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  } catch {
    /* ignore */
  }
}

describe("AuditTrail", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    cleanup();
  });
  afterEach(cleanup);

  // -------------------------------------------------------------------------
  // record
  // -------------------------------------------------------------------------
  describe("record", () => {
    it("should auto-generate id and timestamp", () => {
      const trail = new AuditTrail(TEST_FILE);
      const before = Date.now();
      const entry = trail.record({
        action: "ALERT_TRIGGERED",
        missionId: "m1",
        details: { threshold: 90 },
      });
      const after = Date.now();

      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
      expect(entry.action).toBe("ALERT_TRIGGERED");
      expect(entry.missionId).toBe("m1");
      expect(entry.details).toEqual({ threshold: 90 });
    });

    it("should generate unique ids for each entry", () => {
      const trail = new AuditTrail(TEST_FILE);
      const e1 = trail.record({ action: "BUDGET_CREATED", details: {} });
      const e2 = trail.record({ action: "BUDGET_MODIFIED", details: {} });
      expect(e1.id).not.toBe(e2.id);
    });

    it("should preserve optional userId field", () => {
      const trail = new AuditTrail(TEST_FILE);
      const entry = trail.record({
        action: "PERMISSION_CHANGED",
        userId: "user-42",
        details: { change: "budget_increase" },
      });
      expect(entry.userId).toBe("user-42");
    });
  });

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------
  describe("query", () => {
    function seedTrail(trail: AuditTrail): AuditEntry[] {
      const entries: AuditEntry[] = [];
      entries.push(
        trail.record({
          action: "ALERT_TRIGGERED",
          missionId: "m1",
          details: {},
        })
      );
      entries.push(
        trail.record({
          action: "DOWNGRADE_APPLIED",
          missionId: "m1",
          userId: "u1",
          details: {},
        })
      );
      entries.push(
        trail.record({
          action: "ALERT_TRIGGERED",
          missionId: "m2",
          details: {},
        })
      );
      entries.push(
        trail.record({
          action: "TASK_PAUSED",
          missionId: "m2",
          userId: "u2",
          details: {},
        })
      );
      entries.push(
        trail.record({
          action: "PERMISSION_CHANGED",
          userId: "u1",
          details: {},
        })
      );
      return entries;
    }

    it("should return all entries when no filters", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({});
      expect(result).toHaveLength(5);
    });

    it("should return results sorted by timestamp descending", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({});
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].timestamp).toBeGreaterThanOrEqual(
          result[i].timestamp
        );
      }
    });

    it("should filter by missionId", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({ missionId: "m1" });
      expect(result).toHaveLength(2);
      expect(result.every(e => e.missionId === "m1")).toBe(true);
    });

    it("should filter by action", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({ action: "ALERT_TRIGGERED" });
      expect(result).toHaveLength(2);
      expect(result.every(e => e.action === "ALERT_TRIGGERED")).toBe(true);
    });

    it("should filter by userId", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({ userId: "u1" });
      expect(result).toHaveLength(2);
      expect(result.every(e => e.userId === "u1")).toBe(true);
    });

    it("should filter by timeRange", () => {
      const trail = new AuditTrail(TEST_FILE);
      const e1 = trail.record({ action: "BUDGET_CREATED", details: {} });
      // All entries are recorded nearly simultaneously, so use their actual timestamps
      const result = trail.query({
        timeRange: { start: e1.timestamp, end: e1.timestamp },
      });
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(
        result.every(
          e => e.timestamp >= e1.timestamp && e.timestamp <= e1.timestamp
        )
      ).toBe(true);
    });

    it("should combine multiple filters (AND logic)", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({
        missionId: "m1",
        action: "DOWNGRADE_APPLIED",
      });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("DOWNGRADE_APPLIED");
      expect(result[0].missionId).toBe("m1");
    });

    it("should return empty array when no matches", () => {
      const trail = new AuditTrail(TEST_FILE);
      seedTrail(trail);
      const result = trail.query({ missionId: "nonexistent" });
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // persist / load cycle
  // -------------------------------------------------------------------------
  describe("persist / load", () => {
    it("should persist and reload entries", () => {
      const trail1 = new AuditTrail(TEST_FILE);
      trail1.record({
        action: "ALERT_TRIGGERED",
        missionId: "m1",
        details: { level: "WARNING" },
      });
      trail1.record({
        action: "DOWNGRADE_APPLIED",
        missionId: "m2",
        details: { model: "gpt-4o" },
      });
      trail1.persist();

      // Create a new instance that loads from the same file
      const trail2 = new AuditTrail(TEST_FILE);
      const loaded = trail2.query({});
      expect(loaded).toHaveLength(2);
      expect(loaded.some(e => e.missionId === "m1")).toBe(true);
      expect(loaded.some(e => e.missionId === "m2")).toBe(true);
    });

    it("should preserve entry fields through persist/load", () => {
      const trail1 = new AuditTrail(TEST_FILE);
      const original = trail1.record({
        action: "PERMISSION_CHANGED",
        missionId: "mx",
        userId: "ux",
        details: { old: 100, new: 200 },
      });
      trail1.persist();

      const trail2 = new AuditTrail(TEST_FILE);
      const loaded = trail2.query({});
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(original.id);
      expect(loaded[0].action).toBe(original.action);
      expect(loaded[0].missionId).toBe(original.missionId);
      expect(loaded[0].userId).toBe(original.userId);
      expect(loaded[0].timestamp).toBe(original.timestamp);
      expect(loaded[0].details).toEqual(original.details);
    });

    it("should start with empty state when file does not exist", () => {
      const trail = new AuditTrail(resolve(TEST_DIR, "nonexistent.json"));
      expect(trail.query({})).toHaveLength(0);
    });

    it("should start with empty state when file is corrupted", () => {
      writeFileSync(TEST_FILE, "{{invalid json", "utf-8");
      const trail = new AuditTrail(TEST_FILE);
      expect(trail.query({})).toHaveLength(0);
    });

    it("should start with empty state when file has wrong structure", () => {
      writeFileSync(
        TEST_FILE,
        JSON.stringify({ version: 1, entries: "not-an-array" }),
        "utf-8"
      );
      const trail = new AuditTrail(TEST_FILE);
      expect(trail.query({})).toHaveLength(0);
    });
  });
});
