import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CancelExecutorJobRequest,
  CancelExecutorJobResponse,
} from '../../shared/executor/api.js';
import { createTaskRouter } from '../routes/tasks.js';
import { MissionRuntime } from '../tasks/mission-runtime.js';
import { MissionStore } from '../tasks/mission-store.js';

async function startServer(
  runtime: MissionRuntime,
  fetchImpl?: typeof fetch,
) {
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskRouter(runtime, { fetchImpl }));

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

describe('MissionRuntime cancelMission', () => {
  let runtime: MissionRuntime;

  beforeEach(() => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
  });

  it('cancels a running mission and records cancel metadata', () => {
    const mission = runtime.createChatTask('Cancel me');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 52);

    const cancelled = runtime.cancelMission(mission.id, {
      reason: 'Operator stopped the task',
      requestedBy: 'tester',
      source: 'user',
    });

    expect(cancelled).toMatchObject({
      id: mission.id,
      status: 'cancelled',
      waitingFor: undefined,
      decision: undefined,
      cancelReason: 'Operator stopped the task',
      cancelledBy: 'tester',
    });
    expect(cancelled?.cancelledAt).toBeTypeOf('number');
    expect(cancelled?.completedAt).toBe(cancelled?.cancelledAt);
    expect(cancelled?.events.at(-1)).toMatchObject({
      type: 'cancelled',
      message: 'Operator stopped the task',
      source: 'user',
    });
  });

  it('cancels a waiting mission and clears the outstanding decision', () => {
    const mission = runtime.createChatTask('Waiting mission');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 40);
    runtime.waitOnMission(mission.id, 'approval', 'Need approval', 48, {
      prompt: 'Approve execution?',
      options: [{ id: 'approve', label: 'Approve' }],
    });

    const cancelled = runtime.cancelMission(mission.id, {
      reason: 'No longer needed',
      requestedBy: 'tester',
      source: 'user',
    });

    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.waitingFor).toBeUndefined();
    expect(cancelled?.decision).toBeUndefined();
    expect(cancelled?.cancelReason).toBe('No longer needed');
  });

  it('treats repeated cancellation as idempotent', () => {
    const mission = runtime.createChatTask('Idempotent cancel');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 20);

    const first = runtime.cancelMission(mission.id, {
      reason: 'First cancel',
      requestedBy: 'tester',
      source: 'user',
    });
    const second = runtime.cancelMission(mission.id, {
      reason: 'Second cancel should be ignored',
      requestedBy: 'tester-2',
      source: 'user',
    });

    expect(second).toEqual(first);
    expect(second?.events.filter(event => event.type === 'cancelled')).toHaveLength(1);
    expect(second?.cancelReason).toBe('First cancel');
  });
});

describe('task cancel route', () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express['listen']> | null = null;
  let baseUrl = '';

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  beforeEach(() => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
  });

  it('cancels a mission locally when there is no executor job', async () => {
    const mission = runtime.createChatTask('Local cancel');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 62);

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'User cancelled from UI',
        requestedBy: 'ui-user',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      executorForwarded: false,
      task: {
        id: mission.id,
        status: 'cancelled',
        cancelReason: 'User cancelled from UI',
        cancelledBy: 'ui-user',
      },
    });
  });

  it('forwards cancellation to executor when the mission has an executor job', async () => {
    const mission = runtime.createChatTask('Executor cancel');
    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: 'lobster',
        jobId: 'job-123',
        status: 'running',
        baseUrl: 'http://executor.local:3031',
      },
    });
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 70);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as CancelExecutorJobRequest : {};
      expect(String(input)).toContain('/api/executor/jobs/job-123/cancel');
      expect(body).toMatchObject({
        reason: 'Stop the running container',
        requestedBy: 'operator',
        source: 'user',
      });

      const payload: CancelExecutorJobResponse = {
        ok: true,
        accepted: true,
        cancelRequested: true,
        missionId: mission.id,
        jobId: 'job-123',
        status: 'running',
        message: 'Cancellation requested',
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Stop the running container',
        requestedBy: 'operator',
        source: 'user',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      ok: true,
      executorForwarded: true,
      task: {
        id: mission.id,
        status: 'cancelled',
      },
    });
  });

  it('returns the current mission unchanged when it is already terminal', async () => {
    const mission = runtime.createChatTask('Already done');
    runtime.finishMission(mission.id, 'All done');

    const fetchImpl = vi.fn();
    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Too late',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      ok: true,
      alreadyFinal: true,
      task: {
        id: mission.id,
        status: 'done',
      },
    });
  });

  it('returns a clear error when executor cancellation is unreachable', async () => {
    const mission = runtime.createChatTask('Executor unreachable');
    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: 'lobster',
        jobId: 'job-unreachable',
        status: 'running',
        baseUrl: 'http://executor.local:3031',
      },
    });
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 50);

    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Cancel now',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain('Executor cancel request failed');
    expect(runtime.getTask(mission.id)?.status).toBe('running');
  });
});
