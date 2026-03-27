/**
 * Cube Pets Office — Server Entry Point
 * Express + Socket.IO + REST API + Multi-Agent Orchestration
 */
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeAgentRuntime() {
  const db = (await import("./db/index.js")).default;
  const { ensureAgentWorkspaces } = await import("./memory/workspace.js");

  const agentIds = db.getAgents().map(agent => agent.id);
  const workspaces = ensureAgentWorkspaces(agentIds);

  console.log(
    `[Workspace] Ready. ${workspaces.length} agent workspaces materialized.`
  );
  return { agentIds, workspaceCount: workspaces.length };
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Initialize Socket.IO
  const { initSocketIO } = await import("./core/socket.js");
  initSocketIO(server);

  await initializeAgentRuntime();

  const db = (await import("./db/index.js")).default;
  const { soulStore } = await import("./memory/soul-store.js");
  soulStore.ensureAllSoulFiles();

  // Initialize agent registry
  const { registry } = await import("./core/registry.js");
  registry.init();
  const { heartbeatScheduler } = await import("./core/heartbeat.js");
  const { sessionStore } = await import("./memory/session-store.js");

  // Recover workflows that were left running across restarts.
  for (const workflow of db.getWorkflows()) {
    if (workflow.status === "running") {
      db.updateWorkflow(workflow.id, {
        status: "failed",
        results: {
          ...(workflow.results || {}),
          last_error: "Server restarted before the workflow completed.",
          failed_stage: workflow.current_stage || null,
        },
      });
    } else if (
      workflow.status === "completed" ||
      workflow.status === "completed_with_errors" ||
      workflow.status === "failed"
    ) {
      sessionStore.materializeWorkflowMemories(workflow.id);
    }
  }

  // API Routes
  const agentRoutes = (await import("./routes/agents.js")).default;
  const chatRoutes = (await import("./routes/chat.js")).default;
  const reportRoutes = (await import("./routes/reports.js")).default;
  const workflowRoutes = (await import("./routes/workflows.js")).default;
  const configRoutes = (await import("./routes/config.js")).default;

  app.use("/api/agents", agentRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/workflows", workflowRoutes);
  app.use("/api/config", configRoutes);

  heartbeatScheduler.start();

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`API available at http://localhost:${port}/api/`);
  });
}

export { initializeAgentRuntime, startServer };
startServer().catch(console.error);
