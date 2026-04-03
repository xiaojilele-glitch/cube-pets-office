import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

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
} from '../../shared/mission/contracts.js';

import {
  MISSION_STATUSES,
  MISSION_STAGE_STATUSES,
  MISSION_EVENT_TYPES,
  MISSION_EVENT_LEVELS,
} from '../../shared/mission/contracts.js';

// ── Arbitraries (reused pattern from p1) ──

const arbMissionStatus: fc.Arbitrary<MissionStatus> = fc.constantFrom(...MISSION_STATUSES);
const arbStageStatus: fc.Arbitrary<MissionStageStatus> = fc.constantFrom(...MISSION_STAGE_STATUSES);
const arbEventType: fc.Arbitrary<MissionEventType> = fc.constantFrom(...MISSION_EVENT_TYPES);
const arbEventLevel: fc.Arbitrary<MissionEventLevel> = fc.constantFrom(...MISSION_EVENT_LEVELS);

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
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  level: fc.option(arbEventLevel, { nil: undefined }),
  time: fc.nat(),
  source: fc.option(
    fc.constantFrom('mission-core' as const, 'executor' as const, 'feishu' as const, 'brain' as const, 'user' as const),
    { nil: undefined },
  ),
});

const arbOrganization: fc.Arbitrary<MissionOrganizationSnapshot> = fc.record({
  departments: fc.array(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 20 }),
      label: fc.string({ minLength: 1, maxLength: 30 }),
      managerName: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  agentCount: fc.nat({ max: 50 }),
});

const arbWorkPackageStatus = fc.constantFrom(
  'pending' as const, 'running' as const, 'passed' as const, 'failed' as const, 'verified' as const,
);

const arbWorkPackage: fc.Arbitrary<MissionWorkPackage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  workerId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
  assignee: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  description: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  status: arbWorkPackageStatus,
  score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  deliverable: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  feedback: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
});

const arbMessageLogEntry: fc.Arbitrary<MissionMessageLogEntry> = fc.record({
  sender: fc.string({ minLength: 1, maxLength: 20 }),
  content: fc.string({ minLength: 1, maxLength: 80 }),
  time: fc.nat(),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
});

const arbAgentCrewRole = fc.constantFrom('ceo' as const, 'manager' as const, 'worker' as const);
const arbAgentCrewStatus = fc.constantFrom(
  'idle' as const, 'working' as const, 'thinking' as const, 'done' as const, 'error' as const,
);

const arbAgentCrewMember: fc.Arbitrary<MissionAgentCrewMember> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  role: arbAgentCrewRole,
  department: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  status: arbAgentCrewStatus,
});

/** Core required fields for any MissionRecord. */
const arbCoreMissionRecord = fc.record({
  id: fc.uuid(),
  kind: fc.string({ minLength: 1, maxLength: 20 }),
  title: fc.string({ minLength: 1, maxLength: 60 }),
  sourceText: fc.option(fc.string({ maxLength: 80 }), { nil: undefined }),
  topicId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  status: arbMissionStatus,
  progress: fc.integer({ min: 0, max: 100 }),
  currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  stages: fc.array(arbStage, { minLength: 1, maxLength: 6 }),
  summary: fc.option(fc.string({ maxLength: 120 }), { nil: undefined }),
  createdAt: fc.nat(),
  updatedAt: fc.nat(),
  completedAt: fc.option(fc.nat(), { nil: undefined }),
  events: fc.array(arbEvent, { minLength: 0, maxLength: 10 }),
});

// ── Derivation rules (specification under test) ──

/**
 * These functions encode the derivation rules from the design doc / requirement 3.2.
 * They are the SPECIFICATION of how summary fields must be derived from MissionRecord.
 */

function deriveDepartmentLabels(mission: MissionRecord): string[] {
  return mission.organization?.departments.map(d => d.label) ?? [];
}

function deriveTaskCount(mission: MissionRecord): number {
  return mission.workPackages?.length ?? 0;
}

function deriveCompletedTaskCount(mission: MissionRecord): number {
  return mission.workPackages?.filter(
    wp => wp.status === 'passed' || wp.status === 'verified',
  ).length ?? 0;
}

function deriveMessageCount(mission: MissionRecord): number {
  return mission.messageLog?.length ?? 0;
}

function deriveActiveAgentCount(mission: MissionRecord): number {
  return mission.agentCrew?.filter(
    a => a.status === 'working' || a.status === 'thinking',
  ).length ?? 0;
}

// ── Property Tests ──
// Feature: workflow-decoupling, Property 3: 原生 Summary 构建完整性
// **Validates: Requirements 3.2**

describe('Feature: workflow-decoupling, Property 3: 原生 Summary 构建完整性', () => {
  it('departmentLabels derives from organization.departments', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        arbOrganization,
        (core, organization) => {
          const mission: MissionRecord = { ...core, organization } as MissionRecord;
          const labels = deriveDepartmentLabels(mission);

          expect(labels).toEqual(organization.departments.map(d => d.label));
          expect(labels.length).toBe(organization.departments.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('taskCount equals workPackages.length', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 10 }),
        (core, workPackages) => {
          const mission: MissionRecord = { ...core, workPackages } as MissionRecord;
          expect(deriveTaskCount(mission)).toBe(workPackages.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('completedTaskCount equals workPackages filtered by passed or verified', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 10 }),
        (core, workPackages) => {
          const mission: MissionRecord = { ...core, workPackages } as MissionRecord;
          const expected = workPackages.filter(
            wp => wp.status === 'passed' || wp.status === 'verified',
          ).length;
          expect(deriveCompletedTaskCount(mission)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('messageCount equals messageLog.length', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbMessageLogEntry, { minLength: 0, maxLength: 15 }),
        (core, messageLog) => {
          const mission: MissionRecord = { ...core, messageLog } as MissionRecord;
          expect(deriveMessageCount(mission)).toBe(messageLog.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('activeAgentCount equals agentCrew filtered by working or thinking', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 10 }),
        (core, agentCrew) => {
          const mission: MissionRecord = { ...core, agentCrew } as MissionRecord;
          const expected = agentCrew.filter(
            a => a.status === 'working' || a.status === 'thinking',
          ).length;
          expect(deriveActiveAgentCount(mission)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when enrichment fields are undefined, defaults are used', () => {
    fc.assert(
      fc.property(arbCoreMissionRecord, (core) => {
        const mission: MissionRecord = { ...core } as MissionRecord;

        // No enrichment fields → defaults
        expect(deriveDepartmentLabels(mission)).toEqual([]);
        expect(deriveTaskCount(mission)).toBe(0);
        expect(deriveCompletedTaskCount(mission)).toBe(0);
        expect(deriveMessageCount(mission)).toBe(0);
        expect(deriveActiveAgentCount(mission)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('completedTaskCount <= taskCount always holds', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(fc.array(arbWorkPackage, { minLength: 0, maxLength: 10 }), { nil: undefined }),
        (core, workPackages) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (workPackages !== undefined) mission.workPackages = workPackages;

          const total = deriveTaskCount(mission);
          const completed = deriveCompletedTaskCount(mission);
          expect(completed).toBeLessThanOrEqual(total);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('activeAgentCount <= total agentCrew length always holds', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 10 }), { nil: undefined }),
        (core, agentCrew) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (agentCrew !== undefined) mission.agentCrew = agentCrew;

          const totalCrew = mission.agentCrew?.length ?? 0;
          const active = deriveActiveAgentCount(mission);
          expect(active).toBeLessThanOrEqual(totalCrew);
        },
      ),
      { numRuns: 100 },
    );
  });
});
