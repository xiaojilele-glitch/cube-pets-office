/**
 * AuditChain — 哈希链引擎
 *
 * 负责构建和维护密码学哈希链：
 * - ECDSA-P256 密钥管理（环境变量 / 自动生成 / 持久化）
 * - SHA-256 哈希计算
 * - ECDSA-P256 签名
 * - append()：生成 AuditLogEntry
 * - getLatestHash() / getEntry() / getEntries()
 * - 创世条目（genesis entry）
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AuditEvent, AuditLogEntry } from "../../shared/audit/contracts.js";

// ─── IAuditStore 接口 ──────────────────────────────────────────────────────

export interface IAuditStore {
  appendEntry(entry: AuditLogEntry): void;
  readEntries(startSeq: number, endSeq: number): AuditLogEntry[];
  getEntryCount(): number;
  getLastEntry(): AuditLogEntry | null;
  getEntryById(entryId: string): AuditLogEntry | null;
}

// ─── InMemoryAuditStore（默认临时存储） ─────────────────────────────────────

class InMemoryAuditStore implements IAuditStore {
  private entries: AuditLogEntry[] = [];

  appendEntry(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }

  readEntries(startSeq: number, endSeq: number): AuditLogEntry[] {
    return this.entries.filter(
      (e) => e.sequenceNumber >= startSeq && e.sequenceNumber <= endSeq,
    );
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  getLastEntry(): AuditLogEntry | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
  }

  getEntryById(entryId: string): AuditLogEntry | null {
    return this.entries.find((e) => e.entryId === entryId) ?? null;
  }
}


// ─── 密钥目录常量 ──────────────────────────────────────────────────────────

const KEYS_DIR = path.resolve("data/audit/keys");
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "private.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "public.pem");

// ─── AuditChain 类 ─────────────────────────────────────────────────────────

export class AuditChain {
  private privateKey!: crypto.KeyObject;
  private publicKey!: crypto.KeyObject;
  private store: IAuditStore;
  private initialized = false;

  constructor(options?: {
    privateKey?: string;
    publicKey?: string;
    store?: IAuditStore;
  }) {
    this.store = options?.store ?? new InMemoryAuditStore();

    if (options?.privateKey && options?.publicKey) {
      this.privateKey = crypto.createPrivateKey(options.privateKey);
      this.publicKey = crypto.createPublicKey(options.publicKey);
      this.initialized = true;
    }
  }

  // ─── 2.1 ECDSA-P256 密钥管理 ────────────────────────────────────────────

  /**
   * 初始化密钥：
   * 1. 尝试从环境变量加载
   * 2. 尝试从文件系统加载
   * 3. 自动生成并持久化
   */
  init(): void {
    if (this.initialized) return;

    // 1) 环境变量
    const envPrivate = process.env.AUDIT_SIGNING_PRIVATE_KEY;
    const envPublic = process.env.AUDIT_SIGNING_PUBLIC_KEY;

    if (envPrivate && envPublic) {
      this.privateKey = crypto.createPrivateKey(envPrivate);
      this.publicKey = crypto.createPublicKey(envPublic);
      this.initialized = true;
      return;
    }

    // 2) 文件系统
    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
      const privPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf-8");
      const pubPem = fs.readFileSync(PUBLIC_KEY_PATH, "utf-8");
      this.privateKey = crypto.createPrivateKey(privPem);
      this.publicKey = crypto.createPublicKey(pubPem);
      this.initialized = true;
      return;
    }

    // 3) 自动生成并持久化
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    this.privateKey = privateKey;
    this.publicKey = publicKey;

    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.writeFileSync(
      PRIVATE_KEY_PATH,
      privateKey.export({ type: "sec1", format: "pem" }) as string,
      "utf-8",
    );
    fs.writeFileSync(
      PUBLIC_KEY_PATH,
      publicKey.export({ type: "spki", format: "pem" }) as string,
      "utf-8",
    );

    this.initialized = true;
  }

  /** 获取公钥 PEM（用于外部验证） */
  getPublicKeyPem(): string {
    this.ensureInitialized();
    return this.publicKey.export({ type: "spki", format: "pem" }) as string;
  }

  // ─── 2.2 computeHash() ──────────────────────────────────────────────────

  /**
   * SHA-256 哈希计算
   * currentHash = SHA-256(JSON.stringify(event) + "|" + timestamp + "|" + previousHash + "|" + nonce)
   */
  computeHash(
    event: AuditEvent,
    timestamp: number,
    previousHash: string,
    nonce: string,
  ): string {
    const payload =
      JSON.stringify(event) + "|" + timestamp + "|" + previousHash + "|" + nonce;
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  // ─── 2.3 signEntry() ────────────────────────────────────────────────────

  /**
   * ECDSA-P256 签名
   * signature = ECDSA-P256.sign(privateKey, currentHash)
   */
  signEntry(currentHash: string): string {
    this.ensureInitialized();
    const sign = crypto.createSign("SHA256");
    sign.update(currentHash);
    sign.end();
    return sign.sign(this.privateKey, "base64");
  }

  /**
   * 验证签名
   */
  verifySignature(currentHash: string, signature: string): boolean {
    this.ensureInitialized();
    const verify = crypto.createVerify("SHA256");
    verify.update(currentHash);
    verify.end();
    return verify.verify(this.publicKey, signature, "base64");
  }

  // ─── 2.4 append() ───────────────────────────────────────────────────────

  /**
   * 生成 AuditLogEntry 并追加到存储
   * 1. 生成 eventId（如果事件没有）
   * 2. 获取 previousHash（链尾或 "0"）
   * 3. 生成 nonce
   * 4. 计算 currentHash
   * 5. 签名
   * 6. 创建 AuditLogEntry（sequenceNumber = lastSeq + 1）
   * 7. 追加到存储
   */
  append(event: AuditEvent): AuditLogEntry {
    this.ensureInitialized();

    // 生成 eventId（如果缺失）
    if (!event.eventId) {
      event.eventId = `ae_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    }

    const lastEntry = this.store.getLastEntry();
    const previousHash = lastEntry ? lastEntry.currentHash : "0";
    const sequenceNumber = lastEntry ? lastEntry.sequenceNumber + 1 : 0;
    const entryId = `al_${sequenceNumber}`;
    const nonce = crypto.randomBytes(16).toString("hex");
    const systemTimestamp = Date.now();

    const currentHash = this.computeHash(event, systemTimestamp, previousHash, nonce);
    const signature = this.signEntry(currentHash);

    const entry: AuditLogEntry = {
      entryId,
      sequenceNumber,
      eventId: event.eventId,
      event,
      previousHash,
      currentHash,
      nonce,
      timestamp: {
        system: systemTimestamp,
      },
      signature,
    };

    this.store.appendEntry(entry);
    return entry;
  }

  // ─── 2.5 getLatestHash() / getEntry() / getEntries() ────────────────────

  /** 返回链尾哈希值，空链返回 "0" */
  getLatestHash(): string {
    const last = this.store.getLastEntry();
    return last ? last.currentHash : "0";
  }

  /** 按 entryId 获取条目 */
  getEntry(entryId: string): AuditLogEntry | null {
    return this.store.getEntryById(entryId);
  }

  /** 按序号范围获取条目 */
  getEntries(startSeq: number, endSeq: number): AuditLogEntry[] {
    return this.store.readEntries(startSeq, endSeq);
  }

  /** 获取条目总数 */
  getEntryCount(): number {
    return this.store.getEntryCount();
  }

  // ─── Store 注入 ──────────────────────────────────────────────────────────

  /** 替换底层存储（用于注入 AuditStore） */
  setStore(store: IAuditStore): void {
    this.store = store;
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("AuditChain not initialized. Call init() first or provide keys in constructor.");
    }
  }
}

// ─── 2.6 创世条目说明 ──────────────────────────────────────────────────────
// 创世条目由 append() 自动处理：
// - 当链为空时，previousHash = "0"
// - sequenceNumber = 0
// - entryId = "al_0"

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const auditChain = new AuditChain();
