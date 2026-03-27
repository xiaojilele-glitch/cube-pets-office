/**
 * Workflow Routes — REST API for workflow management
 */
import { Router } from "express";
import path from "path";
import db from "../db/index.js";
import { getAIConfig } from "../core/ai-config.js";
import { generateWorkflowOrganization } from "../core/dynamic-organization.js";
import { workflowEngine } from "../core/workflow-engine.js";
import { reportStore } from "../memory/report-store.js";
import { serverRuntime } from "../runtime/server-runtime.js";

const router = Router();
const ACTIVE_WORKFLOW_STATUSES = ["pending", "running"] as const;
const RECENT_DUPLICATE_WINDOW_MS = 15_000;

function normalizeDirective(directive: string): string {
  return directive.trim().replace(/\s+/g, " ");
}

// POST /api/workflows — Start a new workflow
router.post("/organization/preview", async (req, res) => {
  const { directive } = req.body;
  if (!directive || typeof directive !== "string") {
    return res.status(400).json({ error: "directive is required" });
  }

  const normalizedDirective = normalizeDirective(directive);
  if (!normalizedDirective) {
    return res.status(400).json({ error: "directive is required" });
  }

  try {
    const { organization, debug } = await generateWorkflowOrganization({
      workflowId: `preview_${Date.now()}`,
      directive: normalizedDirective,
      llmProvider: serverRuntime.llmProvider,
      model: getAIConfig().model,
    });
    res.json({ organization, debug });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { directive } = req.body;
  if (!directive || typeof directive !== "string") {
    return res.status(400).json({ error: "directive is required" });
  }

  const normalizedDirective = normalizeDirective(directive);
  if (!normalizedDirective) {
    return res.status(400).json({ error: "directive is required" });
  }

  try {
    const activeWorkflow = db.findWorkflowByDirective(normalizedDirective, {
      statuses: [...ACTIVE_WORKFLOW_STATUSES],
    });
    if (activeWorkflow) {
      return res.json({
        workflowId: activeWorkflow.id,
        status: activeWorkflow.status,
        deduped: true,
      });
    }

    const recentWorkflow = db.findWorkflowByDirective(normalizedDirective, {
      maxAgeMs: RECENT_DUPLICATE_WINDOW_MS,
    });
    if (recentWorkflow) {
      return res.json({
        workflowId: recentWorkflow.id,
        status: recentWorkflow.status,
        deduped: true,
      });
    }

    const workflowId = await workflowEngine.startWorkflow(normalizedDirective);
    res.json({ workflowId, status: "running", deduped: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workflows — List all workflows
router.get("/", (_req, res) => {
  const workflows = db.getWorkflows();
  res.json({ workflows });
});

// GET /api/workflows/:id — Get workflow details
router.get("/:id", (req, res) => {
  const wf = db.getWorkflow(req.params.id);
  if (!wf) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const tasks = db.getTasksByWorkflow(req.params.id);
  const messages = db.getMessagesByWorkflow(req.params.id);
  const report = reportStore.readFinalWorkflowReport(req.params.id);

  res.json({
    workflow: wf,
    tasks,
    messages,
    report,
  });
});

// GET /api/workflows/:id/report — Get final workflow report
router.get("/:id/report", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const report = reportStore.readFinalWorkflowReport(req.params.id);
  if (!report) {
    return res.status(404).json({ error: "Final report not found" });
  }

  res.json({ report });
});

// GET /api/workflows/:id/report/download?format=json|md — Download final workflow report
router.get("/:id/report/download", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const format = req.query.format === "json" ? "json" : "md";
  const filePath = reportStore.getFinalWorkflowReportFilePath(
    req.params.id,
    format
  );
  if (!filePath) {
    return res.status(404).json({ error: "Final report file not found" });
  }

  res.download(filePath, path.basename(filePath));
});

// GET /api/workflows/:id/report/department/:managerId/download?format=json|md
router.get("/:id/report/department/:managerId/download", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const manager = db.getAgent(req.params.managerId);
  if (!manager) {
    return res.status(404).json({ error: "Manager not found" });
  }

  const format = req.query.format === "json" ? "json" : "md";
  const filePath = reportStore.getDepartmentReportFilePath(
    req.params.managerId,
    req.params.id,
    format
  );
  if (!filePath) {
    return res.status(404).json({ error: "Department report file not found" });
  }

  res.download(filePath, path.basename(filePath));
});

// GET /api/workflows/:id/tasks — Get tasks for a workflow
router.get("/:id/tasks", (req, res) => {
  const tasks = db.getTasksByWorkflow(req.params.id);
  res.json({ tasks });
});

// GET /api/workflows/:id/messages — Get messages for a workflow
router.get("/:id/messages", (req, res) => {
  const messages = db.getMessagesByWorkflow(req.params.id);
  res.json({ messages });
});

export default router;
