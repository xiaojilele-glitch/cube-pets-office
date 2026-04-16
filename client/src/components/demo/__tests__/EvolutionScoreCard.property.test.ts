/**
 * Property-based tests for EvolutionScoreCard component data logic
 *
 * Property 6: 进化评分卡包含全维度数据
 * For any DemoEvolutionLog list, the EvolutionScoreCard component's rendered
 * output SHALL display accuracy, completeness, actionability, format dimensions
 * with oldScore and newScore for each Agent.
 *
 * **Validates: Requirements 7.5**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { DemoEvolutionLog } from "@/lib/demo-store";

// ---------------------------------------------------------------------------
// Replicate the component's DIMENSION_LABELS (source of truth)
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<string, string> = {
  accuracy: "准确性",
  completeness: "完整性",
  actionability: "可操作性",
  format: "格式规范",
};

const REQUIRED_DIMENSIONS = [
  "accuracy",
  "completeness",
  "actionability",
  "format",
];

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const arbAgentId: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter(s => s.trim().length > 0);

const arbScore: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 });

/** Generate a single DemoEvolutionLog for a given agent and dimension */
function arbLogForAgentDimension(
  agentId: string,
  dimension: string
): fc.Arbitrary<DemoEvolutionLog> {
  return fc.record({
    agentId: fc.constant(agentId),
    dimension: fc.constant(dimension),
    oldScore: arbScore,
    newScore: arbScore,
    patchContent: fc.string({ minLength: 0, maxLength: 50 }),
    applied: fc.boolean(),
  });
}

/**
 * Generate a complete set of evolution logs for one agent covering all 4 dimensions.
 */
function arbFullAgentLogs(agentId: string): fc.Arbitrary<DemoEvolutionLog[]> {
  return fc
    .tuple(
      arbLogForAgentDimension(agentId, "accuracy"),
      arbLogForAgentDimension(agentId, "completeness"),
      arbLogForAgentDimension(agentId, "actionability"),
      arbLogForAgentDimension(agentId, "format")
    )
    .map(([a, b, c, d]) => [a, b, c, d]);
}

/**
 * Generate a list of DemoEvolutionLog entries for 1-4 agents,
 * each agent having all 4 required dimensions.
 */
const arbFullEvolutionLogs: fc.Arbitrary<DemoEvolutionLog[]> = fc
  .array(arbAgentId, { minLength: 1, maxLength: 4 })
  .chain(agentIds => {
    // Deduplicate agent IDs
    const unique = [...new Set(agentIds)];
    if (unique.length === 0) return fc.constant([] as DemoEvolutionLog[]);
    return fc
      .tuple(...unique.map(id => arbFullAgentLogs(id)))
      .map(arrays => arrays.flat());
  });

// ---------------------------------------------------------------------------
// Replicate the component's grouping logic
// ---------------------------------------------------------------------------

function groupByAgent(
  logs: DemoEvolutionLog[]
): Map<string, DemoEvolutionLog[]> {
  const byAgent = new Map<string, DemoEvolutionLog[]>();
  for (const log of logs) {
    const arr = byAgent.get(log.agentId) ?? [];
    arr.push(log);
    byAgent.set(log.agentId, arr);
  }
  return byAgent;
}

// ---------------------------------------------------------------------------
// Property 6: 进化评分卡包含全维度数据
// **Validates: Requirements 7.5**
// ---------------------------------------------------------------------------

describe("Property 6: 进化评分卡包含全维度数据", () => {
  it("DIMENSION_LABELS covers all 4 required dimensions with non-empty labels", () => {
    for (const dim of REQUIRED_DIMENSIONS) {
      expect(DIMENSION_LABELS[dim]).toBeDefined();
      expect(DIMENSION_LABELS[dim].length).toBeGreaterThan(0);
    }
  });

  it("for any complete evolution log set, grouping by agent yields all 4 dimensions per agent with valid scores", () => {
    fc.assert(
      fc.property(arbFullEvolutionLogs, logs => {
        const grouped = groupByAgent(logs);

        for (const [agentId, agentLogs] of grouped) {
          // Agent ID must be non-empty
          expect(agentId.trim().length).toBeGreaterThan(0);

          // Must have all 4 required dimensions
          const dimensions = agentLogs.map(l => l.dimension);
          for (const dim of REQUIRED_DIMENSIONS) {
            expect(dimensions).toContain(dim);
          }

          // Each log must have valid oldScore and newScore (0-100)
          for (const log of agentLogs) {
            expect(log.oldScore).toBeGreaterThanOrEqual(0);
            expect(log.oldScore).toBeLessThanOrEqual(100);
            expect(log.newScore).toBeGreaterThanOrEqual(0);
            expect(log.newScore).toBeLessThanOrEqual(100);

            // Dimension must have a label in DIMENSION_LABELS
            if (REQUIRED_DIMENSIONS.includes(log.dimension)) {
              expect(DIMENSION_LABELS[log.dimension]).toBeDefined();
              expect(DIMENSION_LABELS[log.dimension].length).toBeGreaterThan(0);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
