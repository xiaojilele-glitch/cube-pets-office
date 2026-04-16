/**
 * Cost observability REST API routes.
 *
 * GET  /api/cost/live              → CostSnapshot
 * GET  /api/cost/history           → MissionCostSummary[]
 * GET  /api/cost/budget            → Budget
 * PUT  /api/cost/budget            → Budget (updated)
 * POST /api/cost/downgrade/release → manual degradation release
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */
import { Router } from "express";

import { costTracker } from "../core/cost-tracker.js";

const router = Router();

// GET /api/cost/live — Req 6.1, 6.5
router.get("/live", (_req, res) => {
  res.json(costTracker.getSnapshot());
});

// GET /api/cost/history — Req 6.2
router.get("/history", (_req, res) => {
  res.json(costTracker.getHistory());
});

// GET /api/cost/budget — Req 6.3
router.get("/budget", (_req, res) => {
  res.json(costTracker.getBudget());
});

// PUT /api/cost/budget — Req 6.4
router.put("/budget", (req, res) => {
  const { maxCost, maxTokens, warningThreshold } = req.body ?? {};

  if (
    typeof maxCost !== "number" ||
    typeof maxTokens !== "number" ||
    typeof warningThreshold !== "number"
  ) {
    return res.status(400).json({
      error:
        "Request body must include numeric maxCost, maxTokens, and warningThreshold",
    });
  }

  if (
    maxCost <= 0 ||
    maxTokens <= 0 ||
    warningThreshold <= 0 ||
    warningThreshold > 1
  ) {
    return res.status(400).json({
      error:
        "maxCost and maxTokens must be positive; warningThreshold must be in (0, 1]",
    });
  }

  costTracker.setBudget({ maxCost, maxTokens, warningThreshold });
  res.json(costTracker.getBudget());
});

// POST /api/cost/downgrade/release — Req 5.4
router.post("/downgrade/release", (_req, res) => {
  costTracker.manualReleaseDegradation();
  res.json({ ok: true, downgradeLevel: costTracker.getDowngradeLevel() });
});

export default router;
