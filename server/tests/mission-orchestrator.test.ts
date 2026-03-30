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
});
