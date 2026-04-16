/**
 * QuotaManager — 项目级配额管理
 *
 * 按 projectId 检查最大向量数量和每日嵌入 token 消耗。
 * 超限时拒绝摄入。
 *
 * Requirements: 8.2
 */

import { getRAGConfig } from "../config.js";

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
}

export class QuotaManager {
  /** 每日 token 消耗追踪：projectId → { date, tokens } */
  private dailyTokens = new Map<string, { date: string; tokens: number }>();

  /** 检查项目是否允许摄入（向量数量配额） */
  checkVectorQuota(
    projectId: string,
    currentVectorCount: number
  ): QuotaCheckResult {
    const config = getRAGConfig();
    const quota = config.quota[projectId];
    if (!quota) return { allowed: true };

    if (currentVectorCount >= quota.maxVectors) {
      return {
        allowed: false,
        reason: `Project ${projectId} has reached max vector quota (${quota.maxVectors})`,
      };
    }
    return { allowed: true };
  }

  /** 检查每日嵌入 token 配额 */
  checkDailyTokenQuota(
    projectId: string,
    additionalTokens: number
  ): QuotaCheckResult {
    const config = getRAGConfig();
    const quota = config.quota[projectId];
    if (!quota) return { allowed: true };

    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyTokens.get(projectId);
    const currentTokens = entry && entry.date === today ? entry.tokens : 0;

    if (currentTokens + additionalTokens > quota.maxDailyEmbeddingTokens) {
      return {
        allowed: false,
        reason: `Project ${projectId} daily embedding token quota exceeded (${quota.maxDailyEmbeddingTokens})`,
      };
    }
    return { allowed: true };
  }

  /** 记录 token 消耗 */
  recordTokenUsage(projectId: string, tokens: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyTokens.get(projectId);
    if (entry && entry.date === today) {
      entry.tokens += tokens;
    } else {
      this.dailyTokens.set(projectId, { date: today, tokens });
    }
  }

  /** 获取项目当日 token 消耗 */
  getDailyUsage(projectId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyTokens.get(projectId);
    return entry && entry.date === today ? entry.tokens : 0;
  }
}
