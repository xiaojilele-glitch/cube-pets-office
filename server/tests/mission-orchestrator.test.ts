import { describe, expect, it, vi } from 'vitest';

import { MissionOrchestrator } from '../core/mission-orchestrator.js';

const FIXED_STAGE_KEYS = [
  'receive',
  'understand',
  'plan',
  'provision',
  'execute',
  'finalize',
];

function createExecutorClientStub() {
  return {
    dispatchPlan: vi.fn(async (plan: { missionId: string }) => ({
      request: {
        executor: 'lobster',
        requestId: 'req_1',
      },
      response: {
        jobId: 'job_1',
        receivedAt: '2026-03-30T10:00:00.000Z',
      },
    })),
  } as any;
}

describe('MissionOrchestrator', () => {
  it('starts missions with the fixed six-stage blueprint and execution context', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
    });

    const result = await orchestrator.startMission({
      title: 'Ship a smoke mission',
      sourceText: 'Execute a smoke validation flow and report the results.',
      topicId: 'thread_alpha',
      workspaceRoot: 'C:/workspace/demo',
    });

    expect(result.mission.stages.map(stage => stage.key)).toEqual(FIXED_STAGE_KEYS);
    expect(result.mission.currentStageKey).toBe('execute');
    expect(result.mission.topicId).toBe('thread_alpha');
    expect(result.mission.executor).toMatchObject({
      name: 'lobster',
      requestId: 'req_1',
      jobId: 'job_1',
      status: 'queued',
    });
    expect(result.mission.instance).toMatchObject({
      workspaceRoot: 'C:/workspace/demo',
    });
  });

  it('maps executor waiting events back into fixed mission stages without reintroducing decision stage', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
      hooks: {
        onDecisionSubmitted: () => ({
          resumed: true,
          detail: 'Decision accepted and executor resumed.',
        }),
      },
    });

    const started = await orchestrator.startMission({
      title: 'Wait for approval',
      sourceText: 'Execute the job and pause for approval before continuing.',
      workspaceRoot: 'C:/workspace/demo',
    });

    const waitingMission = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_1',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.waiting',
      status: 'waiting',
      occurredAt: '2026-03-30T10:10:00.000Z',
      stageKey: 'codegen',
      progress: 72,
      message: 'Awaiting user confirmation',
      waitingFor: 'user confirmation',
      decision: {
        prompt: 'Continue execution?',
        options: [{ id: 'continue', label: 'Continue' }],
      },
      artifacts: [
        {
          kind: 'report',
          name: 'Draft report',
          description: 'Interim artifact',
        },
      ],
      payload: {
        instance: {
          id: 'instance_1',
          workspaceRoot: 'C:/workspace/demo',
          host: 'docker-host',
        },
      },
    });

    expect(waitingMission.status).toBe('waiting');
    expect(waitingMission.currentStageKey).toBe('execute');
    expect(waitingMission.stages.map(stage => stage.key)).toEqual(FIXED_STAGE_KEYS);
    expect(waitingMission.stages.find(stage => stage.key === 'decision')).toBeUndefined();
    expect(waitingMission.artifacts).toMatchObject([
      {
        kind: 'report',
        name: 'Draft report',
      },
    ]);
    expect(waitingMission.instance).toMatchObject({
      id: 'instance_1',
      host: 'docker-host',
    });

    const resumed = await orchestrator.submitDecision(started.mission.id, {
      optionId: 'continue',
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.mission.status).toBe('running');
    expect(resumed.mission.currentStageKey).toBe('execute');
    expect(resumed.mission.waitingFor).toBeUndefined();
    expect(resumed.mission.decision).toBeUndefined();
  });
  it('handles executor completion', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
    });

    const started = await orchestrator.startMission({
      title: 'Success mission',
      sourceText: 'Should succeed.',
      workspaceRoot: 'C:/workspace/demo',
    });

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_1',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T10:10:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {},
    });

    expect(completed.status).toBe('done');
    expect(completed.currentStageKey).toBe('finalize');
  });

  it('handles executor timeout', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
    });

    const started = await orchestrator.startMission({
      title: 'Timeout mission',
      sourceText: 'Should timeout.',
      workspaceRoot: 'C:/workspace/demo',
    });

    const timedOut = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_2',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.timeout',
      status: 'timeout',
      occurredAt: '2026-03-30T10:10:00.000Z',
      progress: 50,
      message: 'Timeout occurred',
      payload: {},
    });

    expect(timedOut.status).toBe('failed');
    expect(timedOut.summary).toBe('Timeout occurred');
  });

  it('handles executor failure', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
    });

    const started = await orchestrator.startMission({
      title: 'Failure mission',
      sourceText: 'Should fail.',
      workspaceRoot: 'C:/workspace/demo',
    });

    const failed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_3',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.failed',
      status: 'failed',
      occurredAt: '2026-03-30T10:10:00.000Z',
      progress: 10,
      message: 'Execution failed',
      payload: {},
    });

    expect(failed.status).toBe('failed');
    expect(failed.summary).toBe('Execution failed');
  });

  it('handles decision approve', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
      hooks: {
        onDecisionSubmitted: () => ({
          resumed: true,
          detail: 'Decision accepted.',
        }),
      },
    });

    const started = await orchestrator.startMission({
      title: 'Wait for approval',
      sourceText: 'Approve this.',
      workspaceRoot: 'C:/workspace/demo',
    });

    await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_4',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.waiting',
      status: 'waiting',
      occurredAt: '2026-03-30T10:10:00.000Z',
      stageKey: 'codegen',
      progress: 72,
      message: 'Awaiting approval',
      waitingFor: 'approval',
      decision: {
        prompt: 'Approve?',
        options: [{ id: 'approve', label: 'Approve' }],
      },
      payload: {},
    });

    const resumed = await orchestrator.submitDecision(started.mission.id, {
      optionId: 'approve',
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.mission.status).toBe('running');
  });

  it('handles decision reject', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
      hooks: {
        onDecisionSubmitted: () => ({
          resumed: true,
          detail: 'Decision rejected.',
        }),
      },
    });

    const started = await orchestrator.startMission({
      title: 'Wait for rejection',
      sourceText: 'Reject this.',
      workspaceRoot: 'C:/workspace/demo',
    });

    await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_5',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.waiting',
      status: 'waiting',
      occurredAt: '2026-03-30T10:10:00.000Z',
      stageKey: 'codegen',
      progress: 72,
      message: 'Awaiting approval',
      waitingFor: 'approval',
      decision: {
        prompt: 'Approve?',
        options: [{ id: 'reject', label: 'Reject' }],
      },
      payload: {},
    });

    const resumed = await orchestrator.submitDecision(started.mission.id, {
      optionId: 'reject',
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.mission.status).toBe('running');
  });

  it('handles decision modify', async () => {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
      hooks: {
        onDecisionSubmitted: () => ({
          resumed: true,
          detail: 'Decision modified.',
        }),
      },
    });

    const started = await orchestrator.startMission({
      title: 'Wait for modification',
      sourceText: 'Modify this.',
      workspaceRoot: 'C:/workspace/demo',
    });

    await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_6',
      missionId: started.mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.waiting',
      status: 'waiting',
      occurredAt: '2026-03-30T10:10:00.000Z',
      stageKey: 'codegen',
      progress: 72,
      message: 'Awaiting approval',
      waitingFor: 'approval',
      decision: {
        prompt: 'Approve?',
        options: [{ id: 'modify', label: 'Modify' }],
      },
      payload: {},
    });

    const resumed = await orchestrator.submitDecision(started.mission.id, {
      optionId: 'modify',
      input: 'Modified input',
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.mission.status).toBe('running');
  });
});

describe('MissionOrchestrator enrichment', () => {
  function createExecutorClientStub() {
    return {
      dispatchPlan: vi.fn(async () => ({
        request: { executor: 'lobster', requestId: 'req_1' },
        response: { jobId: 'job_1', receivedAt: '2026-03-30T10:00:00.000Z' },
      })),
    } as any;
  }

  async function startMission() {
    const orchestrator = new MissionOrchestrator({
      executorClient: createExecutorClientStub(),
    });
    const result = await orchestrator.startMission({
      title: 'Enrichment test mission',
      sourceText: 'Test enrichment on stage completion.',
      workspaceRoot: 'C:/workspace/demo',
    });
    return { orchestrator, mission: result.mission };
  }

  it('enriches MissionRecord with organization, workPackages, and messageLog on mission completion', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Mission completed successfully',
      summary: 'All tasks done',
      payload: {
        organization: {
          departments: [
            { key: 'eng', label: 'Engineering', managerName: 'Alice' },
            { key: 'qa', label: 'QA', managerName: 'Bob' },
          ],
          agentCount: 5,
        },
        workPackages: [
          {
            id: 'wp-1',
            title: 'Build feature',
            assignee: 'Agent-A',
            stageKey: 'execute',
            status: 'passed',
            score: 95,
            deliverable: 'Feature implemented',
          },
          {
            id: 'wp-2',
            title: 'Write tests',
            assignee: 'Agent-B',
            stageKey: 'execute',
            status: 'verified',
          },
        ],
        messageLog: [
          { sender: 'Agent-A', content: 'Starting work', time: 1000, stageKey: 'execute' },
          { sender: 'Agent-B', content: 'Tests passing', time: 2000 },
        ],
      },
    });

    expect(completed.status).toBe('done');
    expect(completed.organization).toEqual({
      departments: [
        { key: 'eng', label: 'Engineering', managerName: 'Alice' },
        { key: 'qa', label: 'QA', managerName: 'Bob' },
      ],
      agentCount: 5,
    });
    expect(completed.workPackages).toHaveLength(2);
    expect(completed.workPackages![0]).toMatchObject({
      id: 'wp-1',
      title: 'Build feature',
      status: 'passed',
      score: 95,
    });
    expect(completed.workPackages![1]).toMatchObject({
      id: 'wp-2',
      title: 'Write tests',
      status: 'verified',
    });
    expect(completed.messageLog).toHaveLength(2);
    expect(completed.messageLog![0]).toMatchObject({
      sender: 'Agent-A',
      content: 'Starting work',
      stageKey: 'execute',
    });
  });

  it('does not overwrite existing fields when payload has no enrichment data', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {},
    });

    expect(completed.status).toBe('done');
    expect(completed.organization).toBeUndefined();
    expect(completed.workPackages).toBeUndefined();
    expect(completed.messageLog).toBeUndefined();
  });

  it('ignores invalid work package entries and keeps valid ones', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {
        workPackages: [
          { id: 'wp-1', title: 'Valid', stageKey: 'execute', status: 'passed' },
          { id: '', title: 'Missing ID', stageKey: 'execute', status: 'passed' },
          { id: 'wp-3', title: 'Bad status', stageKey: 'execute', status: 'unknown' },
          null,
          42,
        ],
      },
    });

    expect(completed.workPackages).toHaveLength(1);
    expect(completed.workPackages![0].id).toBe('wp-1');
  });

  it('ignores organization with no valid departments', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {
        organization: {
          departments: [{ key: '', label: '' }],
          agentCount: 0,
        },
      },
    });

    expect(completed.organization).toBeUndefined();
  });

  it('does not enrich on running/progress events', async () => {
    const { orchestrator, mission } = await startMission();

    const running = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_progress',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.progress',
      status: 'running',
      occurredAt: '2026-03-30T10:30:00.000Z',
      progress: 50,
      message: 'In progress',
      payload: {
        organization: {
          departments: [{ key: 'eng', label: 'Engineering' }],
          agentCount: 3,
        },
      },
    });

    expect(running.status).toBe('running');
    expect(running.organization).toBeUndefined();
  });
});



describe('MissionOrchestrator enrichment', () => {
  function createEnrichmentExecutorStub() {
    return {
      dispatchPlan: vi.fn(async () => ({
        request: { executor: 'lobster', requestId: 'req_1' },
        response: { jobId: 'job_1', receivedAt: '2026-03-30T10:00:00.000Z' },
      })),
    } as any;
  }

  async function startMission() {
    const orchestrator = new MissionOrchestrator({
      executorClient: createEnrichmentExecutorStub(),
    });
    const result = await orchestrator.startMission({
      title: 'Enrichment test mission',
      sourceText: 'Test enrichment on stage completion.',
      workspaceRoot: 'C:/workspace/demo',
    });
    return { orchestrator, mission: result.mission };
  }

  it('enriches MissionRecord with organization, workPackages, and messageLog on mission completion', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Mission completed successfully',
      summary: 'All tasks done',
      payload: {
        organization: {
          departments: [
            { key: 'eng', label: 'Engineering', managerName: 'Alice' },
            { key: 'qa', label: 'QA', managerName: 'Bob' },
          ],
          agentCount: 5,
        },
        workPackages: [
          {
            id: 'wp-1',
            title: 'Build feature',
            assignee: 'Agent-A',
            stageKey: 'execute',
            status: 'passed',
            score: 95,
            deliverable: 'Feature implemented',
          },
          {
            id: 'wp-2',
            title: 'Write tests',
            assignee: 'Agent-B',
            stageKey: 'execute',
            status: 'verified',
          },
        ],
        messageLog: [
          { sender: 'Agent-A', content: 'Starting work', time: 1000, stageKey: 'execute' },
          { sender: 'Agent-B', content: 'Tests passing', time: 2000 },
        ],
      },
    });

    expect(completed.status).toBe('done');
    expect(completed.organization).toEqual({
      departments: [
        { key: 'eng', label: 'Engineering', managerName: 'Alice' },
        { key: 'qa', label: 'QA', managerName: 'Bob' },
      ],
      agentCount: 5,
    });
    expect(completed.workPackages).toHaveLength(2);
    expect(completed.workPackages![0]).toMatchObject({
      id: 'wp-1',
      title: 'Build feature',
      status: 'passed',
      score: 95,
    });
    expect(completed.workPackages![1]).toMatchObject({
      id: 'wp-2',
      title: 'Write tests',
      status: 'verified',
    });
    expect(completed.messageLog).toHaveLength(2);
    expect(completed.messageLog![0]).toMatchObject({
      sender: 'Agent-A',
      content: 'Starting work',
      stageKey: 'execute',
    });
  });

  it('does not overwrite existing fields when payload has no enrichment data', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {},
    });

    expect(completed.status).toBe('done');
    expect(completed.organization).toBeUndefined();
    expect(completed.workPackages).toBeUndefined();
    expect(completed.messageLog).toBeUndefined();
  });

  it('ignores invalid work package entries and keeps valid ones', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {
        workPackages: [
          { id: 'wp-1', title: 'Valid', stageKey: 'execute', status: 'passed' },
          { id: '', title: 'Missing ID', stageKey: 'execute', status: 'passed' },
          { id: 'wp-3', title: 'Bad status', stageKey: 'execute', status: 'unknown' },
          null,
          42,
        ],
      },
    });

    expect(completed.workPackages).toHaveLength(1);
    expect(completed.workPackages![0].id).toBe('wp-1');
  });

  it('ignores organization with no valid departments', async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_complete',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.completed',
      status: 'completed',
      occurredAt: '2026-03-30T11:00:00.000Z',
      progress: 100,
      message: 'Done',
      payload: {
        organization: {
          departments: [{ key: '', label: '' }],
          agentCount: 0,
        },
      },
    });

    expect(completed.organization).toBeUndefined();
  });

  it('does not enrich on running/progress events', async () => {
    const { orchestrator, mission } = await startMission();

    const running = await orchestrator.applyExecutorEvent({
      version: '2026-03-28',
      eventId: 'evt_progress',
      missionId: mission.id,
      jobId: 'job_1',
      executor: 'lobster',
      type: 'job.progress',
      status: 'running',
      occurredAt: '2026-03-30T10:30:00.000Z',
      progress: 50,
      message: 'In progress',
      payload: {
        organization: {
          departments: [{ key: 'eng', label: 'Engineering' }],
          agentCount: 3,
        },
      },
    });

    expect(running.status).toBe('running');
    expect(running.organization).toBeUndefined();
  });
});
