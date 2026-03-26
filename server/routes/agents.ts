/**
 * REST API for agent management and memory inspection.
 */
import { Router } from 'express';

import db from '../db/index.js';
import { readAgentWorkspaceFile } from '../core/access-guard.js';
import { sessionStore } from '../memory/session-store.js';
import { soulStore } from '../memory/soul-store.js';

const router = Router();

// GET /api/agents
router.get('/', (_req, res) => {
  const agents = db.getAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    department: agent.department,
    role: agent.role,
    managerId: agent.manager_id,
    model: agent.model,
    isActive: agent.is_active,
  }));

  res.json({ agents });
});

// GET /api/agents/org/tree
router.get('/org/tree', (_req, res) => {
  const ceo = db.getAgent('ceo');
  const managers = db.getAgentsByRole('manager');
  const workers = db.getAgentsByRole('worker');

  res.json({
    ceo: ceo ? { id: ceo.id, name: ceo.name } : null,
    departments: managers.map((manager) => ({
      manager: {
        id: manager.id,
        name: manager.name,
        department: manager.department,
      },
      workers: workers
        .filter((worker) => worker.manager_id === manager.id)
        .map((worker) => ({ id: worker.id, name: worker.name })),
    })),
  });
});

// GET /api/agents/department/:dept
router.get('/department/:dept', (req, res) => {
  const agents = db.getAgentsByDepartment(req.params.dept);
  res.json({ agents });
});

// GET /api/agents/:id/soul
router.get('/:id/soul', (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const soul = soulStore.getSoul(agent.id, agent.soul_md || '');
  res.json({
    soulMd: soul.soulMd,
    filePath: soul.filePath,
    exists: soul.exists,
  });
});

// GET /api/agents/:id/heartbeat
router.get('/:id/heartbeat', (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const heartbeatMd = readAgentWorkspaceFile(agent.id, 'HEARTBEAT.md', 'root') || '';
  res.json({
    heartbeatMd,
    heartbeatConfig: agent.heartbeat_config || null,
    keywords: db.getHeartbeatKeywords(agent.id),
    capabilities: db.getAgentCapabilities(agent.id),
    exists: Boolean(heartbeatMd),
  });
});

// GET /api/agents/:id/memory/recent
router.get('/:id/memory/recent', (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
  const entries = sessionStore.getRecentEntries(agent.id, workflowId, limit);
  res.json({ entries });
});

// GET /api/agents/:id/memory/search?query=...
router.get('/:id/memory/search', (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const query = typeof req.query.query === 'string' ? req.query.query : '';
  const topK = Math.max(1, Math.min(20, Number(req.query.topK) || 5));
  const memories = sessionStore.searchMemories(agent.id, query, topK);
  res.json({ memories });
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  res.json({ agent });
});

export default router;
