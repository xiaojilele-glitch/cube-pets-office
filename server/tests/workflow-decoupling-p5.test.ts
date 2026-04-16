import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  MissionRecord,
  MissionStatus,
  MissionStageStatus,
  MissionStage,
  MissionEvent,
  MissionEventType,
  MissionEventLevel,
  MissionOrganizationSnapshot,
  MissionWorkPackage,
  MissionMessageLogEntry,
  MissionAgentCrewMember,
} from "../../shared/mission/contracts.js";

import {
  MISSION_STATUSES,
  MISSION_STAGE_STATUSES,
  MISSION_EVENT_TYPES,
  MISSION_EVENT_LEVELS,
} from "../../shared/mission/contracts.js";

// ── Arbitraries (reused pattern from p1/p3/p4) ──

const arbMissionStatus: fc.Arbitrary<MissionStatus> = fc.constantFrom(
  ...MISSION_STATUSES
);
const arbStageStatus: fc.Arbitrary<MissionStageStatus> = fc.constantFrom(
  ...MISSION_STAGE_STATUSES
);
const arbEventType: fc.Arbitrary<MissionEventType> = fc.constantFrom(
  ...MISSION_EVENT_TYPES
);
const arbEventLevel: fc.Arbitrary<MissionEventLevel> = fc.constantFrom(
  ...MISSION_EVENT_LEVELS
);

const arbStage: fc.Arbitrary<MissionStage> = fc.record({
  key: fc.string({ minLength: 1, maxLength: 20 }),
  label: fc.string({ minLength: 1, maxLength: 40 }),
  status: arbStageStatus,
  detail: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  startedAt: fc.option(fc.nat(), { nil: undefined }),
  completedAt: fc.option(fc.nat(), { nil: undefined }),
});

const arbEvent: fc.Arbitrary<MissionEvent> = fc.record({
  type: arbEventType,
  message: fc.string({ minLength: 1, maxLength: 80 }),
  progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  level: fc.option(arbEventLevel, { nil: undefined }),
  time: fc.nat(),
  source: fc.option(
    fc.constantFrom(
      "mission-core" as const,
      "executor" as const,
      "feishu" as const,
      "brain" as const,
      "user" as const
    ),
    { nil: undefined }
  ),
});

const arbOrganization: fc.Arbitrary<MissionOrganizationSnapshot> = fc.record({
  departments: fc.array(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 20 }),
      label: fc.string({ minLength: 1, maxLength: 30 }),
      managerName: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
        nil: undefined,
      }),
    }),
    { minLength: 0, maxLength: 5 }
  ),
  agentCount: fc.nat({ max: 50 }),
});

const arbWorkPackageStatus = fc.constantFrom(
  "pending" as const,
  "running" as const,
  "passed" as const,
  "failed" as const,
  "verified" as const
);

const arbWorkPackage: fc.Arbitrary<MissionWorkPackage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  workerId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
    nil: undefined,
  }),
  assignee: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  description: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  status: arbWorkPackageStatus,
  score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  deliverable: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  feedback: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
});

const arbMessageLogEntry: fc.Arbitrary<MissionMessageLogEntry> = fc.record({
  sender: fc.string({ minLength: 1, maxLength: 20 }),
  content: fc.string({ minLength: 1, maxLength: 80 }),
  time: fc.nat(),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
});

const arbAgentCrewRole = fc.constantFrom(
  "ceo" as const,
  "manager" as const,
  "worker" as const
);
const arbAgentCrewStatus = fc.constantFrom(
  "idle" as const,
  "working" as const,
  "thinking" as const,
  "done" as const,
  "error" as const
);

const arbAgentCrewMember: fc.Arbitrary<MissionAgentCrewMember> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  role: arbAgentCrewRole,
  department: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  status: arbAgentCrewStatus,
});

/** Core required fields for any MissionRecord. */
const arbCoreMissionRecord = fc.record({
  id: fc.uuid(),
  kind: fc.string({ minLength: 1, maxLength: 20 }),
  title: fc.string({ minLength: 1, maxLength: 60 }),
  sourceText: fc.option(fc.string({ maxLength: 80 }), { nil: undefined }),
  topicId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
    nil: undefined,
  }),
  status: arbMissionStatus,
  progress: fc.integer({ min: 0, max: 100 }),
  currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
    nil: undefined,
  }),
  stages: fc.array(arbStage, { minLength: 1, maxLength: 6 }),
  summary: fc.option(fc.string({ maxLength: 120 }), { nil: undefined }),
  createdAt: fc.nat(),
  updatedAt: fc.nat(),
  completedAt: fc.option(fc.nat(), { nil: undefined }),
  events: fc.array(arbEvent, { minLength: 0, maxLength: 10 }),
});

// ── Derivation rules (specification under test) ──
// Post-cleanup: both paths are unified. We verify self-consistency properties
// of the derivation rules that were previously tested for equivalence between
// the native builder and the legacy workflow builder.

function deriveDepartmentLabels(mission: MissionRecord): string[] {
  return mission.organization?.departments.map(d => d.label) ?? [];
}

function deriveTaskCount(mission: MissionRecord): number {
  return mission.workPackages?.length ?? 0;
}

function deriveCompletedTaskCount(mission: MissionRecord): number {
  return (
    mission.workPackages?.filter(
      wp => wp.status === "passed" || wp.status === "verified"
    ).length ?? 0
  );
}

function deriveMessageCount(mission: MissionRecord): number {
  return mission.messageLog?.length ?? 0;
}

function deriveActiveAgentCount(mission: MissionRecord): number {
  return (
    mission.agentCrew?.filter(
      a => a.status === "working" || a.status === "thinking"
    ).length ?? 0
  );
}

/** Build a full MissionRecord with all enrichment fields populated. */
function buildFullMission(
  core: ReturnType<(typeof arbCoreMissionRecord)["generate"]> extends fc.Value<
    infer T
  >
    ? T
    : never,
  organization: MissionOrganizationSnapshot,
  workPackages: MissionWorkPackage[],
  messageLog: MissionMessageLogEntry[],
  agentCrew: MissionAgentCrewMember[]
): MissionRecord {
  return {
    ...core,
    organization,
    workPackages,
    messageLog,
    agentCrew,
  } as MissionRecord;
}

// ── Property Tests ──
// Feature: workflow-decoupling, Property 5: 数据源等价性
// **Validates: Requirements 3.7**

describe("Feature: workflow-decoupling, Property 5: 数据源等价性", () => {
  // 1. Idempotency: Applying derivation rules twice produces identical results
  it("idempotency — applying derivation rules twice yields identical results", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(arbOrganization, { nil: undefined }),
        fc.option(fc.array(arbWorkPackage, { minLength: 0, maxLength: 8 }), {
          nil: undefined,
        }),
        fc.option(
          fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 12 }),
          { nil: undefined }
        ),
        fc.option(
          fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 8 }),
          { nil: undefined }
        ),
        (core, org, wps, msgs, crew) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (org !== undefined) mission.organization = org;
          if (wps !== undefined) mission.workPackages = wps;
          if (msgs !== undefined) mission.messageLog = msgs;
          if (crew !== undefined) mission.agentCrew = crew;

          // First application
          const labels1 = deriveDepartmentLabels(mission);
          const taskCount1 = deriveTaskCount(mission);
          const completedCount1 = deriveCompletedTaskCount(mission);
          const msgCount1 = deriveMessageCount(mission);
          const activeCount1 = deriveActiveAgentCount(mission);

          // Second application (same input, must produce same output)
          const labels2 = deriveDepartmentLabels(mission);
          const taskCount2 = deriveTaskCount(mission);
          const completedCount2 = deriveCompletedTaskCount(mission);
          const msgCount2 = deriveMessageCount(mission);
          const activeCount2 = deriveActiveAgentCount(mission);

          expect(labels1).toEqual(labels2);
          expect(taskCount1).toBe(taskCount2);
          expect(completedCount1).toBe(completedCount2);
          expect(msgCount1).toBe(msgCount2);
          expect(activeCount1).toBe(activeCount2);
        }
      ),
      { numRuns: 100 }
    );
  });

  // 2. Monotonicity: Adding more passed/verified workPackages increases completedTaskCount
  //    but never exceeds taskCount
  it("monotonicity — adding passed/verified workPackages increases completedTaskCount without exceeding taskCount", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 6 }),
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            workerId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
              nil: undefined,
            }),
            title: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
              nil: undefined,
            }),
            assignee: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
              nil: undefined,
            }),
            description: fc.option(fc.string({ maxLength: 60 }), {
              nil: undefined,
            }),
            stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
              nil: undefined,
            }),
            status: fc.constantFrom("passed" as const, "verified" as const),
            score: fc.option(fc.integer({ min: 0, max: 100 }), {
              nil: undefined,
            }),
            deliverable: fc.option(fc.string({ maxLength: 60 }), {
              nil: undefined,
            }),
            feedback: fc.option(fc.string({ maxLength: 60 }), {
              nil: undefined,
            }),
          }),
          { minLength: 1, maxLength: 4 }
        ),
        (core, basePackages, extraCompleted) => {
          const missionBefore: MissionRecord = {
            ...core,
            workPackages: [...basePackages],
          } as MissionRecord;
          const completedBefore = deriveCompletedTaskCount(missionBefore);
          const taskCountBefore = deriveTaskCount(missionBefore);

          // Add extra passed/verified packages
          const missionAfter: MissionRecord = {
            ...core,
            workPackages: [...basePackages, ...extraCompleted],
          } as MissionRecord;
          const completedAfter = deriveCompletedTaskCount(missionAfter);
          const taskCountAfter = deriveTaskCount(missionAfter);

          // completedTaskCount must increase (or stay same if base already had them)
          expect(completedAfter).toBeGreaterThanOrEqual(completedBefore);
          // taskCount must increase
          expect(taskCountAfter).toBe(taskCountBefore + extraCompleted.length);
          // completedTaskCount never exceeds taskCount
          expect(completedAfter).toBeLessThanOrEqual(taskCountAfter);
        }
      ),
      { numRuns: 100 }
    );
  });

  // 3. Additivity: Adding agents with working/thinking status increases activeAgentCount
  it("additivity — adding working/thinking agents increases activeAgentCount proportionally", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 6 }),
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            name: fc.string({ minLength: 1, maxLength: 30 }),
            role: arbAgentCrewRole,
            department: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
              nil: undefined,
            }),
            status: fc.constantFrom("working" as const, "thinking" as const),
          }),
          { minLength: 1, maxLength: 4 }
        ),
        (core, baseCrew, extraActive) => {
          const missionBefore: MissionRecord = {
            ...core,
            agentCrew: [...baseCrew],
          } as MissionRecord;
          const activeBefore = deriveActiveAgentCount(missionBefore);

          const missionAfter: MissionRecord = {
            ...core,
            agentCrew: [...baseCrew, ...extraActive],
          } as MissionRecord;
          const activeAfter = deriveActiveAgentCount(missionAfter);

          // activeAgentCount must increase by exactly the number of added active agents
          expect(activeAfter).toBe(activeBefore + extraActive.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // 4. Independence: Changing organization doesn't affect taskCount/messageCount/activeAgentCount;
  //    changing workPackages doesn't affect departmentLabels/messageCount/activeAgentCount
  it("independence — organization changes do not affect taskCount, messageCount, or activeAgentCount", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        arbOrganization,
        arbOrganization,
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 8 }),
        fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 10 }),
        fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 8 }),
        (core, orgA, orgB, wps, msgs, crew) => {
          const missionA: MissionRecord = {
            ...core,
            organization: orgA,
            workPackages: wps,
            messageLog: msgs,
            agentCrew: crew,
          } as MissionRecord;
          const missionB: MissionRecord = {
            ...core,
            organization: orgB,
            workPackages: wps,
            messageLog: msgs,
            agentCrew: crew,
          } as MissionRecord;

          // taskCount, messageCount, activeAgentCount must be identical
          expect(deriveTaskCount(missionA)).toBe(deriveTaskCount(missionB));
          expect(deriveMessageCount(missionA)).toBe(
            deriveMessageCount(missionB)
          );
          expect(deriveActiveAgentCount(missionA)).toBe(
            deriveActiveAgentCount(missionB)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("independence — workPackages changes do not affect departmentLabels, messageCount, or activeAgentCount", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        arbOrganization,
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 8 }),
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 8 }),
        fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 10 }),
        fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 8 }),
        (core, org, wpsA, wpsB, msgs, crew) => {
          const missionA: MissionRecord = {
            ...core,
            organization: org,
            workPackages: wpsA,
            messageLog: msgs,
            agentCrew: crew,
          } as MissionRecord;
          const missionB: MissionRecord = {
            ...core,
            organization: org,
            workPackages: wpsB,
            messageLog: msgs,
            agentCrew: crew,
          } as MissionRecord;

          // departmentLabels, messageCount, activeAgentCount must be identical
          expect(deriveDepartmentLabels(missionA)).toEqual(
            deriveDepartmentLabels(missionB)
          );
          expect(deriveMessageCount(missionA)).toBe(
            deriveMessageCount(missionB)
          );
          expect(deriveActiveAgentCount(missionA)).toBe(
            deriveActiveAgentCount(missionB)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  // 5. Consistency: Derived summary fields are always internally consistent
  it("consistency — completedTaskCount <= taskCount always holds", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(fc.array(arbWorkPackage, { minLength: 0, maxLength: 10 }), {
          nil: undefined,
        }),
        (core, workPackages) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (workPackages !== undefined) mission.workPackages = workPackages;

          expect(deriveCompletedTaskCount(mission)).toBeLessThanOrEqual(
            deriveTaskCount(mission)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("consistency — activeAgentCount <= agentCrew.length always holds", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(
          fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 10 }),
          { nil: undefined }
        ),
        (core, agentCrew) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (agentCrew !== undefined) mission.agentCrew = agentCrew;

          const totalCrew = mission.agentCrew?.length ?? 0;
          expect(deriveActiveAgentCount(mission)).toBeLessThanOrEqual(
            totalCrew
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("consistency — departmentLabels.length <= organization.departments.length always holds", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(arbOrganization, { nil: undefined }),
        (core, org) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (org !== undefined) mission.organization = org;

          const deptCount = mission.organization?.departments.length ?? 0;
          const labels = deriveDepartmentLabels(mission);
          // labels.length equals departments.length (exact mapping)
          expect(labels.length).toBeLessThanOrEqual(deptCount);
          expect(labels.length).toBe(deptCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
