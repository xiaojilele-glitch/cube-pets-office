# Trae Sandbox Native Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在无 Docker 的 Trae/solo 沙盒中，当 `LOBSTER_EXECUTION_MODE=real` 时自动降级为本机进程执行（native），从而让执行阶段真实跑命令而不是 mock。

**Architecture:** 在 lobster-executor 侧新增 `NativeRunner`（spawn 子进程执行 `payload.command`），并在启动/runner 选择时探测 Docker 可用性：Docker 可用则继续 `DockerRunner`，否则切换 `NativeRunner`。对 server/前端协议保持不变。

**Tech Stack:** Node.js (ESM), TypeScript, Express, Vitest, child_process.spawn, Dockerode（仅用于探测与 DockerRunner）。

---

## File Map

**Modify**
- `services/lobster-executor/src/types.ts`：扩展 executionMode 类型
- `services/lobster-executor/src/config.ts`：解析 `LOBSTER_EXECUTION_MODE=native`
- `services/lobster-executor/src/runner.ts`：新增 NativeRunner 并调整 factory 选择逻辑
- `services/lobster-executor/src/index.ts`：real 模式 Docker 探测失败时不退出，改为降级 native
- `services/lobster-executor/src/service.ts`：允许 config.executionMode 为 native
- `services/lobster-executor/src/app.ts`：/health 特性字段反映当前 runner 能力（dockerLifecycle）
- `vitest.config.server.ts`：纳入 executor 测试（或在计划中使用路径运行）

**Create**
- `services/lobster-executor/src/native-runner.ts`：本机进程执行 runner
- `services/lobster-executor/src/__tests__/native-runner.test.ts`：NativeRunner 单测
- `services/lobster-executor/src/__tests__/runner-factory.test.ts`：createJobRunner 选择逻辑单测
- `services/lobster-executor/src/__tests__/config-native-mode.test.ts`：config 解析单测

---

### Task 1: Expand Execution Mode Types + Config Parsing

**Files:**
- Modify: `services/lobster-executor/src/types.ts`
- Modify: `services/lobster-executor/src/config.ts`
- Create: `services/lobster-executor/src/__tests__/config-native-mode.test.ts`

- [ ] **Step 1: Add failing test for config executionMode parsing**

Create `services/lobster-executor/src/__tests__/config-native-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readLobsterExecutorConfig } from "../config.js";

describe("readLobsterExecutorConfig executionMode", () => {
  it("parses LOBSTER_EXECUTION_MODE=native", () => {
    const config = readLobsterExecutorConfig(
      {
        LOBSTER_EXECUTION_MODE: "native",
        LOBSTER_EXECUTOR_PORT: "3031",
        LOBSTER_EXECUTOR_HOST: "0.0.0.0",
      },
      "linux",
    );
    expect(config.executionMode).toBe("native");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest services/lobster-executor/src/__tests__/config-native-mode.test.ts
```

Expected: FAIL（`executionMode` 类型/解析不支持 native）。

- [ ] **Step 3: Extend LobsterExecutorConfig.executionMode union**

Edit `services/lobster-executor/src/types.ts`:

```ts
export interface LobsterExecutorConfig {
  host: string;
  port: number;
  dataRoot: string;
  serviceName: string;
  executionMode: "real" | "mock" | "native";
  defaultImage: string;
  maxConcurrentJobs: number;
  dockerHost?: string;
  dockerTlsVerify?: boolean;
  dockerCertPath?: string;
  callbackSecret: string;
  aiImage: string;
  securityLevel: string;
  containerUser: string;
  maxMemory: string;
  maxCpus: string;
  maxPids: number;
  tmpfsSize: string;
  networkWhitelist: string[];
  seccompProfilePath?: string;
}
```

- [ ] **Step 4: Parse native mode in readLobsterExecutorConfig**

Edit `services/lobster-executor/src/config.ts`:

```ts
const rawMode = env.LOBSTER_EXECUTION_MODE;
const executionMode =
  rawMode === "mock" ? "mock" : rawMode === "native" ? "native" : "real";

return {
  host: env.LOBSTER_EXECUTOR_HOST || "0.0.0.0",
  port: parsePort(env.LOBSTER_EXECUTOR_PORT, 3031),
  dataRoot: resolve(env.LOBSTER_EXECUTOR_DATA_ROOT || "tmp/lobster-executor"),
  serviceName: env.LOBSTER_EXECUTOR_NAME || "lobster-executor",
  executionMode,
  defaultImage: env.LOBSTER_DEFAULT_IMAGE || "node:20-slim",
  maxConcurrentJobs: Math.max(
    1,
    Number.parseInt(env.LOBSTER_MAX_CONCURRENT_JOBS || "2", 10) || 2
  ),
  dockerHost: env.LOBSTER_DOCKER_HOST || env.DOCKER_HOST || defaultDockerHost(platform),
  dockerTlsVerify: env.DOCKER_TLS_VERIFY === "1" ? true : undefined,
  dockerCertPath: env.DOCKER_CERT_PATH || undefined,
  callbackSecret: env.EXECUTOR_CALLBACK_SECRET || "",
  aiImage: env.LOBSTER_AI_IMAGE || "cube-ai-sandbox:latest",
  securityLevel: securityConfig.securityLevel,
  containerUser: securityConfig.containerUser,
  maxMemory: securityConfig.maxMemory,
  maxCpus: securityConfig.maxCpus,
  maxPids: securityConfig.maxPids,
  tmpfsSize: securityConfig.tmpfsSize,
  networkWhitelist: securityConfig.networkWhitelist,
  seccompProfilePath: securityConfig.seccompProfilePath,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest services/lobster-executor/src/__tests__/config-native-mode.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/lobster-executor/src/types.ts services/lobster-executor/src/config.ts services/lobster-executor/src/__tests__/config-native-mode.test.ts
git commit -m "feat(lobster): support native execution mode in config"
```

---

### Task 2: Add NativeRunner (Local Process Execution)

**Files:**
- Create: `services/lobster-executor/src/native-runner.ts`
- Create: `services/lobster-executor/src/__tests__/native-runner.test.ts`
- Modify: `services/lobster-executor/src/runner.ts`

- [ ] **Step 1: Write failing test for NativeRunner basic execution**

Create `services/lobster-executor/src/__tests__/native-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StoredJobRecord } from "../types.js";
import { NativeRunner } from "../native-runner.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../../shared/executor/contracts.js";

function makeRecord(workspaceRoot: string): StoredJobRecord {
  const now = new Date().toISOString();
  return {
    acceptedResponse: {
      ok: true as const,
      accepted: true as const,
      requestId: "r1",
      missionId: "m1",
      jobId: "j1",
      receivedAt: now,
    },
    request: {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: "r1",
      missionId: "m1",
      jobId: "j1",
      executor: "lobster",
      createdAt: now,
      plan: {
        version: EXECUTOR_CONTRACT_VERSION,
        missionId: "m1",
        summary: "",
        objective: "",
        requestedBy: "brain",
        mode: "auto",
        steps: [],
        jobs: [],
      },
      callback: {
        eventsUrl: "http://localhost/events",
        auth: {
          scheme: "hmac-sha256",
          executorHeader: "x-cube-executor-id",
          timestampHeader: "x-cube-executor-timestamp",
          signatureHeader: "x-cube-executor-signature",
          signedPayload: "timestamp.rawBody",
        },
      },
    },
    planJob: {
      id: "j1",
      key: "native",
      label: "native",
      description: "native",
      kind: "execute",
      payload: {
        workspaceRoot,
        command: ["node", "script.js"],
      },
      timeoutMs: 30_000,
    },
    status: "queued",
    progress: 0,
    message: "",
    receivedAt: now,
    artifacts: [],
    events: [],
    dataDirectory: join(workspaceRoot, ".job"),
    logFile: join(workspaceRoot, ".job", "executor.log"),
    executionMode: "native",
  };
}

describe("NativeRunner", () => {
  it("runs payload.command in workspaceRoot and completes", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-runner-"));
    try {
      writeFileSync(
        join(root, "script.js"),
        "console.log('hello-native');\n",
        "utf-8",
      );
      const record = makeRecord(root);
      const runner = new NativeRunner({
        callbackSender: { send: async () => {} },
      });
      const events: any[] = [];
      await runner.run(record, (e) => events.push(e));

      expect(events.some((e) => e.type === "job.started")).toBe(true);
      expect(events.some((e) => e.type === "job.completed")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest services/lobster-executor/src/__tests__/native-runner.test.ts
```

Expected: FAIL（NativeRunner 不存在）。

- [ ] **Step 3: Implement NativeRunner (minimal)**

Create `services/lobster-executor/src/native-runner.ts` with:

```ts
import { appendFileSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { join, relative, resolve } from "node:path";

import type { ExecutorEvent } from "../../../shared/executor/contracts.js";
import type { StoredJobRecord } from "./types.js";
import type { JobRunner } from "./runner.js";
import type { CallbackSender } from "./callback-sender.js";
import { LogBatcher } from "./log-batcher.js";
import { resolveAICredentials, validateCredentials, buildAIEnvVars } from "./credential-injector.js";

function toRelativePath(pathname: string): string {
  return relative(process.cwd(), pathname).replace(/\\/g, "/");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

export class NativeRunner implements JobRunner {
  private child?: ChildProcess;

  constructor(
    private readonly options: {
      callbackSender: CallbackSender;
      now?: () => Date;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  async cancel(record: StoredJobRecord): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  async run(record: StoredJobRecord, emitEvent: (event: ExecutorEvent) => void): Promise<void> {
    const now = this.options.now ?? (() => new Date());
    const payload = (record.planJob.payload ?? {}) as Record<string, unknown>;
    const command = (payload.command ?? []) as string[];
    if (!Array.isArray(command) || command.length === 0) {
      record.status = "failed";
      record.progress = 100;
      record.errorCode = "NATIVE_MISSING_COMMAND";
      record.errorMessage = "Native runner requires payload.command";
      record.message = record.errorMessage;
      emitEvent({
        version: record.request.version,
        eventId: `${record.request.requestId}-native-missing-command`,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        executor: "lobster-executor",
        type: "job.failed",
        status: "failed",
        occurredAt: nowIso(now),
        message: record.errorMessage,
        errorCode: record.errorCode,
      });
      return;
    }

    const workspaceRootRaw = payload.workspaceRoot as string | undefined;
    const workspaceRoot = workspaceRootRaw ? resolve(workspaceRootRaw) : process.cwd();
    ensureDir(record.dataDirectory);
    ensureDir(join(record.dataDirectory, "artifacts"));

    const envMap = (payload.env ?? {}) as Record<string, string>;
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const [k, v] of Object.entries(envMap)) {
      if (typeof v === "string") env[k] = v;
    }

    const aiEnabled = payload.aiEnabled === true;
    if (aiEnabled) {
      const creds = resolveAICredentials(payload, process.env);
      validateCredentials(creds);
      for (const entry of buildAIEnvVars(creds)) {
        const [k, ...rest] = entry.split("=");
        env[k] = rest.join("=");
      }
    }

    const logBatcher = new LogBatcher(
      (lines) => {
        const logEvent: ExecutorEvent = {
          version: record.request.version,
          eventId: `${record.request.requestId}-${Date.now()}-log`,
          missionId: record.request.missionId,
          jobId: record.request.jobId,
          executor: "lobster-executor",
          type: "job.log",
          status: "running",
          occurredAt: nowIso(now),
          message: lines.join("\n"),
        };
        emitEvent(logEvent);
        void this.options.callbackSender.send(record.request.callback, logEvent);
      },
      500,
      4096,
    );

    const startedAt = nowIso(now);
    record.status = "running";
    record.startedAt = startedAt;
    record.progress = 5;
    record.message = `Started native process for ${record.planJob.label}`;

    const startedEvent: ExecutorEvent = {
      version: record.request.version,
      eventId: `${record.request.requestId}-${Date.now()}-started`,
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      executor: "lobster-executor",
      type: "job.started",
      status: "running",
      occurredAt: startedAt,
      progress: 5,
      message: record.message,
    };
    emitEvent(startedEvent);
    await this.options.callbackSender.send(record.request.callback, startedEvent);

    const timeoutMs = record.planJob.timeoutMs ?? 300_000;
    const start = Date.now();
    const proc = spawn(command[0], command.slice(1), { cwd: workspaceRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = proc;

    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      appendFileSync(record.logFile, text);
      logBatcher.push(text.trimEnd());
    });
    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      appendFileSync(record.logFile, text);
      logBatcher.push(text.trimEnd());
    });

    const exitCode: number = await new Promise((resolveExit) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 1500);
      }, timeoutMs);
      proc.on("exit", (code) => {
        done = true;
        clearTimeout(timer);
        resolveExit(typeof code === "number" ? code : 1);
      });
    });

    const finishedAt = nowIso(now);
    const durationMs = Date.now() - start;

    const resultPayload = {
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      requestId: record.request.requestId,
      summary: exitCode === 0 ? "Native execution completed successfully" : `Native execution failed (exit ${exitCode})`,
      outcome: exitCode === 0 ? "success" : "failed",
      durationMs,
      exitCode,
    };
    const resultFile = join(record.dataDirectory, "result.json");
    writeFileSync(resultFile, `${JSON.stringify(resultPayload, null, 2)}\n`, "utf-8");

    record.finishedAt = finishedAt;
    record.progress = 100;
    record.summary = resultPayload.summary;
    record.message = record.summary;
    record.artifacts = [
      {
        kind: "log",
        name: "executor.log",
        path: toRelativePath(record.logFile),
        description: "Line-oriented executor runtime log",
      },
      {
        kind: "report",
        name: "result.json",
        path: toRelativePath(resultFile),
        description: "Native execution result summary",
      },
    ];

    if (exitCode === 0) {
      record.status = "completed";
      const event: ExecutorEvent = {
        version: record.request.version,
        eventId: `${record.request.requestId}-${Date.now()}-completed`,
        missionId: record.request.missionId,
        jobId: record.request.jobId,
        executor: "lobster-executor",
        type: "job.completed",
        status: "completed",
        occurredAt: finishedAt,
        progress: 100,
        message: record.summary,
        summary: record.summary,
        artifacts: record.artifacts,
        metrics: { durationMs, passed: 1 },
      };
      emitEvent(event);
      await this.options.callbackSender.send(record.request.callback, event);
      return;
    }

    record.status = "failed";
    record.errorCode = "NATIVE_EXIT_NONZERO";
    record.errorMessage = `Process exited with code ${exitCode}`;
    const event: ExecutorEvent = {
      version: record.request.version,
      eventId: `${record.request.requestId}-${Date.now()}-failed`,
      missionId: record.request.missionId,
      jobId: record.request.jobId,
      executor: "lobster-executor",
      type: "job.failed",
      status: "failed",
      occurredAt: finishedAt,
      progress: 100,
      message: record.errorMessage,
      errorCode: record.errorCode,
      summary: record.summary,
      artifacts: record.artifacts,
      metrics: { durationMs, failed: 1 },
    };
    emitEvent(event);
    await this.options.callbackSender.send(record.request.callback, event);
  }
}
```

- [ ] **Step 4: Export NativeRunner via runner factory**

Edit `services/lobster-executor/src/runner.ts`:

```ts
import { NativeRunner } from "./native-runner.js";

export function createJobRunner(
  config: LobsterExecutorConfig,
  callbackSender?: CallbackSender,
  mockRunnerOptions?: MockRunnerOptions,
): JobRunner {
  if (config.executionMode === "mock") {
    return new MockRunner(mockRunnerOptions);
  }

  if (config.executionMode === "native") {
    if (!callbackSender) throw new Error('CallbackSender is required when executionMode is "native"');
    return new NativeRunner({ callbackSender, ...mockRunnerOptions });
  }

  if (!callbackSender) {
    throw new Error('CallbackSender is required when executionMode is "real"');
  }
  return new DockerRunner(config, callbackSender);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest services/lobster-executor/src/__tests__/native-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/lobster-executor/src/native-runner.ts services/lobster-executor/src/runner.ts services/lobster-executor/src/__tests__/native-runner.test.ts
git commit -m "feat(lobster): add native runner for sandbox execution"
```

---

### Task 3: Runner Selection Tests (Factory)

**Files:**
- Create: `services/lobster-executor/src/__tests__/runner-factory.test.ts`

- [ ] **Step 1: Write failing test for createJobRunner selection**

```ts
import { describe, expect, it } from "vitest";
import { createJobRunner } from "../runner.js";
import type { LobsterExecutorConfig } from "../types.js";

describe("createJobRunner", () => {
  it("returns NativeRunner when executionMode=native", () => {
    const config: LobsterExecutorConfig = {
      host: "0.0.0.0",
      port: 3031,
      dataRoot: "/tmp",
      serviceName: "lobster-executor",
      executionMode: "native",
      defaultImage: "node:20-slim",
      maxConcurrentJobs: 2,
      callbackSecret: "",
      aiImage: "cube-ai-sandbox:latest",
      securityLevel: "strict",
      containerUser: "65534",
      maxMemory: "512m",
      maxCpus: "1.0",
      maxPids: 256,
      tmpfsSize: "64m",
      networkWhitelist: [],
    };
    const runner = createJobRunner(config, { send: async () => {} } as any);
    expect(runner.constructor.name).toBe("NativeRunner");
  });
});
```

- [ ] **Step 2: Run test**

```bash
npx vitest services/lobster-executor/src/__tests__/runner-factory.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add services/lobster-executor/src/__tests__/runner-factory.test.ts
git commit -m "test(lobster): cover runner factory selection"
```

---

### Task 4: Auto-Downgrade real → native When Docker Unavailable

**Files:**
- Modify: `services/lobster-executor/src/index.ts`

- [ ] **Step 1: Add helper to probe Docker availability**

Refactor `services/lobster-executor/src/index.ts` to:

```ts
async function isDockerAvailable(dockerHost: string | undefined): Promise<boolean> {
  const docker = new Dockerode(parseDockerHost(dockerHost));
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Change startup behavior**

Replace current `process.exit(1)` branch with:

```ts
let effectiveConfig = config;
if (config.executionMode === "real") {
  const ok = await isDockerAvailable(config.dockerHost);
  if (ok) {
    console.log("[lobster-executor] Docker daemon connected");
  } else {
    console.warn(
      `[lobster-executor] Docker daemon is not available at "${config.dockerHost}". Falling back to native execution.`,
    );
    effectiveConfig = { ...config, executionMode: "native" };
  }
}

const service = createLobsterExecutorService({
  dataRoot: effectiveConfig.dataRoot,
  config: effectiveConfig,
});
```

- [ ] **Step 3: Smoke-check in sandbox**

Run:

```bash
LOBSTER_EXECUTION_MODE=real npx tsx services/lobster-executor/src/index.ts
```

Expected:
- 不退出
- /health 显示 ok

- [ ] **Step 4: Commit**

```bash
git add services/lobster-executor/src/index.ts
git commit -m "feat(lobster): fallback to native when docker is unavailable"
```

---

### Task 5: Health Feature Flags Reflect Runner Capability

**Files:**
- Modify: `services/lobster-executor/src/app.ts`
- Modify: `services/lobster-executor/src/service.ts`

- [ ] **Step 1: Make LobsterExecutorService expose whether docker lifecycle is active**

In `services/lobster-executor/src/service.ts`, add a getter:

```ts
getExecutionMode(): "real" | "mock" | "native" {
  return this.executionMode;
}
```

- [ ] **Step 2: Use service.getExecutionMode() in /health**

In `services/lobster-executor/src/app.ts` replace:

```ts
dockerLifecycle: config.executionMode === "real",
```

with:

```ts
dockerLifecycle: service.getExecutionMode() === "real",
```

And docker ping only when `service.getExecutionMode() === "real"`.

- [ ] **Step 3: Verify health output**

Run:

```bash
curl -sS http://localhost:3031/health | head -c 800 && echo
```

Expected:
- `features.dockerLifecycle=false` in sandbox when fallback/native
- `docker.status=disconnected` but overall `status=ok`

- [ ] **Step 4: Commit**

```bash
git add services/lobster-executor/src/app.ts services/lobster-executor/src/service.ts
git commit -m "feat(lobster): health reflects effective execution mode"
```

---

### Task 6: Make Executor Tests Run in Standard Test Command

**Files:**
- Modify: `vitest.config.server.ts`

- [ ] **Step 1: Add include pattern for lobster-executor tests**

Edit `vitest.config.server.ts` include array to append:

```ts
"services/lobster-executor/src/__tests__/**/*.test.ts",
```

- [ ] **Step 2: Run full test suite (focused)**

Run:

```bash
npx vitest -c vitest.config.server.ts services/lobster-executor/src/__tests__/runner-factory.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.server.ts
git commit -m "test: include lobster-executor tests in vitest config"
```

---

### Task 7: End-to-End Sandbox Verification

**Files:**
- None

- [ ] **Step 1: Start server + executor + frontend**

Terminal A:

```bash
npm run dev:server
```

Terminal B:

```bash
LOBSTER_EXECUTION_MODE=real npx tsx services/lobster-executor/src/index.ts
```

Terminal C:

```bash
npm run dev:frontend -- --port 4173
```

- [ ] **Step 2: Confirm executor effective mode**

```bash
curl -sS http://localhost:3031/health | head -c 800 && echo
```

Expected: docker disconnected + dockerLifecycle=false.

- [ ] **Step 3: Trigger a mission that produces an execution plan with command**

In UI: 发起一个能生成执行计划的任务（例如“在 /workspace 下创建一个文件并写入 hello”）。

Expected:
- UI 看到 job.started → job.log → job.completed
- artifacts 至少包含 executor.log 与 result.json

---

## Self-Review Checklist

- 覆盖 spec 中的“自动检测降级”“不改变协议”“最小可用 artifacts”“取消/超时”均有对应 Task
- 全文无 TODO/TBD，占位语句为 0
- 类型（executionMode union）在 types/config/service/runner/app 五处一致

