// Feature: dynamic-role-system, Property 11: 任务完成更新绩效记录
/**
 * Property 11: 任务完成更新绩效记录
 *
 * 对于任意任务完成事件，对应 Agent 当前角色的 RolePerformanceRecord 应满足：
 * - totalTasks 递增 1
 * - recentTasks 包含新任务记录（Ring Buffer 最大 50 条）
 * - avgQualityScore 和 avgLatencyMs 基于历史数据重新计算
 * - lowConfidence 在 totalTasks < 10 时为 true
 *
 * **Validates: Requirements 4.2, 4.3, 4.4**
 */

import { describe, expect, it, beforeEach } from "vitest";
import fc from "fast-check";

import { RolePerformanceTracker } from "../core/role-performance-tracker.js";
import type { TaskResult } from "../core/role-performance-tracker.js";
import type { RolePerformanceRecord } from "../../shared/role-schema.js";

// ── Arbitraries ──────────────────────────────────────────────────

const arbAgentId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter(s => s.length >= 1);

const arbRoleId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter(s => s.length >= 1);

const arbTaskResult: fc.Arbitrary<TaskResult> = fc.record({
  taskId: fc
    .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
    .filter(s => s.length >= 1),
  qualityScore: fc.double({ min: 0, max: 100, noNaN: true }),
  latencyMs: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  success: fc.boolean(),
});

/** Generate a list of task results to simulate sequential completions */
const arbTaskResultList: fc.Arbitrary<TaskResult[]> = fc.array(arbTaskResult, {
  minLength: 1,
  maxLength: 60,
});

// ── Tests ────────────────────────────────────────────────────────

describe("RolePerformanceTracker Property 11: 任务完成更新绩效记录", () => {
  let tracker: RolePerformanceTracker;

  beforeEach(() => {
    tracker = new RolePerformanceTracker();
  });

  // **Validates: Requirements 4.2**
  it("totalTasks increments by 1 for each task completion", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResultList,
        (agentId, roleId, tasks) => {
          const t = new RolePerformanceTracker();

          for (let i = 0; i < tasks.length; i++) {
            t.updateOnTaskComplete(agentId, roleId, tasks[i]);
            const record = t.getPerformance(
              agentId,
              roleId
            ) as RolePerformanceRecord;
            expect(record.totalTasks).toBe(i + 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.2**
  it("recentTasks contains the new task record after completion", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResult,
        (agentId, roleId, task) => {
          const t = new RolePerformanceTracker();

          t.updateOnTaskComplete(agentId, roleId, task);
          const record = t.getPerformance(
            agentId,
            roleId
          ) as RolePerformanceRecord;

          const found = record.recentTasks.find(
            rt => rt.taskId === task.taskId
          );
          expect(found).toBeDefined();
          expect(found!.qualityScore).toBe(
            Math.max(0, Math.min(100, task.qualityScore))
          );
          expect(found!.latencyMs).toBe(task.latencyMs);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.2**
  it("recentTasks never exceeds 50 entries (Ring Buffer)", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        fc.array(arbTaskResult, { minLength: 51, maxLength: 70 }),
        (agentId, roleId, tasks) => {
          const t = new RolePerformanceTracker();

          for (const task of tasks) {
            t.updateOnTaskComplete(agentId, roleId, task);
          }

          const record = t.getPerformance(
            agentId,
            roleId
          ) as RolePerformanceRecord;
          expect(record.recentTasks.length).toBeLessThanOrEqual(50);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.2**
  it("Ring Buffer keeps the most recent 50 tasks when overflow occurs", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        fc.array(arbTaskResult, { minLength: 51, maxLength: 70 }),
        (agentId, roleId, tasks) => {
          const t = new RolePerformanceTracker();

          for (const task of tasks) {
            t.updateOnTaskComplete(agentId, roleId, task);
          }

          const record = t.getPerformance(
            agentId,
            roleId
          ) as RolePerformanceRecord;

          // The last task should always be present in recentTasks
          const lastTask = tasks[tasks.length - 1];
          const found = record.recentTasks.find(
            rt => rt.taskId === lastTask.taskId
          );
          expect(found).toBeDefined();

          // recentTasks should have exactly 50 entries
          expect(record.recentTasks.length).toBe(50);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.3**
  it("avgQualityScore is recalculated as mean of recentTasks quality scores", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResultList,
        (agentId, roleId, tasks) => {
          const t = new RolePerformanceTracker();

          for (const task of tasks) {
            t.updateOnTaskComplete(agentId, roleId, task);
          }

          const record = t.getPerformance(
            agentId,
            roleId
          ) as RolePerformanceRecord;

          // Manually compute expected avg from recentTasks
          const expectedAvg =
            record.recentTasks.reduce((sum, rt) => sum + rt.qualityScore, 0) /
            record.recentTasks.length;

          expect(record.avgQualityScore).toBeCloseTo(expectedAvg, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.3**
  it("avgLatencyMs is recalculated as mean of recentTasks latency values", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResultList,
        (agentId, roleId, tasks) => {
          const t = new RolePerformanceTracker();

          for (const task of tasks) {
            t.updateOnTaskComplete(agentId, roleId, task);
          }

          const record = t.getPerformance(
            agentId,
            roleId
          ) as RolePerformanceRecord;

          const expectedAvg =
            record.recentTasks.reduce((sum, rt) => sum + rt.latencyMs, 0) /
            record.recentTasks.length;

          expect(record.avgLatencyMs).toBeCloseTo(expectedAvg, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.4**
  it("lowConfidence is true when totalTasks < 10, false otherwise", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResultList,
        (agentId, roleId, tasks) => {
          const t = new RolePerformanceTracker();

          for (let i = 0; i < tasks.length; i++) {
            t.updateOnTaskComplete(agentId, roleId, tasks[i]);
            const record = t.getPerformance(
              agentId,
              roleId
            ) as RolePerformanceRecord;

            if (record.totalTasks < 10) {
              expect(record.lowConfidence).toBe(true);
            } else {
              expect(record.lowConfidence).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.2, 4.3**
  it("qualityScore is clamped to [0, 100] in recentTasks", () => {
    const arbOutOfRangeTask: fc.Arbitrary<TaskResult> = fc.record({
      taskId: fc
        .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
        .filter(s => s.length >= 1),
      qualityScore: fc.double({ min: -500, max: 500, noNaN: true }),
      latencyMs: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
      success: fc.boolean(),
    });

    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbOutOfRangeTask,
        (agentId, roleId, task) => {
          const t = new RolePerformanceTracker();

          t.updateOnTaskComplete(agentId, roleId, task);
          const record = t.getPerformance(
            agentId,
            roleId
          ) as RolePerformanceRecord;

          for (const rt of record.recentTasks) {
            expect(rt.qualityScore).toBeGreaterThanOrEqual(0);
            expect(rt.qualityScore).toBeLessThanOrEqual(100);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: dynamic-role-system, Property 12: 绩效历史按 roleId 过滤
/**
 * Property 12: 绩效历史按 roleId 过滤
 *
 * 对于任意拥有多角色绩效数据的 Agent，通过 roleId 过滤查询应仅返回该角色的
 * RolePerformanceRecord，不包含其他角色的数据。
 *
 * **Validates: Requirements 4.5**
 */

describe("RolePerformanceTracker Property 12: 绩效历史按 roleId 过滤", () => {
  let tracker: RolePerformanceTracker;

  beforeEach(() => {
    tracker = new RolePerformanceTracker();
  });

  /** Generate 2-5 distinct roleIds to simulate multi-role data */
  const arbDistinctRoleIds: fc.Arbitrary<string[]> = fc
    .uniqueArray(arbRoleId, { minLength: 2, maxLength: 5 })
    .filter(arr => arr.length >= 2);

  // **Validates: Requirements 4.5**
  it("querying by roleId returns only that role's RolePerformanceRecord", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbDistinctRoleIds,
        fc.array(arbTaskResult, { minLength: 1, maxLength: 10 }),
        (agentId, roleIds, tasks) => {
          const t = new RolePerformanceTracker();

          // Feed tasks into each role so every role has performance data
          for (const roleId of roleIds) {
            for (const task of tasks) {
              t.updateOnTaskComplete(agentId, roleId, task);
            }
          }

          // For each roleId, querying with that roleId should return a single record
          for (const roleId of roleIds) {
            const result = t.getPerformance(agentId, roleId);

            // Should return a RolePerformanceRecord, not a Map
            expect(result).toBeDefined();
            expect(result).not.toBeInstanceOf(Map);

            const record = result as RolePerformanceRecord;
            // The record should reflect the tasks fed into this specific role
            expect(record.totalTasks).toBe(tasks.length);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.5**
  it("querying by roleId does not include other roles' data", () => {
    fc.assert(
      fc.property(arbAgentId, arbDistinctRoleIds, (agentId, roleIds) => {
        const t = new RolePerformanceTracker();

        // Give each role a distinct number of tasks: role i gets (i + 1) tasks
        for (let i = 0; i < roleIds.length; i++) {
          for (let j = 0; j <= i; j++) {
            t.updateOnTaskComplete(agentId, roleIds[i], {
              taskId: `task-${roleIds[i]}-${j}`,
              qualityScore: 50,
              latencyMs: 100,
              success: true,
            });
          }
        }

        // Query each role individually and verify isolation
        for (let i = 0; i < roleIds.length; i++) {
          const record = t.getPerformance(
            agentId,
            roleIds[i]
          ) as RolePerformanceRecord;
          expect(record).toBeDefined();
          // Each role should have exactly (i + 1) tasks — proves no cross-contamination
          expect(record.totalTasks).toBe(i + 1);
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.5**
  it("querying without roleId returns all roles as a Map", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbDistinctRoleIds,
        arbTaskResult,
        (agentId, roleIds, task) => {
          const t = new RolePerformanceTracker();

          for (const roleId of roleIds) {
            t.updateOnTaskComplete(agentId, roleId, task);
          }

          // Query without roleId should return a Map containing all roles
          const allPerf = t.getPerformance(agentId);
          expect(allPerf).toBeInstanceOf(Map);

          const perfMap = allPerf as Map<string, RolePerformanceRecord>;
          expect(perfMap.size).toBe(roleIds.length);

          for (const roleId of roleIds) {
            expect(perfMap.has(roleId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.5**
  it("querying by non-existent roleId returns undefined", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResult,
        (agentId, roleId, task) => {
          const t = new RolePerformanceTracker();

          t.updateOnTaskComplete(agentId, roleId, task);

          // Query a roleId that was never used
          const result = t.getPerformance(agentId, roleId + "-nonexistent");
          expect(result).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.5**
  it("querying by non-existent agentId returns undefined", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbTaskResult,
        (agentId, roleId, task) => {
          const t = new RolePerformanceTracker();

          t.updateOnTaskComplete(agentId, roleId, task);

          const result = t.getPerformance(agentId + "-nonexistent", roleId);
          expect(result).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
