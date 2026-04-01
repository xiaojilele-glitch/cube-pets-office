/**
 * 遥测 REST API 路由
 *
 * GET /api/telemetry/live    — 返回当前 Mission 的实时指标快照
 * GET /api/telemetry/history — 返回最近 10 次 Mission 的历史指标摘要
 */

import { Router } from "express";
import { telemetryStore } from "../core/telemetry-store.js";

const router = Router();

// GET /api/telemetry/live — 返回当前 Mission 实时快照
router.get("/live", (_req, res) => {
  res.json(telemetryStore.getSnapshot());
});

// GET /api/telemetry/history — 返回最近 Mission 历史摘要
router.get("/history", (_req, res) => {
  res.json(telemetryStore.getHistory());
});

export default router;
