import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

// Mock client-only modules so we can import from tasks-store in a node environment
vi.mock('zustand', () => ({ create: () => () => ({}) }));
vi.mock('socket.io-client', () => ({ io: () => ({}) }));
vi.mock('../../client/src/lib/store', () => ({
  useAppStore: { getState: () => ({ runtimeMode: 'frontend' }) },
}));
vi.mock('../../client/src/lib/workflow-store', () => ({
  useWorkflowStore: { getState: () => ({}) },
}));
vi.mock('../../client/src/lib/runtime/local-runtime-client', () => ({
  localRuntime: {},
}));
vi.mock('../../client/src/lib/mission-client', () => ({
  createMission: vi.fn(),
  getMission: vi.fn(),
  listMissionEvents: vi.fn(),
  listMissions: vi.fn(),
  submitMissionDecision: vi.fn(),
}));

import { buildPlanetSummaryRecord } from '../../client/src/lib/tasks-store';
import type {
  MissionPlanetOverviewItem,
  MissionRecord,
  MissionStatus,
  MissionStageStatus,
  MissionWorkPackage,
  MissionMessageLogEntry,
  MissionOrganizationSnapshot,
} from '../../shared/mission/contracts';

/* ─── Arbitraries ─── */

const arbMissionStatus: fc.Arbitrary<MissionStatus> = fc.constantFrom(
  'queued', 'running', 'waiting', 'done', 'failed',
);

const arbStageStatus: fc.Arbitrary<MissionStageStatus> = fc.constantFrom(
  'pending', 'running', 'done', 'failed',
);

const arbWpStatus = fc.constantFrom(
  'pending' as const, 'running' as const, 'passed' as const, 'failed' as const, 'verified' as const,
);

const arbWorkPackage: fc.Arbitrary<MissionWorkPackage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }).map(s => `wp_${s}`),
  title: fc.string({ minLength: 1, maxLength: 20 }),
  assignee: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined }),
  stageKey: fc.string({ minLength: 1, maxLength: 10 }).map(s => s.replace(/\s/g, '_') || 'stg'),
  status: arbWpStatus,
  score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  deliverable: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  feedback: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
});

const arbMessageLog: fc.Arbitrary<MissionMessageLogEntry> = fc.record({
  sender: fc.string({ minLength: 1, maxLength: 12 }),
  content: fc.string({ minLength: 1, maxLength: 60 }),
  time: fc.nat({ max: 2e12 }),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
});

const arbOrganization: fc.Arbitrary<MissionOrganizationSnapshot> = fc.record({
  departments: fc.array(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 10 }).map(s => s.replace(/\s/g, '_') || 'dept'),
      label: fc.string({ minLength: 1, maxLength: 16 }),
      managerName: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  agentCount: fc.integer({ min: 1, max: 10 }),
});

function arbPlanet(): fc.Arbitrary<MissionPlanetOverviewItem> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 16 }).map(s => `planet_${s}`),
    title: fc.string({ minLength: 0, maxLength: 40 }),
    sourceText: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    summary: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
    kind: fc.string({ minLength: 0, maxLength: 12 }),
    status: arbMissionStatus,
    progress: fc.integer({ min: -10, max: 120 }),
    complexity: fc.integer({ min: 0, max: 20 }),
    radius: fc.integer({ min: 30, max: 200 }),
    position: fc.constant({ x: 0, y: 0 }),
    createdAt: fc.nat({ max: 2e12 }),
    updatedAt: fc.nat({ max: 2e12 }),
    completedAt: fc.option(fc.nat({ max: 2e12 }), { nil: undefined }),
    currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    currentStageLabel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    waitingFor: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    taskUrl: fc.string({ minLength: 1, maxLength: 20 }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 16 }), { minLength: 0, maxLength: 4 }),
  });
}

function arbMission(): fc.Arbitrary<MissionRecord> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 16 }).map(s => `mission_${s}`),
    kind: fc.string({ minLength: 1, maxLength: 12 }),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    sourceText: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    status: arbMissionStatus,
    progress: fc.integer({ min: 0, max: 100 }),
    currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    stages: fc.array(
      fc.record({
        key: fc.string({ minLength: 1, maxLength: 10 }).map(s => s.replace(/\s/g, '_') || 'stg'),
        label: fc.string({ minLength: 1, maxLength: 16 }),
        status: arbStageStatus,
      }),
      { minLength: 1, maxLength: 6 },
    ),
    createdAt: fc.nat({ max: 2e12 }),
    updatedAt: fc.nat({ max: 2e12 }),
    events: fc.array(
      fc.record({
        type: fc.constantFrom('created', 'progress', 'log', 'done', 'failed') as fc.Arbitrary<any>,
        message: fc.string({ minLength: 1, maxLength: 40 }),
        time: fc.nat({ max: 2e12 }),
        level: fc.option(fc.constantFrom('info', 'warn', 'error') as fc.Arbitrary<any>, { nil: undefined }),
      }),
      { minLength: 0, maxLength: 6 },
    ),
    organization: fc.option(arbOrganization, { nil: undefined }),
    workPackages: fc.option(fc.array(arbWorkPackage, { minLength: 0, maxLength: 6 }), { nil: undefined }),
    messageLog: fc.option(fc.array(arbMessageLog, { minLength: 0, maxLength: 6 }), { nil: undefined }),
    artifacts: fc.option(
      fc.array(
        fc.record({
          kind: fc.constantFrom('file', 'report', 'url', 'log') as fc.Arbitrary<any>,
          name: fc.string({ minLength: 1, maxLength: 16 }),
        }),
        { minLength: 0, maxLength: 4 },
      ),
      { nil: undefined },
    ),
  }) as fc.Arbitrary<MissionRecord>;
}

/* ─── Property 1: Mission 原生摘要完整性 ─── */
/* **Validates: Requirements 1.1, 1.4, 1.5** */

describe('Feature: mission-native-projection, Property 1: Mission 原生摘要完整性', () => {
  it('produces a valid MissionTaskSummary with all fields non-undefined', () => {
    fc.assert(
      fc.property(arbPlanet(), fc.option(arbMission(), { nil: undefined }), (planet, mission) => {
        const summary = buildPlanetSummaryRecord(planet, mission ?? undefined);

        // All required fields must be defined
        expect(summary.id).toBeDefined();
        expect(summary.title).toBeDefined();
        expect(typeof summary.title).toBe('string');
        expect(summary.title.length).toBeGreaterThan(0);
        expect(summary.kind).toBeDefined();
        expect(summary.status).toBeDefined();
        expect(typeof summary.progress).toBe('number');
        expect(summary.progress).toBeGreaterThanOrEqual(0);
        expect(summary.progress).toBeLessThanOrEqual(100);
        expect(summary.createdAt).toBeDefined();
        expect(summary.updatedAt).toBeDefined();
        expect(Array.isArray(summary.departmentLabels)).toBe(true);
        expect(typeof summary.taskCount).toBe('number');
        expect(typeof summary.completedTaskCount).toBe('number');
        expect(typeof summary.messageCount).toBe('number');
        expect(typeof summary.activeAgentCount).toBe('number');
      }),
      { numRuns: 100 },
    );
  });

  it('departmentLabels derives from planet.tags when non-empty', () => {
    fc.assert(
      fc.property(
        arbPlanet().map(p => ({ ...p, tags: ['Engineering', 'Design'] })),
        (planet) => {
          const summary = buildPlanetSummaryRecord(planet);
          expect(summary.departmentLabels).toEqual(['Engineering', 'Design']);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('taskCount derives from workPackages.length', () => {
    fc.assert(
      fc.property(
        arbPlanet(),
        fc.array(arbWorkPackage, { minLength: 0, maxLength: 8 }),
        (planet, workPackages) => {
          const mission: MissionRecord = {
            id: planet.id,
            kind: 'chat',
            title: planet.title || 'Test',
            status: 'running',
            progress: 50,
            stages: [{ key: 'execute', label: 'Execute', status: 'running' }],
            createdAt: 1000,
            updatedAt: 2000,
            events: [],
            workPackages,
          };
          const summary = buildPlanetSummaryRecord(planet, mission);
          expect(summary.taskCount).toBe(workPackages.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('completedTaskCount derives from workPackages filtered by passed/verified', () => {
    fc.assert(
      fc.property(
        arbPlanet(),
        fc.array(arbWorkPackage, { minLength: 1, maxLength: 8 }),
        (planet, workPackages) => {
          const mission: MissionRecord = {
            id: planet.id,
            kind: 'chat',
            title: 'Test',
            status: 'running',
            progress: 50,
            stages: [{ key: 'execute', label: 'Execute', status: 'running' }],
            createdAt: 1000,
            updatedAt: 2000,
            events: [],
            workPackages,
          };
          const summary = buildPlanetSummaryRecord(planet, mission);
          const expected = workPackages.filter(
            wp => wp.status === 'passed' || wp.status === 'verified',
          ).length;
          expect(summary.completedTaskCount).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('messageCount derives from messageLog.length', () => {
    fc.assert(
      fc.property(
        arbPlanet(),
        fc.array(arbMessageLog, { minLength: 0, maxLength: 8 }),
        (planet, messageLog) => {
          const mission: MissionRecord = {
            id: planet.id,
            kind: 'chat',
            title: 'Test',
            status: 'running',
            progress: 50,
            stages: [{ key: 'execute', label: 'Execute', status: 'running' }],
            createdAt: 1000,
            updatedAt: 2000,
            events: [],
            messageLog,
          };
          const summary = buildPlanetSummaryRecord(planet, mission);
          expect(summary.messageCount).toBe(messageLog.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
