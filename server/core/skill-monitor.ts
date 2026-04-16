/**
 * SkillMonitor — Skill 性能监控
 *
 * 收集、持久化和查询 Skill 执行性能数据，支持聚合和告警。
 */

import db from "../db/index.js";
type Database = typeof db;

import type {
  SkillExecutionMetrics,
  TimeRange,
  AggregatedMetrics,
  AlertResult,
} from "../../shared/skill-contracts.js";

const DEFAULT_FAILURE_THRESHOLD = 0.5; // 50%
const DEFAULT_ALERT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export class SkillMonitor {
  constructor(private readonly db: Database) {}

  /** 记录 Skill 执行指标 */
  recordMetrics(metrics: SkillExecutionMetrics): void {
    this.db.createSkillMetric(metrics);
  }

  /** 查询 Skill 性能数据，支持 timeRange 过滤和维度聚合 */
  getSkillMetrics(skillId: string, timeRange?: TimeRange): AggregatedMetrics {
    let records = this.db.getSkillMetrics(skillId);

    if (timeRange) {
      const start = new Date(timeRange.start).getTime();
      const end = new Date(timeRange.end).getTime();
      records = records.filter(r => {
        const t = new Date(r.timestamp).getTime();
        return t >= start && t <= end;
      });
    }

    const total = records.length;
    const successes = records.filter(r => r.success).length;
    const failures = total - successes;

    const avgActivation =
      total > 0
        ? records.reduce((sum, r) => sum + r.activationTimeMs, 0) / total
        : 0;
    const avgExecution =
      total > 0
        ? records.reduce((sum, r) => sum + r.executionTimeMs, 0) / total
        : 0;
    const totalTokens = records.reduce((sum, r) => sum + r.tokenCount, 0);

    // Group by version
    const byVersion: Record<string, { count: number; successRate: number }> =
      {};
    const byAgentRole: Record<string, { count: number; successRate: number }> =
      {};
    const byTaskType: Record<string, { count: number; successRate: number }> =
      {};

    for (const r of records) {
      // version
      if (!byVersion[r.version])
        byVersion[r.version] = { count: 0, successRate: 0 };
      byVersion[r.version].count++;

      // agentRole
      if (!byAgentRole[r.agentRole])
        byAgentRole[r.agentRole] = { count: 0, successRate: 0 };
      byAgentRole[r.agentRole].count++;

      // taskType
      if (!byTaskType[r.taskType])
        byTaskType[r.taskType] = { count: 0, successRate: 0 };
      byTaskType[r.taskType].count++;

      if (r.success) {
        byVersion[r.version].successRate++;
        byAgentRole[r.agentRole].successRate++;
        byTaskType[r.taskType].successRate++;
      }
    }

    // Convert success counts to rates
    for (const key of Object.keys(byVersion)) {
      byVersion[key].successRate =
        byVersion[key].count > 0
          ? byVersion[key].successRate / byVersion[key].count
          : 0;
    }
    for (const key of Object.keys(byAgentRole)) {
      byAgentRole[key].successRate =
        byAgentRole[key].count > 0
          ? byAgentRole[key].successRate / byAgentRole[key].count
          : 0;
    }
    for (const key of Object.keys(byTaskType)) {
      byTaskType[key].successRate =
        byTaskType[key].count > 0
          ? byTaskType[key].successRate / byTaskType[key].count
          : 0;
    }

    return {
      skillId,
      totalExecutions: total,
      successCount: successes,
      failureCount: failures,
      avgActivationTimeMs: avgActivation,
      avgExecutionTimeMs: avgExecution,
      totalTokenCount: totalTokens,
      successRate: total > 0 ? successes / total : 0,
      byVersion,
      byAgentRole,
      byTaskType,
    };
  }

  /** 检查是否需要触发告警（失败率超过阈值） */
  checkAlerts(
    skillId: string,
    threshold: number = DEFAULT_FAILURE_THRESHOLD,
    windowMs: number = DEFAULT_ALERT_WINDOW_MS
  ): AlertResult | null {
    const now = Date.now();
    const records = this.db.getSkillMetrics(skillId).filter(r => {
      const t = new Date(r.timestamp).getTime();
      return now - t <= windowMs;
    });

    if (records.length === 0) return null;

    const failures = records.filter(r => !r.success).length;
    const failureRate = failures / records.length;

    if (failureRate > threshold) {
      return {
        skillId,
        alertType: "high_failure_rate",
        currentRate: failureRate,
        threshold,
        message: `Skill "${skillId}" failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(threshold * 100).toFixed(1)}%`,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }
}
