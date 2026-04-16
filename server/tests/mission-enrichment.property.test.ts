import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  MissionOrganizationSnapshot,
  MissionWorkPackage,
  MissionMessageLogEntry,
} from "../../shared/mission/contracts.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";

/* ─── Arbitraries ─── */

const arbDepartment = fc.record({
  key: fc
    .string({ minLength: 1, maxLength: 12 })
    .map(s => s.replace(/\s/g, "_") || "dept"),
  label: fc.string({ minLength: 1, maxLength: 20 }),
  managerName: fc.option(fc.string({ minLength: 1, maxLength: 16 }), {
    nil: undefined,
  }),
});

const arbOrganization: fc.Arbitrary<MissionOrganizationSnapshot> = fc.record({
  departments: fc.array(arbDepartment, { minLength: 1, maxLength: 5 }),
  agentCount: fc.integer({ min: 1, max: 20 }),
});

const arbWpStatus = fc.constantFrom(
  "pending" as const,
  "running" as const,
  "passed" as const,
  "failed" as const,
  "verified" as const
);

const arbWorkPackage: fc.Arbitrary<MissionWorkPackage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).map(s => `wp_${s}`),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  assignee: fc.option(fc.string({ minLength: 1, maxLength: 16 }), {
    nil: undefined,
  }),
  stageKey: fc
    .string({ minLength: 1, maxLength: 12 })
    .map(s => s.replace(/\s/g, "_") || "stg"),
  status: arbWpStatus,
  score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  deliverable: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  feedback: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
});

const arbMessageLogEntry: fc.Arbitrary<MissionMessageLogEntry> = fc.record({
  sender: fc.string({ minLength: 1, maxLength: 16 }),
  content: fc.string({ minLength: 1, maxLength: 80 }),
  time: fc.nat({ max: 2000000000000 }),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
    nil: undefined,
  }),
});

/* ─── Helpers ─── */

function createRuntime(): MissionRuntime {
  return new MissionRuntime({
    store: new MissionStore(null),
    autoRecover: false,
  });
}

/* ─── Property 5: 阶段完成时数据丰富化 ─── */
/* **Validates: Requirements 3.4** */

describe("Feature: mission-native-projection, Property 5: 阶段完成时数据丰富化", () => {
  it("patchEnrichment with organization results in mission containing that organization", () => {
    fc.assert(
      fc.property(arbOrganization, org => {
        const runtime = createRuntime();
        const task = runtime.createTask({
          kind: "chat",
          title: "Enrichment test",
          stageLabels: [
            { key: "receive", label: "Receive task" },
            { key: "execute", label: "Run execution" },
          ],
        });
        runtime.markMissionRunning(task.id, "receive", "Started", 10);

        const enriched = runtime.patchEnrichment(task.id, {
          organization: org,
        });

        expect(enriched).toBeDefined();
        expect(enriched!.organization).toBeDefined();
        expect(enriched!.organization!.departments).toHaveLength(
          org.departments.length
        );
        expect(enriched!.organization!.agentCount).toBe(org.agentCount);
      }),
      { numRuns: 100 }
    );
  });

  it("patchEnrichment with workPackages results in mission containing those workPackages", () => {
    fc.assert(
      fc.property(
        fc.array(arbWorkPackage, { minLength: 1, maxLength: 8 }),
        workPackages => {
          const runtime = createRuntime();
          const task = runtime.createTask({
            kind: "chat",
            title: "WP enrichment test",
            stageLabels: [{ key: "receive", label: "Receive task" }],
          });
          runtime.markMissionRunning(task.id, "receive", "Started", 10);

          const enriched = runtime.patchEnrichment(task.id, { workPackages });

          expect(enriched).toBeDefined();
          expect(enriched!.workPackages).toBeDefined();
          expect(enriched!.workPackages).toHaveLength(workPackages.length);
          for (let i = 0; i < workPackages.length; i++) {
            expect(enriched!.workPackages![i].id).toBe(workPackages[i].id);
            expect(enriched!.workPackages![i].status).toBe(
              workPackages[i].status
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("patchEnrichment with messageLog results in mission containing those messages", () => {
    fc.assert(
      fc.property(
        fc.array(arbMessageLogEntry, { minLength: 1, maxLength: 10 }),
        messageLog => {
          const runtime = createRuntime();
          const task = runtime.createTask({
            kind: "chat",
            title: "Message enrichment test",
            stageLabels: [{ key: "receive", label: "Receive task" }],
          });
          runtime.markMissionRunning(task.id, "receive", "Started", 10);

          const enriched = runtime.patchEnrichment(task.id, { messageLog });

          expect(enriched).toBeDefined();
          expect(enriched!.messageLog).toBeDefined();
          expect(enriched!.messageLog).toHaveLength(messageLog.length);
          for (let i = 0; i < messageLog.length; i++) {
            expect(enriched!.messageLog![i].sender).toBe(messageLog[i].sender);
            expect(enriched!.messageLog![i].content).toBe(
              messageLog[i].content
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("enrichment does not affect existing mission fields (id, title, status, stages)", () => {
    fc.assert(
      fc.property(
        arbOrganization,
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 4 }),
        fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 4 }),
        (org, workPackages, messageLog) => {
          const runtime = createRuntime();
          const task = runtime.createTask({
            kind: "chat",
            title: "Preserve fields test",
            stageLabels: [
              { key: "receive", label: "Receive task" },
              { key: "execute", label: "Run execution" },
            ],
          });
          runtime.markMissionRunning(task.id, "receive", "Started", 25);

          const before = runtime.getTask(task.id)!;
          const beforeId = before.id;
          const beforeTitle = before.title;
          const beforeStageCount = before.stages.length;

          runtime.patchEnrichment(task.id, {
            organization: org,
            workPackages,
            messageLog,
          });

          const after = runtime.getTask(task.id)!;
          expect(after.id).toBe(beforeId);
          expect(after.title).toBe(beforeTitle);
          expect(after.stages).toHaveLength(beforeStageCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
