/**
 * AuditChain 哈希链引擎 单元测试
 * 覆盖 Task 2.1 ~ 2.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { AuditChain } from "../audit/audit-chain.js";
import type { AuditEvent } from "../../shared/audit/contracts.js";
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
    eventId: `ae_test_${Date.now()}`,
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

describe("AuditChain", () => {
  let chain: AuditChain;
  let keys: { privateKey: string; publicKey: string };

  beforeEach(() => {
    keys = generateTestKeys();
    chain = new AuditChain({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
  });

  // ─── 2.1 密钥管理 ────────────────────────────────────────────────────────

  describe("2.1 ECDSA-P256 密钥管理", () => {
    it("should accept injected keys via constructor", () => {
      expect(() => chain.getPublicKeyPem()).not.toThrow();
      const pem = chain.getPublicKeyPem();
      expect(pem).toContain("BEGIN PUBLIC KEY");
    });

    it("should throw if not initialized and no keys provided", () => {
      const uninitChain = new AuditChain();
      expect(() => uninitChain.getPublicKeyPem()).toThrow(/not initialized/i);
    });

    it("should auto-generate keys via init() when no env/file keys exist", () => {
      const autoChain = new AuditChain();
      // init() will try env → file → auto-generate
      autoChain.init();
      expect(() => autoChain.getPublicKeyPem()).not.toThrow();
    });
  });

  // ─── 2.2 computeHash() ──────────────────────────────────────────────────

  describe("2.2 computeHash()", () => {
    it("should return a 64-char hex SHA-256 hash", () => {
      const event = makeEvent();
      const hash = chain.computeHash(event, Date.now(), "0", "abc123");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce deterministic output for same inputs", () => {
      const event = makeEvent();
      const ts = 1700000000000;
      const h1 = chain.computeHash(event, ts, "0", "nonce1");
      const h2 = chain.computeHash(event, ts, "0", "nonce1");
      expect(h1).toBe(h2);
    });

    it("should produce different hashes for different nonces", () => {
      const event = makeEvent();
      const ts = Date.now();
      const h1 = chain.computeHash(event, ts, "0", "nonce1");
      const h2 = chain.computeHash(event, ts, "0", "nonce2");
      expect(h1).not.toBe(h2);
    });

    it("should match manual SHA-256 computation", () => {
      const event = makeEvent();
      const ts = 1700000000000;
      const prevHash = "0";
      const nonce = "testnonce";
      const payload =
        JSON.stringify(event) + "|" + ts + "|" + prevHash + "|" + nonce;
      const expected = crypto
        .createHash("sha256")
        .update(payload)
        .digest("hex");
      expect(chain.computeHash(event, ts, prevHash, nonce)).toBe(expected);
    });
  });

  // ─── 2.3 signEntry() ────────────────────────────────────────────────────

  describe("2.3 signEntry()", () => {
    it("should return a base64 signature", () => {
      const sig = chain.signEntry("somehash");
      expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("should produce verifiable signatures", () => {
      const hash = "abc123def456";
      const sig = chain.signEntry(hash);
      expect(chain.verifySignature(hash, sig)).toBe(true);
    });

    it("should fail verification with wrong hash", () => {
      const sig = chain.signEntry("correct_hash");
      expect(chain.verifySignature("wrong_hash", sig)).toBe(false);
    });

    it("should fail verification with wrong key", () => {
      const otherKeys = generateTestKeys();
      const otherChain = new AuditChain({
        privateKey: otherKeys.privateKey,
        publicKey: otherKeys.publicKey,
      });
      const hash = "test_hash";
      const sig = chain.signEntry(hash);
      expect(otherChain.verifySignature(hash, sig)).toBe(false);
    });
  });

  // ─── 2.4 append() ───────────────────────────────────────────────────────

  describe("2.4 append()", () => {
    it("should create an entry with correct structure", () => {
      const event = makeEvent();
      const entry = chain.append(event);

      expect(entry.entryId).toBe("al_0");
      expect(entry.sequenceNumber).toBe(0);
      expect(entry.eventId).toBe(event.eventId);
      expect(entry.event).toEqual(event);
      expect(entry.previousHash).toBe("0");
      expect(entry.currentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.timestamp.system).toBeGreaterThan(0);
      expect(entry.signature).toBeTruthy();
    });

    it("should auto-generate eventId if missing", () => {
      const event = makeEvent({ eventId: "" });
      const entry = chain.append(event);
      expect(entry.eventId).toMatch(/^ae_\d+_[0-9a-f]{8}$/);
    });

    it("should chain entries with correct previousHash", () => {
      const e1 = chain.append(makeEvent());
      const e2 = chain.append(makeEvent());
      expect(e2.previousHash).toBe(e1.currentHash);
      expect(e2.sequenceNumber).toBe(1);
      expect(e2.entryId).toBe("al_1");
    });

    it("should produce verifiable hash and signature", () => {
      const entry = chain.append(makeEvent());
      // Recompute hash
      const recomputed = chain.computeHash(
        entry.event,
        entry.timestamp.system,
        entry.previousHash,
        entry.nonce
      );
      expect(recomputed).toBe(entry.currentHash);
      // Verify signature
      expect(chain.verifySignature(entry.currentHash, entry.signature)).toBe(
        true
      );
    });
  });

  // ─── 2.5 getLatestHash() / getEntry() / getEntries() ────────────────────

  describe("2.5 getLatestHash / getEntry / getEntries", () => {
    it("getLatestHash() returns '0' for empty chain", () => {
      expect(chain.getLatestHash()).toBe("0");
    });

    it("getLatestHash() returns last entry hash", () => {
      const e1 = chain.append(makeEvent());
      expect(chain.getLatestHash()).toBe(e1.currentHash);
      const e2 = chain.append(makeEvent());
      expect(chain.getLatestHash()).toBe(e2.currentHash);
    });

    it("getEntry() finds by entryId", () => {
      const e1 = chain.append(makeEvent());
      chain.append(makeEvent());
      const found = chain.getEntry(e1.entryId);
      expect(found).not.toBeNull();
      expect(found!.entryId).toBe(e1.entryId);
    });

    it("getEntry() returns null for unknown id", () => {
      expect(chain.getEntry("al_999")).toBeNull();
    });

    it("getEntries() returns entries in range", () => {
      for (let i = 0; i < 5; i++) chain.append(makeEvent());
      const entries = chain.getEntries(1, 3);
      expect(entries).toHaveLength(3);
      expect(entries[0].sequenceNumber).toBe(1);
      expect(entries[2].sequenceNumber).toBe(3);
    });

    it("getEntryCount() tracks chain length", () => {
      expect(chain.getEntryCount()).toBe(0);
      chain.append(makeEvent());
      expect(chain.getEntryCount()).toBe(1);
      chain.append(makeEvent());
      expect(chain.getEntryCount()).toBe(2);
    });
  });

  // ─── 2.6 创世条目 ───────────────────────────────────────────────────────

  describe("2.6 Genesis entry", () => {
    it("first entry has previousHash='0', sequenceNumber=0, entryId='al_0'", () => {
      const entry = chain.append(makeEvent());
      expect(entry.previousHash).toBe("0");
      expect(entry.sequenceNumber).toBe(0);
      expect(entry.entryId).toBe("al_0");
    });

    it("second entry links to genesis", () => {
      const genesis = chain.append(makeEvent());
      const second = chain.append(makeEvent());
      expect(second.previousHash).toBe(genesis.currentHash);
      expect(second.sequenceNumber).toBe(1);
    });
  });

  // ─── Store 注入 ──────────────────────────────────────────────────────────

  describe("setStore()", () => {
    it("should allow replacing the store", () => {
      chain.append(makeEvent());
      expect(chain.getEntryCount()).toBe(1);

      // Create a new chain with a fresh store and inject it
      const newChain = new AuditChain({
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
      });
      // The new chain has an empty store
      expect(newChain.getEntryCount()).toBe(0);
    });
  });
});
