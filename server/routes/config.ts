/**
 * System configuration routes.
 */
import { Router } from 'express';

import { getAIConfig } from '../core/ai-config.js';
import { V3_STAGES } from '../core/workflow-engine.js';
import db from '../db/index.js';

const router = Router();

const STAGE_LABELS: Record<string, string> = {
  direction: 'Direction',
  planning: 'Planning',
  execution: 'Execution',
  review: 'Review',
  meta_audit: 'Meta Audit',
  revision: 'Revision',
  verify: 'Verify',
  summary: 'Summary',
  feedback: 'Feedback',
  evolution: 'Evolution',
};

router.get('/ai', (_req, res) => {
  res.json({ config: getAIConfig(), source: '.env', writable: false });
});

router.get('/stages', (_req, res) => {
  const stageInfo = V3_STAGES.map((stage, idx) => ({
    id: stage,
    order: idx + 1,
    label: STAGE_LABELS[stage] || stage,
  }));

  res.json({ stages: stageInfo });
});

router.get('/stats', (_req, res) => {
  const agents = db.getAgents();
  const workflows = db.getWorkflows();
  const completedWorkflows = workflows.filter((workflow) => workflow.status === 'completed');

  res.json({
    totalAgents: agents.length,
    activeAgents: agents.filter((agent) => agent.is_active).length,
    totalWorkflows: workflows.length,
    completedWorkflows: completedWorkflows.length,
    runningWorkflows: workflows.filter((workflow) => workflow.status === 'running').length,
  });
});

export default router;
