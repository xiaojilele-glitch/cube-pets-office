/**
 * Property tests for AI image selection in DockerRunner.
 *
 * Feature: ai-enabled-sandbox
 * - Property 1: AI 镜像选择正确性
 * - Property 8: 非 AI Job 行为不变
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

import { DockerRunner } from "../docker-runner.js";
import type { LobsterExecutorConfig, StoredJobRecord } from "../types.js";
import type { CallbackSender } from "../callback-sender.js";
import type {
  ExecutionPlanJob,
  ExecutorJobRequest,
} from "../../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../../shared/executor/contracts.js";

/* ─── Helpers ─── */

const DEFAULT_IMAGE = "node:20-slim";
const DEFAULT_AI_IMAGE = "cube-ai-sandbox:latest";
/** A valid API key for testing (length > 8) */
const TEST_API_KEY = "test-api-key-for-property-testing-12345";

function makeRunner(
  defaultImage = DEFAULT_IMAGE,
  aiImage = DEFAULT_AI_IMAGE
): DockerRunner {
  const config: LobsterExecutorConfig = {
    host: "localhost",
    port: 7200,
    dataRoot: "/tmp/test",
    serviceName: "lobster-executor",
    executionMode: "real",
    defaultImage,
    maxConcurrentJobs: 2,
    callbackSecret: "",
    aiImage,
    securityLevel: "strict",
    containerUser: "65534",
    maxMemory: "512m",
    maxCpus: "1.0",
    maxPids: 256,
    tmpfsSize: "64m",
    networkWhitelist: [],
  };
  const mockCallbackSender = {
    send: async () => {},
  } as unknown as CallbackSender;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockDocker = {} as any;
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

/** Optional docker image name */
const arbImage = fc.option(
  fc
    .tuple(
      fc
        .array(
          fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
          { minLength: 1, maxLength: 20 }
        )
        .map(a => a.join("")),
      fc.option(
        fc
          .array(
            fc.constantFrom(
              ..."abcdefghijklmnopqrstuvwxyz0123456789.-".split("")
            ),
            { minLength: 1, maxLength: 10 }
          )
          .map(a => a.join("")),
        { nil: undefined }
      )
    )
    .map(([name, tag]) => (tag ? `${name}:${tag}` : name)),
  { nil: undefined }
);

/** Optional AI image name for config */
const arbAiImage = fc.option(
  fc
    .array(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-:".split("")),
      { minLength: 3, maxLength: 30 }
    )
    .map(a => a.join("")),
  { nil: undefined }
);

/** Env key: valid env var names */
const arbEnvKey = fc
  .array(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split("")),
    { minLength: 1, maxLength: 15 }
  )
  .map(a => a.join(""))
  // Exclude AI_ prefixed keys to avoid collision in non-AI tests
  .filter(k => !k.startsWith("AI_"));

/** Env value: printable ASCII */
const arbEnvValue = fc.string({ minLength: 0, maxLength: 30 });

/** 0-5 env entries with unique keys */
const arbEnvMap = fc
  .uniqueArray(fc.tuple(arbEnvKey, arbEnvValue), {
    minLength: 0,
    maxLength: 5,
    selector: ([k]: [string, string]) => k,
  })
  .map(pairs => Object.fromEntries(pairs));

/* ─── Environment setup for AI tests ─── */

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  // Set a valid API key so buildContainerOptions doesn't throw for AI jobs
  process.env.LLM_API_KEY = TEST_API_KEY;
  process.env.LLM_BASE_URL = "https://api.test.com";
  process.env.LLM_MODEL = "test-model";
});

afterEach(() => {
  // Restore original env
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

/* ─── Property 1: AI 镜像选择正确性 ─── */

describe("Property 1: AI 镜像选择正确性", () => {
  /**
   * **Validates: Requirements 1.3, 1.4, 7.1**
   *
   * For any Job payload and executor config combination:
   * - When aiEnabled=true AND payload.image NOT set → use AI image
   * - When aiEnabled=false or unset → use default image
   * - When payload.image explicitly set → use payload.image regardless of aiEnabled
   */

  it("aiEnabled=true without payload.image uses AI image from config", () => {
    fc.assert(
      fc.property(arbAiImage, configAiImage => {
        const aiImage = configAiImage || DEFAULT_AI_IMAGE;
        const runner = makeRunner(DEFAULT_IMAGE, aiImage);
        const payload: Record<string, unknown> = {
          aiEnabled: true,
          llmConfig: { apiKey: TEST_API_KEY },
        };

        const opts = runner.buildContainerOptions(
          makeRecord(payload),
          "/tmp/ws"
        );

        expect(opts.Image).toBe(aiImage);
      }),
      { numRuns: 100 }
    );
  });

  it("aiEnabled=false or unset uses default image from config", () => {
    fc.assert(
      fc.property(fc.constantFrom(false, undefined), aiEnabled => {
        const runner = makeRunner();
        const payload: Record<string, unknown> = {};
        if (aiEnabled !== undefined) payload.aiEnabled = aiEnabled;

        const opts = runner.buildContainerOptions(
          makeRecord(payload),
          "/tmp/ws"
        );

        expect(opts.Image).toBe(DEFAULT_IMAGE);
      }),
      { numRuns: 100 }
    );
  });

  it("payload.image takes priority regardless of aiEnabled", () => {
    fc.assert(
      fc.property(
        arbImage.filter(img => img !== undefined),
        fc.constantFrom(true, false, undefined),
        (explicitImage, aiEnabled) => {
          const runner = makeRunner();
          const payload: Record<string, unknown> = {
            image: explicitImage,
          };
          if (aiEnabled !== undefined) payload.aiEnabled = aiEnabled;
          // Provide valid creds for AI-enabled case
          if (aiEnabled === true) {
            payload.llmConfig = { apiKey: TEST_API_KEY };
          }

          const opts = runner.buildContainerOptions(
            makeRecord(payload),
            "/tmp/ws"
          );

          expect(opts.Image).toBe(explicitImage);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when config.aiImage is not set, falls back to cube-ai-sandbox:latest", () => {
    fc.assert(
      fc.property(fc.constant(true), () => {
        // Pass empty string for aiImage to simulate unset
        const config: LobsterExecutorConfig = {
          host: "localhost",
          port: 7200,
          dataRoot: "/tmp/test",
          serviceName: "lobster-executor",
          executionMode: "real",
          defaultImage: DEFAULT_IMAGE,
          maxConcurrentJobs: 2,
          callbackSecret: "",
          aiImage: "",
          securityLevel: "strict",
          containerUser: "65534",
          maxMemory: "512m",
          maxCpus: "1.0",
          maxPids: 256,
          tmpfsSize: "64m",
          networkWhitelist: [],
        };
        const mockCallbackSender = {
          send: async () => {},
        } as unknown as CallbackSender;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockDocker = {} as any;
        const runner = new DockerRunner(config, mockCallbackSender, mockDocker);

        const payload: Record<string, unknown> = {
          aiEnabled: true,
          llmConfig: { apiKey: TEST_API_KEY },
        };

        const opts = runner.buildContainerOptions(
          makeRecord(payload),
          "/tmp/ws"
        );

        expect(opts.Image).toBe("cube-ai-sandbox:latest");
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 8: 非 AI Job 行为不变 ─── */

describe("Property 8: 非 AI Job 行为不变", () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For any payload with aiEnabled=false or unset, buildContainerOptions
   * output should NOT contain AI_ prefixed env vars and should NOT use AI image.
   */

  it("non-AI jobs never have AI_ prefixed env vars", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(false, undefined),
        arbEnvMap,
        (aiEnabled, envMap) => {
          const runner = makeRunner();
          const payload: Record<string, unknown> = { env: envMap };
          if (aiEnabled !== undefined) payload.aiEnabled = aiEnabled;

          const opts = runner.buildContainerOptions(
            makeRecord(payload),
            "/tmp/ws"
          );

          const envArray = opts.Env ?? [];
          const aiEnvVars = envArray.filter((e: string) => e.startsWith("AI_"));
          expect(aiEnvVars).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("non-AI jobs never use AI image", () => {
    fc.assert(
      fc.property(fc.constantFrom(false, undefined), aiEnabled => {
        const runner = makeRunner(DEFAULT_IMAGE, "my-custom-ai:v2");
        const payload: Record<string, unknown> = {};
        if (aiEnabled !== undefined) payload.aiEnabled = aiEnabled;

        const opts = runner.buildContainerOptions(
          makeRecord(payload),
          "/tmp/ws"
        );

        // Should use default image, not AI image
        expect(opts.Image).toBe(DEFAULT_IMAGE);
        expect(opts.Image).not.toBe("my-custom-ai:v2");
      }),
      { numRuns: 100 }
    );
  });

  it("non-AI jobs with env vars preserve only user-specified env vars", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(false, undefined),
        arbEnvMap,
        (aiEnabled, envMap) => {
          const runner = makeRunner();
          const payload: Record<string, unknown> = { env: envMap };
          if (aiEnabled !== undefined) payload.aiEnabled = aiEnabled;

          const opts = runner.buildContainerOptions(
            makeRecord(payload),
            "/tmp/ws"
          );

          const entries = Object.entries(envMap);
          if (entries.length === 0) {
            expect(opts.Env).toBeUndefined();
          } else {
            expect(opts.Env).toHaveLength(entries.length);
            for (const [k, v] of entries) {
              expect(opts.Env).toContain(`${k}=${v}`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
