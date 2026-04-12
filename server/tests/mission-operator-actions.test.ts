import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('mission operator actions route', () => {
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

  it('pauses a running mission and forwards pause to the executor', async () => {
    const mission = runtime.createChatTask('Pause me');
    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: 'lobster',
        jobId: 'job-pause',
        status: 'running',
        baseUrl: 'http://executor.local:3031',
      },
    });
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 58);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/executor/jobs/job-pause/pause');

      return new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          pauseRequested: true,
          missionId: mission.id,
          jobId: 'job-pause',
          status: 'running',
          message: 'Executor job paused while running',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'pause',
        requestedBy: 'operator',
        reason: 'Need to inspect the current run',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      ok: true,
      action: {
        action: 'pause',
        requestedBy: 'operator',
      },
      task: {
        id: mission.id,
        status: 'running',
        operatorState: 'paused',
      },
    });
  });

  it('requires a reason for mark-blocked', async () => {
    const mission = runtime.createChatTask('Blocked mission');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 40);

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'mark-blocked',
        requestedBy: 'operator',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('blocker reason');
  });

  it('resumes a blocked mission and clears the active blocker', async () => {
    const mission = runtime.createChatTask('Resume blocked mission');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 40);
    runtime.updateMission(mission.id, task => {
      task.operatorState = 'blocked';
      task.blocker = {
        reason: 'Waiting for PM feedback',
        createdAt: Date.now(),
        createdBy: 'operator',
      };
    });

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'resume',
        requestedBy: 'operator',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      task: {
        id: mission.id,
        operatorState: 'active',
      },
    });
    expect(body.task.blocker).toBeUndefined();
  });

  it('supports a pause to resume loop for the same running mission', async () => {
    const mission = runtime.createChatTask('Pause then resume mission');
    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: 'lobster',
        jobId: 'job-pause-resume',
        status: 'running',
        baseUrl: 'http://executor.local:3031',
      },
    });
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 52);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pause')) {
        return new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            pauseRequested: true,
            missionId: mission.id,
            jobId: 'job-pause-resume',
            status: 'running',
            message: 'Executor job paused while running',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          resumeRequested: true,
          missionId: mission.id,
          jobId: 'job-pause-resume',
          status: 'running',
          message: 'Executor job resumed',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const pauseResponse = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'pause',
        requestedBy: 'operator',
        reason: 'Pause before validation',
      }),
    });
    const pausedBody = await pauseResponse.json();

    expect(pauseResponse.status).toBe(200);
    expect(pausedBody.task.operatorState).toBe('paused');

    const resumeResponse = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'resume',
        requestedBy: 'operator',
        reason: 'Resume after validation',
      }),
    });
    const resumedBody = await resumeResponse.json();

    expect(resumeResponse.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(resumedBody).toMatchObject({
      task: {
        id: mission.id,
        status: 'running',
        operatorState: 'active',
      },
      action: {
        action: 'resume',
        requestedBy: 'operator',
      },
    });
  });

  it('retries a failed mission by incrementing attempt and returning it to queued', async () => {
    const mission = runtime.createChatTask('Retry mission');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 70);
    runtime.failMission(mission.id, 'Something failed');

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'retry',
        requestedBy: 'operator',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      task: {
        id: mission.id,
        status: 'queued',
        operatorState: 'active',
        attempt: 2,
      },
      action: {
        action: 'retry',
      },
    });
  });

  it('retries an nl-command mission by re-dispatching it to the executor', async () => {
    const mission = runtime.createTask({
      kind: 'nl-command',
      title: 'Retry dispatched mission',
      sourceText: 'Write a Python script that prints the first 20 Fibonacci numbers.',
    });
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 70);
    runtime.failMission(mission.id, 'Executor dispatch failed earlier');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      expect(url).toContain('/api/executor/jobs');
      expect(init?.method).toBe('POST');

      return new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          missionId: mission.id,
          jobId: 'job_retry_dispatch',
          receivedAt: new Date().toISOString(),
          status: 'queued',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'retry',
        requestedBy: 'operator',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({
      ok: true,
      dispatchAccepted: true,
      task: {
        id: mission.id,
        status: 'running',
        operatorState: 'active',
        attempt: 2,
        currentStageKey: 'execute',
        executor: {
          jobId: 'job_retry_dispatch',
          status: 'queued',
        },
      },
      action: {
        action: 'retry',
      },
    });
  });

  it('retries a cancelled mission by incrementing attempt and returning it to queued', async () => {
    const mission = runtime.createChatTask('Retry cancelled mission');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 60);
    runtime.cancelMission(mission.id, {
      reason: 'Stop current attempt',
      requestedBy: 'operator',
      source: 'user',
    });

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'retry',
        requestedBy: 'operator',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      task: {
        id: mission.id,
        status: 'queued',
        operatorState: 'active',
        attempt: 2,
      },
      action: {
        action: 'retry',
      },
    });
  });

  it('terminates a running mission by reusing the cancel flow', async () => {
    const mission = runtime.createChatTask('Terminate mission');
    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: 'lobster',
        jobId: 'job-terminate',
        status: 'running',
        baseUrl: 'http://executor.local:3031',
      },
    });
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 66);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/executor/jobs/job-terminate/cancel');

      return new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          cancelRequested: true,
          missionId: mission.id,
          jobId: 'job-terminate',
          status: 'running',
          message: 'Termination requested',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'terminate',
        requestedBy: 'operator',
        reason: 'Stop the current run completely',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      task: {
        id: mission.id,
        status: 'cancelled',
        operatorState: 'terminating',
        cancelReason: 'Stop the current run completely',
      },
      action: {
        action: 'terminate',
      },
    });
  });

  it('returns 409 with allowedActions when the action does not match current state', async () => {
    const mission = runtime.createChatTask('Conflict mission');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 40);
    runtime.updateMission(mission.id, task => {
      task.operatorState = 'paused';
    });

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'pause',
        requestedBy: 'operator',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.allowedActions).toEqual(['resume', 'terminate']);
  });
});
