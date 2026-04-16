import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DedupChecker, buildDedupKey } from "../rag/ingestion/dedup-checker.js";

function makeTempPath(): string {
  const dir = join(
    tmpdir(),
    "dedup-checker-test-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2)
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "test-dedup.json");
}

describe("buildDedupKey", () => {
  it("formats key as sourceType:sourceId:contentHash", () => {
    expect(buildDedupKey("task_result", "src-1", "abc123")).toBe(
      "task_result:src-1:abc123"
    );
  });
});

describe("DedupChecker", () => {
  let filePath: string;
  let checker: DedupChecker;

  beforeEach(() => {
    filePath = makeTempPath();
    checker = new DedupChecker(filePath);
  });

  afterEach(async () => {
    await checker.flush();
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  });

  // --- isDuplicate ---

  it("returns false for unseen entries", () => {
    expect(checker.isDuplicate("task_result", "src-1", "hash-a")).toBe(false);
  });

  it("returns true after markIngested", () => {
    checker.markIngested("task_result", "src-1", "hash-a");
    expect(checker.isDuplicate("task_result", "src-1", "hash-a")).toBe(true);
  });

  it("distinguishes different sourceType", () => {
    checker.markIngested("task_result", "src-1", "hash-a");
    expect(checker.isDuplicate("code_snippet", "src-1", "hash-a")).toBe(false);
  });

  it("distinguishes different sourceId", () => {
    checker.markIngested("task_result", "src-1", "hash-a");
    expect(checker.isDuplicate("task_result", "src-2", "hash-a")).toBe(false);
  });

  it("distinguishes different contentHash", () => {
    checker.markIngested("task_result", "src-1", "hash-a");
    expect(checker.isDuplicate("task_result", "src-1", "hash-b")).toBe(false);
  });

  // --- markIngested idempotency ---

  it("marking the same entry twice does not increase count", () => {
    checker.markIngested("task_result", "src-1", "hash-a");
    checker.markIngested("task_result", "src-1", "hash-a");
    expect(checker.count()).toBe(1);
  });

  // --- count ---

  it("starts at 0", () => {
    expect(checker.count()).toBe(0);
  });

  it("increments on new entries", () => {
    checker.markIngested("task_result", "src-1", "h1");
    checker.markIngested("code_snippet", "src-2", "h2");
    expect(checker.count()).toBe(2);
  });

  // --- persistence ---

  it("persists to JSON and reloads on new instance", async () => {
    checker.markIngested("task_result", "src-1", "hash-a");
    checker.markIngested("code_snippet", "src-2", "hash-b");
    await checker.flush();

    const checker2 = new DedupChecker(filePath);
    expect(checker2.count()).toBe(2);
    expect(checker2.isDuplicate("task_result", "src-1", "hash-a")).toBe(true);
    expect(checker2.isDuplicate("code_snippet", "src-2", "hash-b")).toBe(true);
    expect(checker2.isDuplicate("document", "src-3", "hash-c")).toBe(false);
  });

  it("starts empty when file does not exist", () => {
    const fresh = new DedupChecker(
      join(tmpdir(), "nonexistent-" + Date.now() + ".json")
    );
    expect(fresh.count()).toBe(0);
  });

  it("starts empty when file contains invalid JSON", () => {
    writeFileSync(filePath, "not-valid-json{{{", "utf-8");
    const fresh = new DedupChecker(filePath);
    expect(fresh.count()).toBe(0);
  });
});
