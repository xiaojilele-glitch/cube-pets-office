/**
 * REST API routes for guest agent management.
 *
 * POST   /api/agents/guest      — Create a guest agent
 * GET    /api/agents/guest      — List active guest agents
 * DELETE /api/agents/guest/:id  — Remove a guest agent
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.7
 */
import { Router, type Request, type Response } from "express";
import { registry, MAX_GUESTS } from "../core/registry.js";
import { GuestAgent } from "../core/guest-agent.js";
import { guestLifecycleManager } from "../core/guest-lifecycle.js";
import { generateGuestId, sanitizeGuestConfig } from "../../shared/guest-agent-utils.js";
import { ensureAgentWorkspace } from "../memory/workspace.js";
import type { GuestAgentConfig, GuestAgentNode } from "../../shared/organization-schema.js";

const router = Router();

/**
 * POST /api/agents/guest — Create a guest agent.
 * @see Requirements 2.1, 2.7
 */
router.post("/", (req: Request, res: Response) => {
  const { name, config, departmentId, managerId } = req.body ?? {};

  // Validate required fields
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Missing required field: name" });
  }
  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "Missing required field: config" });
  }
  const cfg = config as Partial<GuestAgentConfig>;
  if (!cfg.model || typeof cfg.model !== "string") {
    return res.status(400).json({ error: "Missing required field: config.model" });
  }
  if (!cfg.baseUrl || typeof cfg.baseUrl !== "string") {
    return res.status(400).json({ error: "Missing required field: config.baseUrl" });
  }

  // Build a complete GuestAgentConfig with defaults
  const guestConfig: GuestAgentConfig = {
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    skills: Array.isArray(cfg.skills) ? cfg.skills : [],
    mcp: Array.isArray(cfg.mcp) ? cfg.mcp : [],
    avatarHint: typeof cfg.avatarHint === "string" ? cfg.avatarHint : "cat",
  };

  const id = generateGuestId();
  const dept = typeof departmentId === "string" && departmentId.trim() ? departmentId.trim() : "engineering";
  const mgr = typeof managerId === "string" && managerId.trim() ? managerId.trim() : "mgr-eng";

  const orgNode: GuestAgentNode = {
    id,
    agentId: id,
    parentId: mgr,
    departmentId: dept,
    departmentLabel: dept.charAt(0).toUpperCase() + dept.slice(1),
    name: name.trim(),
    title: "Guest Worker",
    role: "worker",
    responsibility: "Assist with tasks as a guest agent",
    responsibilities: ["Assist with assigned tasks"],
    goals: ["Complete assigned work"],
    summaryFocus: [],
    skills: [],
    mcp: [],
    model: { model: guestConfig.model, temperature: 0.7, maxTokens: 3000 },
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
    invitedBy: "api",
    source: "manual",
    expiresAt: Date.now() + 3600_000,
    guestConfig,
  };

  // Attempt registration (may throw if limit reached)
  try {
    const agent = new GuestAgent(id, guestConfig, orgNode);
    registry.registerGuest(id, agent);
  } catch (err: any) {
    if (err.message?.includes("Maximum guest agent limit reached")) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  // Create workspace directory
  ensureAgentWorkspace(id);

  return res.status(201).json({
    id,
    name: name.trim(),
    config: sanitizeGuestConfig(guestConfig),
    createdAt: new Date().toISOString(),
  });
});

/**
 * GET /api/agents/guest — List active guest agents (apiKey hidden).
 * @see Requirements 2.2
 */
router.get("/", (_req: Request, res: Response) => {
  const guests = registry.getGuestAgents().map((agent) => ({
    id: agent.config.id,
    name: agent.config.name,
    department: agent.config.department,
    role: agent.config.role,
    managerId: agent.config.managerId,
    config: sanitizeGuestConfig(agent.guestConfig),
  }));
  return res.json({ guests });
});

/**
 * DELETE /api/agents/guest/:id — Remove a guest agent.
 * @see Requirements 2.3
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!registry.isGuest(id)) {
    return res.status(404).json({ error: `Guest agent not found: ${id}` });
  }
  await guestLifecycleManager.leaveOffice(id);
  return res.status(204).send();
});

export default router;
