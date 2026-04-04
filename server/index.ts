/**
 * Cube Pets Office - Server Entry Point
 * Express + Socket.IO + REST API + Multi-Agent Orchestration
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  MISSION_CORE_STAGE_BLUEPRINT,
  type MissionArtifact,
  type MissionDecision,
  type MissionInstanceContext,
} from "../shared/mission/contracts.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_EXECUTOR_BASE_URL = "http://127.0.0.1:3031";
const EXECUTOR_STAGE_LABELS: Record<string, string> = {
  receive: "Receive task",
  understand: "Understand request",
  plan: "Build execution plan",
  provision: "Provision execution runtime",
  scan: "Scan workspace",
  analyze: "Analyze request",
  "build-plan": "Build execution plan",
  dispatch: "Provision execution runtime",
  codegen: "Generate artifacts",
  execute: "Run execution",
  report: "Publish report",
  custom: "Custom action",
  finalize: "Finalize mission",
};
const SMOKE_STAGE_LABELS = [...MISSION_CORE_STAGE_BLUEPRINT];

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

interface ExecutorCallbackRequestBody {
  event?: {
    version?: string;
    eventId?: string;
    missionId?: string;
    jobId?: string;
    executor?: string;
    type?: string;
    status?: string;
    occurredAt?: string;
    stageKey?: string;
    progress?: number;
    message?: string;
    detail?: string;
    waitingFor?: string;
    decision?: {
      prompt?: string;
      options?: Array<{
        id?: string;
        label?: string;
        description?: string;
      }>;
      allowFreeText?: boolean;
      placeholder?: string;
    };
    summary?: string;
    errorCode?: string;
    log?: {
      level?: "info" | "warn" | "error";
      message?: string;
    };
    artifacts?: Array<{
      kind?: "file" | "report" | "url" | "log";
      name?: string;
      path?: string;
      url?: string;
      description?: string;
    }>;
    payload?: {
      instance?: {
        id?: string;
        image?: string;
        command?: string[];
        workspaceRoot?: string;
        startedAt?: number;
        completedAt?: number;
        exitCode?: number;
        host?: string;
      };
      securitySummary?: {
        level?: string;
        user?: string;
        networkMode?: string;
        readonlyRootfs?: boolean;
        memoryLimit?: string;
        cpuLimit?: string;
        pidsLimit?: number;
      };
    };
    /** 日志/截图关联的步骤索引 */
    stepIndex?: number;
    /** 日志流类型 */
    stream?: "stdout" | "stderr";
    /** 日志数据（最大 4KB） */
    data?: string;
    /** base64 编码 PNG 截图（最大 200KB） */
    imageData?: string;
    /** 截图宽度 */
    imageWidth?: number;
    /** 截图高度 */
    imageHeight?: number;
  };
}

interface DispatchSmokeRequestBody {
  title?: string;
  sourceText?: string;
  outcome?: "success" | "failed";
  executorBaseUrl?: string;
}

interface SeedRunningSmokeRequestBody {
  title?: string;
  sourceText?: string;
  stageKey?: string;
  detail?: string;
  progress?: number;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !value.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function executorStageLabel(stageKey: string | undefined): string {
  if (!stageKey) return EXECUTOR_STAGE_LABELS.finalize;
  return EXECUTOR_STAGE_LABELS[stageKey] || stageKey;
}

function buildServerBaseUrl(request: Request): string {
  const forwardedProto = request.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.header("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get("host") || "127.0.0.1";
  return `${protocol}://${host}`;
}

function parseHexSignature(rawValue: string | undefined): Buffer | null {
  if (!rawValue) return null;
  const normalized = rawValue.startsWith("sha256=")
    ? rawValue.slice("sha256=".length)
    : rawValue;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized.toLowerCase(), "hex");
}

function createExecutorCallbackSignature(
  secret: string,
  timestamp: string,
  rawBody: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function verifyExecutorCallbackSignature(
  request: RequestWithRawBody,
  response: Response
): boolean {
  const secret = process.env.EXECUTOR_CALLBACK_SECRET?.trim();
  if (!secret) return true;

  const timestamp = request.header("x-cube-executor-timestamp")?.trim();
  const signature = request.header("x-cube-executor-signature")?.trim();
  const rawBody = request.rawBody || "";
  const maxSkewMs =
    parsePositiveInteger(process.env.EXECUTOR_CALLBACK_MAX_SKEW_SECONDS, 300) *
    1_000;

  if (!timestamp || !signature) {
    response
      .status(401)
      .json({ ok: false, error: "Missing executor callback auth headers" });
    return false;
  }

  const timestampMs = /^\d+$/.test(timestamp)
    ? timestamp.length <= 10
      ? Number.parseInt(timestamp, 10) * 1_000
      : Number.parseInt(timestamp, 10)
    : Number.NaN;

  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > maxSkewMs) {
    response
      .status(401)
      .json({ ok: false, error: "Executor callback timestamp is invalid or expired" });
    return false;
  }

  const expected = Buffer.from(
    createExecutorCallbackSignature(secret, timestamp, rawBody),
    "hex"
  );
  const actual = parseHexSignature(signature);
  if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    response
      .status(401)
      .json({ ok: false, error: "Executor callback signature mismatch" });
    return false;
  }

  return true;
}

function resolveExecutorStageKey(
  event: NonNullable<ExecutorCallbackRequestBody["event"]>,
  fallback: string | undefined
): string {
  const rawStageKey = event.stageKey?.trim();
  if (rawStageKey) {
    if (["receive", "understand", "plan", "provision", "execute", "finalize"].includes(rawStageKey)) {
      return rawStageKey;
    }
    if (rawStageKey === "scan" || rawStageKey === "analyze") return "understand";
    if (rawStageKey === "build-plan") return "plan";
    if (rawStageKey === "dispatch") return "provision";
    if (rawStageKey === "codegen" || rawStageKey === "execute" || rawStageKey === "custom") {
      return "execute";
    }
    if (rawStageKey === "report") return "finalize";
  }

  if (event.type === "job.accepted") return "provision";
  if (event.type === "job.waiting" || event.status === "waiting") {
    return fallback || "execute";
  }
  if (
    event.type === "job.completed" ||
    event.type === "job.failed" ||
    event.type === "job.cancelled" ||
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "cancelled"
  ) {
    return "finalize";
  }

  return fallback || "execute";
}

function normalizeExecutorArtifacts(
  artifacts: NonNullable<ExecutorCallbackRequestBody["event"]>["artifacts"]
): MissionArtifact[] | undefined {
  if (!Array.isArray(artifacts)) return undefined;

  const normalized = artifacts.flatMap(artifact => {
    if (
      !artifact ||
      (artifact.kind !== "file" &&
        artifact.kind !== "report" &&
        artifact.kind !== "url" &&
        artifact.kind !== "log") ||
      !artifact.name?.trim()
    ) {
      return [];
    }

    return [
      {
        kind: artifact.kind,
        name: artifact.name.trim(),
        path: artifact.path?.trim() || undefined,
        url: artifact.url?.trim() || undefined,
        description: artifact.description?.trim() || undefined,
      },
    ];
  });

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeExecutorInstance(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["payload"]
): MissionInstanceContext | undefined {
  const instance = value?.instance;
  if (!instance || typeof instance !== "object") return undefined;

  return {
    id: instance.id?.trim() || undefined,
    image: instance.image?.trim() || undefined,
    command: Array.isArray(instance.command)
      ? instance.command.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    workspaceRoot: instance.workspaceRoot?.trim() || undefined,
    startedAt: typeof instance.startedAt === "number" ? instance.startedAt : undefined,
    completedAt:
      typeof instance.completedAt === "number" ? instance.completedAt : undefined,
    exitCode: typeof instance.exitCode === "number" ? instance.exitCode : undefined,
    host: instance.host?.trim() || undefined,
  };
}

function normalizeSmokeOutcome(value: unknown): "success" | "failed" {
  return value === "failed" ? "failed" : "success";
}

function normalizeSecuritySummary(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["payload"]
): MissionRecord["securitySummary"] | undefined {
  const ss = value?.securitySummary;
  if (!ss || typeof ss !== "object") return undefined;
  if (!ss.level?.trim()) return undefined;
  return {
    level: ss.level.trim(),
    user: ss.user?.trim() || "65534",
    networkMode: ss.networkMode?.trim() || "none",
    readonlyRootfs: ss.readonlyRootfs === true,
    memoryLimit: ss.memoryLimit?.trim() || "512MB",
    cpuLimit: ss.cpuLimit?.trim() || "1.0",
    pidsLimit: typeof ss.pidsLimit === "number" ? ss.pidsLimit : 256,
  };
}

function normalizeExecutorDecision(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["decision"]
): MissionDecision | undefined {
  if (!value?.prompt?.trim()) return undefined;

  const options = Array.isArray(value.options)
    ? value.options.flatMap((option: NonNullable<typeof value.options>[number]) => {
        if (!option?.id?.trim() || !option?.label?.trim()) {
          return [];
        }

        return [
          {
            id: option.id.trim(),
            label: option.label.trim(),
            description: option.description?.trim() || undefined,
          },
        ];
      })
    : [];

  if (options.length === 0) return undefined;

  return {
    prompt: value.prompt.trim(),
    options,
    allowFreeText: value.allowFreeText === true,
    placeholder: value.placeholder?.trim() || undefined,
  };
}

function isSmokeEnabled(): boolean {
  return parseBoolean(process.env.MISSION_SMOKE_ENABLED, false);
}

function sendSmokeDisabled(response: Response): Response {
  return response.status(404).json({
    ok: false,
    error: "Mission smoke routes are disabled. Set MISSION_SMOKE_ENABLED=true to enable them.",
  });
}

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

  app.use(
    express.json({
      limit: "10mb",
      verify: (request, _response, buffer) => {
        (request as RequestWithRawBody).rawBody = buffer.toString("utf8");
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  const { initSocketIO } = await import("./core/socket.js");
  initSocketIO(server);

  await initializeAgentRuntime();

  const db = (await import("./db/index.js")).default;
  const { soulStore } = await import("./memory/soul-store.js");
  soulStore.ensureAllSoulFiles();

  const { registry } = await import("./core/registry.js");
  registry.init();
  const { heartbeatScheduler } = await import("./core/heartbeat.js");
  const { sessionStore } = await import("./memory/session-store.js");
  const { missionRuntime } = await import("./tasks/mission-runtime.js");
  const { createTaskRouter, createDecisionTemplatesRouter } = await import("./routes/tasks.js");
  const { createPlanetRouter } = await import("./routes/planets.js");
  const { createFeishuRouter } = await import("./routes/feishu.js");
  const { buildExecutionPlan } = await import("./core/execution-plan-builder.js");
  const { ExecutorClient } = await import("./core/executor-client.js");
  const { EXECUTOR_API_ROUTES } = await import("../shared/executor/api.js");

  // Wire up workflow → mission enrichment bridge (workflow-decoupling Task 4.2)
  const { serverRuntime, setOnStageCompleted } = await import("./runtime/server-runtime.js");
  const { initEnrichmentBridge, onWorkflowStageCompleted } = await import("./core/mission-enrichment-bridge.js");
  initEnrichmentBridge(missionRuntime, serverRuntime.workflowRepo);
  setOnStageCompleted(onWorkflowStageCompleted);

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

  const agentRoutes = (await import("./routes/agents.js")).default;
  const chatRoutes = (await import("./routes/chat.js")).default;
  const reportRoutes = (await import("./routes/reports.js")).default;
  const workflowRoutes = (await import("./routes/workflows.js")).default;
  const configRoutes = (await import("./routes/config.js")).default;
  const exportRoutes = (await import("./routes/export.js")).default;
  const telemetryRoutes = (await import("./routes/telemetry.js")).default;
  const costRoutes = (await import("./routes/cost.js")).default;
  const replayRoutes = (await import("./routes/replay.js")).default;
  const { costTracker } = await import("./core/cost-tracker.js");

  costTracker.loadHistory();

  // ── Collaboration Replay ──
  const { ServerReplayStore } = await import("./replay/replay-store.js");
  const { EventCollector } = await import("./replay/event-collector.js");
  const {
    installMissionInterceptor,
    installMessageBusInterceptor,
    installExecutorInterceptor,
  } = await import("./replay/interceptors.js");
  const { messageBus } = await import("./core/message-bus.js");

  const replayStore = new ServerReplayStore();
  const eventCollector = new EventCollector(replayStore);

  installMissionInterceptor(missionRuntime, eventCollector);
  installMessageBusInterceptor(messageBus, eventCollector);
  app.use("/api/executor/events", installExecutorInterceptor(eventCollector));

  // ── Knowledge Graph ──
  const { GraphStore } = await import("./knowledge/graph-store.js");
  const { OntologyRegistry } = await import("./knowledge/ontology-registry.js");
  const { KnowledgeReviewQueue } = await import("./knowledge/review-queue.js");
  const { KnowledgeGraphQuery } = await import("./knowledge/query-service.js");
  const { KnowledgeService } = await import("./knowledge/knowledge-service.js");
  const { createKnowledgeRouter } = await import("./routes/knowledge.js");
  const { createKnowledgeAdminRouter } = await import("./routes/knowledge-admin.js");

  const graphStore = new GraphStore();
  const ontologyRegistry = new OntologyRegistry();
  const reviewQueue = new KnowledgeReviewQueue(graphStore);
  const queryService = new KnowledgeGraphQuery(graphStore, ontologyRegistry);
  const knowledgeService = new KnowledgeService(queryService, graphStore);

  const { getSocketIO, registerSandboxRelay } = await import("./core/socket.js");
  const { SandboxRelay } = await import("./core/sandbox-relay.js");
  const { SANDBOX_SOCKET_EVENTS } = await import("../shared/mission/socket.js");
  const sandboxRelay = new SandboxRelay();
  registerSandboxRelay(sandboxRelay);

  graphStore.onEntityChanged((entity, action) => {
    const io = getSocketIO();
    if (io) {
      io.emit("knowledge.entityChanged", { entity, action });
    }
  });

  // ── RAG Pipeline ──
  const { getRAGConfig } = await import("./rag/config.js");
  const ragConfig = getRAGConfig();
  if (ragConfig.enabled) {
    const { initRAG } = await import("./rag/index.js");
    const ragDeps = initRAG();
    const { createRAGRouter } = await import("./routes/rag.js");
    app.use("/api/rag", createRAGRouter(ragDeps));
  }

  app.use("/api/agents", agentRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/workflows", workflowRoutes);
  app.use("/api/config", configRoutes);
  app.use("/api/export", exportRoutes);
  app.use("/api/telemetry", telemetryRoutes);
  app.use("/api/cost", costRoutes);
  const visionRoutes = (await import("./routes/vision.js")).default;
  app.use("/api/vision", visionRoutes);
  const voiceRoutes = (await import("./routes/voice.js")).default;
  app.use("/api/voice", voiceRoutes);
  const skillRoutes = (await import("./routes/skills.js")).default;
  app.use("/api/skills", skillRoutes);
  const { seedSkills } = await import("./core/skill-seed.js");
  seedSkills();
  const analyticsRoutes = (await import("./routes/analytics.js")).default;
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/replay", replayRoutes);
  const reputationRoutes = (await import("./routes/reputation.js")).default;
  app.use("/api", reputationRoutes);
  app.use("/api/tasks", createTaskRouter(missionRuntime));
  app.use("/api/decision-templates", createDecisionTemplatesRouter());
  app.use("/api/planets", createPlanetRouter(missionRuntime));
  app.use("/api/feishu", createFeishuRouter());
  app.use("/api/knowledge", createKnowledgeRouter({ graphStore, reviewQueue, knowledgeService }));
  app.use("/api/admin/knowledge", createKnowledgeAdminRouter({ graphStore, ontologyRegistry, reviewQueue }));

  const nlCommandRoutes = (await import("./routes/nl-command.js")).default;
  app.use("/api/nl-command", nlCommandRoutes);

  app.post("/api/executor/events", async (request, response) => {
    const typedRequest = request as RequestWithRawBody;
    if (!verifyExecutorCallbackSignature(typedRequest, response)) return;

    const event = (request.body as ExecutorCallbackRequestBody | undefined)?.event;
    if (!event?.missionId?.trim() || !event?.jobId?.trim() || !event?.eventId?.trim()) {
      return response.status(400).json({
        ok: false,
        error: "Executor callback body must include event.missionId, event.jobId, and event.eventId",
      });
    }

    const missionId = event.missionId.trim();
    const current = missionRuntime.getTask(missionId);
    if (!current) {
      return response.status(404).json({
        ok: false,
        error: `Mission not found for executor event: ${missionId}`,
      });
    }

    const progress =
      typeof event.progress === "number"
        ? Math.max(0, Math.min(100, event.progress))
        : current.progress;
    const stageKey = resolveExecutorStageKey(event, current.currentStageKey);
    const detail =
      event.detail?.trim() ||
      event.message?.trim() ||
      `Executor event at ${executorStageLabel(stageKey)}`;
    const executorName = event.executor?.trim() || current.executor?.name || "executor";
    const artifacts = normalizeExecutorArtifacts(event.artifacts);
    const instance = normalizeExecutorInstance(event.payload);
    const securitySummary = normalizeSecuritySummary(event.payload);

    missionRuntime.patchMissionExecution(missionId, {
      executor: {
        name: executorName,
        requestId: current.executor?.requestId,
        jobId: event.jobId.trim(),
        status: event.status?.trim() || current.executor?.status,
        baseUrl: current.executor?.baseUrl,
        lastEventType: event.type?.trim() || current.executor?.lastEventType,
        lastEventAt: Date.now(),
      },
      instance: instance || current.instance,
      artifacts: artifacts || current.artifacts,
      securitySummary: securitySummary || current.securitySummary,
    });

    if (event.type === "job.log") {
      missionRuntime.logMission(
        missionId,
        event.log?.message?.trim() || detail,
        event.log?.level === "error"
          ? "error"
          : event.log?.level === "warn"
            ? "warn"
            : "info",
        progress,
        "executor"
      );
    } else if (event.type === "job.log_stream") {
      const logEntry = {
        missionId,
        jobId: event.jobId.trim(),
        stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : 0,
        stream: (event.stream === "stderr" ? "stderr" : "stdout") as "stdout" | "stderr",
        data: event.data ?? "",
        timestamp: event.occurredAt?.trim() || new Date().toISOString(),
      };
      sandboxRelay.appendLog(logEntry);
      const io = getSocketIO();
      if (io) {
        io.emit(SANDBOX_SOCKET_EVENTS.missionLog, logEntry);
      }
    } else if (event.type === "job.screenshot") {
      const screenPayload = {
        missionId,
        jobId: event.jobId.trim(),
        stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : 0,
        imageData: event.imageData ?? "",
        width: typeof event.imageWidth === "number" ? event.imageWidth : 0,
        height: typeof event.imageHeight === "number" ? event.imageHeight : 0,
        timestamp: event.occurredAt?.trim() || new Date().toISOString(),
      };
      const io = getSocketIO();
      if (io) {
        io.emit(SANDBOX_SOCKET_EVENTS.missionScreen, screenPayload);
      }
    } else if (event.type === "job.waiting" || event.status === "waiting") {
      missionRuntime.markMissionRunning(missionId, stageKey, detail, progress, "executor");
      missionRuntime.waitOnMission(
        missionId,
        event.waitingFor?.trim() || detail,
        detail,
        progress,
        normalizeExecutorDecision(event.decision),
        "executor"
      );
    } else if (event.type === "job.completed" || event.status === "completed") {
      missionRuntime.markMissionRunning(missionId, stageKey, detail, progress, "executor");
      missionRuntime.finishMission(
        missionId,
        event.summary?.trim() || detail,
        "executor"
      );
    } else if (
      event.type === "job.failed" ||
      event.type === "job.cancelled" ||
      event.status === "failed" ||
      event.status === "cancelled"
    ) {
      missionRuntime.markMissionRunning(missionId, stageKey, detail, progress, "executor");
      missionRuntime.failMission(
        missionId,
        event.summary?.trim() || detail,
        "executor"
      );
    } else {
      missionRuntime.markMissionRunning(missionId, stageKey, detail, progress, "executor");
    }

    return response.json({
      ok: true,
      accepted: true,
      missionId,
      jobId: event.jobId.trim(),
      eventId: event.eventId.trim(),
    });
  });

  app.post("/api/tasks/smoke/dispatch", async (request, response) => {
    if (!isSmokeEnabled()) return sendSmokeDisabled(response);

    const body = (request.body || {}) as DispatchSmokeRequestBody;
    const outcome = normalizeSmokeOutcome(body.outcome);
    const sourceText =
      body.sourceText?.trim() ||
      (outcome === "failed"
        ? "Execute a smoke task that should fail after staged executor updates."
        : "Execute a smoke task that should complete after staged executor updates.");
    const title =
      body.title?.trim() ||
      (outcome === "failed"
        ? "Mission integration smoke failure"
        : "Mission integration smoke success");

    const mission = missionRuntime.createTask({
      kind: "executor-smoke",
      title,
      sourceText,
      stageLabels: SMOKE_STAGE_LABELS,
    });

    try {
      missionRuntime.markMissionRunning(
        mission.id,
        "understand",
        "Smoke mission accepted and queued for plan building.",
        8,
        "brain"
      );

      const buildResult = await buildExecutionPlan({
        missionId: mission.id,
        title,
        sourceText,
        requestedBy: "system",
      });

      missionRuntime.updateMissionStage(
        mission.id,
        "understand",
        { status: "done", detail: buildResult.understanding.summary },
        16,
        "brain"
      );
      missionRuntime.markMissionRunning(
        mission.id,
        "plan",
        "Structured execution plan created for smoke dispatch.",
        28,
        "brain"
      );
      missionRuntime.updateMissionStage(
        mission.id,
        "plan",
        { status: "done", detail: buildResult.plan.summary },
        36,
        "brain"
      );
      missionRuntime.markMissionRunning(
        mission.id,
        "provision",
        "Provisioning executor job on lobster.",
        45,
        "brain"
      );

      const firstJob = buildResult.plan.jobs[0];
      if (!firstJob) {
        throw new Error("Execution plan did not produce any executor jobs.");
      }
      firstJob.payload = {
        ...(firstJob.payload || {}),
        runner: {
          kind: "mock",
          outcome,
          steps: 3,
          delayMs: 40,
          summary:
            outcome === "failed"
              ? "Smoke failed job completed with expected mock failure"
              : "Smoke success job completed",
        },
      };

      const executorBaseUrl =
        body.executorBaseUrl?.trim() ||
        process.env.LOBSTER_EXECUTOR_BASE_URL?.trim() ||
        DEFAULT_EXECUTOR_BASE_URL;
      const callbackUrl = new URL(
        EXECUTOR_API_ROUTES.events,
        buildServerBaseUrl(request)
      ).toString();
      const executorClient = new ExecutorClient({
        baseUrl: executorBaseUrl,
        callbackUrl,
      });

      const dispatchResult = await executorClient.dispatchPlan(buildResult.plan, {
        jobId: firstJob.id,
        requestId: `smoke_${mission.id}`,
        traceId: randomUUID(),
        idempotencyKey: `smoke:${mission.id}:${outcome}`,
      });

      missionRuntime.updateMissionStage(
        mission.id,
        "provision",
        {
          status: "done",
          detail: `Executor accepted job ${dispatchResult.response.jobId}.`,
        },
        60,
        "brain"
      );
      missionRuntime.patchMissionExecution(mission.id, {
        executor: {
          name: dispatchResult.request.executor,
          requestId: dispatchResult.request.requestId,
          jobId: dispatchResult.response.jobId,
          status: "queued",
          baseUrl: executorBaseUrl,
          lastEventType: "job.accepted",
          lastEventAt: Date.now(),
        },
        instance: {
          workspaceRoot: buildResult.plan.workspaceRoot,
        },
        artifacts: buildResult.plan.artifacts,
      });
      missionRuntime.markMissionRunning(
        mission.id,
        "execute",
        "Executor is running the smoke job. Replay executor events into /api/executor/events to complete the loop.",
        64,
        "brain"
      );

      return response.json({
        ok: true,
        missionId: mission.id,
        jobId: dispatchResult.response.jobId,
        executorBaseUrl,
        callbackUrl,
        task: missionRuntime.getTask(mission.id),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      missionRuntime.failMission(mission.id, detail, "brain");
      return response.status(502).json({
        ok: false,
        missionId: mission.id,
        error: detail,
      });
    }
  });

  app.post("/api/tasks/smoke/seed-running", (request, response) => {
    if (!isSmokeEnabled()) return sendSmokeDisabled(response);

    const body = (request.body || {}) as SeedRunningSmokeRequestBody;
    const mission = missionRuntime.createTask({
      kind: "restart-smoke",
      title: body.title?.trim() || "Mission restart recovery smoke",
      sourceText:
        body.sourceText?.trim() ||
        "Create a running mission so restart recovery can mark it as failed.",
      stageLabels: SMOKE_STAGE_LABELS,
    });

    const stageKey = body.stageKey?.trim() || "execute";
    const detail =
      body.detail?.trim() || "Mission is mid-flight and waiting for server restart smoke.";
    const progress =
      typeof body.progress === "number"
        ? Math.max(1, Math.min(99, Math.round(body.progress)))
        : 52;

    missionRuntime.markMissionRunning(mission.id, stageKey, detail, progress, "brain");

    return response.json({
      ok: true,
      missionId: mission.id,
      task: missionRuntime.getTask(mission.id),
    });
  });

  heartbeatScheduler.start();

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      features: {
        workflows: true,
        tasks: true,
        feishu: true,
        executorCallbacks: true,
        missionSocket: true,
      },
    });
  });

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

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
