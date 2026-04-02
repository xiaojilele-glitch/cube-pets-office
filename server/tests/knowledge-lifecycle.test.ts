import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

import { LifecycleLog } from "../knowledge/lifecycle-log.js";
import type { LifecycleLogEntry } from "../../shared/knowledge/types.js";

// Use a temp directory for test isolation
let tmpDir: string;
let logFilePath: string;
let log: LifecycleLog;

function makeEntry(overrides?: Partial<LifecycleLogEntry>): LifecycleLogEntry {
  return {
    entityId: "ent-001",
    action: "status_change",
    reason: "test reason",
    previousStatus: "active",
    newStatus: "deprecated",
    timestamp: "2025-01-15T10:00:00.000Z",
    triggeredBy: "manual",
    ...overrides,
  };
}

describe("LifecycleLog", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-log-test-"));
    logFilePath = path.join(tmpDir, "lifecycle-log.jsonl");
    log = new LifecycleLog(logFilePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // append
  // -------------------------------------------------------------------------

  describe("append", () => {
    it("writes a single entry as a JSON line", () => {
      const entry = makeEntry();
      log.append(entry);

      const raw = fs.readFileSync(logFilePath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(entry);
    });

    it("appends multiple entries as separate lines", () => {
      log.append(makeEntry({ entityId: "e1" }));
      log.append(makeEntry({ entityId: "e2" }));
      log.append(makeEntry({ entityId: "e3" }));

      const raw = fs.readFileSync(logFilePath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).entityId).toBe("e1");
      expect(JSON.parse(lines[1]).entityId).toBe("e2");
      expect(JSON.parse(lines[2]).entityId).toBe("e3");
    });

    it("creates the directory if it doesn't exist", () => {
      const nestedPath = path.join(tmpDir, "nested", "deep", "log.jsonl");
      const nestedLog = new LifecycleLog(nestedPath);
      nestedLog.append(makeEntry());

      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // query — no filters
  // -------------------------------------------------------------------------

  describe("query (no filters)", () => {
    it("returns all entries when no filters are provided", () => {
      log.append(makeEntry({ entityId: "a" }));
      log.append(makeEntry({ entityId: "b" }));

      const results = log.query();
      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe("a");
      expect(results[1].entityId).toBe("b");
    });

    it("returns empty array when file does not exist", () => {
      const missingLog = new LifecycleLog(path.join(tmpDir, "nope.jsonl"));
      expect(missingLog.query()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // query — filters
  // -------------------------------------------------------------------------

  describe("query (with filters)", () => {
    beforeEach(() => {
      log.append(makeEntry({
        entityId: "e1",
        action: "status_change",
        triggeredBy: "manual",
        timestamp: "2025-01-10T00:00:00.000Z",
      }));
      log.append(makeEntry({
        entityId: "e2",
        action: "garbage_collect",
        triggeredBy: "auto_cleanup",
        timestamp: "2025-01-15T00:00:00.000Z",
      }));
      log.append(makeEntry({
        entityId: "e1",
        action: "merge",
        triggeredBy: "auto_cleanup",
        timestamp: "2025-01-20T00:00:00.000Z",
      }));
      log.append(makeEntry({
        entityId: "e3",
        action: "review",
        triggeredBy: "review",
        timestamp: "2025-01-25T00:00:00.000Z",
      }));
    });

    it("filters by entityId", () => {
      const results = log.query({ entityId: "e1" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.entityId === "e1")).toBe(true);
    });

    it("filters by action", () => {
      const results = log.query({ action: "garbage_collect" });
      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe("e2");
    });

    it("filters by triggeredBy", () => {
      const results = log.query({ triggeredBy: "auto_cleanup" });
      expect(results).toHaveLength(2);
    });

    it("filters by since (ISO 8601 timestamp)", () => {
      const results = log.query({ since: "2025-01-16T00:00:00.000Z" });
      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe("e1"); // merge at Jan 20
      expect(results[1].entityId).toBe("e3"); // review at Jan 25
    });

    it("combines multiple filters", () => {
      const results = log.query({
        entityId: "e1",
        triggeredBy: "auto_cleanup",
      });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("merge");
    });

    it("returns empty array when no entries match", () => {
      const results = log.query({ entityId: "nonexistent" });
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("handles corrupted lines gracefully — skips invalid JSON", () => {
      // Write a mix of valid and invalid lines
      fs.writeFileSync(
        logFilePath,
        [
          JSON.stringify(makeEntry({ entityId: "valid1" })),
          "THIS IS NOT JSON",
          JSON.stringify(makeEntry({ entityId: "valid2" })),
          "{broken json",
        ].join("\n"),
        "utf-8",
      );

      const results = log.query();
      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe("valid1");
      expect(results[1].entityId).toBe("valid2");
    });

    it("handles empty file gracefully", () => {
      fs.writeFileSync(logFilePath, "", "utf-8");
      expect(log.query()).toEqual([]);
    });

    it("handles file with only whitespace/newlines", () => {
      fs.writeFileSync(logFilePath, "\n\n  \n", "utf-8");
      expect(log.query()).toEqual([]);
    });
  });
});
