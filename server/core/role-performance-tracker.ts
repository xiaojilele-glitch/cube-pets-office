/**
 * RolePerformanceTracker — 分角色绩效追踪器（全局单例）
 *
 * 维护每个 Agent 在每个角色下的绩效记录，支持：
 * - 任务完成时更新绩效数据
 * - Ring Buffer 语义的 recentTasks（最大 50 条）
 * - lowConfidence 标记（totalTasks < 10）
 * - 按 agentId / roleId 查询绩效
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import type { RolePerformanceRecord } from "../../shared/role-schema.js";

const MAX_RECENT_TASKS = 50;
const LOW_CONFIDENCE_THRESHOLD = 10;

export interface TaskResult {
  taskId: string;
  qualityScore: number;
  latencyMs: number;
  success: boolean;
}

class RolePerformanceTracker {
  /** Map<agentId, Map<roleId, RolePerformanceRecord>> */
  private data: Map<string, Map<string, RolePerformanceRecord>> = new Map();

  /**
   * Update performance record when a task completes.
   *
   * 1. Get or create record for agentId + roleId
   * 2. Increment totalTasks
   * 3. Push to recentTasks (ring buffer, max 50)
   * 4. Recalculate avgQualityScore from recentTasks
   * 5. Recalculate avgLatencyMs from recentTasks
   * 6. Update successRate = successfulTasks / totalTasks
   * 7. Update lastActiveAt
   * 8. Set lowConfidence = totalTasks < 10
   * 9. Clamp qualityScore to [0, 100]
   */
  updateOnTaskComplete(
    agentId: string,
    roleId: string,
    taskResult: TaskResult
  ): void {
    const agentMap = this.getOrCreateAgentMap(agentId);
    const record = this.getOrCreateRecord(agentMap, roleId);

    // Clamp qualityScore to [0, 100]
    const clampedQuality = Math.max(0, Math.min(100, taskResult.qualityScore));

    // Increment totalTasks
    record.totalTasks += 1;

    // Track successful tasks via successRate
    // Derive previous successful count, add current, recompute rate
    const previousSuccessful = Math.round(
      record.successRate * (record.totalTasks - 1)
    );
    const newSuccessful = previousSuccessful + (taskResult.success ? 1 : 0);
    record.successRate = newSuccessful / record.totalTasks;

    // Push to recentTasks with ring buffer semantics
    record.recentTasks.push({
      taskId: taskResult.taskId,
      qualityScore: clampedQuality,
      latencyMs: taskResult.latencyMs,
      timestamp: new Date().toISOString(),
    });

    // Enforce ring buffer max size
    if (record.recentTasks.length > MAX_RECENT_TASKS) {
      record.recentTasks = record.recentTasks.slice(
        record.recentTasks.length - MAX_RECENT_TASKS
      );
    }

    // Recalculate avgQualityScore from recentTasks
    const totalQuality = record.recentTasks.reduce(
      (sum, t) => sum + t.qualityScore,
      0
    );
    record.avgQualityScore = totalQuality / record.recentTasks.length;

    // Recalculate avgLatencyMs from recentTasks
    const totalLatency = record.recentTasks.reduce(
      (sum, t) => sum + t.latencyMs,
      0
    );
    record.avgLatencyMs = totalLatency / record.recentTasks.length;

    // Update lastActiveAt
    record.lastActiveAt = new Date().toISOString();

    // Set lowConfidence flag
    record.lowConfidence = record.totalTasks < LOW_CONFIDENCE_THRESHOLD;
  }

  /**
   * Query performance data.
   *
   * - If roleId is provided, return single RolePerformanceRecord or undefined
   * - If no roleId, return Map<roleId, RolePerformanceRecord> for that agent
   * - Returns undefined if agent has no performance data
   */
  getPerformance(
    agentId: string,
    roleId?: string
  ): Map<string, RolePerformanceRecord> | RolePerformanceRecord | undefined {
    const agentMap = this.data.get(agentId);
    if (!agentMap) return undefined;

    if (roleId !== undefined) {
      return agentMap.get(roleId);
    }

    return new Map(agentMap);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getOrCreateAgentMap(
    agentId: string
  ): Map<string, RolePerformanceRecord> {
    let agentMap = this.data.get(agentId);
    if (!agentMap) {
      agentMap = new Map();
      this.data.set(agentId, agentMap);
    }
    return agentMap;
  }

  private getOrCreateRecord(
    agentMap: Map<string, RolePerformanceRecord>,
    roleId: string
  ): RolePerformanceRecord {
    let record = agentMap.get(roleId);
    if (!record) {
      record = {
        totalTasks: 0,
        avgQualityScore: 0,
        avgLatencyMs: 0,
        successRate: 0,
        lastActiveAt: "",
        lowConfidence: true,
        recentTasks: [],
      };
      agentMap.set(roleId, record);
    }
    return record;
  }
}

export const rolePerformanceTracker = new RolePerformanceTracker();

/** Export class for testing */
export { RolePerformanceTracker };
