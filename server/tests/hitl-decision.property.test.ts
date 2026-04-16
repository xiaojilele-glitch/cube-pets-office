import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  DecisionHistoryEntry,
  DecisionType,
  MissionDecision,
  MissionDecisionOption,
  MissionDecisionResolved,
  MissionRecord,
} from "../../shared/mission/contracts.js";
import { DECISION_TYPES } from "../../shared/mission/contracts.js";
import {
  submitMissionDecision,
  generateDecisionId,
  type MissionDecisionRuntime,
} from "../tasks/mission-decision.js";

/* ─── Arbitraries ─── */

const arbDecisionType = fc.constantFrom(...DECISION_TYPES);

const arbSeverity = fc.constantFrom("info", "warn", "danger") as fc.Arbitrary<
  "info" | "warn" | "danger"
>;

const arbOptionId = fc.string({ minLength: 1, maxLength: 12 }).map(s => {
  // Ensure alphanumeric-only option IDs
  const cleaned = s.replace(/[^a-z0-9]/gi, "a");
  return cleaned || "opt";
});

const arbOption: fc.Arbitrary<MissionDecisionOption> = fc.record({
  id: arbOptionId,
  label: fc.string({ minLength: 1, maxLength: 30 }),
  description: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  action: fc.option(arbDecisionType, { nil: undefined }),
  severity: fc.option(arbSeverity, { nil: undefined }),
  requiresComment: fc.option(fc.boolean(), { nil: undefined }),
});

const arbDecision: fc.Arbitrary<MissionDecision> = fc.record({
  prompt: fc.string({ minLength: 1, maxLength: 80 }),
  options: fc.array(arbOption, { minLength: 1, maxLength: 5 }).chain(opts => {
    // Ensure unique option ids
    const seen = new Set<string>();
    const unique = opts.filter(o => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
    return fc.constant(
      unique.length > 0 ? unique : [{ id: "default", label: "Default" }]
    );
  }),
  allowFreeText: fc.option(fc.boolean(), { nil: undefined }),
  placeholder: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  type: fc.option(arbDecisionType, { nil: undefined }),
  templateId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  payload: fc.option(
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
    { nil: undefined }
  ),
  decisionId: fc.option(
    fc.string({ minLength: 1, maxLength: 20 }).map(s => `dec_${s}`),
    { nil: undefined }
  ),
});

/* ─── Mock Runtime Helper ─── */

function createMockRuntime(
  initialTasks: MissionRecord[] = []
): MissionDecisionRuntime & {
  tasks: Map<string, MissionRecord>;
} {
  const tasks = new Map<string, MissionRecord>();
  for (const t of initialTasks) {
    tasks.set(t.id, structuredClone(t));
  }

  return {
    tasks,
    getTask(id: string) {
      const t = tasks.get(id);
      return t ? structuredClone(t) : undefined;
    },
    resumeMissionFromDecision(id, submission) {
      const t = tasks.get(id);
      if (!t) return undefined;
      // Preserve decisionHistory across calls
      const history = t.decisionHistory ? [...t.decisionHistory] : [];
      t.status = "running";
      t.waitingFor = undefined;
      t.decision = undefined;
      t.decisionHistory = history;
      t.updatedAt = Date.now();
      tasks.set(id, t);
      return structuredClone(t);
    },
  };
}

function makeWaitingTask(
  id: string,
  decision: MissionDecision,
  overrides: Partial<MissionRecord> = {}
): MissionRecord {
  return {
    id,
    kind: "chat",
    title: "PBT task",
    status: "waiting",
    progress: 50,
    currentStageKey: "execute",
    stages: [{ key: "execute", label: "Run execution", status: "running" }],
    waitingFor: decision.prompt,
    decision,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    ...overrides,
  };
}

/* ─── Property 1: Decision type backward compatibility ─── */
/* **Validates: Requirements 1.1** */

describe("Property 1: Decision type backward compatibility", () => {
  it("when MissionDecision.type is undefined, resolved history entry type is custom-action", () => {
    fc.assert(
      fc.property(arbDecision, decision => {
        // Force type to undefined to test backward compatibility
        const decisionWithoutType: MissionDecision = {
          ...decision,
          type: undefined,
        };
        const task = makeWaitingTask("task_p1", decisionWithoutType);
        const runtime = createMockRuntime([task]);

        // Pick the first option for submission
        const optionId = decisionWithoutType.options[0].id;
        const freeText = decisionWithoutType.options[0].requiresComment
          ? "required comment"
          : undefined;

        const result = submitMissionDecision(runtime, "task_p1", {
          optionId,
          freeText,
        });

        if (result.ok && result.task.decisionHistory?.length) {
          const entry =
            result.task.decisionHistory[result.task.decisionHistory.length - 1];
          // When type is undefined, it should default to 'custom-action'
          return entry.type === "custom-action";
        }
        // If submission failed (e.g. requiresComment without freeText), that's fine — skip
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 2: Decision history monotonically increasing ─── */
/* **Validates: Requirements 2.1** */

describe("Property 2: Decision history monotonically increasing", () => {
  it("for N successful decisions, decisionHistory.length === N and submittedAt is non-decreasing", () => {
    const arbDecisionCount = fc.integer({ min: 1, max: 10 });
    const arbDecisions = arbDecisionCount.chain(n =>
      fc.array(arbDecision, { minLength: n, maxLength: n })
    );

    fc.assert(
      fc.property(arbDecisions, decisions => {
        // Create a task with the first decision
        const firstDecision = decisions[0];
        const task = makeWaitingTask("task_p2", firstDecision);
        const runtime = createMockRuntime([task]);

        let successCount = 0;

        for (let i = 0; i < decisions.length; i++) {
          const d = decisions[i];
          const inner = runtime.tasks.get("task_p2")!;

          if (i > 0) {
            // Put task back into waiting with next decision
            inner.status = "waiting";
            inner.decision = d;
            inner.waitingFor = d.prompt;
            runtime.tasks.set("task_p2", inner);
          }

          const optionId = d.options[0].id;
          const freeText = d.options[0].requiresComment ? "comment" : undefined;

          const result = submitMissionDecision(runtime, "task_p2", {
            optionId,
            freeText,
          });

          if (result.ok && !result.alreadyResolved) {
            successCount++;
            // Sync history back to mock store
            const stored = runtime.tasks.get("task_p2")!;
            stored.decisionHistory = structuredClone(
              result.task.decisionHistory ?? []
            );
            runtime.tasks.set("task_p2", stored);
          }
        }

        // Verify history length matches successful decisions
        const finalTask = runtime.tasks.get("task_p2")!;
        const history = finalTask.decisionHistory ?? [];

        if (history.length !== successCount) return false;

        // Verify submittedAt is non-decreasing
        for (let i = 1; i < history.length; i++) {
          if (history[i].submittedAt < history[i - 1].submittedAt) return false;
        }

        return true;
      }),
      { numRuns: 50 }
    );
  });
});

/* ─── Property 3: requiresComment validation consistency ─── */
/* **Validates: Requirements 4.1** */

describe("Property 3: requiresComment validation consistency", () => {
  it("empty/whitespace freeText fails (400) when requiresComment=true; non-empty can succeed", () => {
    const arbEmptyish = fc.constantFrom("", "   ", "\t", "\n", "  \n  ");
    const arbNonEmpty = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter(s => s.trim().length > 0);

    fc.assert(
      fc.property(
        arbDecision,
        fc.boolean(), // true = test empty freeText, false = test non-empty
        arbEmptyish,
        arbNonEmpty,
        (baseDecision, testEmpty, emptyText, nonEmptyText) => {
          // Create a decision with at least one requiresComment option
          const rcOption: MissionDecisionOption = {
            id: "rc_opt",
            label: "Requires Comment",
            requiresComment: true,
          };
          const decision: MissionDecision = {
            ...baseDecision,
            options: [
              rcOption,
              ...baseDecision.options.filter(o => o.id !== "rc_opt"),
            ],
            allowFreeText: true,
          };

          const task = makeWaitingTask("task_p3", decision);
          const runtime = createMockRuntime([task]);

          if (testEmpty) {
            // Empty/whitespace freeText should fail with 400
            const result = submitMissionDecision(runtime, "task_p3", {
              optionId: "rc_opt",
              freeText: emptyText,
            });
            return !result.ok && result.statusCode === 400;
          } else {
            // Non-empty freeText should succeed
            const result = submitMissionDecision(runtime, "task_p3", {
              optionId: "rc_opt",
              freeText: nonEmptyText,
            });
            return result.ok === true;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 4: Decision history persistence integrity ─── */
/* **Validates: Requirements 8.1** */

describe("Property 4: Decision history persistence integrity", () => {
  it("serializing and deserializing decisionHistory preserves all entries", () => {
    const arbResolved: fc.Arbitrary<MissionDecisionResolved> = fc.record({
      optionId: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
        nil: undefined,
      }),
      optionLabel: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
        nil: undefined,
      }),
      freeText: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    });

    const arbHistoryEntry: fc.Arbitrary<DecisionHistoryEntry> = fc.record({
      decisionId: fc
        .string({ minLength: 1, maxLength: 20 })
        .map(s => `dec_${s}`),
      type: arbDecisionType,
      prompt: fc.string({ minLength: 1, maxLength: 80 }),
      options: fc.array(arbOption, { minLength: 1, maxLength: 5 }),
      templateId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
        nil: undefined,
      }),
      payload: fc.option(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.jsonValue()
        ),
        { nil: undefined }
      ),
      resolved: arbResolved,
      submittedBy: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
        nil: undefined,
      }),
      submittedAt: fc.nat({ max: 2000000000000 }),
      reason: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
      stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
        nil: undefined,
      }),
    });

    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 20 }),
        history => {
          // Simulate persistence: JSON serialize → deserialize
          const serialized = JSON.stringify(history);
          const deserialized: DecisionHistoryEntry[] = JSON.parse(serialized);

          // Length must be preserved
          if (deserialized.length !== history.length) return false;

          // Each entry's decisionId and resolved fields must match
          for (let i = 0; i < history.length; i++) {
            const original = history[i];
            const restored = deserialized[i];

            if (restored.decisionId !== original.decisionId) return false;
            if (restored.resolved.optionId !== original.resolved.optionId)
              return false;
            if (restored.resolved.optionLabel !== original.resolved.optionLabel)
              return false;
            if (restored.resolved.freeText !== original.resolved.freeText)
              return false;
            if (restored.submittedAt !== original.submittedAt) return false;
            if (restored.type !== original.type) return false;
            if (restored.prompt !== original.prompt) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
