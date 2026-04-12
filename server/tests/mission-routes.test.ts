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

describe('tasks routes', () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express['listen']> | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });

    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
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

  it('returns recent tasks from GET /api/tasks', async () => {
    const task = runtime.createTask({
      kind: 'chat',
      title: 'Summarize relay state',
      sourceText: 'Need a stable summary',
      stageLabels: [
        { key: 'receive', label: 'Receive task' },
        { key: 'understand', label: 'Understand problem' },
      ],
    });
    runtime.markMissionRunning(
      task.id,
      'understand',
      'Scanning current state',
      42
    );

    const response = await fetch(`${baseUrl}/api/tasks?limit=10`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      tasks: [
        {
          id: task.id,
          title: 'Summarize relay state',
          status: 'running',
          progress: 42,
        },
      ],
    });
  });

  it('creates a mission from POST /api/tasks with the fixed mission stages', async () => {
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'chat',
        sourceText: 'Help me plan a relay rollout across Feishu and Cube.',
        topicId: 'thread_123',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.task).toMatchObject({
      kind: 'chat',
      topicId: 'thread_123',
      stages: [
        { key: 'receive', label: 'Receive task', status: 'pending' },
        { key: 'understand', label: 'Understand request', status: 'pending' },
        { key: 'plan', label: 'Build execution plan', status: 'pending' },
        { key: 'provision', label: 'Provision execution runtime', status: 'pending' },
        { key: 'execute', label: 'Run execution', status: 'pending' },
        { key: 'finalize', label: 'Finalize mission', status: 'pending' },
      ],
    });
  });

  it('auto-dispatches nl-command missions when requested at creation time', async () => {
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
          missionId: 'ignored-by-route',
          jobId: 'job_auto_dispatch',
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

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'nl-command',
        title: 'Write a Fibonacci script',
        sourceText: 'Write a Python script that prints the first 20 Fibonacci numbers.',
        autoDispatch: true,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({
      ok: true,
      dispatchAccepted: true,
      task: {
        kind: 'nl-command',
        status: 'running',
        currentStageKey: 'execute',
        executor: {
          jobId: 'job_auto_dispatch',
          status: 'queued',
        },
      },
    });
  });

  it('returns a task detail from GET /api/tasks/:id', async () => {
    const task = runtime.createTask({
      kind: 'chat',
      title: 'Inspect task detail route',
      stageLabels: [{ key: 'receive', label: 'Receive task' }],
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      task: {
        id: task.id,
        title: 'Inspect task detail route',
        status: 'queued',
      },
    });
  });

  it('submits a waiting decision and resumes mission progress', async () => {
    const task = runtime.createChatTask('Decision task');
    runtime.markMissionRunning(task.id, 'receive', 'Task accepted', 10);
    runtime.waitOnMission(task.id, 'product direction', 'Need a direction', 42, {
      prompt: 'Choose a path',
      options: [
        { id: 'continue', label: 'Continue' },
        { id: 'report', label: 'Report only' },
      ],
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        optionId: 'continue',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      decision: {
        optionId: 'continue',
        optionLabel: 'Continue',
      },
      task: {
        id: task.id,
        status: 'running',
      },
    });
    expect(runtime.getTask(task.id)?.waitingFor).toBeUndefined();
    expect(runtime.getTask(task.id)?.decision).toBeUndefined();
  });

  it('returns recent task events from GET /api/tasks/:id/events', async () => {
    const task = runtime.createChatTask('Task events');
    runtime.markMissionRunning(task.id, 'understand', 'Reading mission details', 18);
    runtime.logMission(task.id, 'Collected first batch of notes', 'info', 22);

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/events?limit=3`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      missionId: task.id,
    });
    expect(body.events).toHaveLength(3);
    expect(body.events.map((event: { message: string }) => event.message)).toContain(
      'Collected first batch of notes'
    );
  });

  it('returns 404 for missing task detail', async () => {
    const response = await fetch(`${baseUrl}/api/tasks/task_missing`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Task not found' });
  });

  it('returns 400 when POST /api/tasks is missing title and source text', async () => {
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ kind: 'chat' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'title or sourceText is required' });
  });
});
