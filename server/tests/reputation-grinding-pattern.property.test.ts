/**
 * Property-Based Test: 刷分模式检测
 *
 * **Feature: agent-reputation, Property 17: 刷分模式检测**
 * **Validates: Requirements 7.2**
 *
 * For any Agent 在 24 小时内完成的任务序列，当 low 复杂度任务占比 > grindingTaskRatio
 * 且总数 > grindingTaskCount 时，低复杂度任务的信誉更新权重应降低为 lowComplexityWeight。
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { AnomalyDetector } from "../core/reputation/anomaly-detector.js";
import type { TaskSummary } from "../core/reputation/anomaly-detector.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type { ReputationConfig } from "../../shared/reputation.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const AGENT_ID = "agent-grinding-test";

/** Generate a timestamp within the last 24 hours */
const recentTimestampArb = fc
  .integer({ min: 1, max: 24 * 60 * 60 * 1000 - 1 })
  .map(msAgo => new Date(Date.now() - msAgo).toISOString());

/** Generate a timestamp older than 24 hours */
const oldTimestampArb = fc
  .integer({ min: 24 * 60 * 60 * 1000 + 1, max: 7 * 24 * 60 * 60 * 1000 })
  .map(msAgo => new Date(Date.now() - msAgo).toISOString());

const complexityArb = fc.constantFrom<"low" | "medium" | "high">(
  "low",
  "medium",
  "high"
);

/** Generate a single TaskSummary with a recent timestamp */
function taskSummaryArb(
  timestampArb: fc.Arbitrary<string>
): fc.Arbitrary<TaskSummary> {
  return fc.record({
    taskId: fc.integer({ min: 1, max: 100_000 }).map(String),
    complexity: complexityArb,
    completedAt: timestampArb,
  });
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 17: 刷分模式检测", () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const detector = new AnomalyDetector(config);

  it("detects grinding when low-complexity ratio > grindingTaskRatio AND count > grindingTaskCount", () => {
    fc.assert(
      fc.property(
        fc.array(taskSummaryArb(recentTimestampArb), {
          minLength: 0,
          maxLength: 60,
        }),
        tasks => {
          const result = detector.checkGrindingPattern(AGENT_ID, tasks);

          // Recompute expected values
          const now = Date.now();
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;
          const tasksIn24h = tasks.filter(t => {
            const taskTime = new Date(t.completedAt).getTime();
            return now - taskTime <= twentyFourHoursMs;
          });

          const totalCount = tasksIn24h.length;
          const lowCount = tasksIn24h.filter(
            t => t.complexity === "low"
          ).length;
          const expectedRatio = totalCount > 0 ? lowCount / totalCount : 0;

          const expectedGrinding =
            expectedRatio > config.anomaly.grindingTaskRatio &&
            totalCount > config.anomaly.grindingTaskCount;

          expect(result.lowComplexityRatio).toBeCloseTo(expectedRatio, 10);
          expect(result.isGrinding).toBe(expectedGrinding);
          expect(result.weight).toBe(
            expectedGrinding ? config.anomaly.lowComplexityWeight : 1.0
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns weight = lowComplexityWeight when grinding is detected", () => {
    // Construct a guaranteed grinding scenario: all low-complexity, count > threshold
    fc.assert(
      fc.property(
        fc.integer({ min: config.anomaly.grindingTaskCount + 1, max: 80 }),
        count => {
          const tasks: TaskSummary[] = Array.from(
            { length: count },
            (_, i) => ({
              taskId: String(i),
              complexity: "low" as const,
              completedAt: new Date(
                Date.now() - (i + 1) * 60_000
              ).toISOString(),
            })
          );

          const result = detector.checkGrindingPattern(AGENT_ID, tasks);

          expect(result.isGrinding).toBe(true);
          expect(result.lowComplexityRatio).toBe(1.0);
          expect(result.weight).toBe(config.anomaly.lowComplexityWeight);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does NOT flag grinding when task count <= grindingTaskCount even if all low-complexity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: config.anomaly.grindingTaskCount }),
        count => {
          const tasks: TaskSummary[] = Array.from(
            { length: count },
            (_, i) => ({
              taskId: String(i),
              complexity: "low" as const,
              completedAt: new Date(
                Date.now() - (i + 1) * 60_000
              ).toISOString(),
            })
          );

          const result = detector.checkGrindingPattern(AGENT_ID, tasks);

          expect(result.isGrinding).toBe(false);
          expect(result.weight).toBe(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does NOT flag grinding when low-complexity ratio <= grindingTaskRatio even with many tasks", () => {
    // Generate enough tasks where low ratio is at most grindingTaskRatio
    fc.assert(
      fc.property(
        fc.integer({ min: config.anomaly.grindingTaskCount + 1, max: 80 }),
        totalCount => {
          // Ensure low count / total <= grindingTaskRatio
          const maxLow = Math.floor(
            totalCount * config.anomaly.grindingTaskRatio
          );
          const lowCount = maxLow; // exactly at threshold (<=), not grinding
          const nonLowCount = totalCount - lowCount;

          const tasks: TaskSummary[] = [];
          for (let i = 0; i < lowCount; i++) {
            tasks.push({
              taskId: String(i),
              complexity: "low",
              completedAt: new Date(
                Date.now() - (i + 1) * 60_000
              ).toISOString(),
            });
          }
          for (let i = 0; i < nonLowCount; i++) {
            tasks.push({
              taskId: String(lowCount + i),
              complexity: "medium",
              completedAt: new Date(
                Date.now() - (lowCount + i + 1) * 60_000
              ).toISOString(),
            });
          }

          const result = detector.checkGrindingPattern(AGENT_ID, tasks);

          // lowCount / totalCount = floor(total * 0.8) / total <= 0.8
          expect(result.isGrinding).toBe(false);
          expect(result.weight).toBe(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("ignores tasks older than 24 hours", () => {
    fc.assert(
      fc.property(
        fc.array(taskSummaryArb(oldTimestampArb), {
          minLength: 1,
          maxLength: 50,
        }),
        oldTasks => {
          // Even if all are low-complexity and many, they are outside 24h window
          const allLow = oldTasks.map(t => ({
            ...t,
            complexity: "low" as const,
          }));
          const result = detector.checkGrindingPattern(AGENT_ID, allLow);

          expect(result.isGrinding).toBe(false);
          expect(result.lowComplexityRatio).toBe(0);
          expect(result.weight).toBe(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("works correctly with configurable anomaly parameters", () => {
    fc.assert(
      fc.property(
        fc.record({
          grindingTaskRatio: fc.double({ min: 0.5, max: 0.95, noNaN: true }),
          grindingTaskCount: fc.integer({ min: 5, max: 50 }),
          lowComplexityWeight: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        }),
        fc.array(taskSummaryArb(recentTimestampArb), {
          minLength: 0,
          maxLength: 60,
        }),
        (anomalyParams, tasks) => {
          const customConfig: ReputationConfig = {
            ...config,
            anomaly: { ...config.anomaly, ...anomalyParams },
          };
          const customDetector = new AnomalyDetector(customConfig);
          const result = customDetector.checkGrindingPattern(AGENT_ID, tasks);

          // Recompute expected
          const now = Date.now();
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;
          const tasksIn24h = tasks.filter(t => {
            const taskTime = new Date(t.completedAt).getTime();
            return now - taskTime <= twentyFourHoursMs;
          });

          const totalCount = tasksIn24h.length;
          const lowCount = tasksIn24h.filter(
            t => t.complexity === "low"
          ).length;
          const expectedRatio = totalCount > 0 ? lowCount / totalCount : 0;

          const expectedGrinding =
            expectedRatio > anomalyParams.grindingTaskRatio &&
            totalCount > anomalyParams.grindingTaskCount;

          expect(result.isGrinding).toBe(expectedGrinding);
          expect(result.weight).toBe(
            expectedGrinding ? anomalyParams.lowComplexityWeight : 1.0
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
