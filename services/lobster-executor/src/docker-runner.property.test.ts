/**
 * Property 1: 容器创建配置正确性
 *
 * For any Job payload with image, env, command, workspaceRoot fields,
 * DockerRunner's buildContainerOptions should correctly reflect:
 * Image, Env, Cmd, and Binds.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 4.4**
 *
 * Feature: lobster-executor-real, Property 1: 容器创建配置正确性
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Dockerode from "dockerode";

import { DockerRunner } from "./docker-runner.js";
import type { LobsterExecutorConfig, StoredJobRecord } from "./types.js";
import type { CallbackSender } from "./callback-sender.js";
import type {
  ExecutionPlanJob,
  ExecutorJobRequest,
} from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";

/* ─── Helpers ─── */

const DEFAULT_IMAGE = "node:20-slim";

function makeRunner(defaultImage = DEFAULT_IMAGE): DockerRunner {
  const config: LobsterExecutorConfig = {
    host: "localhost",
    port: 7200,
    dataRoot: "/tmp/test",
    serviceName: "lobster-executor",
    executionMode: "real",
    defaultImage,
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
  const mockCallbackSender = { send: async () => {} } as unknown as CallbackSender;
  const mockDocker = {} as Dockerode;
  return new DockerRunner(config, mockCallbackSender, mockDocker);
}

function makeRecord(payload: Record<string, unknown>): StoredJobRecord {
  const planJob: ExecutionPlanJob = {
    id: "job-1",
    key: "test-job",
    label: "Test Job",
    description: "test",
    kind: "execute",
    payload,
  };
  return {
    planJob,
    status: "queued",
    progress: 0,
    message: "",
    receivedAt: new Date().toISOString(),
    artifacts: [],
    events: [],
    dataDirectory: "/tmp/test/jobs/m1/j1",
    logFile: "/tmp/test/jobs/m1/j1/executor.log",
    executionMode: "real",
    acceptedResponse: {
      ok: true as const,
      accepted: true as const,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-1",
      receivedAt: new Date().toISOString(),
    },
    request: {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: "r1",
      missionId: "m1",
      jobId: "job-1",
      executor: "lobster",
      createdAt: new Date().toISOString(),
      plan: {
        version: EXECUTOR_CONTRACT_VERSION,
        missionId: "m1",
        summary: "",
        objective: "",
        requestedBy: "brain",
        mode: "auto",
        steps: [],
        jobs: [planJob],
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
    } as ExecutorJobRequest,
  };
}

/* ─── Arbitraries ─── */

/** Optional docker image name: simple alphanumeric with optional tag */
const arbImage = fc.option(
  fc.tuple(
    fc.array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789-".split(""))), { minLength: 1, maxLength: 20 }).map((a) => a.join("")),
    fc.option(
      fc.array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789.-".split(""))), { minLength: 1, maxLength: 10 }).map((a) => a.join("")),
      { nil: undefined },
    ),
  ).map(([name, tag]) => (tag ? `${name}:${tag}` : name)),
  { nil: undefined },
);

/** Env key: non-empty alphanumeric + underscore (valid env var names) */
const arbEnvKey = fc.array(
  fc.constantFrom(...("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split(""))),
  { minLength: 1, maxLength: 15 },
).map((a) => a.join(""));

/** Env value: printable ASCII */
const arbEnvValue = fc.string({ minLength: 0, maxLength: 30 });

/** 0-10 env entries with unique keys */
const arbEnvMap = fc.uniqueArray(
  fc.tuple(arbEnvKey, arbEnvValue),
  { minLength: 0, maxLength: 10, selector: ([k]: [string, string]) => k },
).map((pairs) => Object.fromEntries(pairs));

/** Command array: 0-5 non-empty strings */
const arbCommand = fc.array(
  fc.string({ minLength: 1, maxLength: 20 }),
  { minLength: 0, maxLength: 5 },
);

/** Optional workspaceRoot path */
const arbWorkspaceRoot = fc.option(
  fc.array(fc.constantFrom(...("/abcdefghijklmnopqrstuvwxyz0123456789-_".split(""))), { minLength: 2, maxLength: 30 }).map((a) => a.join("")),
  { nil: undefined },
);

/** Random workspace dir (the host-side fallback) */
const arbWorkspaceDir = fc.array(
  fc.constantFrom(...("/abcdefghijklmnopqrstuvwxyz0123456789-_".split(""))),
  { minLength: 2, maxLength: 30 },
).map((a) => a.join(""));

/* ─── Tests ─── */

describe("Property 1: 容器创建配置正确性", () => {
  it("Image equals payload.image when set, or config.defaultImage when not set", () => {
    fc.assert(
      fc.property(arbImage, (image) => {
        const runner = makeRunner();
        const payload: Record<string, unknown> = {};
        if (image) payload.image = image;

        const opts = runner.buildContainerOptions(makeRecord(payload), "/tmp/ws");

        if (image) {
          expect(opts.Image).toBe(image);
        } else {
          expect(opts.Image).toBe(DEFAULT_IMAGE);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Env contains all payload.env entries in KEY=VALUE format", () => {
    fc.assert(
      fc.property(arbEnvMap, (envMap) => {
        const runner = makeRunner();
        const opts = runner.buildContainerOptions(makeRecord({ env: envMap }), "/tmp/ws");

        const entries = Object.entries(envMap);
        if (entries.length === 0) {
          expect(opts.Env).toBeUndefined();
        } else {
          expect(opts.Env).toBeDefined();
          for (const [k, v] of entries) {
            expect(opts.Env).toContain(`${k}=${v}`);
          }
          expect(opts.Env!.length).toBe(entries.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Cmd equals payload.command when set, undefined when empty", () => {
    fc.assert(
      fc.property(arbCommand, (command) => {
        const runner = makeRunner();
        const opts = runner.buildContainerOptions(makeRecord({ command }), "/tmp/ws");

        if (command.length > 0) {
          expect(opts.Cmd).toEqual(command);
        } else {
          expect(opts.Cmd).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("HostConfig.Binds uses payload.workspaceRoot when provided, otherwise workspaceDir", () => {
    fc.assert(
      fc.property(arbWorkspaceRoot, arbWorkspaceDir, (workspaceRoot, workspaceDir) => {
        const runner = makeRunner();
        const payload: Record<string, unknown> = {};
        if (workspaceRoot) payload.workspaceRoot = workspaceRoot;

        const opts = runner.buildContainerOptions(makeRecord(payload), workspaceDir);

        const expectedHost = workspaceRoot || workspaceDir;
        expect(opts.HostConfig?.Binds).toContain(`${expectedHost}:/workspace`);
      }),
      { numRuns: 100 },
    );
  });

  it("WorkingDir is always /workspace", () => {
    fc.assert(
      fc.property(arbImage, arbEnvMap, arbCommand, arbWorkspaceRoot, arbWorkspaceDir,
        (image, envMap, command, workspaceRoot, workspaceDir) => {
          const runner = makeRunner();
          const payload: Record<string, unknown> = {};
          if (image) payload.image = image;
          if (Object.keys(envMap).length > 0) payload.env = envMap;
          if (command.length > 0) payload.command = command;
          if (workspaceRoot) payload.workspaceRoot = workspaceRoot;

          const opts = runner.buildContainerOptions(makeRecord(payload), workspaceDir);

          expect(opts.WorkingDir).toBe("/workspace");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all fields combined: config reflects full payload correctly", () => {
    fc.assert(
      fc.property(
        arbImage, arbEnvMap, arbCommand, arbWorkspaceRoot, arbWorkspaceDir,
        (image, envMap, command, workspaceRoot, workspaceDir) => {
          const runner = makeRunner();
          const payload: Record<string, unknown> = {};
          if (image) payload.image = image;
          if (Object.keys(envMap).length > 0) payload.env = envMap;
          if (command.length > 0) payload.command = command;
          if (workspaceRoot) payload.workspaceRoot = workspaceRoot;

          const opts = runner.buildContainerOptions(makeRecord(payload), workspaceDir);

          // Image
          expect(opts.Image).toBe(image || DEFAULT_IMAGE);

          // Env
          const envEntries = Object.entries(envMap);
          if (envEntries.length > 0) {
            expect(opts.Env).toHaveLength(envEntries.length);
            for (const [k, v] of envEntries) {
              expect(opts.Env).toContain(`${k}=${v}`);
            }
          } else {
            expect(opts.Env).toBeUndefined();
          }

          // Cmd
          if (command.length > 0) {
            expect(opts.Cmd).toEqual(command);
          } else {
            expect(opts.Cmd).toBeUndefined();
          }

          // Binds
          const expectedHost = workspaceRoot || workspaceDir;
          expect(opts.HostConfig?.Binds).toEqual([`${expectedHost}:/workspace`]);

          // WorkingDir
          expect(opts.WorkingDir).toBe("/workspace");
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 3: 退出码到状态映射 ─── */

/**
 * Property 3: 退出码到状态映射
 *
 * For any integer exit code, exit code 0 should map to "completed" status,
 * non-zero should map to "failed".
 *
 * **Validates: Requirements 1.8**
 *
 * Feature: lobster-executor-real, Property 3: 退出码到状态映射
 */
describe("Property 3: 退出码到状态映射", () => {
  it("exit code 0 always maps to 'completed'", () => {
    expect(DockerRunner.mapExitCodeToStatus(0)).toBe("completed");
  });

  it("any non-zero exit code maps to 'failed'", () => {
    fc.assert(
      fc.property(
        fc.integer().filter((n) => n !== 0),
        (exitCode) => {
          expect(DockerRunner.mapExitCodeToStatus(exitCode)).toBe("failed");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any integer exit code, result is 'completed' iff exitCode === 0", () => {
    fc.assert(
      fc.property(fc.integer(), (exitCode) => {
        const status = DockerRunner.mapExitCodeToStatus(exitCode);
        if (exitCode === 0) {
          expect(status).toBe("completed");
        } else {
          expect(status).toBe("failed");
        }
      }),
      { numRuns: 100 },
    );
  });
});
