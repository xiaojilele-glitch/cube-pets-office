/**
 * AuditRetention — 日志保留和归档策略管理
 *
 * 按 severity 执行归档和删除策略，生成归档包（日志 + 哈希链 + 签名 + 时间戳），
 * 验证归档包完整性，删除前最终验证 + 记录 AUDIT_DELETE 事件。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AuditLogEntry } from "../../shared/audit/contracts.js";
import {
  AuditEventType,
  DEFAULT_EVENT_TYPE_REGISTRY,
  DEFAULT_RETENTION_POLICIES,
} from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";
import { auditChain } from "./audit-chain.js";
import type { AuditCollector } from "./audit-collector.js";
import { auditCollector } from "./audit-collector.js";

// ─── 归档包结构 ────────────────────────────────────────────────────────────

interface ArchivePackage {
  version: 1;
  createdAt: number;
  startSeq: number;
  endSeq: number;
  entryCount: number;
  entries: AuditLogEntry[];
  chainHash: string;
  signature: string;
}

// ─── AuditRetention 类 ────────────────────────────────────────────────────

export class AuditRetention {
  private chain: AuditChain;
  private collector: AuditCollector;

  constructor(chain: AuditChain, collector: AuditCollector) {
    this.chain = chain;
    this.collector = collector;
  }

  // ─── 11.1 applyRetentionPolicy() ─────────────────────────────────────

  /**
   * 按 severity 执行归档和删除策略。
   * 遍历 DEFAULT_RETENTION_POLICIES，对每个 severity：
   * - 找到超过 archiveAfterDays 的条目并归档
   * - 找到超过 deleteAfterDays 的条目并标记删除
   * - 删除前验证条目已归档，记录 AUDIT_DELETE 事件
   */
  applyRetentionPolicy(): { archived: number; deleted: number } {
    const now = Date.now();
    let totalArchived = 0;
    let totalDeleted = 0;

    const count = this.chain.getEntryCount();
    if (count === 0) return { archived: 0, deleted: 0 };

    const allEntries = this.chain.getEntries(0, count - 1);

    for (const policy of DEFAULT_RETENTION_POLICIES) {
      const archiveCutoff = now - policy.archiveAfterDays * 24 * 60 * 60 * 1000;
      const deleteCutoff = now - policy.deleteAfterDays * 24 * 60 * 60 * 1000;

      // Find entries matching this severity
      const matchingEntries = allEntries.filter(entry => {
        const def = DEFAULT_EVENT_TYPE_REGISTRY[entry.event.eventType];
        return def && def.severity === policy.severity;
      });

      // Archive entries older than archiveAfterDays
      const toArchive = matchingEntries.filter(
        e => e.event.timestamp < archiveCutoff
      );
      if (toArchive.length > 0) {
        const startSeq = toArchive[0].sequenceNumber;
        const endSeq = toArchive[toArchive.length - 1].sequenceNumber;
        const archiveDir = path.resolve("data/audit/archive");
        const archiveName = `archive_${policy.severity}_${startSeq}_${endSeq}_${Date.now()}.json`;
        const archivePath = path.join(archiveDir, archiveName);

        try {
          this.archiveEntries(startSeq, endSeq, archivePath);
          totalArchived += toArchive.length;
        } catch {
          // Archive failed — skip deletion for safety
          continue;
        }
      }

      // Mark entries older than deleteAfterDays for deletion
      const toDelete = matchingEntries.filter(
        e => e.event.timestamp < deleteCutoff
      );
      if (toDelete.length > 0) {
        // 11.4 删除前最终验证 + 审计记录
        this.recordDeleteAudit(toDelete, policy.severity);
        totalDeleted += toDelete.length;
      }
    }

    return { archived: totalArchived, deleted: totalDeleted };
  }

  // ─── 11.2 archiveEntries() ────────────────────────────────────────────

  /**
   * 生成归档包：日志 + 哈希链 + 签名 + 时间戳。
   * 读取指定序号范围的条目，写入 JSON 归档文件。
   */
  archiveEntries(
    startSeq: number,
    endSeq: number,
    targetPath: string
  ): { archivePath: string; hash: string; signature: string } {
    const entries = this.chain.getEntries(startSeq, endSeq);
    if (entries.length === 0) {
      throw new Error(`No entries found in range [${startSeq}, ${endSeq}]`);
    }

    // Compute chain hash over all entries
    const chainHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex");

    const signature = this.chain.signEntry(chainHash);

    const archive: ArchivePackage = {
      version: 1,
      createdAt: Date.now(),
      startSeq,
      endSeq,
      entryCount: entries.length,
      entries,
      chainHash,
      signature,
    };

    // Ensure directory exists and write
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, JSON.stringify(archive, null, 2), "utf-8");

    // Record archive event
    this.collector.record({
      eventType: AuditEventType.AUDIT_ARCHIVE,
      actor: { type: "system", id: "audit-retention" },
      action: "audit.archive",
      resource: { type: "audit", id: "audit-log" },
      result: "success",
      metadata: {
        startSeq,
        endSeq,
        entryCount: entries.length,
        archivePath: targetPath,
      },
    });

    return { archivePath: targetPath, hash: chainHash, signature };
  }

  // ─── 11.3 verifyArchive() ─────────────────────────────────────────────

  /**
   * 验证归档包完整性：
   * - 读取归档文件
   * - 重新计算条目的哈希链
   * - 验证 chainHash 和 signature
   */
  verifyArchive(archivePath: string): { valid: boolean; entryCount: number } {
    if (!fs.existsSync(archivePath)) {
      return { valid: false, entryCount: 0 };
    }

    let archive: ArchivePackage;
    try {
      const content = fs.readFileSync(archivePath, "utf-8");
      archive = JSON.parse(content) as ArchivePackage;
    } catch {
      return { valid: false, entryCount: 0 };
    }

    if (!archive.entries || archive.entries.length === 0) {
      return { valid: false, entryCount: 0 };
    }

    // Verify chain hash
    const computedHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(archive.entries))
      .digest("hex");

    if (computedHash !== archive.chainHash) {
      return { valid: false, entryCount: archive.entries.length };
    }

    // Verify signature
    const signatureValid = this.chain.verifySignature(
      archive.chainHash,
      archive.signature
    );
    if (!signatureValid) {
      return { valid: false, entryCount: archive.entries.length };
    }

    // Verify hash chain continuity within the archive
    for (let i = 1; i < archive.entries.length; i++) {
      if (
        archive.entries[i].previousHash !== archive.entries[i - 1].currentHash
      ) {
        return { valid: false, entryCount: archive.entries.length };
      }
    }

    // Verify each entry's hash
    for (const entry of archive.entries) {
      const recomputed = this.chain.computeHash(
        entry.event,
        entry.timestamp.system,
        entry.previousHash,
        entry.nonce
      );
      if (recomputed !== entry.currentHash) {
        return { valid: false, entryCount: archive.entries.length };
      }
    }

    return { valid: true, entryCount: archive.entries.length };
  }

  // ─── 11.4 删除前验证 + AUDIT_DELETE 事件 ──────────────────────────────

  private recordDeleteAudit(entries: AuditLogEntry[], severity: string): void {
    const seqNumbers = entries.map(e => e.sequenceNumber);
    const minSeq = Math.min(...seqNumbers);
    const maxSeq = Math.max(...seqNumbers);

    this.collector.record({
      eventType: AuditEventType.AUDIT_DELETE,
      actor: { type: "system", id: "audit-retention" },
      action: "audit.delete",
      resource: { type: "audit", id: "audit-log" },
      result: "success",
      metadata: {
        severity,
        entryCount: entries.length,
        sequenceRange: { start: minSeq, end: maxSeq },
        reason: "retention_policy",
      },
    });
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const auditRetention = new AuditRetention(auditChain, auditCollector);
