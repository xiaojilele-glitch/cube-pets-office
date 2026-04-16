/**
 * AuditCollector 事件采集器 单元测试
 * 覆盖 Task 5.1 ~ 5.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AuditCollector } from "../audit/audit-collector.js";
import type { AuditEventInput } from "../audit/audit-collector.js";
import { AuditChain } from "../audit/audit-chain.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
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

// ─── 辅助：创建测试 AuditEventInput ────────────────────────────────────────

function makeInput(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    eventType: AuditEventType.AGENT_EXECUTED, // INFO severity
    actor: { type: "agent", id: "agent-1", name: "TestAgent" },
    action: "execute_task",
    resource: { type: "mission", id: "m-1", name: "TestMission" },
    result: "success",
    context: { sessionId: "sess-1" },
    ...overrides,
  };
}

function makeCriticalInput(
  overrides?: Partial<AuditEventInput>
): AuditEventInput {
  return makeInput({
    eventType: AuditEventType.DECISION_MADE, // CRITICAL severity
    action: "make_decision",
    ...overrides,
  });
}

describe("AuditCollector", () => {
  let chain: AuditChain;
  let tsProvider: TimestampProvider;
  let collector: AuditCollector;
  let tmpDir: string;
  let fallbackPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    const keys = generateTestKeys();
    chain = new AuditChain({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
    tsProvider = new TimestampProvider();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-collector-test-"));
    fallbackPath = path.join(tmpDir, "buffer.jsonl");
    collector = new AuditCollector(chain, tsProvider, fallbackPath);
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ─── 5.1 record() — 异步缓冲写入 ──────────────────────────────────────

  describe("5.1 record() — async buffered write", () => {
    it("should add INFO events to buffer without writing to chain", () => {
      collector.record(makeInput());
      expect(collector.getBufferSize()).toBe(1);
      expect(chain.getEntryCount()).toBe(0);
    });

    it("should add WARNING events to buffer", () => {
      collector.record(makeInput({ eventType: AuditEventType.AGENT_FAILED })); // WARNING
      expect(collector.getBufferSize()).toBe(1);
      expect(chain.getEntryCount()).toBe(0);
    });

    it("should auto-route CRITICAL events to recordSync()", () => {
      collector.record(makeCriticalInput());
      // CRITICAL bypasses buffer
      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(1);
    });

    it("should accumulate multiple events in buffer", () => {
      for (let i = 0; i < 10; i++) {
        collector.record(makeInput());
      }
      expect(collector.getBufferSize()).toBe(10);
      expect(chain.getEntryCount()).toBe(0);
    });
  });

  // ─── 5.2 recordSync() — 同步写入 ─────────────────────────────────────

  describe("5.2 recordSync() — sync write for CRITICAL", () => {
    it("should write directly to chain and return AuditLogEntry", () => {
      const entry = collector.recordSync(makeCriticalInput());
      expect(entry).toBeDefined();
      expect(entry.entryId).toBe("al_0");
      expect(entry.event.eventType).toBe(AuditEventType.DECISION_MADE);
      expect(chain.getEntryCount()).toBe(1);
    });

    it("should generate eventId and timestamp", () => {
      const entry = collector.recordSync(makeCriticalInput());
      expect(entry.event.eventId).toMatch(/^ae_\d+_[0-9a-f]{8}$/);
      expect(entry.event.timestamp).toBeGreaterThan(0);
    });

    it("should not affect buffer", () => {
      collector.recordSync(makeCriticalInput());
      expect(collector.getBufferSize()).toBe(0);
    });

    it("should chain multiple sync entries correctly", () => {
      const e1 = collector.recordSync(makeCriticalInput());
      const e2 = collector.recordSync(makeCriticalInput());
      expect(e2.previousHash).toBe(e1.currentHash);
      expect(e2.sequenceNumber).toBe(1);
    });
  });

  // ─── 5.3 缓冲策略 ────────────────────────────────────────────────────

  describe("5.3 Buffer strategy (100ms / 50 entries)", () => {
    it("should flush immediately when buffer reaches 50", () => {
      for (let i = 0; i < 50; i++) {
        collector.record(makeInput());
      }
      // Buffer should be flushed
      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(50);
    });

    it("should flush via timer after 100ms", () => {
      collector.record(makeInput());
      expect(collector.getBufferSize()).toBe(1);
      expect(chain.getEntryCount()).toBe(0);

      vi.advanceTimersByTime(100);

      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(1);
    });

    it("should reset timer on each record() call", () => {
      collector.record(makeInput());
      vi.advanceTimersByTime(80); // 80ms — not yet flushed
      expect(collector.getBufferSize()).toBe(1);

      collector.record(makeInput()); // resets timer
      vi.advanceTimersByTime(80); // 80ms from second record — still not 100ms
      expect(collector.getBufferSize()).toBe(2);

      vi.advanceTimersByTime(20); // now 100ms from second record
      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(2);
    });

    it("should not flush before 100ms if buffer < 50", () => {
      for (let i = 0; i < 49; i++) {
        collector.record(makeInput());
      }
      expect(collector.getBufferSize()).toBe(49);
      expect(chain.getEntryCount()).toBe(0);

      vi.advanceTimersByTime(99);
      expect(collector.getBufferSize()).toBe(49);
    });

    it("should handle mixed CRITICAL and INFO events", () => {
      collector.record(makeInput()); // buffered
      collector.record(makeCriticalInput()); // sync
      collector.record(makeInput()); // buffered

      expect(collector.getBufferSize()).toBe(2);
      expect(chain.getEntryCount()).toBe(1); // only CRITICAL written

      vi.advanceTimersByTime(100);
      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(3);
    });
  });

  // ─── 5.4 flush() — 手动刷新 ──────────────────────────────────────────

  describe("5.4 flush() — manual flush", () => {
    it("should write all buffered events to chain", () => {
      for (let i = 0; i < 10; i++) {
        collector.record(makeInput());
      }
      expect(chain.getEntryCount()).toBe(0);

      collector.flush();
      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(10);
    });

    it("should be a no-op when buffer is empty", () => {
      collector.flush();
      expect(collector.getBufferSize()).toBe(0);
      expect(chain.getEntryCount()).toBe(0);
    });

    it("should clear the flush timer", () => {
      collector.record(makeInput());
      collector.flush();
      expect(chain.getEntryCount()).toBe(1);

      // Advancing timer should not cause double flush
      vi.advanceTimersByTime(200);
      expect(chain.getEntryCount()).toBe(1);
    });

    it("should produce valid chain entries", () => {
      collector.record(makeInput());
      collector.record(makeInput());
      collector.flush();

      const entries = chain.getEntries(0, 1);
      expect(entries).toHaveLength(2);
      expect(entries[1].previousHash).toBe(entries[0].currentHash);
    });
  });

  // ─── 5.5 采集失败 fallback ────────────────────────────────────────────

  describe("5.5 Fallback on failure", () => {
    it("should write failed events to fallback file", () => {
      // Make chain.append throw
      const appendSpy = vi.spyOn(chain, "append").mockImplementation(() => {
        throw new Error("Storage failure");
      });

      collector.record(makeInput());
      collector.flush();

      expect(fs.existsSync(fallbackPath)).toBe(true);
      const content = fs.readFileSync(fallbackPath, "utf-8").trim();
      const lines = content.split("\n");
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.eventType).toBe(AuditEventType.AGENT_EXECUTED);

      appendSpy.mockRestore();
    });

    it("should retry fallback events on timer", () => {
      // First: make append fail
      const appendSpy = vi.spyOn(chain, "append").mockImplementation(() => {
        throw new Error("Storage failure");
      });

      collector.record(makeInput());
      collector.flush();
      expect(fs.existsSync(fallbackPath)).toBe(true);

      // Restore append so retry succeeds
      appendSpy.mockRestore();

      // Advance to retry interval (30s)
      vi.advanceTimersByTime(30_000);

      // Fallback file should be removed after successful retry
      expect(fs.existsSync(fallbackPath)).toBe(false);
      expect(chain.getEntryCount()).toBe(1);
    });

    it("should keep events in fallback if retry still fails", () => {
      const appendSpy = vi.spyOn(chain, "append").mockImplementation(() => {
        throw new Error("Storage failure");
      });

      collector.record(makeInput());
      collector.flush();

      // Retry still fails
      vi.advanceTimersByTime(30_000);

      expect(fs.existsSync(fallbackPath)).toBe(true);
      const content = fs.readFileSync(fallbackPath, "utf-8").trim();
      expect(content.split("\n")).toHaveLength(1);

      appendSpy.mockRestore();
    });

    it("should accumulate multiple failed flushes in fallback", () => {
      const appendSpy = vi.spyOn(chain, "append").mockImplementation(() => {
        throw new Error("Storage failure");
      });

      collector.record(makeInput());
      collector.flush();
      collector.record(makeInput());
      collector.flush();

      const content = fs.readFileSync(fallbackPath, "utf-8").trim();
      expect(content.split("\n")).toHaveLength(2);

      appendSpy.mockRestore();
    });
  });

  // ─── getBufferSize() ─────────────────────────────────────────────────

  describe("getBufferSize()", () => {
    it("should return 0 for new collector", () => {
      expect(collector.getBufferSize()).toBe(0);
    });

    it("should track buffer size accurately", () => {
      collector.record(makeInput());
      expect(collector.getBufferSize()).toBe(1);
      collector.record(makeInput());
      expect(collector.getBufferSize()).toBe(2);
      collector.flush();
      expect(collector.getBufferSize()).toBe(0);
    });

    it("should not count CRITICAL events", () => {
      collector.record(makeCriticalInput());
      expect(collector.getBufferSize()).toBe(0);
    });
  });

  // ─── destroy() ───────────────────────────────────────────────────────

  describe("destroy()", () => {
    it("should prevent timer-based flush after destroy", () => {
      collector.record(makeInput());
      collector.destroy();

      vi.advanceTimersByTime(200);
      // Buffer should still have the event (timer was cleared)
      expect(collector.getBufferSize()).toBe(1);
      expect(chain.getEntryCount()).toBe(0);
    });
  });
});
