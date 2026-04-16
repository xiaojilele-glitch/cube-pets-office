/**
 * AuditStore WAL 存储 单元测试
 * 覆盖 Task 3.1 ~ 3.6
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { AuditStore } from "../audit/audit-store.js";
import type {
  AuditLogEntry,
  AuditEvent,
} from "../../shared/audit/contracts.js";
import { AuditEventType } from "../../shared/audit/contracts.js";

// ─── 辅助：创建临时目录 ─────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-store-test-"));
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 辅助：创建测试 AuditLogEntry ──────────────────────────────────────────

function makeEntry(
  seq: number,
  overrides?: Partial<AuditLogEntry>
): AuditLogEntry {
  const event: AuditEvent = {
    eventId: `ae_test_${seq}`,
    eventType: AuditEventType.AGENT_EXECUTED,
    timestamp: Date.now(),
    actor: { type: "agent", id: "agent-1", name: "TestAgent" },
    action: "execute_task",
    resource: { type: "mission", id: "m-1", name: "TestMission" },
    result: "success",
    context: { sessionId: "sess-1" },
  };

  return {
    entryId: `al_${seq}`,
    sequenceNumber: seq,
    eventId: event.eventId,
    event,
    previousHash: seq === 0 ? "0" : `hash_${seq - 1}`,
    currentHash: `hash_${seq}`,
    nonce: crypto.randomBytes(16).toString("hex"),
    timestamp: { system: Date.now() + seq },
    signature: `sig_${seq}`,
    ...overrides,
  };
}

describe("AuditStore", () => {
  let tmpDir: string;
  let store: AuditStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new AuditStore(tmpDir);
    store.init();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── 3.1 WAL 文件写入（JSONL 格式） ──────────────────────────────────────

  describe("3.1 WAL file write (JSONL)", () => {
    it("should create WAL file on first append", () => {
      const entry = makeEntry(0);
      store.appendEntry(entry);
      const walPath = path.join(tmpDir, "chain.wal");
      expect(fs.existsSync(walPath)).toBe(true);
    });

    it("should write one JSON line per entry", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));
      const walPath = path.join(tmpDir, "chain.wal");
      const content = fs.readFileSync(walPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      expect(() => JSON.parse(lines[1])).not.toThrow();
    });

    it("should persist entry data correctly", () => {
      const entry = makeEntry(0);
      store.appendEntry(entry);
      const walPath = path.join(tmpDir, "chain.wal");
      const content = fs.readFileSync(walPath, "utf-8").trim();
      const parsed = JSON.parse(content);
      expect(parsed.entryId).toBe(entry.entryId);
      expect(parsed.sequenceNumber).toBe(entry.sequenceNumber);
      expect(parsed.currentHash).toBe(entry.currentHash);
    });

    it("should create directories if they don't exist", () => {
      const nestedDir = path.join(tmpDir, "nested", "deep");
      const nestedStore = new AuditStore(nestedDir);
      nestedStore.init();
      nestedStore.appendEntry(makeEntry(0));
      expect(fs.existsSync(path.join(nestedDir, "chain.wal"))).toBe(true);
    });
  });

  // ─── 3.2 appendEntry() ───────────────────────────────────────────────────

  describe("3.2 appendEntry()", () => {
    it("should append entries sequentially", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));
      store.appendEntry(makeEntry(2));
      expect(store.getEntryCount()).toBe(3);
    });

    it("should update in-memory index on append", () => {
      const entry = makeEntry(0);
      store.appendEntry(entry);
      expect(store.getEntryById(entry.entryId)).not.toBeNull();
    });

    it("should persist to WAL with fsync (data survives re-read)", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));

      // Create a new store pointing to the same directory and recover
      const store2 = new AuditStore(tmpDir);
      store2.init();
      expect(store2.getEntryCount()).toBe(2);
    });
  });

  // ─── 3.3 readEntries() ───────────────────────────────────────────────────

  describe("3.3 readEntries()", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        store.appendEntry(makeEntry(i));
      }
    });

    it("should return entries within the specified range", () => {
      const entries = store.readEntries(1, 3);
      expect(entries).toHaveLength(3);
      expect(entries[0].sequenceNumber).toBe(1);
      expect(entries[2].sequenceNumber).toBe(3);
    });

    it("should return entries sorted by sequenceNumber", () => {
      const entries = store.readEntries(0, 4);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].sequenceNumber).toBeGreaterThan(
          entries[i - 1].sequenceNumber
        );
      }
    });

    it("should return empty array for out-of-range query", () => {
      const entries = store.readEntries(10, 20);
      expect(entries).toHaveLength(0);
    });

    it("should return single entry when start === end", () => {
      const entries = store.readEntries(2, 2);
      expect(entries).toHaveLength(1);
      expect(entries[0].sequenceNumber).toBe(2);
    });

    it("should return all entries for full range", () => {
      const entries = store.readEntries(0, 4);
      expect(entries).toHaveLength(5);
    });
  });

  // ─── 3.4 getEntryCount() / getLastEntry() ────────────────────────────────

  describe("3.4 getEntryCount() / getLastEntry()", () => {
    it("getEntryCount() returns 0 for empty store", () => {
      expect(store.getEntryCount()).toBe(0);
    });

    it("getEntryCount() tracks appended entries", () => {
      store.appendEntry(makeEntry(0));
      expect(store.getEntryCount()).toBe(1);
      store.appendEntry(makeEntry(1));
      expect(store.getEntryCount()).toBe(2);
    });

    it("getLastEntry() returns null for empty store", () => {
      expect(store.getLastEntry()).toBeNull();
    });

    it("getLastEntry() returns the most recently appended entry", () => {
      store.appendEntry(makeEntry(0));
      const last = makeEntry(1);
      store.appendEntry(last);
      const result = store.getLastEntry();
      expect(result).not.toBeNull();
      expect(result!.entryId).toBe(last.entryId);
      expect(result!.sequenceNumber).toBe(1);
    });
  });

  // ─── 3.5 索引文件维护 ────────────────────────────────────────────────────

  describe("3.5 Index file maintenance", () => {
    it("should create index file on append", () => {
      store.appendEntry(makeEntry(0));
      const idxPath = path.join(tmpDir, "chain.idx");
      expect(fs.existsSync(idxPath)).toBe(true);
    });

    it("should persist entryId → index mapping", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));
      const idxPath = path.join(tmpDir, "chain.idx");
      const content = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
      expect(content["al_0"]).toBe(0);
      expect(content["al_1"]).toBe(1);
    });

    it("getEntryById() should find entries by id", () => {
      const entry = makeEntry(0);
      store.appendEntry(entry);
      store.appendEntry(makeEntry(1));

      const found = store.getEntryById("al_0");
      expect(found).not.toBeNull();
      expect(found!.entryId).toBe("al_0");
    });

    it("getEntryById() returns null for unknown id", () => {
      store.appendEntry(makeEntry(0));
      expect(store.getEntryById("al_999")).toBeNull();
    });
  });

  // ─── 3.6 启动时从 WAL 恢复内存索引 ──────────────────────────────────────

  describe("3.6 WAL recovery on startup", () => {
    it("should recover all entries from WAL", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));
      store.appendEntry(makeEntry(2));

      const store2 = new AuditStore(tmpDir);
      store2.init();
      expect(store2.getEntryCount()).toBe(3);
    });

    it("should rebuild index map from WAL", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));

      const store2 = new AuditStore(tmpDir);
      store2.init();
      expect(store2.getEntryById("al_0")).not.toBeNull();
      expect(store2.getEntryById("al_1")).not.toBeNull();
    });

    it("should recover getLastEntry() correctly", () => {
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));

      const store2 = new AuditStore(tmpDir);
      store2.init();
      const last = store2.getLastEntry();
      expect(last).not.toBeNull();
      expect(last!.sequenceNumber).toBe(1);
    });

    it("should recover readEntries() correctly", () => {
      for (let i = 0; i < 5; i++) {
        store.appendEntry(makeEntry(i));
      }

      const store2 = new AuditStore(tmpDir);
      store2.init();
      const entries = store2.readEntries(1, 3);
      expect(entries).toHaveLength(3);
      expect(entries[0].sequenceNumber).toBe(1);
    });

    it("should handle corrupted lines gracefully", () => {
      // Write valid entries
      store.appendEntry(makeEntry(0));
      store.appendEntry(makeEntry(1));

      // Inject a corrupted line into the WAL
      const walPath = path.join(tmpDir, "chain.wal");
      fs.appendFileSync(walPath, "THIS IS NOT VALID JSON\n");

      // Append another valid entry manually
      const entry2 = makeEntry(2);
      fs.appendFileSync(walPath, JSON.stringify(entry2) + "\n");

      // Recover — should skip the corrupted line
      const store2 = new AuditStore(tmpDir);
      store2.init();
      expect(store2.getEntryCount()).toBe(3);
      expect(store2.getEntryById("al_0")).not.toBeNull();
      expect(store2.getEntryById("al_1")).not.toBeNull();
      expect(store2.getEntryById("al_2")).not.toBeNull();
    });

    it("should handle empty WAL file", () => {
      const walPath = path.join(tmpDir, "chain.wal");
      fs.writeFileSync(walPath, "");

      const store2 = new AuditStore(tmpDir);
      store2.init();
      expect(store2.getEntryCount()).toBe(0);
      expect(store2.getLastEntry()).toBeNull();
    });

    it("should handle non-existent WAL file", () => {
      const freshDir = makeTmpDir();
      try {
        const freshStore = new AuditStore(freshDir);
        freshStore.init();
        expect(freshStore.getEntryCount()).toBe(0);
      } finally {
        cleanDir(freshDir);
      }
    });
  });
});
