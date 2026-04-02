/**
 * REST API for role analytics.
 *
 * @see Requirements 7.5
 */
import { Router } from 'express';
import { roleAnalyticsService } from '../core/role-analytics.js';

const router = Router();

// GET /api/analytics/roles
router.get('/roles', (_req, res) => {
  const roleUsageSummary = roleAnalyticsService.getRoleUsageSummary();
  const agentRoleDistribution = roleAnalyticsService.getAgentRoleDistribution();
  res.json({ roleUsageSummary, agentRoleDistribution });
});

export default router;
