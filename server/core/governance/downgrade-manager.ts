/**
 * 模型降级管理器 (Model Downgrade Manager) — 成本治理
 *
 * 管理 LLM 模型降级链，支持灰度降级控制和自动回滚。
 * 所有降级/回滚操作均记录到 AuditTrail。
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import type { DowngradeRecord } from "../../../shared/cost-governance.js";
import { DOWNGRADE_CHAIN } from "../../../shared/cost-governance.js";
import { auditTrail } from "./audit-trail.js";

/** Internal record with grayPercent metadata for effective-model resolution */
interface InternalDowngradeRecord extends DowngradeRecord {
  grayPercent?: number;
}

export class ModelDowngradeManager {
  private records: InternalDowngradeRecord[] = [];

  /**
   * 执行模型降级。
   *
   * 在 DOWNGRADE_CHAIN 中查找 sourceModel 的下一级模型。
   * 如果 sourceModel 在链末端（无下一级），返回 status='FAILED' 的记录。
   * 支持 grayPercent (0-100) 灰度控制。
   */
  applyDowngrade(
    missionId: string,
    sourceModel: string,
    grayPercent?: number
  ): DowngradeRecord {
    const targetModel = DOWNGRADE_CHAIN[sourceModel];

    const record: InternalDowngradeRecord = {
      id: randomUUID(),
      missionId,
      sourceModel,
      targetModel: targetModel ?? sourceModel,
      reason: targetModel
        ? `Cost governance: downgrade ${sourceModel} → ${targetModel}`
        : `No downgrade target for ${sourceModel} in chain`,
      expectedSaving: targetModel ? 0.3 : 0,
      timestamp: Date.now(),
      status: targetModel ? "APPLIED" : "FAILED",
      grayPercent: targetModel ? grayPercent : undefined,
    };

    this.records.push(record);

    auditTrail.record({
      action: "DOWNGRADE_APPLIED",
      missionId,
      details: {
        recordId: record.id,
        sourceModel,
        targetModel: record.targetModel,
        status: record.status,
        grayPercent: grayPercent ?? 100,
        expectedSaving: record.expectedSaving,
      },
    });

    return this.toPublicRecord(record);
  }

  /**
   * 回滚降级。
   *
   * 将指定记录的 status 设为 'ROLLED_BACK'，并记录到 AuditTrail。
   */
  rollback(recordId: string, reason: string): void {
    const record = this.records.find(r => r.id === recordId);
    if (!record) return;

    record.status = "ROLLED_BACK";
    record.rollbackReason = reason;

    auditTrail.record({
      action: "DOWNGRADE_ROLLED_BACK",
      missionId: record.missionId,
      details: {
        recordId,
        sourceModel: record.sourceModel,
        targetModel: record.targetModel,
        reason,
      },
    });
  }

  /**
   * 获取当前有效模型。
   *
   * 检查该 mission + model 是否有活跃降级记录（status='APPLIED'）。
   * 如果有灰度控制（grayPercent < 100），使用 agentId 的哈希值
   * 确定性地判断该 agent 是否在灰度组内。
   */
  getEffectiveModel(
    missionId: string,
    originalModel: string,
    agentId: string
  ): string {
    // Find the most recent APPLIED downgrade for this mission + model
    const activeRecord = this.findActiveDowngrade(missionId, originalModel);
    if (!activeRecord) return originalModel;

    // If no gray percent or 100%, always use target model
    const grayPercent = activeRecord.grayPercent;
    if (grayPercent === undefined || grayPercent >= 100) {
      return activeRecord.targetModel;
    }

    // If gray percent is 0, never downgrade
    if (grayPercent <= 0) return originalModel;

    // Deterministic hash-based decision for gray group membership
    if (this.isInGrayGroup(agentId, grayPercent)) {
      return activeRecord.targetModel;
    }

    return originalModel;
  }

  /**
   * 获取指定 Mission 的所有降级记录。
   */
  getRecords(missionId: string): DowngradeRecord[] {
    return this.records
      .filter(r => r.missionId === missionId)
      .map(r => this.toPublicRecord(r));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findActiveDowngrade(
    missionId: string,
    sourceModel: string
  ): InternalDowngradeRecord | undefined {
    // Search from newest to oldest
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (
        r.missionId === missionId &&
        r.sourceModel === sourceModel &&
        r.status === "APPLIED"
      ) {
        return r;
      }
    }
    return undefined;
  }

  /**
   * Deterministic gray-group membership using a hash of agentId.
   * Maps the hash to 0-99 and checks if it falls within grayPercent.
   */
  private isInGrayGroup(agentId: string, grayPercent: number): boolean {
    const hash = createHash("sha256").update(agentId).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    return bucket < grayPercent;
  }

  /** Strip internal fields before returning to callers */
  private toPublicRecord(r: InternalDowngradeRecord): DowngradeRecord {
    const { grayPercent: _, ...publicRecord } = r;
    return publicRecord;
  }
}

/** 单例 */
export const downgradeManager = new ModelDowngradeManager();
