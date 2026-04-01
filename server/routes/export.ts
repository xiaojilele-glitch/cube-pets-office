/**
 * Export Routes — REST API for cross-framework workflow export
 *
 * POST /api/export
 * Body: { workflowId: string, framework: ExportFramework }
 * Response: ZIP file stream (application/zip)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
import { Router } from "express";
import { exportWorkflow } from "../core/exporter.js";
import { SUPPORTED_FRAMEWORKS, type ExportFramework } from "../../shared/export-schema.js";

const router = Router();

router.post("/", async (req, res) => {
  const { workflowId, framework } = req.body;

  // --- Validate framework parameter ---
  if (
    !framework ||
    typeof framework !== "string" ||
    !SUPPORTED_FRAMEWORKS.includes(framework as (typeof SUPPORTED_FRAMEWORKS)[number])
  ) {
    return res.status(400).json({
      error: "Invalid framework",
      supported: [...SUPPORTED_FRAMEWORKS],
    });
  }

  try {
    const { buffer, filename } = await exportWorkflow(
      workflowId,
      framework as ExportFramework
    );

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    return res.send(buffer);
  } catch (err: any) {
    const message: string = err?.message ?? "";

    // Map known error messages to appropriate HTTP status codes
    if (message.includes("Workflow not found")) {
      return res.status(404).json({ error: "Workflow not found" });
    }
    if (message.includes("No organization found")) {
      return res.status(404).json({ error: "No organization found for this workflow" });
    }
    if (message.includes("Invalid framework")) {
      return res.status(400).json({
        error: "Invalid framework",
        supported: [...SUPPORTED_FRAMEWORKS],
      });
    }

    // Internal error — no stack trace exposed
    return res.status(500).json({ error: "Export packaging failed" });
  }
});

export default router;
