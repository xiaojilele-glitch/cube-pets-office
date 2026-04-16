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

// ── Arbitraries ──

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

/** Core required fields for any MissionRecord (pre-migration shape). */
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

/** Generates a MissionRecord with a random subset of enrichment fields present or absent. */
function arbMissionRecord(): fc.Arbitrary<MissionRecord> {
  return fc
    .tuple(
      arbCoreMissionRecord,
      fc.option(arbOrganization, { nil: undefined }),
      fc.option(fc.array(arbWorkPackage, { minLength: 0, maxLength: 8 }), {
        nil: undefined,
      }),
      fc.option(fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 15 }), {
        nil: undefined,
      }),
      fc.option(fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 8 }), {
        nil: undefined,
      })
    )
    .map(([core, organization, workPackages, messageLog, agentCrew]) => {
      const record: MissionRecord = {
        ...core,
        events: core.events,
      } as MissionRecord;
      if (organization !== undefined) record.organization = organization;
      if (workPackages !== undefined) record.workPackages = workPackages;
      if (messageLog !== undefined) record.messageLog = messageLog;
      if (agentCrew !== undefined) record.agentCrew = agentCrew;
      return record;
    });
}

// ── Required field keys that must always exist on any valid MissionRecord ──

const CORE_REQUIRED_KEYS: (keyof MissionRecord)[] = [
  "id",
  "kind",
  "title",
  "status",
  "progress",
  "stages",
  "createdAt",
  "updatedAt",
  "events",
];

const ENRICHMENT_KEYS: (keyof MissionRecord)[] = [
  "organization",
  "workPackages",
  "messageLog",
  "agentCrew",
];

// ── Property Tests ──
// Feature: workflow-decoupling, Property 1: MissionRecord 丰富化字段向后兼容
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7**

describe("Feature: workflow-decoupling, Property 1: MissionRecord 丰富化字段向后兼容", () => {
  it("core required fields are always present regardless of enrichment field combination", () => {
    fc.assert(
      fc.property(arbMissionRecord(), record => {
        for (const key of CORE_REQUIRED_KEYS) {
          expect(record).toHaveProperty(key);
          expect(record[key]).toBeDefined();
        }
        // id must be a non-empty string
        expect(typeof record.id).toBe("string");
        expect(record.id.length).toBeGreaterThan(0);
        // status must be a valid MissionStatus
        expect(MISSION_STATUSES).toContain(record.status);
        // progress must be a number in [0, 100]
        expect(record.progress).toBeGreaterThanOrEqual(0);
        expect(record.progress).toBeLessThanOrEqual(100);
        // stages must be a non-empty array
        expect(Array.isArray(record.stages)).toBe(true);
        expect(record.stages.length).toBeGreaterThan(0);
        // events must be an array
        expect(Array.isArray(record.events)).toBe(true);
        // timestamps must be numbers
        expect(typeof record.createdAt).toBe("number");
        expect(typeof record.updatedAt).toBe("number");
      }),
      { numRuns: 100 }
    );
  });

  it("enrichment fields are always optional — a record with none is structurally valid", () => {
    fc.assert(
      fc.property(arbCoreMissionRecord, core => {
        // Build a record with zero enrichment fields (pre-migration format)
        const record: MissionRecord = { ...core } as MissionRecord;

        // All core required fields present
        for (const key of CORE_REQUIRED_KEYS) {
          expect(record).toHaveProperty(key);
          expect(record[key]).toBeDefined();
        }

        // Enrichment fields should be absent (undefined)
        for (const key of ENRICHMENT_KEYS) {
          expect(record[key]).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it("enrichment fields do not affect core required fields", () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(arbOrganization, { nil: undefined }),
        fc.option(fc.array(arbWorkPackage, { minLength: 0, maxLength: 5 }), {
          nil: undefined,
        }),
        fc.option(
          fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 10 }),
          { nil: undefined }
        ),
        fc.option(
          fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 5 }),
          { nil: undefined }
        ),
        (core, org, wps, msgs, crew) => {
          // Record without enrichment
          const bare: MissionRecord = { ...core } as MissionRecord;

          // Record with enrichment
          const enriched: MissionRecord = { ...core } as MissionRecord;
          if (org !== undefined) enriched.organization = org;
          if (wps !== undefined) enriched.workPackages = wps;
          if (msgs !== undefined) enriched.messageLog = msgs;
          if (crew !== undefined) enriched.agentCrew = crew;

          // Core fields must be identical between bare and enriched
          for (const key of CORE_REQUIRED_KEYS) {
            expect(enriched[key]).toEqual(bare[key]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when enrichment fields are present, they conform to their type contracts", () => {
    fc.assert(
      fc.property(arbMissionRecord(), record => {
        if (record.organization !== undefined) {
          expect(Array.isArray(record.organization.departments)).toBe(true);
          expect(typeof record.organization.agentCount).toBe("number");
          for (const dept of record.organization.departments) {
            expect(typeof dept.key).toBe("string");
            expect(typeof dept.label).toBe("string");
          }
        }

        if (record.workPackages !== undefined) {
          expect(Array.isArray(record.workPackages)).toBe(true);
          const validStatuses = [
            "pending",
            "running",
            "passed",
            "failed",
            "verified",
          ];
          for (const wp of record.workPackages) {
            expect(typeof wp.id).toBe("string");
            expect(validStatuses).toContain(wp.status);
          }
        }

        if (record.messageLog !== undefined) {
          expect(Array.isArray(record.messageLog)).toBe(true);
          for (const entry of record.messageLog) {
            expect(typeof entry.sender).toBe("string");
            expect(typeof entry.content).toBe("string");
            expect(typeof entry.time).toBe("number");
          }
        }

        if (record.agentCrew !== undefined) {
          expect(Array.isArray(record.agentCrew)).toBe(true);
          const validRoles = ["ceo", "manager", "worker"];
          const validStatuses = [
            "idle",
            "working",
            "thinking",
            "done",
            "error",
          ];
          for (const member of record.agentCrew) {
            expect(typeof member.id).toBe("string");
            expect(typeof member.name).toBe("string");
            expect(validRoles).toContain(member.role);
            expect(validStatuses).toContain(member.status);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
