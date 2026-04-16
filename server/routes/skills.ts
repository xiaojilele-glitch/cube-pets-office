/**
 * REST API for Skill management — registration, query, versioning, enable/disable, metrics.
 */
import { Router } from "express";
import { skillRegistry } from "../core/dynamic-organization.js";
import { SkillMonitor } from "../core/skill-monitor.js";
import db from "../db/index.js";
import type { SkillDefinition } from "../../shared/skill-contracts.js";

const router = Router();
const monitor = new SkillMonitor(db);

// POST /api/skills — 注册新 Skill
router.post("/", (req, res) => {
  try {
    const definition: SkillDefinition = req.body;
    const record = skillRegistry.registerSkill(definition);
    res.status(201).json(record);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/skills — 查询 Skill 列表
router.get("/", (req, res) => {
  const category = req.query.category as string | undefined;
  const tags = req.query.tags
    ? (req.query.tags as string).split(",")
    : undefined;
  const results = skillRegistry.querySkills({ category, tags });
  res.json({ skills: results });
});

// GET /api/skills/:id/versions — 查询版本列表
router.get("/:id/versions", (req, res) => {
  const versions = skillRegistry.getSkillVersions(req.params.id);
  res.json({ versions });
});

// PUT /api/skills/:id/:version/enable — 启用 Skill
router.put("/:id/:version/enable", (req, res) => {
  try {
    const { operator = "system", reason = "" } = req.body || {};
    skillRegistry.enableSkill(
      req.params.id,
      req.params.version,
      operator,
      reason
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// PUT /api/skills/:id/:version/disable — 禁用 Skill
router.put("/:id/:version/disable", (req, res) => {
  try {
    const { operator = "system", reason = "" } = req.body || {};
    skillRegistry.disableSkill(
      req.params.id,
      req.params.version,
      operator,
      reason
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// GET /api/skills/:id/metrics — 查询性能指标
router.get("/:id/metrics", (req, res) => {
  const start = req.query.start as string | undefined;
  const end = req.query.end as string | undefined;
  const timeRange = start && end ? { start, end } : undefined;
  const metrics = monitor.getSkillMetrics(req.params.id, timeRange);
  res.json(metrics);
});

export default router;
