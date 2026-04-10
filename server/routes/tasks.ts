import { Router } from 'express';
import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

import { MISSION_CORE_STAGE_BLUEPRINT } from '../../shared/mission/contracts.js';
import type {
  ArtifactListItem,
  ArtifactListResponse,
  MissionEvent,
} from '../../shared/mission/contracts.js';
import { EXECUTOR_API_ROUTES, type CancelExecutorJobRequest } from '../../shared/executor/api.js';
import type { SubmitMissionOperatorActionRequest } from '../../shared/mission/api.js';
import { BUILTIN_DECISION_TEMPLATES } from '../../shared/mission/decision-templates.js';
import { submitMissionDecision } from '../tasks/mission-decision.js';
import {
  MissionOperatorActionError,
  createMissionOperatorService,
} from '../tasks/mission-operator-service.js';
import {
  missionRuntime,
  type MissionRuntime,
} from '../tasks/mission-runtime.js';
import {
  getMimeType,
  isTextMime,
  validateArtifactPath,
  resolveArtifactAbsolutePath,
  resolveExecutorJobAbsolutePath,
} from './artifact-utils.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_DECISION_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_EXECUTOR_BASE_URL = 'http://127.0.0.1:3031';
const FINAL_MISSION_STATUSES = new Set(['done', 'failed', 'cancelled']);

export interface TaskRouterOptions {
  fetchImpl?: typeof fetch;
  executorBaseUrl?: string;
}

function parseLimit(rawValue: unknown, defaultLimit = DEFAULT_LIMIT): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return defaultLimit;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function buildTaskTitle(
  title: unknown,
  sourceText: unknown
): string | null {
  if (typeof title === 'string' && title.trim()) {
    return title.trim();
  }

  if (typeof sourceText === 'string' && sourceText.trim()) {
    const compact = sourceText.trim().replace(/\s+/g, ' ');
    return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
  }

  return null;
}

function normalizeCancelSource(value: unknown): MissionEvent['source'] {
  switch (value) {
    case 'brain':
    case 'executor':
    case 'feishu':
    case 'mission-core':
    case 'user':
      return value;
    default:
      return 'user';
  }
}

function toExecutorCancelSource(
  source: MissionEvent['source'],
): CancelExecutorJobRequest['source'] {
  switch (source) {
    case 'user':
    case 'brain':
    case 'feishu':
      return source;
    case 'executor':
    case 'mission-core':
    default:
      return 'system';
  }
}

function buildExecutorUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function isExecutorTerminalStatus(value: unknown): boolean {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

export function createTaskRouter(
  runtime: MissionRuntime = missionRuntime,
  options: TaskRouterOptions = {},
): Router {
  const router = Router();
  const EXECUTOR_LOG_WHITESPACE_CHECK_BYTES = 4096;
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultExecutorBaseUrl =
    options.executorBaseUrl?.trim() ||
    process.env.LOBSTER_EXECUTOR_BASE_URL?.trim() ||
    DEFAULT_EXECUTOR_BASE_URL;
  const operatorService = createMissionOperatorService(runtime, {
    fetchImpl,
    executorBaseUrl: defaultExecutorBaseUrl,
  });

  async function buildExecutorLogFallback(
    missionId: string,
    jobId: string,
  ): Promise<string | null> {
    const eventsPath = resolveExecutorJobAbsolutePath(missionId, jobId, 'events.jsonl');

    try {
      const raw = await readFile(eventsPath, 'utf-8');
      const lines = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            const parsed = JSON.parse(line) as {
              occurredAt?: string;
              message?: string;
              summary?: string;
              type?: string;
            };
            const timestamp = parsed.occurredAt?.trim() || 'unknown-time';
            const message =
              parsed.message?.trim() ||
              parsed.summary?.trim() ||
              parsed.type?.trim() ||
              line;
            return `[${timestamp}] ${message}`;
          } catch {
            return line;
          }
        });

      return lines.length > 0 ? `${lines.join('\n')}\n` : '';
    } catch {
      return null;
    }
  }

  async function resolveExecutorLogFallback(
    missionId: string,
    jobId: string,
    absolutePath: string,
  ): Promise<string | null> {
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        return buildExecutorLogFallback(missionId, jobId);
      }

      if (fileStat.size === 0) {
        return buildExecutorLogFallback(missionId, jobId);
      }

      if (fileStat.size > EXECUTOR_LOG_WHITESPACE_CHECK_BYTES) {
        return null;
      }

      const content = await readFile(absolutePath, 'utf-8');
      return content.trim().length === 0
        ? buildExecutorLogFallback(missionId, jobId)
        : null;
    } catch {
      return buildExecutorLogFallback(missionId, jobId);
    }
  }

  router.post('/', (req, res) => {
    const body = req.body || {};
    const title = buildTaskTitle(body.title, body.sourceText);
    if (!title) {
      return res.status(400).json({
        error: 'title or sourceText is required',
      });
    }

    const task = runtime.createTask({
      kind: typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'chat',
      title,
      sourceText:
        typeof body.sourceText === 'string' && body.sourceText.trim()
          ? body.sourceText.trim()
          : undefined,
      topicId:
        typeof body.topicId === 'string' && body.topicId.trim()
          ? body.topicId.trim()
          : undefined,
      stageLabels: [...MISSION_CORE_STAGE_BLUEPRINT],
    });

    return res.status(201).json({
      ok: true,
      task,
    });
  });

  router.get('/', (req, res) => {
    const limit = parseLimit(req.query.limit);
    res.json({
      ok: true,
      tasks: runtime.listTasks(limit),
    });
  });

  router.get('/:id', (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      ok: true,
      task,
    });
  });

  router.get('/:id/events', (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const limit = parseLimit(req.query.limit);
    res.json({
      ok: true,
      missionId: task.id,
      events: runtime.listTaskEvents(task.id, limit),
    });
  });

  router.get('/:id/decisions', (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const limit = parseLimit(req.query.limit, DEFAULT_DECISION_LIMIT);
    const history = task.decisionHistory ?? [];
    const sliced = history.slice(-limit);
    res.json({
      ok: true,
      missionId: task.id,
      decisions: sliced,
    });
  });

  router.post('/:id/cancel', async (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (FINAL_MISSION_STATUSES.has(task.status)) {
      return res.json({
        ok: true,
        alreadyFinal: true,
        executorForwarded: false,
        task,
      });
    }

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : undefined;
    const requestedBy =
      typeof req.body?.requestedBy === 'string' && req.body.requestedBy.trim()
        ? req.body.requestedBy.trim()
        : undefined;
    const source = normalizeCancelSource(req.body?.source);

    const executorJobId = task.executor?.jobId?.trim();
    let executorForwarded = false;

    if (executorJobId) {
      const executorBaseUrl =
        task.executor?.baseUrl?.trim() || defaultExecutorBaseUrl;
      const requestBody: CancelExecutorJobRequest = {
        reason,
        requestedBy,
        source: toExecutorCancelSource(source),
      };

      let downstreamResponse: Response;
      try {
        downstreamResponse = await fetchImpl(
          buildExecutorUrl(
            executorBaseUrl,
            EXECUTOR_API_ROUTES.cancelJob.replace(':id', encodeURIComponent(executorJobId)),
          ),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          },
        );
      } catch (error) {
        return res.status(503).json({
          error:
            error instanceof Error
              ? `Executor cancel request failed: ${error.message}`
              : 'Executor cancel request failed',
        });
      }

      const rawBody = await downstreamResponse.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedBody = null;
      }

      if (!downstreamResponse.ok) {
        const message =
          typeof parsedBody === 'object' &&
          parsedBody !== null &&
          'error' in parsedBody &&
          typeof parsedBody.error === 'string'
            ? parsedBody.error
            : `Executor cancel request failed with HTTP ${downstreamResponse.status}`;

        if (downstreamResponse.status !== 404) {
          return res.status(502).json({ error: message });
        }
      } else {
        executorForwarded = true;
        const downstreamStatus =
          typeof parsedBody === 'object' &&
          parsedBody !== null &&
          'status' in parsedBody
            ? parsedBody.status
            : undefined;
        if (!isExecutorTerminalStatus(downstreamStatus)) {
          executorForwarded = true;
        }
      }
    }

    const cancelled = runtime.cancelMission(task.id, {
      reason,
      requestedBy,
      source,
    });

    return res.json({
      ok: true,
      alreadyFinal: false,
      executorForwarded,
      task: cancelled,
    });
  });

  router.post('/:id/operator-actions', async (req, res) => {
    try {
      const input = (req.body || {}) as SubmitMissionOperatorActionRequest;
      const result = await operatorService.submit(req.params.id, input);
      return res.json({
        ok: true,
        action: result.action,
        task: result.task,
      });
    } catch (error) {
      if (error instanceof MissionOperatorActionError) {
        return res.status(error.statusCode).json({
          error: error.message,
          allowedActions: error.allowedActions,
        });
      }

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Mission operator action failed',
      });
    }
  });

  /* ─── Artifact Routes (Task 2.1 / 2.2 / 2.3) ─── */

  // 2.1 — List artifacts
  router.get('/:id/artifacts', (req, res) => {
    const mission = runtime.getTask(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: `Mission not found: ${req.params.id}` });
    }

    const raw = mission.artifacts ?? [];
    const artifacts: ArtifactListItem[] = raw.map((a, index) => ({
      ...a,
      index,
      downloadUrl: `/api/tasks/${mission.id}/artifacts/${index}/download`,
    }));

    const body: ArtifactListResponse = {
      ok: true,
      missionId: mission.id,
      artifacts,
    };
    return res.json(body);
  });

  // 2.2 — Download artifact
  router.get('/:id/artifacts/:index/download', async (req, res) => {
    const mission = runtime.getTask(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: `Mission not found: ${req.params.id}` });
    }

    const raw = mission.artifacts ?? [];
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= raw.length) {
      return res.status(404).json({ error: `Artifact not found at index ${req.params.index}` });
    }

    const artifact = raw[idx];

    // URL artifacts → 302 redirect
    if (artifact.kind === 'url') {
      return res.redirect(302, artifact.url ?? '');
    }

    if (!artifact.path) {
      return res.status(404).json({ error: 'Artifact has no file path' });
    }

    if (!validateArtifactPath(artifact.path)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    const jobId = mission.executor?.jobId ?? '';
    const absPath = resolveArtifactAbsolutePath(mission.id, jobId, artifact.path);

    if (artifact.name === 'executor.log') {
      const fallbackLog = await resolveExecutorLogFallback(mission.id, jobId, absPath);
      if (fallbackLog !== null) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
        return res.send(fallbackLog);
      }
    }

    try {
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) {
        return res.status(404).json({ error: 'Artifact file not found' });
      }
    } catch {
      return res.status(404).json({ error: 'Artifact file not found' });
    }

    res.setHeader('Content-Type', getMimeType(artifact.name));
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
    const stream = fs.createReadStream(absPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read artifact file' });
      }
    });
    stream.pipe(res);
  });

  // 2.3 — Preview artifact
  router.get('/:id/artifacts/:index/preview', async (req, res) => {
    const mission = runtime.getTask(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: `Mission not found: ${req.params.id}` });
    }

    const raw = mission.artifacts ?? [];
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= raw.length) {
      return res.status(404).json({ error: `Artifact not found at index ${req.params.index}` });
    }

    const artifact = raw[idx];

    if (!artifact.path) {
      return res.status(404).json({ error: 'Artifact has no file path' });
    }

    if (!validateArtifactPath(artifact.path)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    const mime = getMimeType(artifact.name);
    if (!isTextMime(mime)) {
      return res.status(415).json({ error: 'Binary files cannot be previewed' });
    }

    const jobId = mission.executor?.jobId ?? '';
    const absPath = resolveArtifactAbsolutePath(mission.id, jobId, artifact.path);

    const MAX_PREVIEW_BYTES = 1_048_576; // 1 MB

    if (artifact.name === 'executor.log') {
      const fallbackLog = await resolveExecutorLogFallback(mission.id, jobId, absPath);
      if (fallbackLog !== null) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(fallbackLog);
      }
    }

    try {
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) {
        return res.status(404).json({ error: 'Artifact file not found' });
      }

      const truncated = fileStat.size > MAX_PREVIEW_BYTES;

      res.setHeader('Content-Type', mime);
      if (truncated) {
        res.setHeader('X-Truncated', 'true');
      }

      const stream = fs.createReadStream(absPath, {
        start: 0,
        end: truncated ? MAX_PREVIEW_BYTES - 1 : undefined,
      });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read artifact file' });
        }
      });
      stream.pipe(res);
    } catch {
      return res.status(404).json({ error: 'Artifact file not found' });
    }
  });

  router.post('/:id/decision', (req, res) => {
    const result = submitMissionDecision(runtime, req.params.id, req.body || {}, {
      idempotentIfNotWaiting: true,
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ error: result.error });
    }

    // Broadcast mission.decision.submitted Socket event (Task 5.3)
    if (!result.alreadyResolved && result.task.decisionHistory?.length) {
      const historyEntry = result.task.decisionHistory[result.task.decisionHistory.length - 1];
      runtime.emitDecisionSubmitted(result.task, historyEntry, result.decision);
    }

    res.json({
      ok: true,
      alreadyResolved: result.alreadyResolved === true,
      detail: result.detail,
      decision: result.decision,
      task: result.task,
    });
  });

  return router;
}

export function createDecisionTemplatesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      templates: [...BUILTIN_DECISION_TEMPLATES],
    });
  });

  return router;
}

export default createTaskRouter();
