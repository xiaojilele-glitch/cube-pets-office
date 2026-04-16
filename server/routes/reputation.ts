/**
 * REST API for Agent Reputation System
 *
 * @see Requirements 8.2, 8.3, 8.4, 8.5, 9.6
 */
import { Router } from "express";
import { ReputationService } from "../core/reputation/reputation-service.js";
import { ReputationCalculator } from "../core/reputation/reputation-calculator.js";
import { TrustTierEvaluator } from "../core/reputation/trust-tier-evaluator.js";
import { AnomalyDetector } from "../core/reputation/anomaly-detector.js";
import { DEFAULT_REPUTATION_CONFIG } from "../../shared/reputation.js";
import type { DimensionScores, TrustTier } from "../../shared/reputation.js";
import db from "../db/index.js";

const config = DEFAULT_REPUTATION_CONFIG;
const service = new ReputationService(
  new ReputationCalculator(config),
  new TrustTierEvaluator(config),
  new AnomalyDetector(config),
  config
);

const router = Router();

// GET /api/agents/:id/reputation — 返回完整 ReputationProfile
router.get("/agents/:id/reputation", (req, res) => {
  const profile = service.getReputation(req.params.id);
  if (!profile) {
    res.status(404).json({ error: "Agent reputation profile not found" });
    return;
  }
  res.json(profile);
});

// GET /api/admin/reputation/leaderboard — 排行榜
router.get("/admin/reputation/leaderboard", (req, res) => {
  const sortBy = (req.query.sortBy as string) || "overallScore";
  const order = (req.query.order as "asc" | "desc") || "desc";
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const trustTier = req.query.trustTier as TrustTier | undefined;

  const board = service.getLeaderboard({
    sortBy: sortBy as keyof DimensionScores | "overallScore",
    order,
    limit,
    offset,
    trustTier,
  });
  res.json({ leaderboard: board, total: board.length });
});

// POST /api/admin/reputation/:agentId/adjust — 手动调整
router.post("/admin/reputation/:agentId/adjust", (req, res) => {
  const { dimension, delta, reason } = req.body || {};
  if (!dimension || delta == null || !reason) {
    res
      .status(400)
      .json({ error: "dimension, delta, and reason are required" });
    return;
  }
  service.adjustReputation(req.params.agentId, dimension, delta, reason);
  const profile = service.getReputation(req.params.agentId);
  res.json(profile ?? { ok: true });
});

// POST /api/admin/reputation/:agentId/reset — 重置
router.post("/admin/reputation/:agentId/reset", (req, res) => {
  service.resetReputation(req.params.agentId);
  const profile = service.getReputation(req.params.agentId);
  res.json(profile ?? { ok: true });
});

// GET /api/admin/reputation/distribution — 分布直方图数据
router.get("/admin/reputation/distribution", (_req, res) => {
  const profiles = db.getAllReputationProfiles();
  const buckets: Record<string, number> = {
    "0-99": 0,
    "100-199": 0,
    "200-299": 0,
    "300-399": 0,
    "400-499": 0,
    "500-599": 0,
    "600-699": 0,
    "700-799": 0,
    "800-899": 0,
    "900-1000": 0,
  };
  for (const p of profiles) {
    const bucket =
      p.overallScore >= 900
        ? "900-1000"
        : `${Math.floor(p.overallScore / 100) * 100}-${Math.floor(p.overallScore / 100) * 100 + 99}`;
    buckets[bucket] = (buckets[bucket] || 0) + 1;
  }
  res.json({ distribution: buckets, total: profiles.length });
});

// GET /api/admin/reputation/trends — 趋势曲线数据
router.get("/admin/reputation/trends", (req, res) => {
  const agentId = req.query.agentId as string | undefined;
  const limit = parseInt(req.query.limit as string) || 100;

  if (agentId) {
    const events = db.getReputationEvents(agentId, limit);
    res.json({ agentId, events });
  } else {
    // Return aggregate: latest score per agent
    const profiles = db.getAllReputationProfiles();
    const summary = profiles.map(p => ({
      agentId: p.agentId,
      overallScore: p.overallScore,
      grade: p.grade,
      trustTier: p.trustTier,
      updatedAt: p.updatedAt,
    }));
    res.json({ trends: summary });
  }
});

export default router;
export { service as reputationService };
