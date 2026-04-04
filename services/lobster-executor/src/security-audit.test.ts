import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecurityAuditLogger } from "./security-audit.js";
import type { SecurityAuditEntry } from "../../../shared/executor/contracts.js";

const TEST_DATA_ROOT = join(process.cwd(), "tmp/test-security-audit");

describe("SecurityAuditLogger", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_ROOT)) {
      rmSync(TEST_DATA_ROOT, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_ROOT, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_ROOT)) {
      rmSync(TEST_DATA_ROOT, { recursive: true, force: true });
    }
  });

  it("log() writes entries with auto-generated timestamp", () => {
    const logger = new SecurityAuditLogger(TEST_DATA_ROOT);
    const before = new Date().toISOString();

    logger.log({
      jobId: "job-1",
      missionId: "mission-1",
      eventType: "container.created",
      securityLevel: "strict",
      detail: { containerId: "abc123" },
    });

    const entries = logger.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBeDefined();
    expect(entries[0].timestamp.length).toBeGreaterThan(0);
    expect(entries[0].timestamp >= before).toBe(true);
    expect(entries[0].jobId).toBe("job-1");
    expect(entries[0].missionId).toBe("mission-1");
    expect(entries[0].eventType).toBe("container.created");
    expect(entries[0].securityLevel).toBe("strict");
    expect(entries[0].detail).toEqual({ containerId: "abc123" });
  });

  it("getByJobId() filters correctly", () => {
    const logger = new SecurityAuditLogger(TEST_DATA_ROOT);

    logger.log({
      jobId: "job-1",
      missionId: "mission-1",
      eventType: "container.created",
      securityLevel: "strict",
      detail: {},
    });
    logger.log({
      jobId: "job-2",
      missionId: "mission-1",
      eventType: "container.started",
      securityLevel: "balanced",
      detail: {},
    });
    logger.log({
      jobId: "job-1",
      missionId: "mission-1",
      eventType: "container.destroyed",
      securityLevel: "strict",
      detail: {},
    });

    const job1Entries = logger.getByJobId("job-1");
    expect(job1Entries).toHaveLength(2);
    expect(job1Entries.every((e) => e.jobId === "job-1")).toBe(true);

    const job2Entries = logger.getByJobId("job-2");
    expect(job2Entries).toHaveLength(1);
    expect(job2Entries[0].eventType).toBe("container.started");

    const noEntries = logger.getByJobId("job-nonexistent");
    expect(noEntries).toHaveLength(0);
  });

  it("getAll() returns all entries with optional limit", () => {
    const logger = new SecurityAuditLogger(TEST_DATA_ROOT);

    for (let i = 0; i < 5; i++) {
      logger.log({
        jobId: `job-${i}`,
        missionId: "mission-1",
        eventType: "container.created",
        securityLevel: "strict",
        detail: { index: i },
      });
    }

    expect(logger.getAll()).toHaveLength(5);
    expect(logger.getAll(3)).toHaveLength(3);
    // limit returns the most recent entries
    const limited = logger.getAll(2);
    expect(limited).toHaveLength(2);
    expect((limited[0].detail as { index: number }).index).toBe(3);
    expect((limited[1].detail as { index: number }).index).toBe(4);
  });

  it("file is created if it doesn't exist", () => {
    const freshRoot = join(TEST_DATA_ROOT, "fresh-subdir");
    const logger = new SecurityAuditLogger(freshRoot);

    // File shouldn't exist yet
    expect(existsSync(join(freshRoot, "security-audit.jsonl"))).toBe(false);

    logger.log({
      jobId: "job-1",
      missionId: "mission-1",
      eventType: "container.created",
      securityLevel: "strict",
      detail: {},
    });

    // File should now exist
    expect(existsSync(join(freshRoot, "security-audit.jsonl"))).toBe(true);
    expect(logger.getAll()).toHaveLength(1);
  });

  it("getAll() and getByJobId() return empty arrays when no file exists", () => {
    const emptyRoot = join(TEST_DATA_ROOT, "empty-subdir");
    mkdirSync(emptyRoot, { recursive: true });
    const logger = new SecurityAuditLogger(emptyRoot);

    expect(logger.getAll()).toEqual([]);
    expect(logger.getByJobId("any")).toEqual([]);
  });
});
