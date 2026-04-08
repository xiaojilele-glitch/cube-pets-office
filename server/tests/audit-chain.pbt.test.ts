/**
 * AuditChain 属性测试 (Property-Based Testing)
 *
 * 使用 fast-check 验证审计链的 8 个正确性属性：
 * P-1 哈希链连续性 | P-2 哈希不可伪造 | P-3 Append-Only 不变量
 * P-4 时间戳单调递增 | P-5 签名有效性 | P-6 序号连续性
 * P-7 篡改检测 | P-8 CRITICAL 事件必录
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import fc from "fast-check";
import { AuditChain } from "../audit/audit-chain.js";
import { AuditVerifier } from "../audit/audit-verifier.js";
import { AuditCollector } from "../audit/audit-collector.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
import {
  AuditEventType,
  DEFAULT_EVENT_TYPE_REGISTRY,
} from "../../shared/audit/contracts.js";
import type { AuditEvent, AuditLogEntry } from "../../shared/audit/contracts.js";

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

// ─── Arbitrary：随机 AuditEvent 生成器 ──────────────────────────────────────

const arbAuditEvent = fc.record({
  eventId: fc.string({ minLength: 1, maxLength: 30 }).map(
    (s) => `ae_${s.replace(/[^a-zA-Z0-9_]/g, "x")}`,
  ),
  eventType: fc.constantFrom(...Object.values(AuditEventType)),
  timestamp: fc.nat({ max: 2000000000000 }),
  actor: fc.record({
    type: fc.constantFrom("user" as const, "agent" as const, "system" as const),
    id: fc.string({ minLength: 1, maxLength: 20 }).map(
      (s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"),
    ),
    name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
  }),
  action: fc.string({ minLength: 1, maxLength: 50 }),
  resource: fc.record({
    type: fc.string({ minLength: 1, maxLength: 20 }).map(
      (s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"),
    ),
    id: fc.string({ minLength: 1, maxLength: 20 }).map(
      (s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"),
    ),
    name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
  }),
  result: fc.constantFrom(
    "success" as const,
    "failure" as const,
    "denied" as const,
    "error" as const,
  ),
  context: fc.constant({}),
}) as fc.Arbitrary<AuditEvent>;


// CRITICAL event types from the registry
const CRITICAL_EVENT_TYPES = Object.values(AuditEventType).filter(
  (t) => DEFAULT_EVENT_TYPE_REGISTRY[t]?.severity === "CRITICAL",
);

const arbCriticalEventType = fc.constantFrom(...CRITICAL_EVENT_TYPES);

// ─── P-1: 哈希链连续性 ─────────────────────────────────────────────────────
// **Validates: Requirements 3.2**

describe("P-1: 哈希链连续性", () => {
  let chain: AuditChain;

  beforeEach(() => {
    const keys = generateTestKeys();
    chain = new AuditChain({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
  });

  it("任意相邻条目 entry[n+1].previousHash === entry[n].currentHash", () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 2, maxLength: 20 }),
        (events) => {
          // Fresh chain per run
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          const entries: AuditLogEntry[] = [];
          for (const ev of events) {
            entries.push(c.append(ev));
          }

          for (let i = 1; i < entries.length; i++) {
            expect(entries[i].previousHash).toBe(entries[i - 1].currentHash);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── P-2: 哈希不可伪造 ─────────────────────────────────────────────────────
// **Validates: Requirements 3.3**

describe("P-2: 哈希不可伪造", () => {
  it("重新计算哈希值必须与 currentHash 一致", () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 1, maxLength: 15 }),
        (events) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          const entries: AuditLogEntry[] = [];
          for (const ev of events) {
            entries.push(c.append(ev));
          }

          for (const entry of entries) {
            const recomputed = crypto
              .createHash("sha256")
              .update(
                JSON.stringify(entry.event) +
                  "|" +
                  entry.timestamp.system +
                  "|" +
                  entry.previousHash +
                  "|" +
                  entry.nonce,
              )
              .digest("hex");
            expect(recomputed).toBe(entry.currentHash);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── P-3: Append-Only 不变量 ────────────────────────────────────────────────
// **Validates: Requirements 3.5**

describe("P-3: Append-Only 不变量", () => {
  it("链长度只能单调递增，已写入条目不可修改", () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 1, maxLength: 10 }),
        fc.array(arbAuditEvent, { minLength: 1, maxLength: 10 }),
        (firstBatch, secondBatch) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          // Append first batch
          const firstEntries: AuditLogEntry[] = [];
          for (const ev of firstBatch) {
            firstEntries.push(c.append(ev));
          }
          const N = c.getEntryCount();
          expect(N).toBe(firstBatch.length);

          // Snapshot first batch entries
          const snapshot = firstEntries.map((e) => JSON.stringify(e));

          // Append second batch
          for (const ev of secondBatch) {
            c.append(ev);
          }
          const total = c.getEntryCount();
          expect(total).toBe(N + secondBatch.length);

          // Verify first N entries are unchanged
          const reread = c.getEntries(0, N - 1);
          for (let i = 0; i < reread.length; i++) {
            expect(JSON.stringify(reread[i])).toBe(snapshot[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── P-4: 时间戳单调递增 ───────────────────────────────────────────────────
// **Validates: Requirements 4.4, 4.5**

describe("P-4: 时间戳单调递增", () => {
  it("相邻条目时间戳不倒退", () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 2, maxLength: 20 }),
        (events) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          const entries: AuditLogEntry[] = [];
          for (const ev of events) {
            entries.push(c.append(ev));
          }

          for (let i = 1; i < entries.length; i++) {
            expect(entries[i].timestamp.system).toBeGreaterThanOrEqual(
              entries[i - 1].timestamp.system,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── P-5: 签名有效性 ───────────────────────────────────────────────────────
// **Validates: Requirements 3.4**

describe("P-5: 签名有效性", () => {
  it("任意条目的签名可通过公钥验证", () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 1, maxLength: 15 }),
        (events) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          const entries: AuditLogEntry[] = [];
          for (const ev of events) {
            entries.push(c.append(ev));
          }

          for (const entry of entries) {
            expect(c.verifySignature(entry.currentHash, entry.signature)).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── P-6: 序号连续性 ───────────────────────────────────────────────────────
// **Validates: Requirements 5.2**

describe("P-6: 序号连续性", () => {
  it("相邻条目序号差为 1", () => {
    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 2, maxLength: 20 }),
        (events) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          const entries: AuditLogEntry[] = [];
          for (const ev of events) {
            entries.push(c.append(ev));
          }

          // First entry starts at 0
          expect(entries[0].sequenceNumber).toBe(0);

          for (let i = 1; i < entries.length; i++) {
            expect(entries[i].sequenceNumber).toBe(
              entries[i - 1].sequenceNumber + 1,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── P-7: 篡改检测 ─────────────────────────────────────────────────────────
// **Validates: Requirements 5.1, 5.3**

describe("P-7: 篡改检测", () => {
  it("修改任意条目的任意字段后 verifyChain() 返回 valid=false", () => {
    // Tampering strategies: modify different fields of an entry
    const tamperStrategies = [
      // Tamper with event.action
      (entry: AuditLogEntry) => {
        entry.event = { ...entry.event, action: entry.event.action + "_TAMPERED" };
      },
      // Tamper with currentHash
      (entry: AuditLogEntry) => {
        entry.currentHash = "0".repeat(64);
      },
      // Tamper with nonce
      (entry: AuditLogEntry) => {
        entry.nonce = "tampered_nonce_" + entry.nonce;
      },
      // Tamper with signature
      (entry: AuditLogEntry) => {
        entry.signature = "dGFtcGVyZWQ="; // base64 of "tampered"
      },
      // Tamper with previousHash
      (entry: AuditLogEntry) => {
        entry.previousHash = "f".repeat(64);
      },
      // Tamper with timestamp
      (entry: AuditLogEntry) => {
        entry.timestamp = { ...entry.timestamp, system: entry.timestamp.system + 999999 };
      },
    ];

    fc.assert(
      fc.property(
        fc.array(arbAuditEvent, { minLength: 2, maxLength: 8 }),
        fc.nat().map((n) => n % tamperStrategies.length),
        (events, strategyIdx) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });

          for (const ev of events) {
            c.append(ev);
          }

          // Verify chain is valid before tampering
          const verifier = new AuditVerifier(c);
          const beforeResult = verifier.verifyChain();
          expect(beforeResult.valid).toBe(true);

          // Get all entries, pick one to tamper
          const allEntries = c.getEntries(0, c.getEntryCount() - 1);
          const targetIdx = strategyIdx % allEntries.length;
          const target = allEntries[targetIdx];

          // Apply tampering strategy
          tamperStrategies[strategyIdx](target);

          // Build a tampered chain using a custom store
          const tamperedChain = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
            store: {
              appendEntry: () => {},
              readEntries: (start: number, end: number) =>
                allEntries.filter(
                  (e) => e.sequenceNumber >= start && e.sequenceNumber <= end,
                ),
              getEntryCount: () => allEntries.length,
              getLastEntry: () => allEntries[allEntries.length - 1],
              getEntryById: (id: string) =>
                allEntries.find((e) => e.entryId === id) ?? null,
            },
          });

          const tamperedVerifier = new AuditVerifier(tamperedChain);
          const afterResult = tamperedVerifier.verifyChain();
          expect(afterResult.valid).toBe(false);
          expect(afterResult.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── P-8: CRITICAL 事件必录 ─────────────────────────────────────────────────
// **Validates: Requirements 1.3, 2.4**

describe("P-8: CRITICAL 事件必录", () => {
  it("severity=CRITICAL 的事件必须出现在审计链中", () => {
    fc.assert(
      fc.property(
        arbCriticalEventType,
        fc.string({ minLength: 1, maxLength: 20 }).map(
          (s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"),
        ),
        fc.string({ minLength: 1, maxLength: 30 }),
        (eventType, actorId, action) => {
          const keys = generateTestKeys();
          const c = new AuditChain({
            privateKey: keys.privateKey,
            publicKey: keys.publicKey,
          });
          const tsProvider = new TimestampProvider();
          const collector = new AuditCollector(c, tsProvider);

          // Use recordSync to bypass buffer (CRITICAL events)
          const entry = collector.recordSync({
            eventType,
            actor: { type: "system", id: actorId },
            action,
            resource: { type: "audit", id: "res-1" },
            result: "success",
          });

          // The event must be in the chain
          expect(c.getEntryCount()).toBeGreaterThanOrEqual(1);

          // Verify the entry is retrievable
          const found = c.getEntry(entry.entryId);
          expect(found).not.toBeNull();
          expect(found!.event.eventType).toBe(eventType);
          expect(found!.event.actor.id).toBe(actorId);

          // Cleanup
          collector.destroy();
        },
      ),
      { numRuns: 100 },
    );
  });
});
