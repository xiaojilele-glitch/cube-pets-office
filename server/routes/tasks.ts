import { Router } from 'express';

import { MISSION_CORE_STAGE_BLUEPRINT } from '../../shared/mission/contracts.js';
import { BUILTIN_DECISION_TEMPLATES } from '../../shared/mission/decision-templates.js';
import { submitMissionDecision } from '../tasks/mission-decision.js';
import {
  missionRuntime,
  type MissionRuntime,
} from '../tasks/mission-runtime.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_DECISION_LIMIT = 50;
const MAX_LIMIT = 200;

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

export function createTaskRouter(runtime: MissionRuntime = missionRuntime): Router {
  const router = Router();

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
