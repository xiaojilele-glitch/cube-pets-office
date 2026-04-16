/**
 * AuditVerifier — 完整性验证器
 *
 * 验证审计链的哈希链连续性、签名有效性和时间戳顺序：
 * - verifyEntry()：验证单条日志的哈希和签名
 * - verifyChain()：验证指定范围的哈希链
 * - verifyTimestamps()：验证时间戳单调递增
 * - schedulePeriodicVerification()：定期验证
 * - 验证失败告警（通过 onVerificationComplete 回调）
 */

import type {
  AuditLogEntry,
  VerificationError,
  VerificationResult,
} from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";

// ─── AuditVerifier 类 ──────────────────────────────────────────────────────

export class AuditVerifier {
  private chain: AuditChain;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private lastResult: VerificationResult | null = null;
  private onVerificationComplete?: (result: VerificationResult) => void;

  constructor(chain: AuditChain) {
    this.chain = chain;
  }

  // ─── 6.1 verifyEntry() ──────────────────────────────────────────────────

  /**
   * 验证单条日志的哈希和签名。
   * - 重新计算哈希并与 currentHash 比对
   * - 验证 ECDSA 签名
   * 返回 null 表示有效，否则返回 VerificationError。
   */
  verifyEntry(entry: AuditLogEntry): VerificationError | null {
    // 1. 重新计算哈希
    const recomputed = this.chain.computeHash(
      entry.event,
      entry.timestamp.system,
      entry.previousHash,
      entry.nonce
    );

    if (recomputed !== entry.currentHash) {
      return {
        entryId: entry.entryId,
        sequenceNumber: entry.sequenceNumber,
        errorType: "hash_mismatch",
        expected: recomputed,
        actual: entry.currentHash,
        message: `Hash mismatch at entry ${entry.entryId}: expected ${recomputed}, got ${entry.currentHash}`,
      };
    }

    // 2. 验证签名
    const sigValid = this.chain.verifySignature(
      entry.currentHash,
      entry.signature
    );

    if (!sigValid) {
      return {
        entryId: entry.entryId,
        sequenceNumber: entry.sequenceNumber,
        errorType: "signature_invalid",
        message: `Invalid signature at entry ${entry.entryId}`,
      };
    }

    return null;
  }

  // ─── 6.2 verifyChain() ─────────────────────────────────────────────────

  /**
   * 验证指定范围的哈希链连续性 + 签名 + 时间戳顺序 + 序号连续性。
   * 默认验证全链。
   */
  verifyChain(startSeq?: number, endSeq?: number): VerificationResult {
    const totalCount = this.chain.getEntryCount();

    const start = startSeq ?? 0;
    const end = endSeq ?? Math.max(totalCount - 1, 0);

    // Empty chain or invalid range
    if (totalCount === 0 || start > end) {
      return {
        valid: true,
        checkedRange: { start, end },
        totalEntries: 0,
        errors: [],
        verifiedAt: Date.now(),
      };
    }

    const entries = this.chain.getEntries(start, end);
    const errors: VerificationError[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // 1. verifyEntry — hash + signature
      const entryError = this.verifyEntry(entry);
      if (entryError) {
        errors.push(entryError);
      }

      if (i > 0) {
        const prev = entries[i - 1];

        // 2. Chain break — previousHash must match previous entry's currentHash
        if (entry.previousHash !== prev.currentHash) {
          errors.push({
            entryId: entry.entryId,
            sequenceNumber: entry.sequenceNumber,
            errorType: "chain_break",
            expected: prev.currentHash,
            actual: entry.previousHash,
            message: `Chain break at entry ${entry.entryId}: previousHash does not match previous entry's currentHash`,
          });
        }

        // 3. Sequence gap — sequenceNumber must be consecutive
        if (entry.sequenceNumber !== prev.sequenceNumber + 1) {
          errors.push({
            entryId: entry.entryId,
            sequenceNumber: entry.sequenceNumber,
            errorType: "sequence_gap",
            expected: String(prev.sequenceNumber + 1),
            actual: String(entry.sequenceNumber),
            message: `Sequence gap at entry ${entry.entryId}: expected ${prev.sequenceNumber + 1}, got ${entry.sequenceNumber}`,
          });
        }

        // 4. Timestamp regression — timestamp must be non-decreasing
        if (entry.timestamp.system < prev.timestamp.system) {
          errors.push({
            entryId: entry.entryId,
            sequenceNumber: entry.sequenceNumber,
            errorType: "timestamp_regression",
            expected: String(prev.timestamp.system),
            actual: String(entry.timestamp.system),
            message: `Timestamp regression at entry ${entry.entryId}: ${entry.timestamp.system} < ${prev.timestamp.system}`,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      checkedRange: { start, end },
      totalEntries: entries.length,
      errors,
      verifiedAt: Date.now(),
    };
  }

  // ─── 6.3 verifyTimestamps() ────────────────────────────────────────────

  /**
   * 验证时间戳单调递增。
   * 对于连续条目，检查 entry[n+1].timestamp.system >= entry[n].timestamp.system。
   */
  verifyTimestamps(entries: AuditLogEntry[]): VerificationError[] {
    const errors: VerificationError[] = [];

    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];

      if (curr.timestamp.system < prev.timestamp.system) {
        errors.push({
          entryId: curr.entryId,
          sequenceNumber: curr.sequenceNumber,
          errorType: "timestamp_regression",
          expected: String(prev.timestamp.system),
          actual: String(curr.timestamp.system),
          message: `Timestamp regression at entry ${curr.entryId}: ${curr.timestamp.system} < ${prev.timestamp.system}`,
        });
      }
    }

    return errors;
  }

  // ─── 6.4 schedulePeriodicVerification() ────────────────────────────────

  /**
   * 启动定期验证。默认每小时（3600000ms）。
   * 每次验证后存储结果并调用 onVerificationComplete 回调。
   */
  schedulePeriodicVerification(intervalMs: number = 3600000): void {
    this.stopPeriodicVerification();

    this.periodicTimer = setInterval(() => {
      const result = this.verifyChain();
      this.lastResult = result;

      // 6.5 验证完成回调（用于 Socket 广播等）
      if (this.onVerificationComplete) {
        this.onVerificationComplete(result);
      }
    }, intervalMs);
  }

  /**
   * 停止定期验证。
   */
  stopPeriodicVerification(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  // ─── 6.5 验证完成回调 ──────────────────────────────────────────────────

  /**
   * 设置验证完成回调。
   * 当定期验证完成时（无论成功或失败），调用此回调。
   * 用于 Socket audit_verification 广播。
   */
  setOnVerificationComplete(
    handler: (result: VerificationResult) => void
  ): void {
    this.onVerificationComplete = handler;
  }

  /**
   * 获取最近一次验证结果。
   */
  getLastResult(): VerificationResult | null {
    return this.lastResult;
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

import { auditChain } from "./audit-chain.js";

export const auditVerifier = new AuditVerifier(auditChain);
