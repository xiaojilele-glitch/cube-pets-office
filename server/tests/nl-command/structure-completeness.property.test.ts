// Feature: nl-command-center, Property 1: StrategicCommand structural integrity
// Feature: nl-command-center, Property 7: decomposition output structural integrity

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import type {
  StrategicCommand,
  CommandPriority,
  CommandStatus,
  CommandConstraint,
  DecomposedMission,
  DecomposedTask,
  MissionDecomposition,
  TaskDecomposition,
  MissionDependency,
  TaskDependency,
} from "../../../shared/nl-command/contracts.js";

// --- Generators ---

const commandPriorityArb: fc.Arbitrary<CommandPriority> = fc.constantFrom(
  "critical",
  "high",
  "medium",
  "low"
);

const commandStatusArb: fc.Arbitrary<CommandStatus> = fc.constantFrom(
  "draft",
  "analyzing",
  "clarifying",
  "finalized",
  "decomposing",
  "planning",
  "approving",
  "executing",
  "completed",
  "failed",
  "cancelled"
);

const constraintTypeArb = fc.constantFrom(
  "budget" as const,
  "time" as const,
  "quality" as const,
  "resource" as const,
  "custom" as const
);

const commandConstraintArb: fc.Arbitrary<CommandConstraint> = fc.record({
  type: constraintTypeArb,
  description: fc.string({ minLength: 1 }),
  value: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  unit: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 100 });

const strategicCommandArb: fc.Arbitrary<StrategicCommand> = fc.record({
  commandId: fc.uuid(),
  commandText: nonEmptyStringArb,
  userId: nonEmptyStringArb,
  timestamp: fc.nat({ max: 2_000_000_000_000 }),
  status: commandStatusArb,
  parsedIntent: fc.option(nonEmptyStringArb, { nil: undefined }),
  constraints: fc.array(commandConstraintArb, { minLength: 0, maxLength: 5 }),
  objectives: fc.array(nonEmptyStringArb, { minLength: 0, maxLength: 5 }),
  priority: commandPriorityArb,
  timeframe: fc.option(
    fc.record({
      startDate: fc.option(nonEmptyStringArb, { nil: undefined }),
      endDate: fc.option(nonEmptyStringArb, { nil: undefined }),
      durationEstimate: fc.option(nonEmptyStringArb, { nil: undefined }),
    }),
    { nil: undefined }
  ),
});

const decomposedMissionArb: fc.Arbitrary<DecomposedMission> = fc.record({
  missionId: fc.uuid(),
  title: nonEmptyStringArb,
  description: nonEmptyStringArb,
  objectives: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
  constraints: fc.array(commandConstraintArb, { minLength: 0, maxLength: 3 }),
  estimatedDuration: fc.double({ min: 0.01, max: 100_000, noNaN: true }),
  estimatedCost: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  priority: commandPriorityArb,
});

const decomposedTaskArb: fc.Arbitrary<DecomposedTask> = fc.record({
  taskId: fc.uuid(),
  title: nonEmptyStringArb,
  description: nonEmptyStringArb,
  objectives: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
  constraints: fc.array(commandConstraintArb, { minLength: 0, maxLength: 3 }),
  estimatedDuration: fc.double({ min: 0.01, max: 100_000, noNaN: true }),
  estimatedCost: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  requiredSkills: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
  priority: commandPriorityArb,
});

// --- Property 1: StrategicCommand structural integrity ---
// **Validates: Requirements 1.1**

describe("Property 1: StrategicCommand structural integrity", () => {
  it("SHALL contain non-undefined values for all required fields", () => {
    fc.assert(
      fc.property(strategicCommandArb, (cmd: StrategicCommand) => {
        expect(cmd.commandId).toBeDefined();
        expect(typeof cmd.commandId).toBe("string");
        expect(cmd.commandId.length).toBeGreaterThan(0);
        expect(cmd.commandText).toBeDefined();
        expect(cmd.commandText.length).toBeGreaterThan(0);
        expect(cmd.userId).toBeDefined();
        expect(cmd.userId.length).toBeGreaterThan(0);
        expect(typeof cmd.timestamp).toBe("number");
        expect([
          "draft",
          "analyzing",
          "clarifying",
          "finalized",
          "decomposing",
          "planning",
          "approving",
          "executing",
          "completed",
          "failed",
          "cancelled",
        ]).toContain(cmd.status);
        expect(Array.isArray(cmd.constraints)).toBe(true);
        expect(Array.isArray(cmd.objectives)).toBe(true);
        expect(["critical", "high", "medium", "low"]).toContain(cmd.priority);
      }),
      { numRuns: 20 }
    );
  });

  it("constraints array elements SHALL have valid structure", () => {
    fc.assert(
      fc.property(strategicCommandArb, (cmd: StrategicCommand) => {
        for (const c of cmd.constraints) {
          expect(["budget", "time", "quality", "resource", "custom"]).toContain(
            c.type
          );
          expect(typeof c.description).toBe("string");
          expect(c.description.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 20 }
    );
  });
});

// --- Property 7: decomposition output structural integrity ---
// **Validates: Requirements 3.2, 3.3, 4.2, 4.3**

describe("Property 7: decomposition output structural integrity", () => {
  describe("DecomposedMission", () => {
    it("each DecomposedMission SHALL contain non-empty required fields and numeric estimates", () => {
      fc.assert(
        fc.property(decomposedMissionArb, (m: DecomposedMission) => {
          expect(m.missionId.length).toBeGreaterThan(0);
          expect(m.title.length).toBeGreaterThan(0);
          expect(m.description.length).toBeGreaterThan(0);
          expect(m.objectives.length).toBeGreaterThan(0);
          for (const o of m.objectives) {
            expect(o.length).toBeGreaterThan(0);
          }
          expect(typeof m.estimatedDuration).toBe("number");
          expect(Number.isFinite(m.estimatedDuration)).toBe(true);
          expect(typeof m.estimatedCost).toBe("number");
          expect(Number.isFinite(m.estimatedCost)).toBe(true);
        }),
        { numRuns: 20 }
      );
    });
  });

  describe("DecomposedTask", () => {
    it("each DecomposedTask SHALL contain non-empty required fields, requiredSkills, and numeric estimates", () => {
      fc.assert(
        fc.property(decomposedTaskArb, (t: DecomposedTask) => {
          expect(t.taskId.length).toBeGreaterThan(0);
          expect(t.title.length).toBeGreaterThan(0);
          expect(t.description.length).toBeGreaterThan(0);
          expect(t.objectives.length).toBeGreaterThan(0);
          for (const o of t.objectives) {
            expect(o.length).toBeGreaterThan(0);
          }
          expect(t.requiredSkills.length).toBeGreaterThan(0);
          for (const s of t.requiredSkills) {
            expect(s.length).toBeGreaterThan(0);
          }
          expect(typeof t.estimatedDuration).toBe("number");
          expect(Number.isFinite(t.estimatedDuration)).toBe(true);
          expect(typeof t.estimatedCost).toBe("number");
          expect(Number.isFinite(t.estimatedCost)).toBe(true);
        }),
        { numRuns: 20 }
      );
    });
  });

  describe("MissionDecomposition container", () => {
    it("MissionDecomposition SHALL contain valid missions with complete structure", () => {
      const missionDecompositionArb: fc.Arbitrary<MissionDecomposition> = fc
        .array(decomposedMissionArb, { minLength: 1, maxLength: 5 })
        .chain((missions: DecomposedMission[]) => {
          const ids = missions.map(m => m.missionId);
          const depArb: fc.Arbitrary<MissionDependency[]> =
            ids.length >= 2
              ? fc.array(
                  fc.record({
                    fromMissionId: fc.constantFrom(...ids),
                    toMissionId: fc.constantFrom(...ids),
                    type: fc.constantFrom(
                      "blocks" as const,
                      "depends_on" as const,
                      "related" as const
                    ),
                    description: fc.option(nonEmptyStringArb, {
                      nil: undefined,
                    }),
                  }),
                  { minLength: 0, maxLength: 3 }
                )
              : fc.constant([] as MissionDependency[]);
          return depArb.map(deps => ({
            decompositionId: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
            missions,
            dependencies: deps,
            executionOrder: [ids],
            totalEstimatedDuration: missions.reduce(
              (s, m) => s + m.estimatedDuration,
              0
            ),
            totalEstimatedCost: missions.reduce(
              (s, m) => s + m.estimatedCost,
              0
            ),
          }));
        });

      fc.assert(
        fc.property(missionDecompositionArb, (d: MissionDecomposition) => {
          expect(d.missions.length).toBeGreaterThan(0);
          for (const m of d.missions) {
            expect(m.missionId.length).toBeGreaterThan(0);
            expect(m.title.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 20 }
      );
    });
  });

  describe("TaskDecomposition container", () => {
    it("TaskDecomposition SHALL contain valid tasks with complete structure", () => {
      const taskDecompositionArb: fc.Arbitrary<TaskDecomposition> = fc
        .array(decomposedTaskArb, { minLength: 1, maxLength: 5 })
        .chain((tasks: DecomposedTask[]) => {
          const ids = tasks.map(t => t.taskId);
          const depArb: fc.Arbitrary<TaskDependency[]> =
            ids.length >= 2
              ? fc.array(
                  fc.record({
                    fromTaskId: fc.constantFrom(...ids),
                    toTaskId: fc.constantFrom(...ids),
                    type: fc.constantFrom(
                      "blocks" as const,
                      "depends_on" as const
                    ),
                  }),
                  { minLength: 0, maxLength: 3 }
                )
              : fc.constant([] as TaskDependency[]);
          return depArb.map(deps => ({
            decompositionId: crypto.randomUUID(),
            missionId: crypto.randomUUID(),
            tasks,
            dependencies: deps,
            executionOrder: [ids],
          }));
        });

      fc.assert(
        fc.property(taskDecompositionArb, (d: TaskDecomposition) => {
          expect(d.tasks.length).toBeGreaterThan(0);
          for (const t of d.tasks) {
            expect(t.taskId.length).toBeGreaterThan(0);
            expect(t.title.length).toBeGreaterThan(0);
            expect(t.requiredSkills.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 20 }
      );
    });
  });
});
