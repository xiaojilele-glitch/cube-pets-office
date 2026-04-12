import express from "express";
import type { Request, Response } from "express";
import Dockerode from "dockerode";
import { ZodError } from "zod";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";
import {
  EXECUTOR_API_ROUTES,
  type CancelExecutorJobResponse,
  type PauseExecutorJobResponse,
  type ResumeExecutorJobResponse,
  type ExecutorApiErrorResponse,
} from "../../../shared/executor/api.js";
import { parseDockerHost, readLobsterExecutorConfig } from "./config.js";
import { LobsterExecutorError, NotFoundError } from "./errors.js";
import {
  createLobsterExecutorService,
  type LobsterExecutorService,
} from "./service.js";
import type {
  LobsterExecutorHealthResponse,
  LobsterExecutorJobDetailResponse,
  LobsterExecutorJobsResponse,
} from "./types.js";
import { SecurityAuditLogger } from "./security-audit.js";
import type { SecurityAuditEntry } from "../../../shared/executor/contracts.js";

function sendError(
  res: Response<ExecutorApiErrorResponse>,
  error: unknown
): Response<ExecutorApiErrorResponse> {
  if (error instanceof LobsterExecutorError) {
    return res
      .status(error.statusCode)
      .json({ ok: false, error: error.message });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: error.issues.map(issue => issue.message).join("; "),
    });
  }

  const message =
    error instanceof Error
      ? error.message
      : "Unexpected lobster executor error";
  return res.status(500).json({ ok: false, error: message });
}

export function createLobsterExecutorApp(
  service: LobsterExecutorService = createLobsterExecutorService({
    dataRoot: readLobsterExecutorConfig().dataRoot,
  })
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res: Response<LobsterExecutorHealthResponse>) => {
    const config = readLobsterExecutorConfig();

    let dockerStatus: "connected" | "disconnected" = "disconnected";
    if (config.executionMode === "real") {
      try {
        const docker = new Dockerode(parseDockerHost(config.dockerHost));
        await docker.ping();
        dockerStatus = "connected";
      } catch {
        dockerStatus = "disconnected";
      }
    }

    res.json({
      ok: true,
      status: "ok",
      service: config.serviceName,
      version: EXECUTOR_CONTRACT_VERSION,
      timestamp: new Date().toISOString(),
      dataRoot: service.getDataRoot(),
      queue: service.getQueueStats(),
      docker: {
        status: dockerStatus,
        host: config.dockerHost,
      },
        features: {
          health: true,
          createJob: true,
          jobQuery: true,
          cancelJob: true,
          dockerLifecycle: config.executionMode === "real",
          callbackSigning: config.callbackSecret !== "",
        },
      aiCapability: {
        enabled: !!process.env.LLM_API_KEY,
        image: config.aiImage,
        llmProvider: process.env.LLM_BASE_URL || "openai",
      },
    });
  });

  app.get(
    EXECUTOR_API_ROUTES.createJob,
    (_req, res: Response<LobsterExecutorJobsResponse>) => {
      res.json({
        ok: true,
        jobs: service.listJobs(),
      });
    }
  );

  app.get(
    `${EXECUTOR_API_ROUTES.createJob}/:id`,
    (
      req: Request<{ id: string }>,
      res: Response<LobsterExecutorJobDetailResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        res.json({
          ok: true,
          job: service.getJob(req.params.id),
        });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(EXECUTOR_API_ROUTES.createJob, (req, res: Response) => {
    try {
      const response = service.submit(req.body);
      res.status(202).json(response);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post(
    EXECUTOR_API_ROUTES.cancelJob,
    async (
      req: Request<{ id: string }>,
      res: Response<CancelExecutorJobResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        const response = await service.cancel(req.params.id, req.body);
        res.json(response);
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    EXECUTOR_API_ROUTES.pauseJob,
    async (
      req: Request<{ id: string }>,
      res: Response<PauseExecutorJobResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        const response = await service.pause(req.params.id, req.body);
        res.json(response);
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    EXECUTOR_API_ROUTES.resumeJob,
    async (
      req: Request<{ id: string }>,
      res: Response<ResumeExecutorJobResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        const response = await service.resume(req.params.id, req.body);
        res.json(response);
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  // ── Security audit route (Task 4.3) ──
  app.get(
    "/api/executor/security-audit",
    (
      req: Request<unknown, unknown, unknown, { jobId?: string }>,
      res: Response<{ ok: true; entries: SecurityAuditEntry[] } | ExecutorApiErrorResponse>,
    ) => {
      try {
        const config = readLobsterExecutorConfig();
        const auditLogger = new SecurityAuditLogger(config.dataRoot);
        const { jobId } = req.query;
        const entries = jobId
          ? auditLogger.getByJobId(jobId)
          : auditLogger.getAll();
        res.json({ ok: true, entries });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  app.use((_req, res: Response<ExecutorApiErrorResponse>) =>
    res.status(404).json({
      ok: false,
      error: new NotFoundError("Executor route not found").message,
    })
  );

  return app;
}
