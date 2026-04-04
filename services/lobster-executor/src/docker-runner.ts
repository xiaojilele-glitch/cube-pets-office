import Dockerode from "dockerode";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { PassThrough } from "node:stream";
import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionPlanArtifact,
  type ExecutorEvent,
  type ExecutorJobStatus,
} from "../../../shared/executor/contracts.js";
import type { LobsterExecutorConfig, StoredJobRecord } from "./types.js";
import type { JobRunner } from "./runner.js";
import type { CallbackSender } from "./callback-sender.js";
import { LogBatcher } from "./log-batcher.js";

function toRelativePath(pathname: string): string {
  return relative(process.cwd(), pathname).replace(/\\/g, "/");
}

export interface DockerRunnerConfig {
  defaultImage: string;
  dockerHost?: string;
  dockerTlsVerify?: boolean;
  dockerCertPath?: string;
}

/**
 * Real Docker container runner implementing the JobRunner strategy.
 *
 * Lifecycle per job:
 *   1. Create workspace directory
 *   2. Create & start container
 *   3. Emit job.started
 *   4. Stream logs (stdout/stderr → log file + LogBatcher → callback)
 *   5. Wait for exit (with timeout → SIGTERM → SIGKILL)
 *   6. Check exit code → completed / failed
 *   7. Collect artifacts from /workspace/artifacts/
 *   8. Write result.json
 *   9. Emit job.completed or job.failed
 *  10. Remove container (keep logs + artifacts)
 */
export class DockerRunner implements JobRunner {
  private readonly docker: Dockerode;
  private readonly callbackSender: CallbackSender;
  private readonly config: DockerRunnerConfig;

  constructor(
    executorConfig: LobsterExecutorConfig,
    callbackSender: CallbackSender,
    docker?: Dockerode,
  ) {
    this.callbackSender = callbackSender;
    this.config = {
      defaultImage: executorConfig.defaultImage,
      dockerHost: executorConfig.dockerHost,
      dockerTlsVerify: executorConfig.dockerTlsVerify,
      dockerCertPath: executorConfig.dockerCertPath,
    };

    if (docker) {
      this.docker = docker;
    } else {
      const opts: Dockerode.DockerOptions = {};
      if (executorConfig.dockerHost) {
        // Unix socket vs TCP
        if (
          executorConfig.dockerHost.startsWith("/") ||
          executorConfig.dockerHost.startsWith("npipe:")
        ) {
          opts.socketPath = executorConfig.dockerHost;
        } else {
          opts.host = executorConfig.dockerHost;
        }
      }
      if (executorConfig.dockerTlsVerify) {
        opts.protocol = "https";
      }
      if (executorConfig.dockerCertPath) {
        // docker-modem reads ca/cert/key from the cert directory
        const certDir = executorConfig.dockerCertPath;
        try {
          const { readFileSync } = require("node:fs") as typeof import("node:fs");
          opts.ca = readFileSync(join(certDir, "ca.pem"));
          opts.cert = readFileSync(join(certDir, "cert.pem"));
          opts.key = readFileSync(join(certDir, "key.pem"));
        } catch {
          // If cert files don't exist, proceed without TLS certs
          console.warn(`[DockerRunner] Failed to read TLS certs from ${certDir}`);
        }
      }
      this.docker = new Dockerode(opts);
    }
  }

  /* ── public API ── */

  async run(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
  ): Promise<void> {
    const startTime = Date.now();
    let container: Dockerode.Container | undefined;

    try {
      // 1. Prepare workspace
      const workspaceDir = join(record.dataDirectory, "workspace");
      const artifactsDir = join(workspaceDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      // 2. Create container
      container = await this.createContainer(record, workspaceDir);
      const containerId = container.id;
      record.containerId = containerId;

      // 3. Start container
      await container.start();

      // 4. Update record & emit job.started
      const startedAt = new Date().toISOString();
      record.status = "running";
      record.startedAt = startedAt;
      record.message = `Container ${containerId.slice(0, 12)} started`;
      record.progress = 5;

      const startedEvent = this.createEvent(record, {
        type: "job.started",
        status: "running",
        progress: 5,
        message: `Started Docker container ${containerId.slice(0, 12)} for ${record.planJob.label}`,
      });
      emitEvent(startedEvent);
      await this.sendCallback(record, startedEvent);

      // 5. Stream logs + wait for exit (with timeout)
      const stderrLines: string[] = []; // ring buffer for last 50 stderr lines
      const { timedOut } = await this.streamAndWait(
        container,
        record,
        emitEvent,
        stderrLines,
      );

      // 6. Inspect exit code
      const inspection = await container.inspect();
      const exitCode = inspection.State.ExitCode;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      // 7. Collect artifacts
      const artifacts = this.collectArtifacts(record, workspaceDir);

      // 8. Write result.json
      this.writeResult(record, exitCode, durationMs, timedOut);

      // 9. Finalize record & emit terminal event
      record.finishedAt = finishedAt;
      record.artifacts = artifacts;

      if (timedOut) {
        await this.emitFailed(
          record, emitEvent, "TIMEOUT",
          `Container timed out after ${durationMs}ms`,
          durationMs, artifacts, stderrLines,
        );
      } else if (exitCode !== 0) {
        await this.emitFailed(
          record, emitEvent, `EXIT_CODE_${exitCode}`,
          `Container exited with code ${exitCode}`,
          durationMs, artifacts, stderrLines,
        );
      } else {
        await this.emitCompleted(record, emitEvent, durationMs, artifacts);
      }
    } catch (err) {
      // Handle Docker-level errors (daemon unavailable, image pull, create fail, etc.)
      const durationMs = Date.now() - startTime;
      const errorCode = this.classifyError(err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      record.finishedAt = new Date().toISOString();
      await this.emitFailed(
        record, emitEvent, errorCode, errorMessage,
        durationMs, [], [],
      );
    } finally {
      // 10. Cleanup container
      if (container) {
        await this.cleanupContainer(container);
      }
    }
  }

  /* ── container creation ── */

  /**
   * Build container creation options from the job record and create it.
   * Exported as a separate method so property tests can validate config mapping.
   */
  buildContainerOptions(
    record: StoredJobRecord,
    workspaceDir: string,
  ): Dockerode.ContainerCreateOptions {
    const payload = (record.planJob.payload ?? {}) as Record<string, unknown>;
    const image =
      (payload.image as string | undefined) ||
      this.config.defaultImage ||
      "node:20-slim";

    const envMap = (payload.env ?? {}) as Record<string, string>;
    const envArray = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);

    const command = (payload.command ?? []) as string[];

    // Use payload.workspaceRoot if provided, otherwise use the job-local workspace
    const hostWorkspace =
      (payload.workspaceRoot as string | undefined) || workspaceDir;

    return {
      Image: image,
      Cmd: command.length > 0 ? command : undefined,
      Env: envArray.length > 0 ? envArray : undefined,
      WorkingDir: "/workspace",
      HostConfig: {
        Binds: [`${hostWorkspace}:/workspace`],
      },
    };
  }

  private async createContainer(
    record: StoredJobRecord,
    workspaceDir: string,
  ): Promise<Dockerode.Container> {
    const opts = this.buildContainerOptions(record, workspaceDir);
    try {
      return await this.docker.createContainer(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No such image") || msg.includes("pull")) {
        throw Object.assign(new Error(msg), { _errorCode: "IMAGE_PULL_FAILED" });
      }
      throw Object.assign(new Error(msg), { _errorCode: "CONTAINER_CREATE_FAILED" });
    }
  }

  /* ── log streaming + wait ── */

  private async streamAndWait(
    container: Dockerode.Container,
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
    stderrLines: string[],
  ): Promise<{ timedOut: boolean }> {
    const timeoutMs =
      record.planJob.timeoutMs ?? 300_000; // default 5 min

    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    // Set up LogBatcher for batched log callbacks
    const logBatcher = new LogBatcher(
      (lines) => {
        const logEvent = this.createEvent(record, {
          type: "job.log",
          status: "running",
          message: lines.join("\n"),
        });
        emitEvent(logEvent);
        void this.sendCallback(record, logEvent);
      },
      500,
      4096,
    );

    // Progress ticker — emit job.progress every 5 seconds
    let lastProgressTime = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - lastProgressTime;
      if (elapsed >= 5000) {
        lastProgressTime = Date.now();
        const progressEvent = this.createEvent(record, {
          type: "job.progress",
          status: "running",
          progress: record.progress,
          message: record.message,
        });
        emitEvent(progressEvent);
        void this.sendCallback(record, progressEvent);
      }
    }, 5000);

    try {
      // Attach to container logs (follow mode)
      const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      const stderrFile = join(record.dataDirectory, "stderr.log");

      // Docker multiplexed stream demux
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      container.modem.demuxStream(logStream as NodeJS.ReadableStream, stdoutStream, stderrStream);

      // Process stdout
      let stdoutBuffer = "";
      stdoutStream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutBuffer += text;
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) {
            this.appendLog(record, line);
            logBatcher.push(line);
          }
        }
      });

      // Process stderr
      let stderrBuffer = "";
      stderrStream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderrBuffer += text;
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) {
            this.appendLog(record, `[stderr] ${line}`);
            appendFileSync(stderrFile, `${line}\n`, "utf-8");
            logBatcher.push(`[stderr] ${line}`);
            // Ring buffer: keep last 50 stderr lines
            stderrLines.push(line);
            if (stderrLines.length > 50) stderrLines.shift();
          }
        }
      });

      // Wait for container to exit, with timeout
      const waitPromise = container.wait();

      const timeoutPromise = new Promise<"timeout">((resolve) => {
        timeoutTimer = setTimeout(() => resolve("timeout"), timeoutMs);
      });

      const result = await Promise.race([waitPromise, timeoutPromise]);

      if (result === "timeout") {
        timedOut = true;
        // SIGTERM + 10s grace
        try {
          await container.stop({ t: 10 });
        } catch {
          // If stop fails (already stopped, etc.), try kill
          try {
            await container.kill({ signal: "SIGKILL" });
          } catch {
            // Container may already be dead
          }
        }
        // Wait for the container to actually finish after stop/kill
        try {
          await container.wait();
        } catch {
          // ignore
        }
      }

      // Flush remaining log data
      if (stdoutBuffer.length > 0) {
        this.appendLog(record, stdoutBuffer);
        logBatcher.push(stdoutBuffer);
      }
      if (stderrBuffer.length > 0) {
        this.appendLog(record, `[stderr] ${stderrBuffer}`);
        appendFileSync(stderrFile, `${stderrBuffer}\n`, "utf-8");
        logBatcher.push(`[stderr] ${stderrBuffer}`);
        stderrLines.push(stderrBuffer);
        if (stderrLines.length > 50) stderrLines.shift();
      }

      logBatcher.destroy();

      return { timedOut };
    } finally {
      clearInterval(progressInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  /* ── artifact collection ── */

  private collectArtifacts(
    record: StoredJobRecord,
    workspaceDir: string,
  ): ExecutionPlanArtifact[] {
    const artifacts: ExecutionPlanArtifact[] = [];

    // Always include the executor log
    artifacts.push({
      kind: "log",
      name: "executor.log",
      path: toRelativePath(record.logFile),
      description: "Line-oriented executor runtime log",
    });

    // Collect files from workspace/artifacts/ (bind-mounted, so available on host)
    const artifactsDir = join(workspaceDir, "artifacts");
    try {
      if (existsSync(artifactsDir)) {
        const files = readdirSync(artifactsDir);
        for (const file of files) {
          const filePath = join(artifactsDir, file);
          const stat = statSync(filePath);
          if (stat.isFile()) {
            artifacts.push({
              kind: "file",
              name: file,
              path: toRelativePath(filePath),
              description: `Artifact produced by container`,
            });
          }
        }
      }
    } catch (err) {
      console.warn(
        `[DockerRunner] Failed to collect artifacts from ${artifactsDir}:`,
        err instanceof Error ? err.message : err,
      );
    }

    return artifacts;
  }

  /* ── result.json ── */

  private writeResult(
    record: StoredJobRecord,
    exitCode: number,
    durationMs: number,
    timedOut: boolean,
  ): void {
    const resultPayload = {
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      requestId: record.request.requestId,
      summary: timedOut
        ? `Container timed out after ${durationMs}ms`
        : exitCode === 0
          ? "Docker execution completed successfully"
          : `Container exited with code ${exitCode}`,
      outcome: exitCode === 0 && !timedOut ? "success" : "failed",
      exitCode,
      durationMs,
      timedOut,
      callback: {
        eventsUrl: record.request.callback.eventsUrl,
        delivery: "hmac-signed",
      },
    };

    const resultFile = join(record.dataDirectory, "result.json");
    writeFileSync(
      resultFile,
      `${JSON.stringify(resultPayload, null, 2)}\n`,
      "utf-8",
    );
  }

  /* ── container cleanup ── */

  private async cleanupContainer(container: Dockerode.Container): Promise<void> {
    try {
      await container.remove({ force: true });
    } catch (err) {
      console.error(
        `[DockerRunner] Failed to remove container ${container.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /* ── event helpers ── */

  private async emitCompleted(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
    durationMs: number,
    artifacts: ExecutionPlanArtifact[],
  ): Promise<void> {
    record.status = "completed";
    record.progress = 100;
    record.summary = "Docker execution completed successfully";
    record.message = record.summary;

    const event = this.createEvent(record, {
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: record.summary,
      summary: record.summary,
      artifacts,
      metrics: { durationMs, passed: 1 },
    });
    emitEvent(event);
    await this.sendCallback(record, event);
  }

  private async emitFailed(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
    errorCode: string,
    errorMessage: string,
    durationMs: number,
    artifacts: ExecutionPlanArtifact[],
    stderrLines: string[],
  ): Promise<void> {
    record.status = "failed";
    record.progress = 100;
    record.errorCode = errorCode;
    record.errorMessage = errorMessage;
    record.message = errorMessage;

    // detail: last 50 lines of stderr
    const detail =
      stderrLines.length > 0
        ? stderrLines.slice(-50).join("\n")
        : undefined;

    const event = this.createEvent(record, {
      type: "job.failed",
      status: "failed",
      progress: 100,
      message: errorMessage,
      errorCode,
      detail,
      summary: errorMessage,
      artifacts,
      metrics: { durationMs, failed: 1 },
    });
    emitEvent(event);
    await this.sendCallback(record, event);
  }

  /**
   * Map exit code to job status.
   * Exported as static so property tests can validate the mapping.
   */
  static mapExitCodeToStatus(exitCode: number): "completed" | "failed" {
    return exitCode === 0 ? "completed" : "failed";
  }

  private createEvent(
    record: StoredJobRecord,
    input: {
      type: ExecutorEvent["type"];
      status: ExecutorJobStatus;
      progress?: number;
      message: string;
      summary?: string;
      errorCode?: string;
      detail?: string;
      artifacts?: ExecutionPlanArtifact[];
      metrics?: ExecutorEvent["metrics"];
    },
  ): ExecutorEvent {
    return {
      version: EXECUTOR_CONTRACT_VERSION,
      eventId: randomUUID(),
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      executor: record.request.executor,
      type: input.type,
      status: input.status,
      occurredAt: new Date().toISOString(),
      progress: input.progress,
      message: input.message,
      summary: input.summary,
      errorCode: input.errorCode,
      detail: input.detail,
      artifacts: input.artifacts,
      metrics: input.metrics,
    };
  }

  private appendLog(record: StoredJobRecord, message: string): void {
    appendFileSync(
      record.logFile,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf-8",
    );
  }

  private async sendCallback(
    record: StoredJobRecord,
    event: ExecutorEvent,
  ): Promise<void> {
    try {
      await this.callbackSender.send(
        record.request.callback.eventsUrl,
        event,
      );
    } catch {
      // Callback failure must not block job execution (Req 2.5)
    }
  }

  private classifyError(err: unknown): string {
    if (err && typeof err === "object" && "_errorCode" in err) {
      return (err as { _errorCode: string })._errorCode;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("connect ECONNREFUSED") || msg.includes("socket")) {
      return "DOCKER_UNAVAILABLE";
    }
    if (msg.includes("No such image") || msg.includes("pull")) {
      return "IMAGE_PULL_FAILED";
    }
    return "CONTAINER_CREATE_FAILED";
  }
}
