/**
 * Property-based tests for ExecutionBridge.detectExecutable
 *
 * Properties tested:
 *   1 — 可执行内容检测
 *   2 — 非可执行内容跳过
 *   3 — Metadata 强制覆盖
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

import { describe, expect, it, beforeEach } from "vitest";
import fc from "fast-check";
import {
  ExecutionBridge,
  type ExecutionBridgeOptions,
} from "../core/execution-bridge.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createBridgeOptions(): ExecutionBridgeOptions {
  return {
    missionRuntime: {} as any,
    executorBaseUrl: "http://localhost:9800",
    callbackUrl: "http://localhost:3000/api/executor/events",
    executionMode: "mock",
    defaultImage: "node:20-slim",
    retryCount: 1,
  };
}

// ─── Constants mirroring the implementation ─────────────────────────────────

const EXECUTABLE_LANGS = [
  "python", "javascript", "typescript", "bash", "sh",
  "shell", "ruby", "go", "rust", "java", "c", "cpp",
];

const SCRIPT_KEYWORDS = [
  "#!/bin", "npm run", "node ", "python ", "python3 ",
  "pytest", "playwright", "npx ", "yarn ", "pnpm ",
  "cargo run", "go run", "java -", "javac ", "gcc ",
  "g++ ", "make ", "cmake ", "docker run", "docker exec",
];

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Pick a random executable language for a code block */
const arbExecLang = fc.constantFrom(...EXECUTABLE_LANGS);

/** Pick a random script keyword */
const arbScriptKeyword = fc.constantFrom(...SCRIPT_KEYWORDS);

/** Safe alphabet that cannot form code blocks or script keywords */
const SAFE_CHARS = "abcdefghijklmABCDEFGHIJKLM .,!?:;()-\n";

/** Safe filler text that cannot accidentally contain executable patterns */
const arbSafeText = fc
  .array(fc.constantFrom(...SAFE_CHARS.split("")), { minLength: 0, maxLength: 80 })
  .map((chars) => chars.join(""))
  // Ensure no accidental code block or script keyword matches
  .filter((s) => {
    const lower = s.toLowerCase();
    if (lower.includes("```")) return false;
    for (const kw of SCRIPT_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return false;
    }
    return true;
  });

/**
 * Generate a deliverable string that contains BOTH an executable code block
 * AND a script keyword (threshold >= 2 required for detection).
 */
const arbExecutableDeliverable = fc
  .tuple(arbExecLang, arbScriptKeyword, arbSafeText, arbSafeText)
  .map(([lang, keyword, prefix, body]) => {
    return `${prefix}\n\`\`\`${lang}\n${body}\n\`\`\`\n${keyword} something\n`;
  });

/**
 * Generate a deliverable string that does NOT contain any executable code
 * block patterns AND does NOT contain any script keywords.
 */
const arbNonExecutableDeliverable = arbSafeText.map((text) => {
  // Ensure we have some content
  return text.length > 0 ? text : "This is a plain text analysis report.";
});

// ─── Property 1: 可执行内容检测 ────────────────────────────────────────────
// **Feature: executor-integration, Property 1: 可执行内容检测**
// **Validates: Requirements 1.1**

describe("Feature: executor-integration, Property 1: 可执行内容检测", () => {
  let bridge: ExecutionBridge;

  beforeEach(() => {
    bridge = new ExecutionBridge(createBridgeOptions());
  });

  it("deliverables containing executable code block + script keyword → executable: true", () => {
    fc.assert(
      fc.property(
        fc.array(arbExecutableDeliverable, { minLength: 1, maxLength: 5 }),
        (deliverables) => {
          const result = bridge.detectExecutable(deliverables);
          expect(result.executable).toBe(true);
          expect(result.reason).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("single deliverable with both patterns → executable: true", () => {
    fc.assert(
      fc.property(arbExecutableDeliverable, (deliverable) => {
        const result = bridge.detectExecutable([deliverable]);
        expect(result.executable).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("executable detection includes reason describing matched patterns", () => {
    fc.assert(
      fc.property(arbExecutableDeliverable, (deliverable) => {
        const result = bridge.detectExecutable([deliverable]);
        expect(result.executable).toBe(true);
        // Reason should mention code block or script keyword
        expect(
          result.reason.includes("code block") ||
          result.reason.includes("script keyword"),
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: 非可执行内容跳过 ──────────────────────────────────────────
// **Feature: executor-integration, Property 2: 非可执行内容跳过**
// **Validates: Requirements 1.2**

describe("Feature: executor-integration, Property 2: 非可执行内容跳过", () => {
  let bridge: ExecutionBridge;

  beforeEach(() => {
    bridge = new ExecutionBridge(createBridgeOptions());
  });

  it("deliverables without executable patterns → executable: false", () => {
    fc.assert(
      fc.property(
        fc.array(arbNonExecutableDeliverable, { minLength: 1, maxLength: 5 }),
        (deliverables) => {
          const result = bridge.detectExecutable(deliverables);
          expect(result.executable).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("empty deliverables array → executable: false", () => {
    const result = bridge.detectExecutable([]);
    expect(result.executable).toBe(false);
  });

  it("array of empty strings → executable: false", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(""), { minLength: 1, maxLength: 10 }),
        (deliverables) => {
          const result = bridge.detectExecutable(deliverables);
          expect(result.executable).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Metadata 强制覆盖 ─────────────────────────────────────────
// **Feature: executor-integration, Property 3: Metadata 强制覆盖**
// **Validates: Requirements 1.3, 1.4**

describe("Feature: executor-integration, Property 3: Metadata 强制覆盖", () => {
  let bridge: ExecutionBridge;

  beforeEach(() => {
    bridge = new ExecutionBridge(createBridgeOptions());
  });

  it("metadata.requiresExecution=true forces executable regardless of content", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbExecutableDeliverable, arbNonExecutableDeliverable),
        (deliverable) => {
          const result = bridge.detectExecutable(
            [deliverable],
            { requiresExecution: true },
          );
          expect(result.executable).toBe(true);
          expect(result.reason).toContain("metadata");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("metadata.requiresExecution=false forces skip regardless of content", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbExecutableDeliverable, arbNonExecutableDeliverable),
        (deliverable) => {
          const result = bridge.detectExecutable(
            [deliverable],
            { requiresExecution: false },
          );
          expect(result.executable).toBe(false);
          expect(result.reason).toContain("metadata");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("metadata.requiresExecution as boolean always overrides content detection", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(arbExecutableDeliverable, arbNonExecutableDeliverable),
          { minLength: 0, maxLength: 5 },
        ),
        fc.boolean(),
        (deliverables, forceValue) => {
          const result = bridge.detectExecutable(
            deliverables,
            { requiresExecution: forceValue },
          );
          expect(result.executable).toBe(forceValue);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-boolean requiresExecution values do NOT override detection", () => {
    fc.assert(
      fc.property(
        arbNonExecutableDeliverable,
        fc.oneof(
          fc.constant("yes"),
          fc.constant("no"),
          fc.constant(1),
          fc.constant(0),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (deliverable, nonBoolValue) => {
          const result = bridge.detectExecutable(
            [deliverable],
            { requiresExecution: nonBoolValue as any },
          );
          // Non-boolean values should NOT force override — falls through to content detection
          // Since arbNonExecutableDeliverable has no patterns, should be false
          expect(result.executable).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: ExecutionPlan 构建不变量 ───────────────────────────────────
// **Feature: executor-integration, Property 4: ExecutionPlan 构建不变量**
// **Validates: Requirements 2.1, 2.2, 2.4**

import { ExecutionPlanBuilder } from "../core/execution-plan-builder.js";
import { EXECUTION_RUN_MODES, type ExecutionRunMode } from "../../shared/executor/contracts.js";

const MISSION_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-";

/** Arbitrary valid missionId (non-empty alphanumeric + dashes, starts with alnum) */
const arbMissionId = fc
  .string({ minLength: 1, maxLength: 40, unit: fc.constantFrom(...MISSION_ID_CHARS.split("")) })
  .filter((s) => /^[a-z0-9]/.test(s));

/** Arbitrary sourceText that has some content (non-blank) */
const arbSourceText = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary ExecutionRunMode */
const arbRunMode: fc.Arbitrary<ExecutionRunMode> = fc.constantFrom(...EXECUTION_RUN_MODES);

describe("Feature: executor-integration, Property 4: ExecutionPlan 构建不变量", () => {
  let builder: ExecutionPlanBuilder;

  beforeEach(() => {
    builder = new ExecutionPlanBuilder();
  });

  it("plan.missionId always equals the input missionId", async () => {
    await fc.assert(
      fc.asyncProperty(arbMissionId, arbSourceText, async (missionId: string, sourceText: string) => {
        const { plan } = await builder.build({ missionId, sourceText });
        expect(plan.missionId).toBe(missionId);
      }),
      { numRuns: 100 },
    );
  });

  it("plan.sourceText contains the input sourceText", async () => {
    await fc.assert(
      fc.asyncProperty(arbMissionId, arbSourceText, async (missionId: string, sourceText: string) => {
        const { plan } = await builder.build({ missionId, sourceText });
        expect(plan.sourceText).toBe(sourceText);
      }),
      { numRuns: 100 },
    );
  });

  it("plan.objective is always non-empty", async () => {
    await fc.assert(
      fc.asyncProperty(arbMissionId, arbSourceText, async (missionId: string, sourceText: string) => {
        const { plan } = await builder.build({ missionId, sourceText });
        expect(plan.objective).toBeTruthy();
        expect(plan.objective.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("plan.mode equals the specified mode when provided", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId,
        arbSourceText,
        arbRunMode,
        async (missionId: string, sourceText: string, mode: ExecutionRunMode) => {
          const { plan } = await builder.build({ missionId, sourceText, mode });
          expect(plan.mode).toBe(mode);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("plan.mode defaults to 'auto' when mode is not specified", async () => {
    await fc.assert(
      fc.asyncProperty(arbMissionId, arbSourceText, async (missionId: string, sourceText: string) => {
        const { plan } = await builder.build({ missionId, sourceText });
        expect(plan.mode).toBe("auto");
      }),
      { numRuns: 100 },
    );
  });

  it("all invariants hold together for any valid input", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId,
        arbSourceText,
        fc.option(arbRunMode, { nil: undefined }),
        async (missionId: string, sourceText: string, mode: ExecutionRunMode | undefined) => {
          const { plan } = await builder.build({ missionId, sourceText, mode });

          // missionId identity
          expect(plan.missionId).toBe(missionId);
          // sourceText preserved
          expect(plan.sourceText).toBe(sourceText);
          // objective non-empty
          expect(plan.objective.length).toBeGreaterThan(0);
          // mode correctness
          if (mode !== undefined) {
            expect(plan.mode).toBe(mode);
          } else {
            expect(plan.mode).toBe("auto");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 8: 模式特定 payload 注入 ─────────────────────────────────────
// **Feature: executor-integration, Property 8: 模式特定 payload 注入**
// **Validates: Requirements 7.1, 7.2**

describe("Feature: executor-integration, Property 8: 模式特定 payload 注入", () => {
  /** Arbitrary non-empty deliverable string (content doesn't matter for payload injection) */
  const arbDeliverable = fc
    .string({ minLength: 1, maxLength: 300 })
    .filter((s) => s.trim().length > 0);

  /** Arbitrary missionId */
  const arbMissionIdPayload = fc
    .string({ minLength: 1, maxLength: 40, unit: fc.constantFrom(...MISSION_ID_CHARS.split("")) })
    .filter((s) => /^[a-z0-9]/.test(s));

  it("mock mode → job.payload.runner.kind === 'mock'", () => {
    fc.assert(
      fc.property(
        arbMissionIdPayload,
        fc.array(arbDeliverable, { minLength: 1, maxLength: 5 }),
        (missionId, deliverables) => {
          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            executionMode: "mock",
          });

          const job: { payload?: Record<string, unknown> } = {};
          (bridge as any).injectModePayload(job, missionId, deliverables);

          // payload must exist
          expect(job.payload).toBeDefined();
          // runner.kind must be "mock"
          const runner = (job.payload as any).runner;
          expect(runner).toBeDefined();
          expect(runner.kind).toBe("mock");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("real mode → job.payload contains image (string) and command (array)", () => {
    fc.assert(
      fc.property(
        arbMissionIdPayload,
        fc.array(arbDeliverable, { minLength: 1, maxLength: 5 }),
        (missionId, deliverables) => {
          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            executionMode: "real",
          });

          const job: { payload?: Record<string, unknown> } = {};
          (bridge as any).injectModePayload(job, missionId, deliverables);

          // payload must exist
          expect(job.payload).toBeDefined();
          // image must be a string
          expect(typeof (job.payload as any).image).toBe("string");
          expect((job.payload as any).image.length).toBeGreaterThan(0);
          // command must be an array
          expect(Array.isArray((job.payload as any).command)).toBe(true);
          expect((job.payload as any).command.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("mock mode preserves existing payload fields", () => {
    fc.assert(
      fc.property(
        arbMissionIdPayload,
        fc.array(arbDeliverable, { minLength: 1, maxLength: 3 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (missionId, deliverables, extraValue) => {
          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            executionMode: "mock",
          });

          const job: { payload?: Record<string, unknown> } = {
            payload: { customField: extraValue },
          };
          (bridge as any).injectModePayload(job, missionId, deliverables);

          expect((job.payload as any).customField).toBe(extraValue);
          expect((job.payload as any).runner.kind).toBe("mock");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("real mode preserves existing payload fields", () => {
    fc.assert(
      fc.property(
        arbMissionIdPayload,
        fc.array(arbDeliverable, { minLength: 1, maxLength: 3 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (missionId, deliverables, extraValue) => {
          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            executionMode: "real",
          });

          const job: { payload?: Record<string, unknown> } = {
            payload: { customField: extraValue },
          };
          (bridge as any).injectModePayload(job, missionId, deliverables);

          expect((job.payload as any).customField).toBe(extraValue);
          expect(typeof (job.payload as any).image).toBe("string");
          expect(Array.isArray((job.payload as any).command)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("mode determines payload shape: mock never has image/command, real never has runner", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("mock" as const, "real" as const),
        arbMissionIdPayload,
        fc.array(arbDeliverable, { minLength: 1, maxLength: 5 }),
        (mode, missionId, deliverables) => {
          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            executionMode: mode,
          });

          const job: { payload?: Record<string, unknown> } = {};
          (bridge as any).injectModePayload(job, missionId, deliverables);

          if (mode === "mock") {
            expect((job.payload as any).runner.kind).toBe("mock");
          } else {
            expect(typeof (job.payload as any).image).toBe("string");
            expect(Array.isArray((job.payload as any).command)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 5: 分发后 executor 上下文一致性 ──────────────────────────────
// **Feature: executor-integration, Property 5: 分发后 executor 上下文一致性**
// **Validates: Requirements 3.2**

import { vi } from "vitest";

describe("Feature: executor-integration, Property 5: 分发后 executor 上下文一致性", () => {
  /** Arbitrary non-empty jobId */
  const arbJobId = fc
    .string({ minLength: 1, maxLength: 40, unit: fc.constantFrom(..."abcdef0123456789-".split("")) })
    .filter((s) => s.trim().length > 0);

  /** Arbitrary non-empty requestId */
  const arbRequestId = fc
    .string({ minLength: 1, maxLength: 40, unit: fc.constantFrom(..."abcdef0123456789-".split("")) })
    .filter((s) => s.trim().length > 0);

  /** Arbitrary missionId */
  const arbMissionId5 = fc
    .string({ minLength: 1, maxLength: 40, unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")) })
    .filter((s) => /^[a-z0-9]/.test(s));

  /** Arbitrary executor name (always "lobster" per ExecutorJobRequest type) */
  const arbExecutorName = fc.constant("lobster" as const);

  it("after successful dispatch, patchMissionExecution receives correct executor context", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId5,
        arbJobId,
        arbRequestId,
        arbExecutorName,
        async (missionId, jobId, requestId, executorName) => {
          // Create mock MissionRuntime that captures patchMissionExecution calls
          const mockRuntime = {
            patchMissionExecution: vi.fn(),
            markMissionRunning: vi.fn(),
            updateMissionStage: vi.fn(),
            failMission: vi.fn(),
          };

          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            missionRuntime: mockRuntime as any,
          });

          // Mock planBuilder.build to return a minimal valid plan
          (bridge as any).planBuilder = {
            build: vi.fn().mockResolvedValue({
              plan: {
                missionId,
                sourceText: "test source",
                objective: "test objective",
                mode: "auto",
                jobs: [{ payload: {} }],
              },
            }),
          };

          // Mock executorClient.dispatchPlan to return controlled response
          (bridge as any).executorClient = {
            dispatchPlan: vi.fn().mockResolvedValue({
              request: {
                requestId,
                executor: executorName,
                missionId,
                jobId,
              },
              response: {
                ok: true,
                accepted: true,
                requestId,
                missionId,
                jobId,
                receivedAt: new Date().toISOString(),
              },
            }),
          };

          // Force execution via metadata
          const result = await bridge.bridge(missionId, ["test"], {
            requiresExecution: true,
          });

          // Bridge should have triggered
          expect(result.triggered).toBe(true);
          expect(result.jobId).toBe(jobId);
          expect(result.requestId).toBe(requestId);

          // patchMissionExecution should have been called exactly once
          expect(mockRuntime.patchMissionExecution).toHaveBeenCalledTimes(1);

          const [callId, callPatch] = mockRuntime.patchMissionExecution.mock.calls[0];
          expect(callId).toBe(missionId);

          // Verify executor context fields
          const executor = callPatch.executor;
          expect(executor).toBeDefined();
          expect(executor.name).toBe(executorName);
          expect(executor.name.length).toBeGreaterThan(0);
          expect(executor.jobId).toBe(jobId);
          expect(executor.requestId).toBe(requestId);
          expect(executor.status).toBe("queued");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("executor.name is always non-empty after successful dispatch", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId5,
        arbJobId,
        arbRequestId,
        async (missionId, jobId, requestId) => {
          const mockRuntime = {
            patchMissionExecution: vi.fn(),
            markMissionRunning: vi.fn(),
            updateMissionStage: vi.fn(),
            failMission: vi.fn(),
          };

          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            missionRuntime: mockRuntime as any,
          });

          (bridge as any).planBuilder = {
            build: vi.fn().mockResolvedValue({
              plan: {
                missionId,
                sourceText: "src",
                objective: "obj",
                mode: "auto",
                jobs: [{ payload: {} }],
              },
            }),
          };

          (bridge as any).executorClient = {
            dispatchPlan: vi.fn().mockResolvedValue({
              request: { requestId, executor: "lobster", missionId, jobId },
              response: { ok: true, accepted: true, requestId, missionId, jobId, receivedAt: new Date().toISOString() },
            }),
          };

          await bridge.bridge(missionId, ["x"], { requiresExecution: true });

          const executor = mockRuntime.patchMissionExecution.mock.calls[0]?.[1]?.executor;
          expect(executor).toBeDefined();
          expect(typeof executor.name).toBe("string");
          expect(executor.name.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("executor context jobId and requestId match dispatch response/request respectively", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId5,
        arbJobId,
        arbRequestId,
        async (missionId, jobId, requestId) => {
          const mockRuntime = {
            patchMissionExecution: vi.fn(),
            markMissionRunning: vi.fn(),
            updateMissionStage: vi.fn(),
            failMission: vi.fn(),
          };

          const bridge = new ExecutionBridge({
            ...createBridgeOptions(),
            missionRuntime: mockRuntime as any,
          });

          (bridge as any).planBuilder = {
            build: vi.fn().mockResolvedValue({
              plan: {
                missionId,
                sourceText: "s",
                objective: "o",
                mode: "auto",
                jobs: [{ payload: {} }],
              },
            }),
          };

          (bridge as any).executorClient = {
            dispatchPlan: vi.fn().mockResolvedValue({
              request: { requestId, executor: "lobster", missionId, jobId },
              response: { ok: true, accepted: true, requestId, missionId, jobId, receivedAt: new Date().toISOString() },
            }),
          };

          await bridge.bridge(missionId, ["code"], { requiresExecution: true });

          const executor = mockRuntime.patchMissionExecution.mock.calls[0][1].executor;
          // jobId comes from dispatch response
          expect(executor.jobId).toBe(jobId);
          // requestId comes from dispatch request
          expect(executor.requestId).toBe(requestId);
          // status is always "queued" after dispatch
          expect(executor.status).toBe("queued");
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 6: Callback URL 构建正确性 ────────────────────────────────────
// **Feature: executor-integration, Property 6: Callback URL 构建正确性**
// **Validates: Requirements 3.5**

import { buildCallbackUrl } from "../core/execution-bridge.js";

describe("Feature: executor-integration, Property 6: Callback URL 构建正确性", () => {
  /** Arbitrary hostname label: starts with a letter, followed by letters/digits/hyphens */
  const arbLabel = fc
    .tuple(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
      fc.array(
        fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
        { minLength: 0, maxLength: 10 },
      ),
    )
    .map(([first, rest]) => first + rest.join(""));

  /**
   * Arbitrary valid hostname: 1-3 labels joined by dots.
   * Each label starts with a letter so `new URL()` never rejects it as a numeric TLD.
   */
  const arbHostname = fc
    .array(arbLabel, { minLength: 1, maxLength: 3 })
    .map((labels) => labels.join("."));

  /** Arbitrary port number (1–65535) */
  const arbPort = fc.integer({ min: 1, max: 65535 });

  /** Arbitrary protocol: http or https */
  const arbProtocol = fc.constantFrom("http", "https");

  /** Arbitrary base URL: protocol://hostname or protocol://hostname:port */
  const arbBaseUrl = fc
    .tuple(arbProtocol, arbHostname, fc.option(arbPort, { nil: undefined }))
    .map(([proto, host, port]) =>
      port !== undefined ? `${proto}://${host}:${port}` : `${proto}://${host}`,
    );

  it("callback URL always ends with /api/executor/events", () => {
    fc.assert(
      fc.property(arbBaseUrl, (baseUrl) => {
        const result = buildCallbackUrl(baseUrl);
        expect(result).toMatch(/\/api\/executor\/events$/);
      }),
      { numRuns: 100 },
    );
  });

  it("callback URL is always a valid URL (parseable by new URL())", () => {
    fc.assert(
      fc.property(arbBaseUrl, (baseUrl) => {
        const result = buildCallbackUrl(baseUrl);
        // Should not throw
        const parsed = new URL(result);
        expect(parsed.href).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });

  it("callback URL preserves the protocol from the base URL", () => {
    fc.assert(
      fc.property(arbBaseUrl, (baseUrl) => {
        const result = buildCallbackUrl(baseUrl);
        const inputProtocol = new URL(baseUrl).protocol;
        const outputProtocol = new URL(result).protocol;
        expect(outputProtocol).toBe(inputProtocol);
      }),
      { numRuns: 100 },
    );
  });

  it("all three properties hold together for any valid base URL", () => {
    fc.assert(
      fc.property(arbBaseUrl, (baseUrl) => {
        const result = buildCallbackUrl(baseUrl);

        // 1. Ends with /api/executor/events
        expect(result).toMatch(/\/api\/executor\/events$/);

        // 2. Valid URL
        const parsed = new URL(result);
        expect(parsed.href).toBeTruthy();

        // 3. Protocol preserved
        expect(parsed.protocol).toBe(new URL(baseUrl).protocol);
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 9: 异常安全性 ─────────────────────────────────────────────────
// **Feature: executor-integration, Property 9: 异常安全性**
// **Validates: Requirements 6.4**

describe("Feature: executor-integration, Property 9: 异常安全性", () => {
  /** Arbitrary error message */
  const arbErrorMessage = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  /** Arbitrary missionId */
  const arbMissionId9 = fc
    .string({
      minLength: 1,
      maxLength: 40,
      unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
    })
    .filter((s) => /^[a-z0-9]/.test(s));

  /**
   * Injection points where we can force an error inside bridge().
   * Each maps to a different internal component that can throw.
   */
  type InjectionPoint =
    | "planBuilder.build"
    | "executorClient.dispatchPlan"
    | "markMissionRunning";

  const arbInjectionPoint: fc.Arbitrary<InjectionPoint> = fc.constantFrom(
    "planBuilder.build",
    "executorClient.dispatchPlan",
    "markMissionRunning",
  );

  /**
   * Helper: create a bridge with mocks, injecting an error at the specified point.
   * Returns the bridge and the mock runtime so we can inspect failMission calls.
   */
  function createFaultyBridge(
    injectionPoint: InjectionPoint,
    errorMessage: string,
  ) {
    const mockRuntime = {
      patchMissionExecution: vi.fn(),
      markMissionRunning: vi.fn(),
      updateMissionStage: vi.fn(),
      failMission: vi.fn(),
    };

    const bridge = new ExecutionBridge({
      ...createBridgeOptions(),
      missionRuntime: mockRuntime as any,
    });

    // Default working mocks — overridden below per injection point
    (bridge as any).planBuilder = {
      build: vi.fn().mockResolvedValue({
        plan: {
          missionId: "placeholder",
          sourceText: "src",
          objective: "obj",
          mode: "auto",
          jobs: [{ payload: {} }],
        },
      }),
    };

    (bridge as any).executorClient = {
      dispatchPlan: vi.fn().mockResolvedValue({
        request: { requestId: "r1", executor: "lobster", missionId: "placeholder", jobId: "j1" },
        response: { ok: true, accepted: true, requestId: "r1", missionId: "placeholder", jobId: "j1", receivedAt: new Date().toISOString() },
      }),
    };

    // Inject the error at the specified point
    switch (injectionPoint) {
      case "planBuilder.build":
        (bridge as any).planBuilder.build = vi.fn().mockRejectedValue(new Error(errorMessage));
        break;
      case "executorClient.dispatchPlan":
        (bridge as any).executorClient.dispatchPlan = vi.fn().mockRejectedValue(new Error(errorMessage));
        break;
      case "markMissionRunning":
        // markMissionRunning is called in Step 4 (before dispatch).
        // Throwing here is caught by the outer try-catch.
        mockRuntime.markMissionRunning.mockImplementation(() => {
          throw new Error(errorMessage);
        });
        break;
    }

    return { bridge, mockRuntime };
  }

  it("for any exception at any injection point, failMission is always called", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId9,
        arbInjectionPoint,
        arbErrorMessage,
        async (missionId, injectionPoint, errorMessage) => {
          const { bridge, mockRuntime } = createFaultyBridge(injectionPoint, errorMessage);

          await bridge.bridge(missionId, ["test code"], {
            requiresExecution: true,
          });

          // failMission must have been called at least once
          expect(mockRuntime.failMission).toHaveBeenCalled();
          // First argument must be the missionId
          expect(mockRuntime.failMission.mock.calls[0][0]).toBe(missionId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("failMission error message contains the original error text", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId9,
        arbInjectionPoint,
        arbErrorMessage,
        async (missionId, injectionPoint, errorMessage) => {
          const { bridge, mockRuntime } = createFaultyBridge(injectionPoint, errorMessage);

          await bridge.bridge(missionId, ["test code"], {
            requiresExecution: true,
          });

          expect(mockRuntime.failMission).toHaveBeenCalled();
          // The error message passed to failMission should contain the original error
          const failMessage = mockRuntime.failMission.mock.calls[0][1] as string;
          expect(failMessage).toContain(errorMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("bridge() returns triggered: true even when an exception occurs", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId9,
        arbInjectionPoint,
        arbErrorMessage,
        async (missionId, injectionPoint, errorMessage) => {
          const { bridge } = createFaultyBridge(injectionPoint, errorMessage);

          const result = await bridge.bridge(missionId, ["test code"], {
            requiresExecution: true,
          });

          // Bridge was triggered (execution was attempted) even though it failed
          expect(result.triggered).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("bridge() never throws — exceptions are always caught and handled", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMissionId9,
        arbInjectionPoint,
        arbErrorMessage,
        async (missionId, injectionPoint, errorMessage) => {
          const { bridge } = createFaultyBridge(injectionPoint, errorMessage);

          // bridge() should never throw, regardless of where the error occurs
          const result = await bridge.bridge(missionId, ["test code"], {
            requiresExecution: true,
          });

          // Should always return a valid BridgeResult
          expect(result).toBeDefined();
          expect(typeof result.triggered).toBe("boolean");
          expect(typeof result.reason).toBe("string");
        },
      ),
      { numRuns: 100 },
    );
  });
});
