/**
 * ExecutionBridge — 桥接 WorkflowEngine execution 阶段与 lobster-executor Docker 执行管线。
 *
 * 职责：
 * 1. 检测 WorkflowEngine 产出中是否包含可执行内容
 * 2. 构建 ExecutionPlan 并通过 ExecutorClient 分发
 * 3. 更新 Mission 运行时状态
 * 4. 支持 mock/real 模式透明切换
 */

import type { MissionRuntime } from "../tasks/mission-runtime.js";
import type { ExecutionPlanBuildResult } from "./execution-plan-builder.js";
import { ExecutionPlanBuilder } from "./execution-plan-builder.js";
import {
  ExecutorClient,
  ExecutorClientError,
  type ExecutorClientOptions,
  type DispatchExecutionPlanResult,
} from "./executor-client.js";
import { EXECUTOR_API_ROUTES } from "../../shared/executor/api.js";
import type { ExecutionPlan } from "../../shared/executor/contracts.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ExecutionBridgeOptions {
  missionRuntime: MissionRuntime;
  executorBaseUrl: string;
  callbackUrl: string;
  executionMode: "mock" | "real";
  defaultImage: string;
  retryCount: number;
}

export interface BridgeResult {
  triggered: boolean;
  reason: string;
  jobId?: string;
  requestId?: string;
}

export interface DetectResult {
  executable: boolean;
  reason: string;
}

// ─── Detection Constants ────────────────────────────────────────────────────

const EXECUTABLE_CODE_BLOCK_LANGS = [
  "python",
  "javascript",
  "typescript",
  "bash",
  "sh",
  "shell",
  "ruby",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
];

const SCRIPT_KEYWORDS = [
  "#!/bin",
  "npm run",
  "node ",
  "python ",
  "python3 ",
  "pytest",
  "playwright",
  "npx ",
  "yarn ",
  "pnpm ",
  "cargo run",
  "go run",
  "java -",
  "javac ",
  "gcc ",
  "g++ ",
  "make ",
  "cmake ",
  "docker run",
  "docker exec",
];


// ─── Code Block Detection Regex ─────────────────────────────────────────────

const CODE_BLOCK_PATTERN = new RegExp(
  "```(?:" + EXECUTABLE_CODE_BLOCK_LANGS.join("|") + ")\\b",
  "i",
);

// ─── Helper: extract command from deliverable ───────────────────────────────

function extractCommandFromDeliverable(deliverable: string): string[] {
  // Try to find a bash/sh code block and extract the command
  const bashBlock = deliverable.match(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/i);
  if (bashBlock?.[1]) {
    const lines = bashBlock[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (lines.length > 0) {
      return ["sh", "-c", lines.join(" && ")];
    }
  }

  // Try to find python invocation
  const pythonBlock = deliverable.match(/```python\s*\n([\s\S]*?)```/i);
  if (pythonBlock?.[1]) {
    return ["python", "-c", pythonBlock[1].trim()];
  }

  // Try to find node/js invocation
  const jsBlock = deliverable.match(/```(?:javascript|typescript)\s*\n([\s\S]*?)```/i);
  if (jsBlock?.[1]) {
    return ["node", "-e", jsBlock[1].trim()];
  }

  // Fallback: run the whole deliverable as a shell script
  return ["sh", "-c", "echo 'No executable command extracted'"];
}

// ─── Helper: delay ──────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── HeartbeatMonitor Class ──────────────────────────────────────────────────

export const HEARTBEAT_TIMEOUT_MS = 30_000;

export class HeartbeatMonitor {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly missionRuntime: MissionRuntime,
    private readonly timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
  ) {}

  /**
   * 分发成功后启动心跳定时器。
   * 如果该 missionId 已有定时器，先清除再重建。
   */
  startHeartbeat(missionId: string): void {
    this.clearHeartbeat(missionId);
    const timer = setTimeout(() => {
      this.timers.delete(missionId);
      this.missionRuntime.failMission(
        missionId,
        "Executor heartbeat timeout",
        "brain",
      );
    }, this.timeoutMs);
    // Unref so the timer doesn't keep the process alive
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    this.timers.set(missionId, timer);
  }

  /**
   * 收到 ExecutorEvent 时重置定时器。
   */
  resetHeartbeat(missionId: string): void {
    if (!this.timers.has(missionId)) return;
    this.startHeartbeat(missionId);
  }

  /**
   * Mission 进入终态（done/failed）时清除定时器。
   */
  clearHeartbeat(missionId: string): void {
    const existing = this.timers.get(missionId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(missionId);
    }
  }

  /**
   * 检查某个 missionId 是否有活跃的心跳定时器。
   */
  hasHeartbeat(missionId: string): boolean {
    return this.timers.has(missionId);
  }

  /**
   * 清除所有定时器（用于关闭/清理）。
   */
  dispose(): void {
    for (const timer of Array.from(this.timers.values())) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

// ─── ExecutionBridge Class ──────────────────────────────────────────────────

export class ExecutionBridge {
  private readonly planBuilder: ExecutionPlanBuilder;
  private readonly executorClient: ExecutorClient;

  constructor(private readonly options: ExecutionBridgeOptions) {
    this.planBuilder = new ExecutionPlanBuilder();
    this.executorClient = new ExecutorClient({
      baseUrl: options.executorBaseUrl,
      callbackUrl: options.callbackUrl,
    });
  }

  /**
   * 检测交付物是否包含可执行内容。
   *
   * 策略优先级：
   * 1. metadata.requiresExecution 强制覆盖
   * 2. 代码块检测（可执行语言）
   * 3. 脚本关键字检测
   * 4. 置信度阈值：匹配 2 个以上模式时判定为可执行
   */
  detectExecutable(
    deliverables: string[],
    metadata?: Record<string, unknown>,
  ): DetectResult {
    // 1. Metadata 强制覆盖
    if (metadata?.requiresExecution === true) {
      return { executable: true, reason: "metadata.requiresExecution forced execution" };
    }
    if (metadata?.requiresExecution === false) {
      return { executable: false, reason: "metadata.requiresExecution forced skip" };
    }

    const joined = deliverables.join("\n");
    let matchCount = 0;
    const reasons: string[] = [];

    // 2. 代码块检测
    if (CODE_BLOCK_PATTERN.test(joined)) {
      matchCount++;
      reasons.push("executable code block detected");
    }

    // 3. 脚本关键字检测
    for (const keyword of SCRIPT_KEYWORDS) {
      if (joined.includes(keyword)) {
        matchCount++;
        reasons.push(`script keyword "${keyword}" detected`);
        break; // Count keyword group as one match
      }
    }

    // 4. 置信度阈值：匹配 2 个以上模式
    if (matchCount >= 2) {
      return {
        executable: true,
        reason: reasons.join("; "),
      };
    }

    if (matchCount === 0) {
      return {
        executable: false,
        reason: "no executable patterns detected",
      };
    }

    return {
      executable: false,
      reason: `only ${matchCount} pattern(s) matched, threshold is 2: ${reasons.join("; ")}`,
    };
  }

  /**
   * 完整桥接流程：检测 → 构建计划 → 分发 → 更新 Mission 状态。
   */
  async bridge(
    missionId: string,
    deliverables: string[],
    metadata?: Record<string, unknown>,
  ): Promise<BridgeResult> {
    const { missionRuntime } = this.options;

    try {
      // Step 1: 检测可执行产物
      const detection = this.detectExecutable(deliverables, metadata);
      if (!detection.executable) {
        return {
          triggered: false,
          reason: detection.reason,
        };
      }

      // Step 2: 构建 ExecutionPlan
      const sourceText = deliverables.join("\n\n---\n\n");
      let planResult: ExecutionPlanBuildResult;
      try {
        planResult = await this.planBuilder.build({
          missionId,
          sourceText,
          requestedBy: "brain",
          mode: (metadata?.mode as ExecutionPlan["mode"]) ?? "auto",
          metadata,
        });
      } catch (buildError) {
        const message = buildError instanceof Error ? buildError.message : String(buildError);
        missionRuntime.failMission(
          missionId,
          `ExecutionPlan build failed: ${message}`,
          "brain",
        );
        return {
          triggered: true,
          reason: `ExecutionPlan build failed: ${message}`,
        };
      }

      // Step 3: 注入 mock/real 模式 payload
      const firstJob = planResult.plan.jobs[0];
      if (firstJob) {
        this.injectModePayload(firstJob, missionId, deliverables);
      }

      // Step 4: 更新 Mission 阶段到 provision
      missionRuntime.markMissionRunning(
        missionId,
        "provision",
        "Dispatching execution plan to executor.",
        45,
        "brain",
      );

      // Step 5: 分发到 ExecutorClient（含重试）
      let dispatched: DispatchExecutionPlanResult;
      try {
        dispatched = await this.dispatchWithRetry(planResult.plan);
      } catch (dispatchError) {
        const message = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        missionRuntime.failMission(
          missionId,
          `Executor dispatch failed: ${message}`,
          "brain",
        );
        return {
          triggered: true,
          reason: `Executor dispatch failed: ${message}`,
        };
      }

      // Step 6: 更新 Mission executor 上下文
      missionRuntime.updateMissionStage(
        missionId,
        "provision",
        {
          status: "done",
          detail: `Executor accepted job ${dispatched.response.jobId}.`,
        },
        55,
        "brain",
      );

      missionRuntime.patchMissionExecution(missionId, {
        executor: {
          name: dispatched.request.executor,
          requestId: dispatched.request.requestId,
          jobId: dispatched.response.jobId,
          status: "queued",
          baseUrl: this.options.executorBaseUrl,
          lastEventType: "job.accepted",
          lastEventAt: Date.now(),
        },
        instance: planResult.plan.workspaceRoot
          ? { workspaceRoot: planResult.plan.workspaceRoot }
          : undefined,
        artifacts: planResult.plan.artifacts,
      });

      // Step 7: 推进到 execute 阶段，进度 60%
      missionRuntime.markMissionRunning(
        missionId,
        "execute",
        "Executor accepted the mission. Docker execution is in progress.",
        60,
        "brain",
      );

      return {
        triggered: true,
        reason: detection.reason,
        jobId: dispatched.response.jobId,
        requestId: dispatched.request.requestId,
      };
    } catch (unexpectedError) {
      // 顶层 try-catch：未预期异常 → Mission failed
      const message = unexpectedError instanceof Error
        ? unexpectedError.message
        : String(unexpectedError);
      try {
        missionRuntime.failMission(
          missionId,
          `ExecutionBridge unexpected error: ${message}`,
          "brain",
        );
      } catch {
        // Swallow secondary failure to avoid masking the original error
      }
      return {
        triggered: true,
        reason: `Unexpected error: ${message}`,
      };
    }
  }

  /**
   * 注入 mock/real 模式特定的 payload 到 Job。
   */
  private injectModePayload(
    job: { payload?: Record<string, unknown> },
    missionId: string,
    deliverables: string[],
  ): void {
    const existing = job.payload || {};

    if (this.options.executionMode === "mock") {
      job.payload = {
        ...existing,
        runner: {
          kind: "mock",
          outcome: "success",
          steps: 3,
          delayMs: 40,
          summary: "Mock execution completed",
        },
      };
    } else {
      const command = extractCommandFromDeliverable(deliverables.join("\n"));
      job.payload = {
        ...existing,
        image: this.options.defaultImage,
        command,
        env: { MISSION_ID: missionId },
      };
    }
  }

  /**
   * 分发 ExecutionPlan，不可达时重试 retryCount 次，间隔 2 秒。
   */
  private async dispatchWithRetry(
    plan: ExecutionPlan,
  ): Promise<DispatchExecutionPlanResult> {
    const maxAttempts = 1 + Math.max(0, this.options.retryCount);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.executorClient.dispatchPlan(plan);
      } catch (error) {
        lastError = error;

        // Only retry on "unavailable" errors (executor unreachable)
        const isRetryable =
          error instanceof ExecutorClientError && error.kind === "unavailable";

        if (!isRetryable || attempt >= maxAttempts) {
          throw error;
        }

        // Wait 2 seconds before retry
        await delay(2000);
      }
    }

    // Should not reach here, but just in case
    throw lastError;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function buildCallbackUrl(serverBaseUrl: string): string {
  return new URL(EXECUTOR_API_ROUTES.events, serverBaseUrl).toString();
}

export function createExecutionBridge(
  missionRuntime: MissionRuntime,
  options?: {
    executorBaseUrl?: string;
    callbackUrl?: string;
    executionMode?: "mock" | "real";
    defaultImage?: string;
    retryCount?: number;
  },
): ExecutionBridge {
  const executorBaseUrl =
    options?.executorBaseUrl ||
    process.env.LOBSTER_EXECUTOR_BASE_URL?.trim() ||
    "http://localhost:3031";
  const executionMode =
    options?.executionMode ||
    (process.env.LOBSTER_EXECUTION_MODE as "mock" | "real") ||
    "mock";
  const defaultImage =
    options?.defaultImage ||
    process.env.LOBSTER_DEFAULT_IMAGE?.trim() ||
    "node:20-slim";
  const callbackUrl =
    options?.callbackUrl || "http://localhost:3000/api/executor/events";

  return new ExecutionBridge({
    missionRuntime,
    executorBaseUrl,
    callbackUrl,
    executionMode,
    defaultImage,
    retryCount: options?.retryCount ?? 1,
  });
}
