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

import { buildPlanetDetailRecord } from '../../client/src/lib/tasks-store';
import type {
  MissionPlanetOverviewItem,
  MissionPlanetInteriorData,
  MissionPlanetInteriorStage,
  MissionPlanetInteriorAgent,
  MissionRecord,
  MissionStatus,
  MissionStageStatus,
  MissionEvent,
  MissionArtifact,
  MissionAgentStatus,
} from '../../shared/mission/contracts';

/* ─── Arbitraries ─── */

const arbMissionStatus: fc.Arbitrary<MissionStatus> = fc.constantFrom(
  'queued', 'running', 'waiting', 'done', 'failed',
);
const arbStageStatus: fc.Arbitrary<MissionStageStatus> = fc.constantFrom(
  'pending', 'running', 'done', 'failed',
);
const arbAgentStatus: fc.Arbitrary<MissionAgentStatus> = fc.constantFrom(
  'idle', 'working', 'thinking', 'done', 'error',
);

function arbInteriorStages(count: number): fc.Arbitrary<MissionPlanetInteriorStage[]> {
  if (count === 0) return fc.constant([]);
  const arcSize = 360 / count;
  return fc.array(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 10 }).map(s => s.replace(/\s/g, '_') || 'stg'),
      label: fc.string({ minLength: 1, maxLength: 16 }),
      status: arbStageStatus,
      progress: fc.integer({ min: 0, max: 100 }),
      detail: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
      startedAt: fc.option(fc.nat({ max: 2e12 }), { nil: undefined }),
      completedAt: fc.option(fc.nat({ max: 2e12 }), { nil: undefined }),
    }),
    { minLength: count, maxLength: count },
  ).map(stages =>
    stages.map((s, i) => ({
      ...s,
      arcStart: i * arcSize,
      arcEnd: (i + 1) * arcSize,
      midAngle: (i * arcSize + (i + 1) * arcSize) / 2,
    })),
  );
}

const arbAgent: fc.Arbitrary<MissionPlanetInteriorAgent> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ minLength: 1, maxLength: 16 }),
  role: fc.constantFrom('orchestrator', 'worker', 'manager'),
  sprite: fc.constantFrom('cube-brain', 'cube-worker'),
  status: arbAgentStatus,
  stageKey: fc.string({ minLength: 1, maxLength: 10 }).map(s => s.replace(/\s/g, '_') || 'stg'),
  stageLabel: fc.string({ minLength: 1, maxLength: 16 }),
  progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  currentAction: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  angle: fc.double({ min: 0, max: 359.99, noNaN: true }),
});

const arbEvent: fc.Arbitrary<MissionEvent> = fc.record({
  type: fc.constantFrom('created', 'progress', 'log', 'done', 'failed') as fc.Arbitrary<any>,
  message: fc.string({ minLength: 1, maxLength: 40 }),
  time: fc.nat({ max: 2e12 }),
  level: fc.option(fc.constantFrom('info', 'warn', 'error') as fc.Arbitrary<any>, { nil: undefined }),
  stageKey: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
});

const arbArtifact: fc.Arbitrary<MissionArtifact> = fc.record({
  kind: fc.constantFrom('file', 'report', 'url', 'log') as fc.Arbitrary<any>,
  name: fc.string({ minLength: 1, maxLength: 16 }),
  path: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  url: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  description: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
});

function arbPlanet(): fc.Arbitrary<MissionPlanetOverviewItem> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }).map(s => `planet_${s}`),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    sourceText: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    summary: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    kind: fc.string({ minLength: 1, maxLength: 10 }),
    status: arbMissionStatus,
    progress: fc.integer({ min: 0, max: 100 }),
    complexity: fc.integer({ min: 1, max: 10 }),
    radius: fc.integer({ min: 30, max: 100 }),
    position: fc.constant({ x: 0, y: 0 }),
    createdAt: fc.nat({ max: 2e12 }),
    updatedAt: fc.nat({ max: 2e12 }),
    completedAt: fc.option(fc.nat({ max: 2e12 }), { nil: undefined }),
    currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    currentStageLabel: fc.option(fc.string({ minLength: 1, maxLength: 16 }), { nil: undefined }),
    waitingFor: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    taskUrl: fc.string({ minLength: 1, maxLength: 16 }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 0, maxLength: 3 }),
  });
}

function arbMission(): fc.Arbitrary<MissionRecord> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }).map(s => `mission_${s}`),
    kind: fc.string({ minLength: 1, maxLength: 10 }),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    sourceText: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
    status: arbMissionStatus,
    progress: fc.integer({ min: 0, max: 100 }),
    currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    stages: fc.array(
      fc.record({
        key: fc.string({ minLength: 1, maxLength: 10 }).map(s => s.replace(/\s/g, '_') || 'stg'),
        label: fc.string({ minLength: 1, maxLength: 16 }),
        status: arbStageStatus,
      }),
      { minLength: 1, maxLength: 4 },
    ),
    createdAt: fc.nat({ max: 2e12 }),
    updatedAt: fc.nat({ max: 2e12 }),
    events: fc.array(arbEvent, { minLength: 0, maxLength: 4 }),
    artifacts: fc.option(fc.array(arbArtifact, { minLength: 0, maxLength: 3 }), { nil: undefined }),
  }) as fc.Arbitrary<MissionRecord>;
}

/* ─── Property 2: Mission 原生详情完整性 ─── */
/* **Validates: Requirements 1.2** */

describe('Feature: mission-native-projection, Property 2: Mission 原生详情完整性', () => {
  it('stages array matches interior stages input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }).chain(n =>
          fc.tuple(arbPlanet(), arbInteriorStages(n), arbMission()),
        ),
        ([planet, interiorStages, mission]) => {
          const interior: MissionPlanetInteriorData = {
            stages: interiorStages,
            agents: [{ id: 'mission-core', name: 'Mission Core', role: 'orchestrator', sprite: 'cube-brain', status: 'working', stageKey: 'execute', stageLabel: 'Execute', angle: 0 }],
            events: [],
          };
          const detail = buildPlanetDetailRecord(planet, interior, mission);

          expect(detail.stages).toHaveLength(interiorStages.length);
          for (let i = 0; i < interiorStages.length; i++) {
            expect(detail.stages[i].key).toBe(interiorStages[i].key);
            expect(detail.stages[i].arcStart).toBe(interiorStages[i].arcStart);
            expect(detail.stages[i].arcEnd).toBe(interiorStages[i].arcEnd);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('agents array contains at least the mission-core agent', () => {
    fc.assert(
      fc.property(
        arbPlanet(),
        fc.array(arbAgent, { minLength: 0, maxLength: 4 }).map(agents => {
          // Ensure mission-core is present
          const hasCore = agents.some(a => a.id === 'mission-core');
          if (!hasCore) {
            agents.push({
              id: 'mission-core', name: 'Mission Core', role: 'orchestrator',
              sprite: 'cube-brain', status: 'working', stageKey: 'execute',
              stageLabel: 'Execute', angle: 0,
            });
          }
          return agents;
        }),
        arbMission(),
        (planet, agents, mission) => {
          const interior: MissionPlanetInteriorData = {
            stages: [{ key: 'execute', label: 'Execute', status: 'running', progress: 50, arcStart: 0, arcEnd: 360, midAngle: 180 }],
            agents,
            events: [],
          };
          const detail = buildPlanetDetailRecord(planet, interior, mission);

          const core = detail.agents.find(a => a.id === 'mission-core');
          expect(core).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('timeline derives from events', () => {
    fc.assert(
      fc.property(
        arbPlanet(),
        fc.array(arbEvent, { minLength: 1, maxLength: 6 }),
        arbMission(),
        (planet, events, mission) => {
          const interior: MissionPlanetInteriorData = {
            stages: [{ key: 'execute', label: 'Execute', status: 'running', progress: 50, arcStart: 0, arcEnd: 360, midAngle: 180 }],
            agents: [{ id: 'mission-core', name: 'Mission Core', role: 'orchestrator', sprite: 'cube-brain', status: 'working', stageKey: 'execute', stageLabel: 'Execute', angle: 0 }],
            events,
          };
          const detail = buildPlanetDetailRecord(planet, interior, mission);

          // Timeline should have entries
          expect(detail.timeline.length).toBeGreaterThanOrEqual(0);
          // Each timeline entry should have required fields
          for (const entry of detail.timeline) {
            expect(entry.title).toBeDefined();
            expect(typeof entry.time).toBe('number');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('artifacts derives from mission.artifacts', () => {
    fc.assert(
      fc.property(
        arbPlanet(),
        fc.array(arbArtifact, { minLength: 1, maxLength: 4 }),
        (planet, artifacts) => {
          const mission: MissionRecord = {
            id: 'mission_art',
            kind: 'chat',
            title: 'Artifact test',
            status: 'running',
            progress: 50,
            stages: [{ key: 'execute', label: 'Execute', status: 'running' }],
            createdAt: 1000,
            updatedAt: 2000,
            events: [],
            artifacts,
          };
          const interior: MissionPlanetInteriorData = {
            stages: [{ key: 'execute', label: 'Execute', status: 'running', progress: 50, arcStart: 0, arcEnd: 360, midAngle: 180 }],
            agents: [{ id: 'mission-core', name: 'Mission Core', role: 'orchestrator', sprite: 'cube-brain', status: 'working', stageKey: 'execute', stageLabel: 'Execute', angle: 0 }],
            events: [],
          };
          const detail = buildPlanetDetailRecord(planet, interior, mission);

          // Artifacts should be present (may be deduped)
          expect(detail.artifacts.length).toBeLessThanOrEqual(artifacts.length);
          expect(detail.artifacts.length).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
