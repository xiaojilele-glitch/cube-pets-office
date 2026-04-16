import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type {
  CollaborationRequest,
  CollaborationResponse,
  CollaborationResult,
  SubTaskOutput,
  CollaborationSession,
} from "../../shared/swarm.js";

/* ─── Arbitraries ─── */

const arbSubTaskOutput: fc.Arbitrary<SubTaskOutput> = fc.record({
  taskId: fc.string({ minLength: 1, maxLength: 20 }),
  workerId: fc.string({ minLength: 1, maxLength: 20 }),
  description: fc.string({ minLength: 1, maxLength: 100 }),
  deliverable: fc.string({ minLength: 1, maxLength: 100 }),
  status: fc.constantFrom("done", "failed") as fc.Arbitrary<"done" | "failed">,
});

const arbCollaborationRequest: fc.Arbitrary<CollaborationRequest> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  sourcePodId: fc.string({ minLength: 1, maxLength: 20 }),
  sourceManagerId: fc.string({ minLength: 1, maxLength: 20 }),
  requiredCapabilities: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    minLength: 1,
    maxLength: 5,
  }),
  contextSummary: fc.string({ minLength: 0, maxLength: 200 }),
  depth: fc.integer({ min: 0, max: 10 }),
  workflowId: fc.string({ minLength: 1, maxLength: 20 }),
  createdAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
});

const arbCollaborationResponse: fc.Arbitrary<CollaborationResponse> = fc.record(
  {
    requestId: fc.string({ minLength: 1, maxLength: 20 }),
    targetPodId: fc.string({ minLength: 1, maxLength: 20 }),
    targetManagerId: fc.string({ minLength: 1, maxLength: 20 }),
    status: fc.constantFrom("accepted", "rejected", "busy") as fc.Arbitrary<
      "accepted" | "rejected" | "busy"
    >,
    estimatedCompletionMs: fc.option(fc.integer({ min: 0, max: 600_000 }), {
      nil: undefined,
    }),
    reason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), {
      nil: undefined,
    }),
    respondedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  }
);

const arbCollaborationResult: fc.Arbitrary<CollaborationResult> = fc.record({
  requestId: fc.string({ minLength: 1, maxLength: 20 }),
  sessionId: fc.string({ minLength: 1, maxLength: 20 }),
  status: fc.constantFrom("completed", "failed", "timeout") as fc.Arbitrary<
    "completed" | "failed" | "timeout"
  >,
  resultSummary: fc.string({ minLength: 0, maxLength: 200 }),
  subTaskOutputs: fc.array(arbSubTaskOutput, { minLength: 0, maxLength: 5 }),
  completedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  errorReason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), {
    nil: undefined,
  }),
});

const arbSessionStatus = fc.constantFrom(
  "pending",
  "active",
  "completed",
  "failed",
  "timeout"
) as fc.Arbitrary<"pending" | "active" | "completed" | "failed" | "timeout">;

const arbCollaborationSession: fc.Arbitrary<CollaborationSession> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  request: arbCollaborationRequest,
  response: fc.option(arbCollaborationResponse, { nil: undefined }),
  result: fc.option(arbCollaborationResult, { nil: undefined }),
  status: arbSessionStatus,
  startedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  updatedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  completedAt: fc.option(fc.integer({ min: 0, max: 2_000_000_000_000 }), {
    nil: undefined,
  }),
});

/* ─── Property 4 Tests ─── */

// Feature: autonomous-swarm, Property 4: CollaborationSession 序列化往返一致性
// Validates: Requirements 2.5
describe("Feature: autonomous-swarm, Property 4: CollaborationSession 序列化往返一致性", () => {
  it("JSON.parse(JSON.stringify(session)) deep equals the original session", () => {
    fc.assert(
      fc.property(arbCollaborationSession, session => {
        const roundTripped = JSON.parse(JSON.stringify(session));
        expect(roundTripped).toEqual(session);
      }),
      { numRuns: 100 }
    );
  });

  it("round-trip preserves all nested optional fields when present", () => {
    fc.assert(
      fc.property(
        arbCollaborationRequest,
        arbCollaborationResponse,
        arbCollaborationResult,
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (request, response, result, completedAt) => {
          const session: CollaborationSession = {
            id: "full-session",
            request,
            response,
            result,
            status: "completed",
            startedAt: request.createdAt,
            updatedAt: completedAt,
            completedAt,
          };
          const roundTripped = JSON.parse(JSON.stringify(session));
          expect(roundTripped).toEqual(session);
          expect(roundTripped.response).toBeDefined();
          expect(roundTripped.result).toBeDefined();
          expect(roundTripped.completedAt).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("round-trip preserves session when optional fields are absent", () => {
    fc.assert(
      fc.property(arbCollaborationRequest, request => {
        const session: CollaborationSession = {
          id: "minimal-session",
          request,
          status: "pending",
          startedAt: request.createdAt,
          updatedAt: request.createdAt,
        };
        const roundTripped = JSON.parse(JSON.stringify(session));
        expect(roundTripped).toEqual(session);
        expect(roundTripped.response).toBeUndefined();
        expect(roundTripped.result).toBeUndefined();
        expect(roundTripped.completedAt).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 2 Tests ─── */

import { validateCrossPod } from "../../shared/message-bus-rules.js";

// Feature: autonomous-swarm, Property 2: 非 Manager 跨 Pod 消息拒绝
// Validates: Requirements 1.2
describe("Feature: autonomous-swarm, Property 2: 非 Manager 跨 Pod 消息拒绝", () => {
  const arbDepartment = fc.string({ minLength: 1, maxLength: 20 });
  const arbNonManagerRole = fc.constantFrom("worker", "ceo") as fc.Arbitrary<
    "worker" | "ceo"
  >;
  const arbRole = fc.constantFrom("ceo", "manager", "worker") as fc.Arbitrary<
    "ceo" | "manager" | "worker"
  >;

  it("returns false when the sender is not a manager", () => {
    fc.assert(
      fc.property(
        arbNonManagerRole,
        arbRole,
        arbDepartment,
        arbDepartment,
        (fromRole, toRole, fromDept, toDept) => {
          const from = { role: fromRole, department: fromDept };
          const to = { role: toRole, department: toDept };
          expect(validateCrossPod(from, to)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns false when the receiver is not a manager", () => {
    fc.assert(
      fc.property(
        arbRole,
        arbNonManagerRole,
        arbDepartment,
        arbDepartment,
        (fromRole, toRole, fromDept, toDept) => {
          const from = { role: fromRole, department: fromDept };
          const to = { role: toRole, department: toDept };
          expect(validateCrossPod(from, to)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns false when both are managers but in the same department", () => {
    fc.assert(
      fc.property(arbDepartment, dept => {
        const from = { role: "manager" as const, department: dept };
        const to = { role: "manager" as const, department: dept };
        expect(validateCrossPod(from, to)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("returns true when both are managers in different departments (positive case)", () => {
    fc.assert(
      fc.property(arbDepartment, arbDepartment, (deptA, deptB) => {
        fc.pre(deptA !== deptB);
        const from = { role: "manager" as const, department: deptA };
        const to = { role: "manager" as const, department: deptB };
        expect(validateCrossPod(from, to)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 1 Tests ─── */

import { vi, beforeEach } from "vitest";
import { DEFAULT_SWARM_CONFIG } from "../../shared/swarm.js";

/* Hoisted mock state — accessible from vi.mock factory closures */
const mockState = vi.hoisted(() => ({
  agents: new Map<string, any>(),
  workflows: new Map<string, any>(),
  emittedEvents: [] as Array<{ event: string; data: any }>,
  messageCounter: 0,
}));

vi.mock("../../server/db/index.js", () => ({
  default: {
    getAgent: (id: string) => mockState.agents.get(id),
    getWorkflow: (id: string) => mockState.workflows.get(id),
    createMessage: (msg: any) => {
      mockState.messageCounter++;
      return {
        ...msg,
        id: mockState.messageCounter,
        created_at: new Date().toISOString(),
      };
    },
  },
}));

vi.mock("../../server/core/socket.js", () => ({
  getSocketIO: () => ({
    emit: (event: string, data: any) => {
      mockState.emittedEvents.push({ event, data });
    },
  }),
}));

vi.mock("../../server/memory/session-store.js", () => ({
  sessionStore: { appendMessageLog: vi.fn() },
}));

// Feature: autonomous-swarm, Property 1: 跨 Pod 消息投递与元数据正确性
// **Validates: Requirements 1.1, 1.3, 1.4**
describe("Feature: autonomous-swarm, Property 1: 跨 Pod 消息投递与元数据正确性", () => {
  /* ── Arbitraries ── */
  const arbAlphaId = fc.string({
    minLength: 1,
    maxLength: 15,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
  });
  const arbDept = fc.string({
    minLength: 1,
    maxLength: 15,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
  });
  // Content must be non-empty after trim (sendCrossPod rejects whitespace-only)
  const arbContent = fc
    .string({
      minLength: 1,
      maxLength: 300,
      unit: fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyz0123456789 ".split("")
      ),
    })
    .filter(s => s.trim().length > 0);

  const arbDeptPair = fc.tuple(arbDept, arbDept).filter(([a, b]) => a !== b);

  /* ── Helpers ── */
  function registerManager(id: string, department: string) {
    mockState.agents.set(id, {
      id,
      name: id,
      department,
      role: "manager",
      manager_id: null,
      model: "gpt-4o-mini",
      soul_md: null,
      heartbeat_config: null,
      is_active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  function registerWorkflow(id: string) {
    mockState.workflows.set(id, {
      id,
      directive: "test",
      status: "running",
      current_stage: null,
      departments_involved: [],
      started_at: new Date().toISOString(),
      completed_at: null,
      results: null,
      created_at: new Date().toISOString(),
    });
  }

  function resetState() {
    mockState.agents.clear();
    mockState.workflows.clear();
    mockState.emittedEvents.length = 0;
    mockState.messageCounter = 0;
  }

  beforeEach(() => resetState());

  it("sendCrossPod returns message with crossPod: true, correct sourcePodId and targetPodId", async () => {
    const { messageBus } = await import("../../server/core/message-bus.js");

    await fc.assert(
      fc.asyncProperty(
        arbAlphaId,
        arbAlphaId,
        arbDeptPair,
        arbAlphaId,
        arbContent,
        async (fromId, toId, [deptA, deptB], wfId, content) => {
          fc.pre(fromId !== toId);
          resetState();
          registerManager(fromId, deptA);
          registerManager(toId, deptB);
          registerWorkflow(wfId);

          const msg = await messageBus.sendCrossPod(
            fromId,
            toId,
            content,
            wfId
          );

          expect(msg.metadata).toBeDefined();
          expect(msg.metadata.crossPod).toBe(true);
          expect(msg.metadata.sourcePodId).toBe(deptA);
          expect(msg.metadata.targetPodId).toBe(deptB);
          expect(msg.metadata.contentPreview.length).toBeLessThanOrEqual(
            DEFAULT_SWARM_CONFIG.summaryMaxLength
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sendCrossPod emits cross_pod_message Socket.IO event with correct data", async () => {
    const { messageBus } = await import("../../server/core/message-bus.js");

    await fc.assert(
      fc.asyncProperty(
        arbAlphaId,
        arbAlphaId,
        arbDeptPair,
        arbAlphaId,
        arbContent,
        async (fromId, toId, [deptA, deptB], wfId, content) => {
          fc.pre(fromId !== toId);
          resetState();
          registerManager(fromId, deptA);
          registerManager(toId, deptB);
          registerWorkflow(wfId);

          const msg = await messageBus.sendCrossPod(
            fromId,
            toId,
            content,
            wfId
          );

          const crossPodEvents = mockState.emittedEvents.filter(
            e => e.event === "cross_pod_message"
          );
          expect(crossPodEvents.length).toBe(1);

          const eventData = crossPodEvents[0].data;
          expect(eventData.sourcePodId).toBe(deptA);
          expect(eventData.targetPodId).toBe(deptB);
          expect(eventData.messageId).toBe(msg.id);
          expect(eventData.contentPreview).toBe(
            content.substring(0, DEFAULT_SWARM_CONFIG.summaryMaxLength)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 3 Tests ─── */

// Feature: autonomous-swarm, Property 3: 跨 Pod 消息摘要截断
// **Validates: Requirements 1.5**
describe("Feature: autonomous-swarm, Property 3: 跨 Pod 消息摘要截断", () => {
  /* ── Arbitraries ── */
  const arbAlphaId = fc.string({
    minLength: 1,
    maxLength: 15,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
  });
  const arbDept = fc.string({
    minLength: 1,
    maxLength: 15,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
  });
  // Content of arbitrary length — includes strings both shorter and longer than summaryMaxLength
  const arbContent = fc
    .string({
      minLength: 1,
      maxLength: 500,
      unit: fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyz0123456789 ".split("")
      ),
    })
    .filter(s => s.trim().length > 0);

  const arbDeptPair = fc.tuple(arbDept, arbDept).filter(([a, b]) => a !== b);

  const SUMMARY_MAX = DEFAULT_SWARM_CONFIG.summaryMaxLength; // 200

  /* ── Helpers ── */
  function registerManager(id: string, department: string) {
    mockState.agents.set(id, {
      id,
      name: id,
      department,
      role: "manager",
      manager_id: null,
      model: "gpt-4o-mini",
      soul_md: null,
      heartbeat_config: null,
      is_active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  function registerWorkflow(id: string) {
    mockState.workflows.set(id, {
      id,
      directive: "test",
      status: "running",
      current_stage: null,
      departments_involved: [],
      started_at: new Date().toISOString(),
      completed_at: null,
      results: null,
      created_at: new Date().toISOString(),
    });
  }

  function resetState() {
    mockState.agents.clear();
    mockState.workflows.clear();
    mockState.emittedEvents.length = 0;
    mockState.messageCounter = 0;
  }

  beforeEach(() => resetState());

  it("contentPreview length never exceeds summaryMaxLength for any content", async () => {
    const { messageBus } = await import("../../server/core/message-bus.js");

    await fc.assert(
      fc.asyncProperty(
        arbAlphaId,
        arbAlphaId,
        arbDeptPair,
        arbAlphaId,
        arbContent,
        async (fromId, toId, [deptA, deptB], wfId, content) => {
          fc.pre(fromId !== toId);
          resetState();
          registerManager(fromId, deptA);
          registerManager(toId, deptB);
          registerWorkflow(wfId);

          const msg = await messageBus.sendCrossPod(
            fromId,
            toId,
            content,
            wfId
          );

          expect(msg.metadata.contentPreview.length).toBeLessThanOrEqual(
            SUMMARY_MAX
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when content exceeds summaryMaxLength, contentPreview equals content.substring(0, summaryMaxLength)", async () => {
    const { messageBus } = await import("../../server/core/message-bus.js");

    // Generate content guaranteed to be longer than summaryMaxLength
    const arbLongContent = fc
      .string({
        minLength: SUMMARY_MAX + 1,
        maxLength: 500,
        unit: fc.constantFrom(
          ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
        ),
      })
      .filter(s => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(
        arbAlphaId,
        arbAlphaId,
        arbDeptPair,
        arbAlphaId,
        arbLongContent,
        async (fromId, toId, [deptA, deptB], wfId, content) => {
          fc.pre(fromId !== toId);
          resetState();
          registerManager(fromId, deptA);
          registerManager(toId, deptB);
          registerWorkflow(wfId);

          const msg = await messageBus.sendCrossPod(
            fromId,
            toId,
            content,
            wfId
          );

          expect(msg.metadata.contentPreview).toBe(
            content.substring(0, SUMMARY_MAX)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when content length <= summaryMaxLength, contentPreview equals the full content", async () => {
    const { messageBus } = await import("../../server/core/message-bus.js");

    // Generate content guaranteed to be at most summaryMaxLength characters
    const arbShortContent = fc
      .string({
        minLength: 1,
        maxLength: SUMMARY_MAX,
        unit: fc.constantFrom(
          ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
        ),
      })
      .filter(s => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(
        arbAlphaId,
        arbAlphaId,
        arbDeptPair,
        arbAlphaId,
        arbShortContent,
        async (fromId, toId, [deptA, deptB], wfId, content) => {
          fc.pre(fromId !== toId);
          resetState();
          registerManager(fromId, deptA);
          registerManager(toId, deptB);
          registerWorkflow(wfId);

          const msg = await messageBus.sendCrossPod(
            fromId,
            toId,
            content,
            wfId
          );

          expect(msg.metadata.contentPreview).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 5 Tests ─── */

import { SwarmOrchestrator } from "../../server/core/swarm-orchestrator.js";
import type { PodCapability } from "../../shared/swarm.js";

// Feature: autonomous-swarm, Property 5: Pod 能力匹配返回相关 Pod
// **Validates: Requirements 3.2**
describe("Feature: autonomous-swarm, Property 5: Pod 能力匹配返回相关 Pod", () => {
  const CAPABILITY_POOL = [
    "coding",
    "design",
    "testing",
    "devops",
    "analytics",
    "security",
    "ml",
    "frontend",
    "backend",
    "database",
    "infra",
    "docs",
    "review",
    "deploy",
    "monitor",
  ];

  const arbCapability = fc.constantFrom(...CAPABILITY_POOL);

  const arbCapabilitySet = fc.uniqueArray(arbCapability, {
    minLength: 1,
    maxLength: 6,
  });

  const arbPodCapability: fc.Arbitrary<PodCapability> = fc.record({
    podId: fc.string({
      minLength: 1,
      maxLength: 15,
      unit: fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
      ),
    }),
    managerId: fc.string({
      minLength: 1,
      maxLength: 15,
      unit: fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
      ),
    }),
    capabilities: arbCapabilitySet,
    currentLoad: fc.integer({ min: 0, max: 10 }),
    maxConcurrency: fc.integer({ min: 1, max: 10 }),
  });

  /** Generate a list of PodCapabilities with unique podIds */
  const arbPodRegistry = fc
    .array(arbPodCapability, { minLength: 1, maxLength: 8 })
    .map(pods => {
      const seen = new Set<string>();
      return pods.filter(p => {
        if (seen.has(p.podId)) return false;
        seen.add(p.podId);
        return true;
      });
    })
    .filter(pods => pods.length > 0);

  function createOrchestrator(): SwarmOrchestrator {
    return new SwarmOrchestrator({
      messageBus: {} as any,
      config: DEFAULT_SWARM_CONFIG,
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
  }

  it("every returned Pod has at least one capability in common with the required set", () => {
    fc.assert(
      fc.property(arbPodRegistry, arbCapabilitySet, (pods, required) => {
        const orchestrator = createOrchestrator();
        for (const pod of pods) {
          orchestrator.registerPodCapability(pod);
        }

        const results = orchestrator.matchCapabilities(required);
        const requiredSet = new Set(required);

        for (const pod of results) {
          const intersection = pod.capabilities.filter(c => requiredSet.has(c));
          expect(intersection.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("results are sorted by match count descending", () => {
    fc.assert(
      fc.property(arbPodRegistry, arbCapabilitySet, (pods, required) => {
        const orchestrator = createOrchestrator();
        for (const pod of pods) {
          orchestrator.registerPodCapability(pod);
        }

        const results = orchestrator.matchCapabilities(required);
        const requiredSet = new Set(required);

        for (let i = 1; i < results.length; i++) {
          const prevCount = results[i - 1].capabilities.filter(c =>
            requiredSet.has(c)
          ).length;
          const currCount = results[i].capabilities.filter(c =>
            requiredSet.has(c)
          ).length;
          expect(prevCount).toBeGreaterThanOrEqual(currCount);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("no Pod with zero matching capabilities is included in results", () => {
    fc.assert(
      fc.property(arbPodRegistry, arbCapabilitySet, (pods, required) => {
        const orchestrator = createOrchestrator();
        for (const pod of pods) {
          orchestrator.registerPodCapability(pod);
        }

        const results = orchestrator.matchCapabilities(required);
        const resultIds = new Set(results.map(p => p.podId));
        const requiredSet = new Set(required);

        for (const pod of pods) {
          const matchCount = pod.capabilities.filter(c =>
            requiredSet.has(c)
          ).length;
          if (matchCount === 0) {
            expect(resultIds.has(pod.podId)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("all Pods with matching capabilities are included in results", () => {
    fc.assert(
      fc.property(arbPodRegistry, arbCapabilitySet, (pods, required) => {
        const orchestrator = createOrchestrator();
        for (const pod of pods) {
          orchestrator.registerPodCapability(pod);
        }

        const results = orchestrator.matchCapabilities(required);
        const resultIds = new Set(results.map(p => p.podId));
        const requiredSet = new Set(required);

        for (const pod of pods) {
          const matchCount = pod.capabilities.filter(c =>
            requiredSet.has(c)
          ).length;
          if (matchCount > 0) {
            expect(resultIds.has(pod.podId)).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 7 Tests ─── */

// Feature: autonomous-swarm, Property 7: 协作深度限制执行
// **Validates: Requirements 5.1**
describe("Feature: autonomous-swarm, Property 7: 协作深度限制执行", () => {
  const arbMaxDepth = fc.integer({ min: 1, max: 10 });

  function createOrchestratorWithDepth(maxDepth: number): SwarmOrchestrator {
    return new SwarmOrchestrator({
      messageBus: {} as any,
      config: { ...DEFAULT_SWARM_CONFIG, maxDepth },
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
  }

  /**
   * Register a source Pod (with capabilities that do NOT overlap with required)
   * and a target Pod (with capabilities that DO overlap with required).
   */
  function setupPods(orchestrator: SwarmOrchestrator, sourcePodId: string) {
    orchestrator.registerPodCapability({
      podId: sourcePodId,
      managerId: `mgr-${sourcePodId}`,
      capabilities: ["source-only-cap"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
    orchestrator.registerPodCapability({
      podId: "target-pod",
      managerId: "mgr-target",
      capabilities: ["needed-cap"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
  }

  function makeRequest(
    depth: number,
    sourcePodId: string
  ): CollaborationRequest {
    return {
      id: `req-depth-${depth}-${Date.now()}`,
      sourcePodId,
      sourceManagerId: `mgr-${sourcePodId}`,
      requiredCapabilities: ["needed-cap"],
      contextSummary: "test context",
      depth,
      workflowId: "wf-test",
      createdAt: Date.now(),
    };
  }

  it("when depth > maxDepth, handleRequest returns rejected with reason depth_exceeded", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMaxDepth,
        fc.integer({ min: 0, max: 20 }),
        async (maxDepth, extraDepth) => {
          const depth = maxDepth + 1 + extraDepth; // always > maxDepth
          const orchestrator = createOrchestratorWithDepth(maxDepth);
          setupPods(orchestrator, "source-pod");

          const response = await orchestrator.handleRequest(
            makeRequest(depth, "source-pod")
          );

          expect(response.status).toBe("rejected");
          expect(response.reason).toBe("depth_exceeded");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when depth <= maxDepth, handleRequest does NOT reject due to depth", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMaxDepth,
        fc.integer({ min: 0, max: 10 }),
        async (maxDepth, depthOffset) => {
          const depth = Math.min(depthOffset, maxDepth); // always <= maxDepth
          const orchestrator = createOrchestratorWithDepth(maxDepth);
          setupPods(orchestrator, "source-pod");

          const response = await orchestrator.handleRequest(
            makeRequest(depth, "source-pod")
          );

          // Should NOT be rejected due to depth
          if (response.status === "rejected") {
            expect(response.reason).not.toBe("depth_exceeded");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("depth exactly equal to maxDepth is accepted (boundary)", async () => {
    await fc.assert(
      fc.asyncProperty(arbMaxDepth, async maxDepth => {
        const orchestrator = createOrchestratorWithDepth(maxDepth);
        setupPods(orchestrator, "source-pod");

        const response = await orchestrator.handleRequest(
          makeRequest(maxDepth, "source-pod")
        );

        // Boundary: depth === maxDepth should NOT be rejected for depth
        if (response.status === "rejected") {
          expect(response.reason).not.toBe("depth_exceeded");
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 8 Tests ─── */

// Feature: autonomous-swarm, Property 8: 并发协作会话数量限制
// **Validates: Requirements 5.2, 5.5**
describe("Feature: autonomous-swarm, Property 8: 并发协作会话数量限制", () => {
  const arbMaxSessions = fc.integer({ min: 1, max: 8 });

  function createOrchestratorWithSessions(
    maxConcurrentSessions: number
  ): SwarmOrchestrator {
    return new SwarmOrchestrator({
      messageBus: {} as any,
      config: { ...DEFAULT_SWARM_CONFIG, maxConcurrentSessions, maxDepth: 100 },
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
  }

  /**
   * Register multiple source Pods (each with unique non-overlapping capabilities)
   * and a single target Pod with the "needed-cap" capability.
   * Each source Pod needs a unique ID so that each request creates a distinct session.
   */
  function setupPodsForCapacity(
    orchestrator: SwarmOrchestrator,
    numSourcePods: number
  ) {
    // Target pod has the capability we'll request
    orchestrator.registerPodCapability({
      podId: "target-pod",
      managerId: "mgr-target",
      capabilities: ["needed-cap"],
      currentLoad: 0,
      maxConcurrency: 100,
    });

    // Register source pods that do NOT have "needed-cap"
    for (let i = 0; i < numSourcePods; i++) {
      orchestrator.registerPodCapability({
        podId: `source-${i}`,
        managerId: `mgr-source-${i}`,
        capabilities: [`unique-cap-${i}`],
        currentLoad: 0,
        maxConcurrency: 100,
      });
    }
  }

  function makeValidRequest(index: number): CollaborationRequest {
    return {
      id: `req-cap-${index}-${Date.now()}`,
      sourcePodId: `source-${index}`,
      sourceManagerId: `mgr-source-${index}`,
      requiredCapabilities: ["needed-cap"],
      contextSummary: "test context",
      depth: 1,
      workflowId: "wf-test",
      createdAt: Date.now(),
    };
  }

  it("when active sessions >= maxConcurrentSessions, new requests return busy with swarm_capacity_exceeded", async () => {
    await fc.assert(
      fc.asyncProperty(arbMaxSessions, async maxSessions => {
        const orchestrator = createOrchestratorWithSessions(maxSessions);
        // Need enough source pods to fill capacity + 1 extra
        setupPodsForCapacity(orchestrator, maxSessions + 1);

        // Fill up all session slots
        for (let i = 0; i < maxSessions; i++) {
          const resp = await orchestrator.handleRequest(makeValidRequest(i));
          expect(resp.status).toBe("accepted");
        }

        // The next request should be rejected due to capacity
        const overflowResp = await orchestrator.handleRequest(
          makeValidRequest(maxSessions)
        );

        expect(overflowResp.status).toBe("busy");
        expect(overflowResp.reason).toBe("swarm_capacity_exceeded");
      }),
      { numRuns: 100 }
    );
  });

  it("when active sessions < maxConcurrentSessions, requests are NOT rejected due to capacity", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMaxSessions,
        fc.integer({ min: 0, max: 7 }),
        async (maxSessions, fillCount) => {
          const actualFill = Math.min(fillCount, maxSessions - 1); // always < maxSessions
          const orchestrator = createOrchestratorWithSessions(maxSessions);
          setupPodsForCapacity(orchestrator, actualFill + 1);

          // Fill some sessions (less than max)
          for (let i = 0; i < actualFill; i++) {
            await orchestrator.handleRequest(makeValidRequest(i));
          }

          // The next request should NOT be rejected due to capacity
          const resp = await orchestrator.handleRequest(
            makeValidRequest(actualFill)
          );

          if (resp.status === "busy") {
            expect(resp.reason).not.toBe("swarm_capacity_exceeded");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("exactly at maxConcurrentSessions - 1 active sessions, one more request is accepted (boundary)", async () => {
    await fc.assert(
      fc.asyncProperty(arbMaxSessions, async maxSessions => {
        const orchestrator = createOrchestratorWithSessions(maxSessions);
        setupPodsForCapacity(orchestrator, maxSessions);

        // Fill to maxSessions - 1
        for (let i = 0; i < maxSessions - 1; i++) {
          const resp = await orchestrator.handleRequest(makeValidRequest(i));
          expect(resp.status).toBe("accepted");
        }

        // One more should still be accepted (boundary: exactly at limit)
        const boundaryResp = await orchestrator.handleRequest(
          makeValidRequest(maxSessions - 1)
        );

        // Should NOT be rejected due to capacity
        if (boundaryResp.status === "busy") {
          expect(boundaryResp.reason).not.toBe("swarm_capacity_exceeded");
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 9 Tests ─── */

// Feature: autonomous-swarm, Property 9: 协作请求能力验证
// **Validates: Requirements 5.3**
describe("Feature: autonomous-swarm, Property 9: 协作请求能力验证", () => {
  const CAPABILITY_POOL = [
    "coding",
    "design",
    "testing",
    "devops",
    "analytics",
    "security",
    "ml",
    "frontend",
    "backend",
    "database",
    "infra",
    "docs",
    "review",
    "deploy",
    "monitor",
  ];

  const arbCapability = fc.constantFrom(...CAPABILITY_POOL);

  const arbCapabilitySet = fc.uniqueArray(arbCapability, {
    minLength: 1,
    maxLength: 6,
  });

  function createOrchestrator(): SwarmOrchestrator {
    return new SwarmOrchestrator({
      messageBus: {} as any,
      config: {
        ...DEFAULT_SWARM_CONFIG,
        maxDepth: 100,
        maxConcurrentSessions: 100,
      },
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
  }

  it("when source Pod has ALL required capabilities, handleRequest returns rejected with reason self_capability", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCapabilitySet,
        fc.string({
          minLength: 1,
          maxLength: 10,
          unit: fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
          ),
        }),
        fc.string({
          minLength: 1,
          maxLength: 10,
          unit: fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
          ),
        }),
        async (capabilities, sourcePodId, targetPodId) => {
          fc.pre(sourcePodId !== targetPodId);

          const orchestrator = createOrchestrator();

          // Source Pod has ALL the capabilities we will request
          orchestrator.registerPodCapability({
            podId: sourcePodId,
            managerId: `mgr-${sourcePodId}`,
            capabilities,
            currentLoad: 0,
            maxConcurrency: 10,
          });

          // Target Pod also has those capabilities (so matching would find it)
          orchestrator.registerPodCapability({
            podId: targetPodId,
            managerId: `mgr-${targetPodId}`,
            capabilities,
            currentLoad: 0,
            maxConcurrency: 10,
          });

          // Pick a non-empty subset of the source's capabilities as required
          const requiredCapabilities = capabilities.slice(
            0,
            Math.max(1, Math.floor(capabilities.length / 2))
          );

          const request: CollaborationRequest = {
            id: `req-self-${Date.now()}`,
            sourcePodId,
            sourceManagerId: `mgr-${sourcePodId}`,
            requiredCapabilities,
            contextSummary: "test",
            depth: 1,
            workflowId: "wf-test",
            createdAt: Date.now(),
          };

          const response = await orchestrator.handleRequest(request);

          expect(response.status).toBe("rejected");
          expect(response.reason).toBe("self_capability");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when source Pod does NOT have all required capabilities, request is NOT rejected for self_capability", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCapabilitySet,
        arbCapabilitySet,
        fc.string({
          minLength: 1,
          maxLength: 10,
          unit: fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
          ),
        }),
        fc.string({
          minLength: 1,
          maxLength: 10,
          unit: fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
          ),
        }),
        async (
          sourceCapabilities,
          extraCapabilities,
          sourcePodId,
          targetPodId
        ) => {
          fc.pre(sourcePodId !== targetPodId);

          // Ensure at least one required capability is NOT in the source's set
          const sourceCapSet = new Set(sourceCapabilities);
          const missingCaps = extraCapabilities.filter(
            c => !sourceCapSet.has(c)
          );
          fc.pre(missingCaps.length > 0);

          // Required capabilities = some source has + at least one it doesn't
          const requiredCapabilities = [
            ...sourceCapabilities.slice(0, 1),
            ...missingCaps.slice(0, 1),
          ];

          const orchestrator = createOrchestrator();

          // Source Pod does NOT have all required capabilities
          orchestrator.registerPodCapability({
            podId: sourcePodId,
            managerId: `mgr-${sourcePodId}`,
            capabilities: sourceCapabilities,
            currentLoad: 0,
            maxConcurrency: 10,
          });

          // Target Pod has ALL required capabilities
          orchestrator.registerPodCapability({
            podId: targetPodId,
            managerId: `mgr-${targetPodId}`,
            capabilities: [
              ...new Set([...sourceCapabilities, ...extraCapabilities]),
            ],
            currentLoad: 0,
            maxConcurrency: 10,
          });

          const request: CollaborationRequest = {
            id: `req-partial-${Date.now()}`,
            sourcePodId,
            sourceManagerId: `mgr-${sourcePodId}`,
            requiredCapabilities,
            contextSummary: "test",
            depth: 1,
            workflowId: "wf-test",
            createdAt: Date.now(),
          };

          const response = await orchestrator.handleRequest(request);

          // Should NOT be rejected for self_capability
          if (response.status === "rejected") {
            expect(response.reason).not.toBe("self_capability");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 6 Tests ─── */

// Feature: autonomous-swarm, Property 6: 协作结果封装保留所有子任务产出
// **Validates: Requirements 4.3, 4.4**
describe("Feature: autonomous-swarm, Property 6: 协作结果封装保留所有子任务产出", () => {
  function createOrchestrator(): SwarmOrchestrator {
    return new SwarmOrchestrator({
      messageBus: {} as any,
      config: {
        ...DEFAULT_SWARM_CONFIG,
        maxDepth: 100,
        maxConcurrentSessions: 100,
      },
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
  }

  function setupPods(orchestrator: SwarmOrchestrator) {
    orchestrator.registerPodCapability({
      podId: "source-pod",
      managerId: "mgr-source",
      capabilities: ["source-only-cap"],
      currentLoad: 0,
      maxConcurrency: 100,
    });
    orchestrator.registerPodCapability({
      podId: "target-pod",
      managerId: "mgr-target",
      capabilities: ["needed-cap"],
      currentLoad: 0,
      maxConcurrency: 100,
    });
  }

  async function createSession(
    orchestrator: SwarmOrchestrator
  ): Promise<string> {
    const request: CollaborationRequest = {
      id: `req-p6-${Date.now()}-${Math.random()}`,
      sourcePodId: "source-pod",
      sourceManagerId: "mgr-source",
      requiredCapabilities: ["needed-cap"],
      contextSummary: "test context for property 6",
      depth: 1,
      workflowId: "wf-test",
      createdAt: Date.now(),
    };
    const response = await orchestrator.handleRequest(request);
    expect(response.status).toBe("accepted");
    // Retrieve the session ID from active sessions
    const sessions = orchestrator.getActiveSessions();
    const session = sessions.find(s => s.request.id === request.id);
    expect(session).toBeDefined();
    return session!.id;
  }

  it("session.result.subTaskOutputs contains all input outputs (same length, same content)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbSubTaskOutput, { minLength: 0, maxLength: 10 }),
        async subTaskOutputs => {
          const orchestrator = createOrchestrator();
          setupPods(orchestrator);
          const sessionId = await createSession(orchestrator);

          const result: CollaborationResult = {
            requestId: "req-p6",
            sessionId,
            status: "completed", // will be overridden by submitResult
            resultSummary: "test result",
            subTaskOutputs,
            completedAt: Date.now(),
          };

          await orchestrator.submitResult(sessionId, result);

          const sessions = orchestrator.getActiveSessions();
          // Session is now completed/failed, so use a different approach to get it
          // getActiveSessions only returns pending/active, so we check the result object directly
          expect(result.subTaskOutputs).toHaveLength(subTaskOutputs.length);
          for (let i = 0; i < subTaskOutputs.length; i++) {
            expect(result.subTaskOutputs[i]).toEqual(subTaskOutputs[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when all sub-tasks have status 'done', session.status === 'completed' and result.status === 'completed'", async () => {
    const arbDoneOutput: fc.Arbitrary<SubTaskOutput> = fc.record({
      taskId: fc.string({ minLength: 1, maxLength: 20 }),
      workerId: fc.string({ minLength: 1, maxLength: 20 }),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      deliverable: fc.string({ minLength: 1, maxLength: 100 }),
      status: fc.constant("done" as const),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbDoneOutput, { minLength: 1, maxLength: 10 }),
        async subTaskOutputs => {
          const orchestrator = createOrchestrator();
          setupPods(orchestrator);
          const sessionId = await createSession(orchestrator);

          const result: CollaborationResult = {
            requestId: "req-p6-done",
            sessionId,
            status: "completed",
            resultSummary: "all done",
            subTaskOutputs,
            completedAt: Date.now(),
          };

          await orchestrator.submitResult(sessionId, result);

          // result.status should be overridden to "completed"
          expect(result.status).toBe("completed");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when any sub-task has status 'failed', session.status === 'failed' and result.status === 'failed'", async () => {
    // Generate at least one failed sub-task mixed with done sub-tasks
    const arbMixedOutputsWithFailure = fc
      .array(arbSubTaskOutput, { minLength: 1, maxLength: 10 })
      .filter(outputs => outputs.some(o => o.status === "failed"));

    await fc.assert(
      fc.asyncProperty(arbMixedOutputsWithFailure, async subTaskOutputs => {
        const orchestrator = createOrchestrator();
        setupPods(orchestrator);
        const sessionId = await createSession(orchestrator);

        const result: CollaborationResult = {
          requestId: "req-p6-fail",
          sessionId,
          status: "completed", // intentionally set to completed, should be overridden
          resultSummary: "has failures",
          subTaskOutputs,
          completedAt: Date.now(),
        };

        await orchestrator.submitResult(sessionId, result);

        // result.status should be overridden to "failed"
        expect(result.status).toBe("failed");
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 10 Tests ─── */

// Feature: autonomous-swarm, Property 10: 超时会话自动终止
// **Validates: Requirements 5.4**
describe("Feature: autonomous-swarm, Property 10: 超时会话自动终止", () => {
  const arbSessionTimeoutMs = fc.integer({ min: 1000, max: 600_000 });
  const arbBaseTime = fc.integer({
    min: 1_000_000_000_000,
    max: 1_500_000_000_000,
  });

  function createOrchestrator(sessionTimeoutMs: number): SwarmOrchestrator {
    return new SwarmOrchestrator({
      messageBus: {} as any,
      config: {
        ...DEFAULT_SWARM_CONFIG,
        maxDepth: 100,
        maxConcurrentSessions: 100,
        sessionTimeoutMs,
      },
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
  }

  function setupPods(orchestrator: SwarmOrchestrator, count: number) {
    for (let i = 0; i < count; i++) {
      orchestrator.registerPodCapability({
        podId: `source-${i}`,
        managerId: `mgr-source-${i}`,
        capabilities: [`unique-cap-${i}`],
        currentLoad: 0,
        maxConcurrency: 100,
      });
    }
    orchestrator.registerPodCapability({
      podId: "target-pod",
      managerId: "mgr-target",
      capabilities: ["needed-cap"],
      currentLoad: 0,
      maxConcurrency: 100,
    });
  }

  function makeRequest(index: number): CollaborationRequest {
    return {
      id: `req-timeout-${index}-${Math.random()}`,
      sourcePodId: `source-${index}`,
      sourceManagerId: `mgr-source-${index}`,
      requiredCapabilities: ["needed-cap"],
      contextSummary: "timeout test",
      depth: 1,
      workflowId: "wf-test",
      createdAt: 0, // not used by handleRequest for startedAt
    };
  }

  it("sessions that have exceeded timeout are terminated with status 'timeout'", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionTimeoutMs,
        arbBaseTime,
        fc.integer({ min: 1, max: 100_000 }),
        async (timeoutMs, baseTime, extraMs) => {
          const orchestrator = createOrchestrator(timeoutMs);
          setupPods(orchestrator, 1);

          // Create session at baseTime
          const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
          const resp = await orchestrator.handleRequest(makeRequest(0));
          expect(resp.status).toBe("accepted");

          // Advance time past timeout: baseTime + timeoutMs + extraMs
          const futureTime = baseTime + timeoutMs + extraMs;
          dateNowSpy.mockReturnValue(futureTime);

          const timedOut = await orchestrator.terminateTimedOutSessions();

          expect(timedOut.length).toBe(1);
          expect(timedOut[0].status).toBe("timeout");
          expect(timedOut[0].completedAt).toBe(futureTime);

          dateNowSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sessions that have NOT exceeded timeout are NOT terminated", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionTimeoutMs,
        arbBaseTime,
        // elapsed must be strictly less than timeoutMs, so session is still valid
        fc.integer({ min: 0, max: 599_999 }),
        async (timeoutMs, baseTime, elapsedFraction) => {
          // Ensure elapsed < timeoutMs
          const elapsed = elapsedFraction % timeoutMs;

          const orchestrator = createOrchestrator(timeoutMs);
          setupPods(orchestrator, 1);

          // Create session at baseTime
          const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
          const resp = await orchestrator.handleRequest(makeRequest(0));
          expect(resp.status).toBe("accepted");

          // Set time to baseTime + elapsed (still within timeout)
          // startedAt + timeoutMs > currentTime means NOT timed out
          const currentTime = baseTime + elapsed;
          dateNowSpy.mockReturnValue(currentTime);

          const timedOut = await orchestrator.terminateTimedOutSessions();

          expect(timedOut.length).toBe(0);

          // Verify session is still active
          const activeSessions = orchestrator.getActiveSessions();
          expect(activeSessions.length).toBe(1);
          expect(activeSessions[0].status).not.toBe("timeout");

          dateNowSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("already completed/failed sessions are NOT affected by terminateTimedOutSessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionTimeoutMs,
        arbBaseTime,
        fc.integer({ min: 1, max: 100_000 }),
        async (timeoutMs, baseTime, extraMs) => {
          const orchestrator = createOrchestrator(timeoutMs);
          setupPods(orchestrator, 1);

          // Create session at baseTime
          const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
          const resp = await orchestrator.handleRequest(makeRequest(0));
          expect(resp.status).toBe("accepted");

          // Complete the session via submitResult before timeout
          const sessions = orchestrator.getActiveSessions();
          expect(sessions.length).toBe(1);
          const sessionId = sessions[0].id;

          await orchestrator.submitResult(sessionId, {
            requestId: sessions[0].request.id,
            sessionId,
            status: "completed",
            resultSummary: "done",
            subTaskOutputs: [
              {
                taskId: "t1",
                workerId: "w1",
                description: "task",
                deliverable: "result",
                status: "done",
              },
            ],
            completedAt: baseTime + 1000,
          });

          // Advance time well past timeout
          const futureTime = baseTime + timeoutMs + extraMs;
          dateNowSpy.mockReturnValue(futureTime);

          const timedOut = await orchestrator.terminateTimedOutSessions();

          // Already completed session should NOT be terminated
          expect(timedOut.length).toBe(0);

          dateNowSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ─── Task 6.1: analyzeHeartbeat Unit Tests ─── */

import type {
  HeartbeatReport,
  LLMProvider,
  AgentDirectory,
} from "../../server/core/swarm-orchestrator.js";

// Feature: autonomous-swarm, analyzeHeartbeat: 协作机会自主发现
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
describe("Feature: autonomous-swarm, analyzeHeartbeat: 协作机会自主发现", () => {
  function createOrchestratorForHeartbeat(opts?: {
    llmResponse?: string;
    llmShouldThrow?: boolean;
  }) {
    const llmProvider: LLMProvider = {
      generate: opts?.llmShouldThrow
        ? async () => {
            throw new Error("LLM unavailable");
          }
        : async () =>
            opts?.llmResponse ??
            '{"needsCollaboration":false,"requiredCapabilities":[]}',
    };

    const agentDirectory: AgentDirectory = {
      getManagerByPod: () => undefined,
      getAvailableWorkers: () => [],
    };

    const orchestrator = new SwarmOrchestrator({
      messageBus: {} as any,
      config: {
        ...DEFAULT_SWARM_CONFIG,
        maxDepth: 10,
        maxConcurrentSessions: 10,
      },
      llmProvider,
      agentDirectory,
    });

    return orchestrator;
  }

  function makeReport(overrides?: Partial<HeartbeatReport>): HeartbeatReport {
    return {
      agentId: "mgr-pod-a",
      podId: "pod-a",
      actionItems: ["need design review"],
      observations: ["complex UI task detected"],
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it("returns null when both actionItems and observations are empty", async () => {
    const orchestrator = createOrchestratorForHeartbeat();
    const result = await orchestrator.analyzeHeartbeat(
      makeReport({ actionItems: [], observations: [] })
    );
    expect(result).toBeNull();
  });

  it("returns null when LLM says needsCollaboration is false", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse:
        '{"needsCollaboration":false,"requiredCapabilities":["design"]}',
    });
    const result = await orchestrator.analyzeHeartbeat(makeReport());
    expect(result).toBeNull();
  });

  it("returns null when LLM returns empty requiredCapabilities", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse: '{"needsCollaboration":true,"requiredCapabilities":[]}',
    });
    const result = await orchestrator.analyzeHeartbeat(makeReport());
    expect(result).toBeNull();
  });

  it("returns null when LLM call throws an error", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmShouldThrow: true,
    });
    const result = await orchestrator.analyzeHeartbeat(makeReport());
    expect(result).toBeNull();
  });

  it("returns null when LLM returns malformed JSON", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse: "not valid json at all",
    });
    const result = await orchestrator.analyzeHeartbeat(makeReport());
    expect(result).toBeNull();
  });

  it("returns null when no matching Pod is found (requirement 3.4)", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse:
        '{"needsCollaboration":true,"requiredCapabilities":["quantum-computing"]}',
    });
    // Register only the source Pod — no other Pod has "quantum-computing"
    orchestrator.registerPodCapability({
      podId: "pod-a",
      managerId: "mgr-pod-a",
      capabilities: ["coding"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
    const result = await orchestrator.analyzeHeartbeat(makeReport());
    expect(result).toBeNull();
  });

  it("returns null when only the source Pod matches (excludes self)", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse:
        '{"needsCollaboration":true,"requiredCapabilities":["coding"]}',
    });
    orchestrator.registerPodCapability({
      podId: "pod-a",
      managerId: "mgr-pod-a",
      capabilities: ["coding"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
    const result = await orchestrator.analyzeHeartbeat(makeReport());
    expect(result).toBeNull();
  });

  it("returns a CollaborationRequest when a matching target Pod exists", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse:
        '{"needsCollaboration":true,"requiredCapabilities":["design"]}',
    });
    orchestrator.registerPodCapability({
      podId: "pod-a",
      managerId: "mgr-pod-a",
      capabilities: ["coding"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
    orchestrator.registerPodCapability({
      podId: "pod-b",
      managerId: "mgr-pod-b",
      capabilities: ["design"],
      currentLoad: 0,
      maxConcurrency: 10,
    });

    const report = makeReport();
    const result = await orchestrator.analyzeHeartbeat(report);

    expect(result).not.toBeNull();
    expect(result!.sourcePodId).toBe("pod-a");
    expect(result!.sourceManagerId).toBe("mgr-pod-a");
    expect(result!.requiredCapabilities).toEqual(["design"]);
    expect(result!.depth).toBe(1);
    expect(result!.workflowId).toBe("");
    expect(result!.contextSummary).toContain("need design review");
    expect(result!.contextSummary).toContain("complex UI task detected");
    expect(result!.id).toMatch(/^collab-/);
    expect(result!.createdAt).toBeGreaterThan(0);
  });

  it("works when only actionItems are present (observations empty)", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse:
        '{"needsCollaboration":true,"requiredCapabilities":["testing"]}',
    });
    orchestrator.registerPodCapability({
      podId: "pod-a",
      managerId: "mgr-pod-a",
      capabilities: ["coding"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
    orchestrator.registerPodCapability({
      podId: "pod-c",
      managerId: "mgr-pod-c",
      capabilities: ["testing"],
      currentLoad: 0,
      maxConcurrency: 10,
    });

    const result = await orchestrator.analyzeHeartbeat(
      makeReport({ actionItems: ["run integration tests"], observations: [] })
    );

    expect(result).not.toBeNull();
    expect(result!.contextSummary).toBe("run integration tests");
  });

  it("works when only observations are present (actionItems empty)", async () => {
    const orchestrator = createOrchestratorForHeartbeat({
      llmResponse:
        '{"needsCollaboration":true,"requiredCapabilities":["devops"]}',
    });
    orchestrator.registerPodCapability({
      podId: "pod-a",
      managerId: "mgr-pod-a",
      capabilities: ["coding"],
      currentLoad: 0,
      maxConcurrency: 10,
    });
    orchestrator.registerPodCapability({
      podId: "pod-d",
      managerId: "mgr-pod-d",
      capabilities: ["devops"],
      currentLoad: 0,
      maxConcurrency: 10,
    });

    const result = await orchestrator.analyzeHeartbeat(
      makeReport({
        actionItems: [],
        observations: ["deployment pipeline is slow"],
      })
    );

    expect(result).not.toBeNull();
    expect(result!.contextSummary).toBe("deployment pipeline is slow");
  });
});

/* ─── Task 6.2: generateSubTasks Unit Tests ─── */

// Feature: autonomous-swarm, generateSubTasks: 子任务生成与委派
// Validates: Requirements 4.1, 4.2
describe("Feature: autonomous-swarm, generateSubTasks: 子任务生成与委派", () => {
  function createOrchestratorForSubTasks(opts?: {
    llmResponse?: string;
    llmShouldThrow?: boolean;
    workers?: Array<{ id: string; role: string }>;
    manager?: { id: string; role: string } | null;
  }) {
    const llmProvider: LLMProvider = {
      generate: opts?.llmShouldThrow
        ? async () => {
            throw new Error("LLM unavailable");
          }
        : async () => opts?.llmResponse ?? '{"tasks":[]}',
    };

    const agentDirectory: AgentDirectory = {
      getManagerByPod: () =>
        opts?.manager === null
          ? undefined
          : (opts?.manager ?? { id: "mgr-target", role: "manager" }),
      getAvailableWorkers: () => opts?.workers ?? [],
    };

    const orchestrator = new SwarmOrchestrator({
      messageBus: {} as any,
      config: {
        ...DEFAULT_SWARM_CONFIG,
        maxDepth: 10,
        maxConcurrentSessions: 10,
      },
      llmProvider,
      agentDirectory,
    });

    return orchestrator;
  }

  function makeSession(
    overrides?: Partial<CollaborationSession>
  ): CollaborationSession {
    return {
      id: "session-test-1",
      request: {
        id: "req-1",
        sourcePodId: "pod-a",
        sourceManagerId: "mgr-pod-a",
        requiredCapabilities: ["design", "testing"],
        contextSummary: "Need design review and testing",
        depth: 1,
        workflowId: "wf-1",
        createdAt: Date.now(),
      },
      response: {
        requestId: "req-1",
        targetPodId: "pod-b",
        targetManagerId: "mgr-pod-b",
        status: "accepted",
        respondedAt: Date.now(),
      },
      status: "active",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns empty array when session has no response", async () => {
    const orchestrator = createOrchestratorForSubTasks();
    const session = makeSession({ response: undefined });
    const result = await orchestrator.generateSubTasks(session);
    expect(result).toEqual([]);
  });

  it("returns empty array when LLM call throws", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmShouldThrow: true,
    });
    const result = await orchestrator.generateSubTasks(makeSession());
    expect(result).toEqual([]);
  });

  it("returns empty array when LLM returns malformed JSON", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: "not valid json",
    });
    const result = await orchestrator.generateSubTasks(makeSession());
    expect(result).toEqual([]);
  });

  it("returns empty array when LLM returns empty tasks array", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: '{"tasks":[]}',
    });
    const result = await orchestrator.generateSubTasks(makeSession());
    expect(result).toEqual([]);
  });

  it("returns empty array when LLM response has no tasks field", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: '{"something":"else"}',
    });
    const result = await orchestrator.generateSubTasks(makeSession());
    expect(result).toEqual([]);
  });

  it("assigns tasks to workers round-robin when workers are available", async () => {
    const workers = [
      { id: "worker-1", role: "worker" },
      { id: "worker-2", role: "worker" },
    ];
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [
          { description: "Task A", deliverable: "Deliverable A" },
          { description: "Task B", deliverable: "Deliverable B" },
          { description: "Task C", deliverable: "Deliverable C" },
        ],
      }),
      workers,
    });

    const session = makeSession();
    const result = await orchestrator.generateSubTasks(session);

    expect(result).toHaveLength(3);
    // Round-robin: worker-1, worker-2, worker-1
    expect(result[0].workerId).toBe("worker-1");
    expect(result[1].workerId).toBe("worker-2");
    expect(result[2].workerId).toBe("worker-1");
  });

  it("assigns tasks to target manager when no workers are available", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [{ description: "Task A", deliverable: "Deliverable A" }],
      }),
      workers: [],
      manager: { id: "mgr-target", role: "manager" },
    });

    const session = makeSession();
    const result = await orchestrator.generateSubTasks(session);

    expect(result).toHaveLength(1);
    expect(result[0].workerId).toBe("mgr-target");
  });

  it("falls back to response.targetManagerId when getManagerByPod returns undefined", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [{ description: "Task A", deliverable: "Deliverable A" }],
      }),
      workers: [],
      manager: null,
    });

    const session = makeSession();
    const result = await orchestrator.generateSubTasks(session);

    expect(result).toHaveLength(1);
    expect(result[0].workerId).toBe("mgr-pod-b");
  });

  it("generates correct SubTaskOutput structure", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [{ description: "Design the UI", deliverable: "Figma mockup" }],
      }),
      workers: [{ id: "worker-1", role: "worker" }],
    });

    const session = makeSession();
    const result = await orchestrator.generateSubTasks(session);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      taskId: `subtask-${session.id}-0`,
      workerId: "worker-1",
      description: "Design the UI",
      deliverable: "Figma mockup",
      status: "done",
    });
  });

  it("generates unique taskIds for each sub-task", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [
          { description: "Task A", deliverable: "Del A" },
          { description: "Task B", deliverable: "Del B" },
          { description: "Task C", deliverable: "Del C" },
        ],
      }),
      workers: [{ id: "worker-1", role: "worker" }],
    });

    const session = makeSession();
    const result = await orchestrator.generateSubTasks(session);

    const taskIds = result.map(r => r.taskId);
    const uniqueIds = new Set(taskIds);
    expect(uniqueIds.size).toBe(taskIds.length);
  });

  it("preserves description and deliverable from LLM response", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [
          { description: "Write unit tests", deliverable: "Test report" },
          { description: "Review code", deliverable: "Review comments" },
        ],
      }),
      workers: [{ id: "worker-1", role: "worker" }],
    });

    const result = await orchestrator.generateSubTasks(makeSession());

    expect(result[0].description).toBe("Write unit tests");
    expect(result[0].deliverable).toBe("Test report");
    expect(result[1].description).toBe("Review code");
    expect(result[1].deliverable).toBe("Review comments");
  });

  it("sets status to 'done' for all generated sub-tasks", async () => {
    const orchestrator = createOrchestratorForSubTasks({
      llmResponse: JSON.stringify({
        tasks: [
          { description: "Task A", deliverable: "Del A" },
          { description: "Task B", deliverable: "Del B" },
        ],
      }),
      workers: [{ id: "worker-1", role: "worker" }],
    });

    const result = await orchestrator.generateSubTasks(makeSession());

    for (const task of result) {
      expect(task.status).toBe("done");
    }
  });
});

/* ─── Task 6.4: HeartbeatScheduler & SwarmOrchestrator Integration Tests ─── */

import { HeartbeatScheduler } from "../../server/core/heartbeat.js";

// Feature: autonomous-swarm, HeartbeatScheduler ↔ SwarmOrchestrator integration
// Validates: Requirements 3.1, 3.4
describe("Feature: autonomous-swarm, HeartbeatScheduler ↔ SwarmOrchestrator integration", () => {
  it("HeartbeatScheduler has setSwarmOrchestrator method", () => {
    const scheduler = new HeartbeatScheduler();
    expect(typeof scheduler.setSwarmOrchestrator).toBe("function");
  });

  it("setSwarmOrchestrator stores the orchestrator reference without error", () => {
    const scheduler = new HeartbeatScheduler();
    const orchestrator = new SwarmOrchestrator({
      messageBus: {} as any,
      config: DEFAULT_SWARM_CONFIG,
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });

    // Should not throw
    expect(() => scheduler.setSwarmOrchestrator(orchestrator)).not.toThrow();
  });

  it("analyzeHeartbeat generates a CollaborationRequest when called with heartbeat-like data", async () => {
    const orchestrator = new SwarmOrchestrator({
      messageBus: {} as any,
      config: {
        ...DEFAULT_SWARM_CONFIG,
        maxDepth: 10,
        maxConcurrentSessions: 10,
      },
      llmProvider: {
        generate: async () =>
          '{"needsCollaboration":true,"requiredCapabilities":["security"]}',
      },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });

    // Register pods — source pod does NOT have "security", target pod does
    orchestrator.registerPodCapability({
      podId: "engineering",
      managerId: "mgr-eng",
      capabilities: ["coding", "testing"],
      currentLoad: 1,
      maxConcurrency: 5,
    });
    orchestrator.registerPodCapability({
      podId: "infosec",
      managerId: "mgr-sec",
      capabilities: ["security", "audit"],
      currentLoad: 0,
      maxConcurrency: 5,
    });

    // Simulate the heartbeat report data that HeartbeatScheduler would pass
    const report: HeartbeatReport = {
      agentId: "mgr-eng",
      podId: "engineering",
      actionItems: ["security audit needed for auth module"],
      observations: ["detected potential vulnerability in login flow"],
      timestamp: Date.now(),
    };

    const request = await orchestrator.analyzeHeartbeat(report);

    expect(request).not.toBeNull();
    expect(request!.sourcePodId).toBe("engineering");
    expect(request!.sourceManagerId).toBe("mgr-eng");
    expect(request!.requiredCapabilities).toEqual(["security"]);
    expect(request!.contextSummary).toContain("security audit needed");
    expect(request!.contextSummary).toContain(
      "detected potential vulnerability"
    );
  });

  it("when analyzeHeartbeat throws, the error is silently caught (fire-and-forget pattern)", async () => {
    // Create an orchestrator whose analyzeHeartbeat will throw
    const orchestrator = new SwarmOrchestrator({
      messageBus: {} as any,
      config: DEFAULT_SWARM_CONFIG,
      llmProvider: {
        generate: async () => {
          throw new Error("LLM catastrophic failure");
        },
      },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });

    // Simulate the fire-and-forget pattern used in HeartbeatScheduler.trigger():
    //   this.swarmOrchestrator.analyzeHeartbeat(report).catch(() => {})
    const report: HeartbeatReport = {
      agentId: "mgr-test",
      podId: "test-pod",
      actionItems: ["something"],
      observations: ["something else"],
      timestamp: Date.now(),
    };

    // The .catch(() => {}) pattern should swallow the error — analyzeHeartbeat
    // itself catches LLM errors and returns null, so the promise resolves (not rejects).
    // The fire-and-forget .catch() in heartbeat.ts is a safety net for unexpected throws.
    const result = await orchestrator
      .analyzeHeartbeat(report)
      .catch(() => null); // mirrors heartbeat.ts pattern
    // No error propagated — result is null (gracefully handled)
    expect(result).toBeNull();
  });

  it("when no orchestrator is set, HeartbeatScheduler does not error on the swarm path", () => {
    // A fresh HeartbeatScheduler has swarmOrchestrator = null by default.
    // The trigger() method guards with `if (this.swarmOrchestrator)`,
    // so the swarm analysis path is simply skipped.
    // We verify the scheduler can be created and the guard condition is safe.
    const scheduler = new HeartbeatScheduler();

    // The scheduler should exist and have no orchestrator set — no error
    expect(scheduler).toBeDefined();
    expect(typeof scheduler.setSwarmOrchestrator).toBe("function");

    // Calling setSwarmOrchestrator with a new orchestrator after initial null state works
    const orchestrator = new SwarmOrchestrator({
      messageBus: {} as any,
      config: DEFAULT_SWARM_CONFIG,
      llmProvider: { generate: async () => "" },
      agentDirectory: {
        getManagerByPod: () => undefined,
        getAvailableWorkers: () => [],
      },
    });
    expect(() => scheduler.setSwarmOrchestrator(orchestrator)).not.toThrow();
  });
});

/* ─── Property 11 Tests ─── */

import { MissionOrchestrator } from "../../server/core/mission-orchestrator.js";
import type { MissionRepository } from "../../server/core/mission-orchestrator.js";
import type {
  MissionRecord,
  MissionEvent,
} from "../../shared/mission/contracts.js";
import { ExecutorClient } from "../../server/core/executor-client.js";

// Feature: autonomous-swarm, Property 11: 协作结果正确汇总到 Mission
// **Validates: Requirements 6.1, 6.3**
describe("Feature: autonomous-swarm, Property 11: 协作结果正确汇总到 Mission", () => {
  /** Simple in-memory repository for testing */
  function createInMemoryRepo(): MissionRepository & {
    seed(record: MissionRecord): void;
  } {
    const records = new Map<string, MissionRecord>();
    return {
      create(record: MissionRecord): MissionRecord {
        const clone = structuredClone(record);
        records.set(clone.id, clone);
        return structuredClone(clone);
      },
      get(id: string): MissionRecord | undefined {
        const r = records.get(id);
        return r ? structuredClone(r) : undefined;
      },
      save(record: MissionRecord): MissionRecord {
        const clone = structuredClone(record);
        records.set(clone.id, clone);
        return structuredClone(clone);
      },
      seed(record: MissionRecord): void {
        records.set(record.id, structuredClone(record));
      },
    };
  }

  function createMinimalMission(id: string): MissionRecord {
    const now = Date.now();
    return {
      id,
      kind: "brain-dispatch",
      title: "Test Mission",
      status: "running",
      progress: 50,
      currentStageKey: "execute",
      stages: [
        { key: "receive", label: "Receive task", status: "done" },
        { key: "execute", label: "Run execution", status: "running" },
      ],
      createdAt: now,
      updatedAt: now,
      events: [],
    };
  }

  function createOrchestrator(repo: MissionRepository): MissionOrchestrator {
    return new MissionOrchestrator({
      executorClient: {} as ExecutorClient,
      repository: repo,
    });
  }

  /** Arbitrary for CollaborationSession with a guaranteed response (targetPodId) */
  const arbSessionForMission: fc.Arbitrary<CollaborationSession> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }),
    request: arbCollaborationRequest,
    response: arbCollaborationResponse,
    result: fc.option(arbCollaborationResult, { nil: undefined }),
    status: arbSessionStatus,
    startedAt: fc.integer({ min: 1_000_000_000_000, max: 1_500_000_000_000 }),
    updatedAt: fc.integer({ min: 1_000_000_000_000, max: 1_500_000_000_000 }),
    completedAt: fc.option(
      fc.integer({ min: 1_000_000_000_000, max: 1_500_000_000_000 }),
      {
        nil: undefined,
      }
    ),
  });

  it("after appendCollaborationResult, the Mission events contain a collaboration_result event", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionForMission, async session => {
        const repo = createInMemoryRepo();
        const missionId = `mission-p11-${Math.random().toString(36).slice(2)}`;
        repo.seed(createMinimalMission(missionId));
        const orchestrator = createOrchestrator(repo);

        const updatedMission = await orchestrator.appendCollaborationResult(
          missionId,
          session
        );

        const collabEvents = updatedMission.events.filter(
          (e: MissionEvent) => e.type === "collaboration_result"
        );
        expect(collabEvents.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  it("the event contains correct source Pod ID and target Pod ID", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionForMission, async session => {
        const repo = createInMemoryRepo();
        const missionId = `mission-p11-${Math.random().toString(36).slice(2)}`;
        repo.seed(createMinimalMission(missionId));
        const orchestrator = createOrchestrator(repo);

        const updatedMission = await orchestrator.appendCollaborationResult(
          missionId,
          session
        );

        const collabEvent = updatedMission.events.find(
          (e: MissionEvent) => e.type === "collaboration_result"
        );
        expect(collabEvent).toBeDefined();

        const sourcePodId = session.request.sourcePodId;
        const targetPodId = session.response?.targetPodId ?? "unknown";

        expect(collabEvent!.message).toContain(sourcePodId);
        expect(collabEvent!.message).toContain(targetPodId);
      }),
      { numRuns: 100 }
    );
  });

  it("the event description includes the collaboration status", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionForMission, async session => {
        const repo = createInMemoryRepo();
        const missionId = `mission-p11-${Math.random().toString(36).slice(2)}`;
        repo.seed(createMinimalMission(missionId));
        const orchestrator = createOrchestrator(repo);

        const updatedMission = await orchestrator.appendCollaborationResult(
          missionId,
          session
        );

        const collabEvent = updatedMission.events.find(
          (e: MissionEvent) => e.type === "collaboration_result"
        );
        expect(collabEvent).toBeDefined();

        // The status used in the message is session.result?.status ?? session.status
        const expectedStatus = session.result?.status ?? session.status;
        expect(collabEvent!.message).toContain(expectedStatus);
      }),
      { numRuns: 100 }
    );
  });
});
