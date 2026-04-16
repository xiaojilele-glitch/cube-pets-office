import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { MissionOrchestrator } from "../core/mission-orchestrator.js";
import type { ExecutorEvent } from "../../shared/executor/contracts.js";

// ── Helpers ──

function createExecutorClientStub() {
  return {
    dispatchPlan: vi.fn(async () => ({
      request: { executor: "lobster", requestId: "req_1" },
      response: { jobId: "job_1", receivedAt: "2026-03-30T10:00:00.000Z" },
    })),
  } as any;
}

async function startMission() {
  const orchestrator = new MissionOrchestrator({
    executorClient: createExecutorClientStub(),
  });
  const result = await orchestrator.startMission({
    title: "Property test mission",
    sourceText: "Testing enrichment completeness.",
    workspaceRoot: "C:/workspace/demo",
  });
  return { orchestrator, mission: result.mission };
}

// ── Arbitraries ──

const VALID_WP_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "verified",
] as const;

/** Non-empty trimmed string (guaranteed to survive trim validation). */
const arbNonEmptyStr = (maxLen = 20) =>
  fc
    .string({ minLength: 1, maxLength: maxLen })
    .filter(s => s.trim().length > 0);

/** A single valid department entry. */
const arbDepartment = fc.record({
  key: arbNonEmptyStr(),
  label: arbNonEmptyStr(30),
  managerName: fc.option(arbNonEmptyStr(), { nil: undefined }),
});

/** Valid organization payload with at least one valid department. */
const arbOrganizationPayload = fc.record({
  departments: fc.array(arbDepartment, { minLength: 1, maxLength: 5 }),
  agentCount: fc.nat({ max: 50 }),
});

/** A single valid work package entry. */
const arbWorkPackage = fc.record({
  id: arbNonEmptyStr(),
  title: arbNonEmptyStr(40),
  stageKey: arbNonEmptyStr(),
  status: fc.constantFrom(...VALID_WP_STATUSES),
  assignee: fc.option(arbNonEmptyStr(), { nil: undefined }),
  score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  deliverable: fc.option(arbNonEmptyStr(60), { nil: undefined }),
  feedback: fc.option(arbNonEmptyStr(60), { nil: undefined }),
});

/** Valid workPackages payload with at least one valid entry. */
const arbWorkPackagesPayload = fc.array(arbWorkPackage, {
  minLength: 1,
  maxLength: 8,
});

/** A single valid message log entry. */
const arbMessageEntry = fc.record({
  sender: arbNonEmptyStr(),
  content: arbNonEmptyStr(80),
  time: fc.nat(),
  stageKey: fc.option(arbNonEmptyStr(), { nil: undefined }),
});

/** Valid messageLog payload with at least one valid entry. */
const arbMessageLogPayload = fc.array(arbMessageEntry, {
  minLength: 1,
  maxLength: 20,
});

/** Build a job.completed ExecutorEvent with the given enrichment payload. */
function buildCompletedEvent(
  missionId: string,
  payload: Record<string, unknown>
): ExecutorEvent {
  return {
    version: "2026-03-28",
    eventId: `evt_${Date.now()}`,
    missionId,
    jobId: "job_1",
    executor: "lobster",
    type: "job.completed",
    status: "completed",
    occurredAt: new Date().toISOString(),
    progress: 100,
    message: "Mission completed",
    summary: "All done",
    payload,
  };
}

/** Build a job.progress ExecutorEvent with the given enrichment payload. */
function buildProgressEvent(
  missionId: string,
  payload: Record<string, unknown>
): ExecutorEvent {
  return {
    version: "2026-03-28",
    eventId: `evt_${Date.now()}`,
    missionId,
    jobId: "job_1",
    executor: "lobster",
    type: "job.progress",
    status: "running",
    occurredAt: new Date().toISOString(),
    progress: 50,
    message: "In progress",
    payload,
  };
}

// ── Property Tests ──
// Feature: workflow-decoupling, Property 2: 阶段完成丰富化完整性
// **Validates: Requirements 2.5, 2.6**

describe("Feature: workflow-decoupling, Property 2: 阶段完成丰富化完整性", () => {
  it("organization field is populated when job.completed event contains valid organization data", () => {
    fc.assert(
      fc.asyncProperty(arbOrganizationPayload, async orgPayload => {
        const { orchestrator, mission } = await startMission();

        const completed = await orchestrator.applyExecutorEvent(
          buildCompletedEvent(mission.id, { organization: orgPayload })
        );

        expect(completed.status).toBe("done");
        expect(completed.organization).toBeDefined();
        expect(completed.organization!.departments.length).toBeGreaterThan(0);

        // Every department in the result should have non-empty key and label
        for (const dept of completed.organization!.departments) {
          expect(dept.key.trim().length).toBeGreaterThan(0);
          expect(dept.label.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("workPackages field is populated when job.completed event contains valid workPackages data", () => {
    fc.assert(
      fc.asyncProperty(arbWorkPackagesPayload, async wpPayload => {
        const { orchestrator, mission } = await startMission();

        const completed = await orchestrator.applyExecutorEvent(
          buildCompletedEvent(mission.id, { workPackages: wpPayload })
        );

        expect(completed.status).toBe("done");
        expect(completed.workPackages).toBeDefined();
        expect(completed.workPackages!.length).toBeGreaterThan(0);

        const validStatuses = new Set(VALID_WP_STATUSES);
        for (const wp of completed.workPackages!) {
          expect(wp.id.trim().length).toBeGreaterThan(0);
          expect(wp.title!.trim().length).toBeGreaterThan(0);
          expect(validStatuses.has(wp.status)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("messageLog field is populated when job.completed event contains valid messageLog data", () => {
    fc.assert(
      fc.asyncProperty(arbMessageLogPayload, async msgPayload => {
        const { orchestrator, mission } = await startMission();

        const completed = await orchestrator.applyExecutorEvent(
          buildCompletedEvent(mission.id, { messageLog: msgPayload })
        );

        expect(completed.status).toBe("done");
        expect(completed.messageLog).toBeDefined();
        expect(completed.messageLog!.length).toBeGreaterThan(0);

        for (const entry of completed.messageLog!) {
          expect(entry.sender.trim().length).toBeGreaterThan(0);
          expect(entry.content.trim().length).toBeGreaterThan(0);
          expect(typeof entry.time).toBe("number");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("all enrichment fields are correctly extracted when job.completed event contains all three", () => {
    fc.assert(
      fc.asyncProperty(
        arbOrganizationPayload,
        arbWorkPackagesPayload,
        arbMessageLogPayload,
        async (orgPayload, wpPayload, msgPayload) => {
          const { orchestrator, mission } = await startMission();

          const completed = await orchestrator.applyExecutorEvent(
            buildCompletedEvent(mission.id, {
              organization: orgPayload,
              workPackages: wpPayload,
              messageLog: msgPayload,
            })
          );

          expect(completed.status).toBe("done");

          // Organization populated
          expect(completed.organization).toBeDefined();
          expect(completed.organization!.departments.length).toBeGreaterThan(0);

          // WorkPackages populated
          expect(completed.workPackages).toBeDefined();
          expect(completed.workPackages!.length).toBeGreaterThan(0);

          // MessageLog populated
          expect(completed.messageLog).toBeDefined();
          expect(completed.messageLog!.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("enrichment does NOT happen on job.progress events, only on job.completed", () => {
    fc.assert(
      fc.asyncProperty(
        arbOrganizationPayload,
        arbWorkPackagesPayload,
        arbMessageLogPayload,
        async (orgPayload, wpPayload, msgPayload) => {
          const { orchestrator, mission } = await startMission();

          const running = await orchestrator.applyExecutorEvent(
            buildProgressEvent(mission.id, {
              organization: orgPayload,
              workPackages: wpPayload,
              messageLog: msgPayload,
            })
          );

          expect(running.status).toBe("running");
          expect(running.organization).toBeUndefined();
          expect(running.workPackages).toBeUndefined();
          expect(running.messageLog).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
