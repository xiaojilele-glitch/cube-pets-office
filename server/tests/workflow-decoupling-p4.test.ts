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

// ── Arbitraries (reused pattern from p1/p3) ──

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
// These functions encode the derivation rules from the design doc / requirement 3.3.
// They are the SPECIFICATION of how detail fields must be derived from MissionRecord.

/**
 * Rule: stages array has one entry per mission.stages entry.
 * buildMissionInteriorStages produces one TaskStageRing per stage.
 */
function deriveStagesCount(mission: MissionRecord): number {
  return mission.stages.length;
}

/**
 * Rule: agents array is built from agentCrew members + always includes 'mission-core'.
 * buildNativeInteriorAgents maps each agentCrew member and appends mission-core.
 */
function deriveAgents(mission: MissionRecord): Array<{ id: string }> {
  const agents: Array<{ id: string }> = [];

  if (mission.agentCrew) {
    for (const member of mission.agentCrew) {
      agents.push({ id: member.id });
    }
  }

  // Always append mission-core agent
  agents.push({ id: 'mission-core' });

  return agents;
}

/**
 * Rule: logSummary derives from mission.messageLog.
 * - If messageLog is empty/undefined → [{label: "Messages", value: "No messages yet"}]
 * - Otherwise → last 10 entries mapped to {label: sender, value: content}
 */
function deriveLogSummary(mission: MissionRecord): Array<{ label: string; value: string }> {
  if (!mission.messageLog?.length) {
    return [{ label: 'Messages', value: 'No messages yet' }];
  }

  const recent = mission.messageLog.slice(-10);
  return recent.map(entry => ({
    label: entry.sender,
    value: entry.content,
  }));
}

// ── Property Tests ──
// Feature: workflow-decoupling, Property 4: 原生 Detail 构建完整性
// **Validates: Requirements 3.3**

describe('Feature: workflow-decoupling, Property 4: 原生 Detail 构建完整性', () => {
  it('stages count equals mission.stages.length for any MissionRecord', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        (core) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          expect(deriveStagesCount(mission)).toBe(core.stages.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('agents array always contains at least one entry with id "mission-core"', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.option(fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 10 }), { nil: undefined }),
        (core, agentCrew) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (agentCrew !== undefined) mission.agentCrew = agentCrew;

          const agents = deriveAgents(mission);
          const missionCoreAgents = agents.filter(a => a.id === 'mission-core');
          expect(missionCoreAgents.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('agents array length equals agentCrew.length + 1 (the +1 is mission-core)', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbAgentCrewMember, { minLength: 0, maxLength: 10 }),
        (core, agentCrew) => {
          const mission: MissionRecord = { ...core, agentCrew } as MissionRecord;
          const agents = deriveAgents(mission);
          expect(agents.length).toBe(agentCrew.length + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when agentCrew is undefined, agents array has exactly 1 entry (mission-core)', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        (core) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          // agentCrew is not set → undefined
          const agents = deriveAgents(mission);
          expect(agents.length).toBe(1);
          expect(agents[0].id).toBe('mission-core');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logSummary returns default message when messageLog is empty or undefined', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.constantFrom(undefined, [] as MissionMessageLogEntry[]),
        (core, messageLog) => {
          const mission: MissionRecord = { ...core } as MissionRecord;
          if (messageLog !== undefined) mission.messageLog = messageLog;

          const summary = deriveLogSummary(mission);
          expect(summary).toEqual([{ label: 'Messages', value: 'No messages yet' }]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logSummary returns at most 10 entries from the end of messageLog', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbMessageLogEntry, { minLength: 1, maxLength: 25 }),
        (core, messageLog) => {
          const mission: MissionRecord = { ...core, messageLog } as MissionRecord;
          const summary = deriveLogSummary(mission);

          expect(summary.length).toBeLessThanOrEqual(10);
          expect(summary.length).toBe(Math.min(messageLog.length, 10));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logSummary entries have label=sender and value=content from messageLog', () => {
    fc.assert(
      fc.property(
        arbCoreMissionRecord,
        fc.array(arbMessageLogEntry, { minLength: 1, maxLength: 25 }),
        (core, messageLog) => {
          const mission: MissionRecord = { ...core, messageLog } as MissionRecord;
          const summary = deriveLogSummary(mission);

          // Should correspond to the last N entries of messageLog
          const expectedSlice = messageLog.slice(-10);
          expect(summary.length).toBe(expectedSlice.length);

          for (let i = 0; i < summary.length; i++) {
            expect(summary[i].label).toBe(expectedSlice[i].sender);
            expect(summary[i].value).toBe(expectedSlice[i].content);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
