import { Router } from "express";
import path from "path";

import db from "../db/index.js";
import { heartbeatScheduler } from "../core/heartbeat.js";
import { reportStore } from "../memory/report-store.js";

const router = Router();

router.get("/heartbeat/status", (_req, res) => {
  res.json({ statuses: heartbeatScheduler.getStatuses() });
});

router.get("/heartbeat", (req, res) => {
  const agentId =
    typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));

  if (agentId && !db.getAgent(agentId)) {
    return res.status(404).json({ error: "Agent not found" });
  }

  res.json({ reports: reportStore.listHeartbeatReports(agentId, limit) });
});

router.post("/heartbeat/:agentId/run", async (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  try {
    const report = await heartbeatScheduler.trigger(
      req.params.agentId,
      "manual"
    );
    res.json({ report });
  } catch (error: any) {
    res
      .status(400)
      .json({ error: error?.message || "Failed to run heartbeat" });
  }
});

router.get("/heartbeat/:agentId/:reportId", (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const report = reportStore.readHeartbeatReport(
    req.params.agentId,
    req.params.reportId
  );
  if (!report) {
    return res.status(404).json({ error: "Heartbeat report not found" });
  }

  res.json({ report });
});

router.get("/heartbeat/:agentId/:reportId/download", (req, res) => {
  const agent = db.getAgent(req.params.agentId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const format = req.query.format === "json" ? "json" : "md";
  const filePath = reportStore.getHeartbeatReportFilePath(
    req.params.agentId,
    req.params.reportId,
    format
  );

  if (!filePath) {
    return res.status(404).json({ error: "Heartbeat report file not found" });
  }

  res.download(filePath, path.basename(filePath));
});

export default router;
