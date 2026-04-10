import Dockerode from "dockerode";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
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
  type SecurityPolicy,
} from "../../../shared/executor/contracts.js";
import type { AIResultArtifact, LobsterExecutorConfig, StoredJobRecord } from "./types.js";
import type { JobRunner } from "./runner.js";
import type { CallbackSender } from "./callback-sender.js";
import { LogBatcher } from "./log-batcher.js";
import {
  resolveAICredentials,
  validateCredentials,
  buildAIEnvVars,
} from "./credential-injector.js";
import { CredentialScrubber } from "./credential-scrubber.js";
import {
  readSecurityConfig,
  resolveSecurityPolicy,
  toDockerCreateOptions,
  toDockerHostConfig,
} from "./security-policy.js";
import { SecurityAuditLogger } from "./security-audit.js";

function toRelativePath(pathname: string): string {
  return relative(process.cwd(), pathname).replace(/\\/g, "/");
}

export interface DockerRunnerConfig {
  defaultImage: string;
  aiImage?: string;
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
  private readonly securityPolicy: SecurityPolicy;
  private readonly auditLogger: SecurityAuditLogger;

  constructor(
    executorConfig: LobsterExecutorConfig,
    callbackSender: CallbackSender,
    docker?: Dockerode,
  ) {
    this.callbackSender = callbackSender;
    this.config = {
      defaultImage: executorConfig.defaultImage,
      aiImage: executorConfig.aiImage,
      dockerHost: executorConfig.dockerHost,
      dockerTlsVerify: executorConfig.dockerTlsVerify,
      dockerCertPath: executorConfig.dockerCertPath,
    };

    // Resolve security policy once at construction time
    this.securityPolicy = resolveSecurityPolicy({
      securityLevel: executorConfig.securityLevel as "strict" | "balanced" | "permissive",
      containerUser: executorConfig.containerUser ?? "65534",
      maxMemory: executorConfig.maxMemory ?? "512m",
      maxCpus: executorConfig.maxCpus ?? "1.0",
      maxPids: executorConfig.maxPids ?? 256,
      tmpfsSize: executorConfig.tmpfsSize ?? "64m",
      networkWhitelist: executorConfig.networkWhitelist ?? [],
      seccompProfilePath: executorConfig.seccompProfilePath,
    });

    // Security audit logger
    this.auditLogger = new SecurityAuditLogger(executorConfig.dataRoot);

    if (docker) {
      this.docker = docker;
    } else {
      const opts: Dockerode.DockerOptions = {};
      if (executorConfig.dockerHost) {
        if (executorConfig.dockerHost.startsWith("npipe:")) {
          // npipe:////./pipe/xxx → \\.\pipe\xxx
          const pipePath = executorConfig.dockerHost
            .replace(/^npipe:\/\//, "")
            .replace(/\//g, "\\");
          opts.socketPath = pipePath;
        } else if (
          executorConfig.dockerHost.startsWith("/") ||
          executorConfig.dockerHost.startsWith("\\\\.\\pipe\\")
        ) {
          opts.socketPath = executorConfig.dockerHost;
        } else {
          // Parse tcp://host:port or http://host:port
          try {
            const url = new URL(executorConfig.dockerHost.replace(/^tcp:\/\//, "http://"));
            opts.host = url.hostname;
            opts.port = url.port || "2375";
            opts.protocol = "http";
          } catch {
            opts.host = executorConfig.dockerHost;
          }
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
      // 0. Extract payload flags
      const payload = (record.planJob.payload ?? {}) as Record<string, unknown>;
      const aiEnabled = payload.aiEnabled === true;

      // 1. Prepare workspace
      const workspaceDir = join(record.dataDirectory, "workspace");
      const artifactsDir = join(workspaceDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      // 2. Create container
      container = await this.createContainer(record, workspaceDir);
      const containerId = container.id;
      record.containerId = containerId;

      // Audit: container.created
      this.auditLogger.log({
        jobId: record.request.jobId,
        missionId: record.request.missionId,
        eventType: "container.created",
        securityLevel: this.securityPolicy.level,
        detail: {
          containerId,
          image: (record.planJob.payload as Record<string, unknown>)?.image ?? this.config.defaultImage,
          user: this.securityPolicy.user,
          readonlyRootfs: this.securityPolicy.readonlyRootfs,
          capDrop: this.securityPolicy.capDrop,
          capAdd: this.securityPolicy.capAdd,
          networkMode: this.securityPolicy.network.mode,
          memoryBytes: this.securityPolicy.resources.memoryBytes,
          pidsLimit: this.securityPolicy.resources.pidsLimit,
        },
      });

      // 3. Start container
      await container.start();

      // Audit: container.started
      this.auditLogger.log({
        jobId: record.request.jobId,
        missionId: record.request.missionId,
        eventType: "container.started",
        securityLevel: this.securityPolicy.level,
        detail: { containerId },
      });

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
      // Task 3.2: Attach network policy info to job.started payload
      // Task 5.1: Attach securitySummary to job.started payload
      const memBytes = this.securityPolicy.resources.memoryBytes;
      const memoryLimit = memBytes >= 1_073_741_824
        ? `${Math.round(memBytes / 1_073_741_824)}GB`
        : `${Math.round(memBytes / 1_048_576)}MB`;
      const cpuLimit = (this.securityPolicy.resources.nanoCpus / 1_000_000_000).toFixed(1);

      startedEvent.payload = {
        ...startedEvent.payload,
        networkPolicy: {
          mode: this.securityPolicy.network.mode,
          whitelist: this.securityPolicy.network.whitelist ?? [],
        },
        securitySummary: {
          level: this.securityPolicy.level,
          user: this.securityPolicy.user,
          networkMode: this.securityPolicy.network.mode,
          readonlyRootfs: this.securityPolicy.readonlyRootfs,
          memoryLimit,
          cpuLimit,
          pidsLimit: this.securityPolicy.resources.pidsLimit,
        },
      };
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
      const oomKilled = !!(inspection.State as Record<string, unknown>).OOMKilled;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;
      const cancelReason =
        record.cancelRequested?.reason?.trim() || "Docker execution cancelled";

      // 7. Write result.json before artifact collection so it is exposed to the UI.
      const resultFile = this.writeResult(record, exitCode, durationMs, timedOut, {
        outcome: record.cancelRequested ? "cancelled" : undefined,
        summary: record.cancelRequested ? cancelReason : undefined,
      });

      // 8. Collect artifacts
      const artifacts = this.collectArtifacts(record, workspaceDir, resultFile);

      // 8.5 Scrub credentials from artifacts and logs for AI jobs
      if (aiEnabled) {
        const creds = resolveAICredentials(payload, process.env);
        const scrubber = new CredentialScrubber([creds.apiKey]);
        try {
          if (existsSync(artifactsDir)) {
            scrubber.scrubDirectory(artifactsDir);
          }
          if (existsSync(record.logFile)) {
            scrubber.scrubFile(record.logFile);
          }
        } catch (scrubErr) {
          console.warn(
            "[DockerRunner] Credential scrubbing failed:",
            scrubErr instanceof Error ? scrubErr.message : scrubErr,
          );
        }
      }

      // 9. Finalize record & emit terminal event
      record.finishedAt = finishedAt;
      record.artifacts = artifacts;

      if (record.cancelRequested) {
        await this.emitCancelled(record, emitEvent, durationMs, artifacts);
      } else if (timedOut) {
        await this.emitFailed(
          record, emitEvent, "TIMEOUT",
          `Container timed out after ${durationMs}ms`,
          durationMs, artifacts, stderrLines,
        );
      } else if (oomKilled) {
        // Task 2.4: OOM detection
        // Audit: container.oom
        this.auditLogger.log({
          jobId: record.request.jobId,
          missionId: record.request.missionId,
          eventType: "container.oom",
          securityLevel: this.securityPolicy.level,
          detail: { exitCode, memoryLimit: this.securityPolicy.resources.memoryBytes },
        });
        await this.emitFailed(
          record, emitEvent, "OOM_KILLED",
          `Container killed by OOM (exit code ${exitCode})`,
          durationMs, artifacts, stderrLines,
        );
      } else if (exitCode === 159) {
        // Task 2.5: Seccomp violation detection (128 + 31 = SIGSYS)
        // Audit: container.seccomp_violation
        this.auditLogger.log({
          jobId: record.request.jobId,
          missionId: record.request.missionId,
          eventType: "container.seccomp_violation",
          securityLevel: this.securityPolicy.level,
          detail: { exitCode, signal: "SIGSYS" },
        });
        await this.emitFailed(
          record, emitEvent, "SECCOMP_VIOLATION",
          `Container killed by seccomp violation (SIGSYS, exit code 159)`,
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

      // Audit: container.security_failure
      this.auditLogger.log({
        jobId: record.request.jobId,
        missionId: record.request.missionId,
        eventType: "container.security_failure",
        securityLevel: this.securityPolicy.level,
        detail: { errorCode, errorMessage },
      });

      record.finishedAt = new Date().toISOString();
      await this.emitFailed(
        record, emitEvent, errorCode, errorMessage,
        durationMs, [], [],
      );
    } finally {
      // 10. Cleanup container
      if (container) {
        // Audit: container.destroyed
        this.auditLogger.log({
          jobId: record.request.jobId,
          missionId: record.request.missionId,
          eventType: "container.destroyed",
          securityLevel: this.securityPolicy.level,
          detail: { containerId: container.id },
        });
        await this.cleanupContainer(container);
      }
    }
  }

  async cancel(record: StoredJobRecord): Promise<void> {
    const reason =
      record.cancelRequested?.reason?.trim() || "Cancellation requested";
    record.message = reason;
    this.appendLog(record, `[cancel] ${reason}`);

    if (!record.containerId) {
      return;
    }

    const container = this.docker.getContainer(record.containerId);
    await this.stopOrKillContainer(container, 10, 1500);
  }

  async pause(record: StoredJobRecord): Promise<void> {
    const reason = record.pauseRequested?.reason?.trim() || "Pause requested";
    record.message = reason;
    this.appendLog(record, `[pause] ${reason}`);

    if (!record.containerId) {
      return;
    }

    const container = this.docker.getContainer(record.containerId);
    await container.pause();
  }

  async resume(record: StoredJobRecord): Promise<void> {
    const reason = "Resume requested";
    record.message = reason;
    this.appendLog(record, `[resume] ${reason}`);

    if (!record.containerId) {
      return;
    }

    const container = this.docker.getContainer(record.containerId);
    await container.unpause();
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
    const aiEnabled = payload.aiEnabled === true;

    // Image selection: payload.image > (aiEnabled ? aiImage : defaultImage)
    const image = aiEnabled
      ? (payload.image as string | undefined) ||
        this.config.aiImage ||
        "cube-ai-sandbox:latest"
      : (payload.image as string | undefined) ||
        this.config.defaultImage ||
        "node:20-slim";

    const envMap = (payload.env ?? {}) as Record<string, string>;
    const envArray = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);

    // Inject AI credentials when aiEnabled
    if (aiEnabled) {
      const creds = resolveAICredentials(payload, process.env);
      validateCredentials(creds);
      envArray.push(...buildAIEnvVars(creds));
    }

    const command = (payload.command ?? []) as string[];

    // Use payload.workspaceRoot if provided, otherwise use the job-local workspace
    // When Docker is remote (TCP), skip bind mount since local paths don't exist on the remote host
    const hostWorkspace =
      (payload.workspaceRoot as string | undefined) || workspaceDir;
    const isRemoteDocker = this.config.dockerHost?.startsWith("tcp:") || this.config.dockerHost?.startsWith("http:");

    // Security policy → Docker options
    const securityCreateOpts = toDockerCreateOptions(this.securityPolicy);
    const securityHostConfig = toDockerHostConfig(this.securityPolicy);

    return {
      Image: image,
      Cmd: command.length > 0 ? command : undefined,
      Env: envArray.length > 0 ? envArray : undefined,
      WorkingDir: "/workspace",
      User: securityCreateOpts.User,
      HostConfig: {
        // Only bind-mount workspace for local Docker; remote Docker uses an anonymous volume
        ...(isRemoteDocker ? { Binds: [] } : { Binds: [`${hostWorkspace}:/workspace`] }),
        ...securityHostConfig,
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
        await this.stopOrKillContainer(container, 10, 1500);
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
    resultFile: string,
  ): ExecutionPlanArtifact[] {
    const artifacts: ExecutionPlanArtifact[] = [];

    // Always include the executor log
    artifacts.push({
      kind: "log",
      name: "executor.log",
      path: toRelativePath(record.logFile),
      description: "Line-oriented executor runtime log",
    });

    artifacts.push({
      kind: "report",
      name: "result.json",
      path: toRelativePath(resultFile),
      description: "Docker execution summary and exit metadata",
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
    options: {
      outcome?: "success" | "failed" | "cancelled";
      summary?: string;
    } = {},
  ): string {
    const outcome =
      options.outcome ??
      (exitCode === 0 && !timedOut ? "success" : "failed");
    const summary =
      options.summary ??
      (timedOut
        ? `Container timed out after ${durationMs}ms`
        : exitCode === 0
          ? "Docker execution completed successfully"
          : `Container exited with code ${exitCode}`);
    const resultPayload = {
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      requestId: record.request.requestId,
      summary,
      outcome,
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
    return resultFile;
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

  private async stopOrKillContainer(
    container: Dockerode.Container,
    stopSeconds: number,
    killAfterMs: number,
  ): Promise<"stopped" | "killed"> {
    try {
      await Promise.race([
        container.stop({ t: stopSeconds }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("stop timeout")), killAfterMs);
        }),
      ]);
      return "stopped";
    } catch {
      try {
        await container.kill({ signal: "SIGKILL" });
      } catch {
        // Container may already be terminated.
      }
      return "killed";
    }
  }

  /* ── event helpers ── */

  /**
   * Build an AI result summary from an AIResultArtifact.
   * Exported as static so property tests can validate contentPreview truncation.
   */
  static buildAIResultSummary(aiResult: AIResultArtifact): {
    tokenUsage: AIResultArtifact["usage"];
    model: string;
    contentPreview: string;
  } {
    const contentPreview =
      aiResult.content.length > 200
        ? aiResult.content.slice(0, 200)
        : aiResult.content;
    return {
      tokenUsage: aiResult.usage,
      model: aiResult.model,
      contentPreview,
    };
  }

  /**
   * Try to read ai-result.json from the artifacts directory.
   */
  private readAIResult(record: StoredJobRecord): AIResultArtifact | undefined {
    try {
      const artifactPath = join(
        record.dataDirectory,
        "workspace",
        "artifacts",
        "ai-result.json",
      );
      if (existsSync(artifactPath)) {
        const raw = readFileSync(artifactPath, "utf-8");
        return JSON.parse(raw) as AIResultArtifact;
      }
    } catch {
      // Ignore parse errors
    }
    return undefined;
  }

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

    const jobPayload = (record.planJob.payload ?? {}) as Record<string, unknown>;
    const aiEnabled = jobPayload.aiEnabled === true;

    let eventPayload: Record<string, unknown> | undefined;
    if (aiEnabled) {
      const aiTaskType = (jobPayload.aiTaskType as string) || "text-generation";
      const aiResult = this.readAIResult(record);
      eventPayload = {
        aiTaskType,
        aiModel: aiResult?.model ?? (jobPayload.llmConfig as Record<string, unknown> | undefined)?.model ?? "",
      };
      if (aiResult) {
        eventPayload.aiResult = DockerRunner.buildAIResultSummary(aiResult);
      }

      // Scrub event payload content
      const creds = resolveAICredentials(jobPayload, process.env);
      if (creds.apiKey) {
        const scrubber = new CredentialScrubber([creds.apiKey]);
        eventPayload = JSON.parse(scrubber.scrubLine(JSON.stringify(eventPayload)));
      }
    }

    const event = this.createEvent(record, {
      type: "job.completed",
      status: "completed",
      progress: 100,
      message: record.summary,
      summary: record.summary,
      artifacts,
      metrics: { durationMs, passed: 1 },
      payload: eventPayload,
    });
    emitEvent(event);
    await this.sendCallback(record, event);
  }

  private async emitCancelled(
    record: StoredJobRecord,
    emitEvent: (event: ExecutorEvent) => void,
    durationMs: number,
    artifacts: ExecutionPlanArtifact[],
  ): Promise<void> {
    const summary =
      record.cancelRequested?.reason?.trim() || "Docker execution cancelled";

    record.status = "cancelled";
    record.summary = summary;
    record.message = summary;

    const event = this.createEvent(record, {
      type: "job.cancelled",
      status: "cancelled",
      progress: record.progress,
      message: summary,
      summary,
      artifacts,
      metrics: { durationMs },
      payload: {
        cancelRequested: record.cancelRequested,
      },
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

    const jobPayload = (record.planJob.payload ?? {}) as Record<string, unknown>;
    const aiEnabled = jobPayload.aiEnabled === true;

    // detail: last 50 lines of stderr
    let detail =
      stderrLines.length > 0
        ? stderrLines.slice(-50).join("\n")
        : undefined;

    let scrubMessage = errorMessage;
    let eventPayload: Record<string, unknown> | undefined;

    if (aiEnabled) {
      const aiTaskType = (jobPayload.aiTaskType as string) || "text-generation";
      const aiResult = this.readAIResult(record);
      eventPayload = {
        aiTaskType,
        aiModel: aiResult?.model ?? (jobPayload.llmConfig as Record<string, unknown> | undefined)?.model ?? "",
      };
      if (aiResult) {
        eventPayload.aiResult = DockerRunner.buildAIResultSummary(aiResult);
      }

      // Scrub all event content
      const creds = resolveAICredentials(jobPayload, process.env);
      if (creds.apiKey) {
        const scrubber = new CredentialScrubber([creds.apiKey]);
        scrubMessage = scrubber.scrubLine(errorMessage);
        if (detail) {
          detail = scrubber.scrubLine(detail);
        }
        eventPayload = JSON.parse(scrubber.scrubLine(JSON.stringify(eventPayload)));
      }
    }

    const event = this.createEvent(record, {
      type: "job.failed",
      status: "failed",
      progress: 100,
      message: scrubMessage,
      errorCode,
      detail,
      summary: scrubMessage,
      artifacts,
      metrics: { durationMs, failed: 1 },
      payload: eventPayload,
    });

    // Task 4.4: Attach securityContext for security-related failures
    const SECURITY_ERROR_CODES = ["OOM_KILLED", "SECCOMP_VIOLATION", "SECURITY_CONFIG_INVALID"];
    if (SECURITY_ERROR_CODES.includes(errorCode)) {
      event.payload = {
        ...event.payload,
        securityContext: {
          level: this.securityPolicy.level,
          user: this.securityPolicy.user,
          networkMode: this.securityPolicy.network.mode,
          readonlyRootfs: this.securityPolicy.readonlyRootfs,
          capDrop: this.securityPolicy.capDrop,
          capAdd: this.securityPolicy.capAdd,
          resources: this.securityPolicy.resources,
        },
      };
    }

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
      payload?: Record<string, unknown>;
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
      payload: input.payload,
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
