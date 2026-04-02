import { describe, expect, it, vi } from 'vitest';

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
  MissionPlanetInteriorData,
  MissionPlanetOverviewItem,
  MissionRecord,
} from '../../shared/mission/contracts';

function makePlanet(overrides: Partial<MissionPlanetOverviewItem> = {}): MissionPlanetOverviewItem {
  return {
    id: 'planet_1',
    title: 'Test Planet',
    sourceText: 'Build something',
    summary: 'In progress',
    kind: 'chat',
    status: 'running',
    progress: 50,
    complexity: 3,
    radius: 45,
    position: { x: 0, y: 0 },
    createdAt: 1000,
    updatedAt: 2000,
    currentStageKey: 'execute',
    currentStageLabel: 'Run execution',
    waitingFor: undefined,
    taskUrl: '/tasks/planet_1',
    tags: ['Engineering', 'Design'],
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: 'planet_1',
    kind: 'chat',
    title: 'Test Planet',
    sourceText: 'Build something',
    status: 'running',
    progress: 50,
    currentStageKey: 'execute',
    stages: [
      { key: 'receive', label: 'Receive task', status: 'done' },
      { key: 'execute', label: 'Run execution', status: 'running' },
      { key: 'finalize', label: 'Finalize mission', status: 'pending' },
    ],
    summary: 'In progress',
    createdAt: 1000,
    updatedAt: 2000,
    events: [],
    ...overrides,
  };
}

function makeInterior(overrides: Partial<MissionPlanetInteriorData> = {}): MissionPlanetInteriorData {
  return {
    stages: [
      {
        key: 'receive',
        label: 'Receive task',
        status: 'done',
        progress: 100,
        arcStart: 0,
        arcEnd: 120,
        midAngle: 60,
      },
      {
        key: 'execute',
        label: 'Run execution',
        status: 'running',
        progress: 50,
        arcStart: 120,
        arcEnd: 240,
        midAngle: 180,
      },
      {
        key: 'finalize',
        label: 'Finalize mission',
        status: 'pending',
        progress: 0,
        arcStart: 240,
        arcEnd: 360,
        midAngle: 300,
      },
    ],
    agents: [
      {
        id: 'mission-core',
        name: 'Mission Core',
        role: 'orchestrator',
        sprite: 'cube-brain',
        status: 'working',
        stageKey: 'execute',
        stageLabel: 'Run execution',
        angle: 0,
      },
      {
        id: 'alice',
        name: 'Alice',
        role: 'worker',
        sprite: 'cube-worker',
        status: 'working',
        stageKey: 'execute',
        stageLabel: 'Run execution',
        progress: 60,
        currentAction: 'Writing code',
        angle: 180,
      },
    ],
    events: [
      { type: 'created', message: 'Mission created', time: 1000 },
      { type: 'progress', message: 'Stage active', time: 1500, stageKey: 'execute' },
    ],
    summary: 'In progress',
    waitingFor: undefined,
    ...overrides,
  };
}

describe('buildPlanetDetailRecord', () => {
  it('maps interior stages to TaskStageRing[]', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.stages).toHaveLength(3);
    expect(detail.stages[0]).toMatchObject({
      key: 'receive',
      label: 'Receive task',
      status: 'done',
      progress: 100,
      arcStart: 0,
      arcEnd: 120,
      midAngle: 60,
    });
    expect(detail.stages[1]).toMatchObject({
      key: 'execute',
      status: 'running',
      arcStart: 120,
      arcEnd: 240,
    });
    expect(detail.stages[2]).toMatchObject({
      key: 'finalize',
      status: 'pending',
      arcStart: 240,
      arcEnd: 360,
    });
  });

  it('maps interior agents to TaskInteriorAgent[]', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.agents).toHaveLength(2);

    const core = detail.agents.find(a => a.id === 'mission-core');
    expect(core).toBeDefined();
    expect(core!.name).toBe('Mission Core');
    expect(core!.role).toBe('orchestrator');
    expect(core!.department).toBe('Mission');
    expect(core!.status).toBe('working');
    expect(core!.stageKey).toBe('execute');

    const alice = detail.agents.find(a => a.id === 'alice');
    expect(alice).toBeDefined();
    expect(alice!.name).toBe('Alice');
    expect(alice!.role).toBe('worker');
    expect(alice!.progress).toBe(60);
    expect(alice!.currentAction).toBe('Writing code');
  });

  it('builds timeline from interior events', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.timeline.length).toBeGreaterThanOrEqual(2);
    const created = detail.timeline.find(t => t.type === 'created');
    expect(created).toBeDefined();
    expect(created!.title).toBe('Mission created');
  });

  it('builds artifacts from mission.artifacts', () => {
    const mission = makeMission({
      artifacts: [
        { kind: 'file', name: 'report.pdf', description: 'Final report' },
        { kind: 'url', name: 'Dashboard', url: 'https://example.com' },
      ],
    });
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), mission);

    expect(detail.artifacts).toHaveLength(2);
    expect(detail.artifacts[0].title).toBe('report.pdf');
    expect(detail.artifacts[0].kind).toBe('file');
    expect(detail.artifacts[1].title).toBe('Dashboard');
    expect(detail.artifacts[1].href).toBe('https://example.com');
  });

  it('builds decisionPresets from mission.decision', () => {
    const mission = makeMission({
      decision: {
        prompt: 'Choose an option',
        options: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: 'Reject' },
        ],
        allowFreeText: true,
        placeholder: 'Add a note...',
      },
    });
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), mission);

    expect(detail.decisionPresets).toHaveLength(2);
    expect(detail.decisionPresets[0].label).toBe('Approve');
    expect(detail.decisionPresets[0].tone).toBe('primary');
    expect(detail.decisionPresets[1].label).toBe('Reject');
    expect(detail.decisionPrompt).toBe('Choose an option');
    expect(detail.decisionPlaceholder).toBe('Add a note...');
    expect(detail.decisionAllowsFreeText).toBe(true);
  });

  it('returns empty decisionPresets when no decision', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.decisionPresets).toEqual([]);
    expect(detail.decisionPrompt).toBeNull();
    expect(detail.decisionPlaceholder).toBeNull();
    expect(detail.decisionAllowsFreeText).toBe(false);
  });

  it('sets workflow to synthetic workflow from mission', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.workflow).toBeDefined();
    expect(detail.workflow.id).toBe('planet_1');
    expect(detail.workflow.directive).toBe('Build something');
  });

  it('sets tasks, messages, report to empty/null', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.tasks).toEqual([]);
    expect(detail.messages).toEqual([]);
    expect(detail.report).toBeNull();
    expect(detail.organization).toBeNull();
  });

  it('includes instanceInfo and logSummary', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.instanceInfo.length).toBeGreaterThan(0);
    expect(detail.instanceInfo.some(i => i.label === 'Mission ID')).toBe(true);

    expect(detail.logSummary.length).toBeGreaterThan(0);
    expect(detail.logSummary.some(i => i.label === 'Event entries')).toBe(true);
  });

  it('derives failureReasons from failed mission', () => {
    const mission = makeMission({
      status: 'failed',
      summary: 'Something went wrong',
      stages: [
        { key: 'receive', label: 'Receive', status: 'done' },
        { key: 'execute', label: 'Execute', status: 'failed', detail: 'Timeout' },
      ],
    });
    const interior = makeInterior({
      events: [
        { type: 'failed', message: 'Execution failed', time: 3000 },
      ],
    });
    const detail = buildPlanetDetailRecord(makePlanet({ status: 'failed' }), interior, mission);

    expect(detail.failureReasons).toContain('Something went wrong');
    expect(detail.failureReasons).toContain('Timeout');
    expect(detail.failureReasons).toContain('Execution failed');
  });

  it('provides default detail text for stages without detail', () => {
    const interior = makeInterior({
      stages: [
        { key: 's1', label: 'S1', status: 'done', progress: 100, arcStart: 0, arcEnd: 180, midAngle: 90 },
        { key: 's2', label: 'S2', status: 'pending', progress: 0, arcStart: 180, arcEnd: 360, midAngle: 270 },
      ],
    });
    const detail = buildPlanetDetailRecord(makePlanet(), interior, makeMission());

    expect(detail.stages[0].detail).toBe('Completed');
    expect(detail.stages[1].detail).toBe('Queued');
  });

  it('preserves explicit stage detail text', () => {
    const interior = makeInterior({
      stages: [
        { key: 's1', label: 'S1', status: 'running', progress: 50, detail: 'Custom detail', arcStart: 0, arcEnd: 360, midAngle: 180 },
      ],
    });
    const detail = buildPlanetDetailRecord(makePlanet(), interior, makeMission());

    expect(detail.stages[0].detail).toBe('Custom detail');
  });

  it('handles empty interior stages and agents', () => {
    const interior = makeInterior({ stages: [], agents: [] });
    const detail = buildPlanetDetailRecord(makePlanet(), interior, makeMission());

    expect(detail.stages).toEqual([]);
    expect(detail.agents).toEqual([]);
  });

  it('inherits summary fields from buildPlanetSummaryRecord', () => {
    const detail = buildPlanetDetailRecord(makePlanet(), makeInterior(), makeMission());

    expect(detail.id).toBe('planet_1');
    expect(detail.title).toBe('Test Planet');
    expect(detail.status).toBe('running');
    expect(detail.progress).toBe(50);
    expect(detail.departmentLabels).toEqual(['Engineering', 'Design']);
  });

  it('maps agent department from stageLabel for workers', () => {
    const interior = makeInterior({
      agents: [
        {
          id: 'bob',
          name: 'Bob',
          role: 'worker',
          sprite: 'cube-worker',
          status: 'idle',
          stageKey: 'finalize',
          stageLabel: 'Finalize mission',
          angle: 90,
        },
      ],
    });
    const detail = buildPlanetDetailRecord(makePlanet(), interior, makeMission());

    expect(detail.agents[0].department).toBe('Finalize mission');
  });

  it('sets agent progress to null when not provided', () => {
    const interior = makeInterior({
      agents: [
        {
          id: 'mission-core',
          name: 'Mission Core',
          role: 'orchestrator',
          sprite: 'cube-brain',
          status: 'working',
          stageKey: 'execute',
          stageLabel: 'Run execution',
          angle: 0,
        },
      ],
    });
    const detail = buildPlanetDetailRecord(makePlanet(), interior, makeMission());

    expect(detail.agents[0].progress).toBeNull();
  });
});
