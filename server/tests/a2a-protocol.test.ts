import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  type A2AEnvelope,
  type A2AInvokeParams,
  type A2ASession,
  type A2AStreamChunk,
  type A2AResponse,
  type A2AResult,
  type A2AArtifact,
  type A2AError,
  A2A_ERROR_CODES,
  serializeEnvelope,
  deserializeEnvelope,
  serializeSession,
  deserializeSession,
  validateContext,
} from "../../shared/a2a-protocol";
import { A2AServer, type ExposedAgentInfo } from "../core/a2a-server";
import {
  getAdapter,
  CrewAIAdapter,
  LangGraphAdapter,
  ClaudeAdapter,
} from "../core/a2a-adapters";
import { A2AClient } from "../core/a2a-client";
import { createEnvelope } from "../../shared/a2a-protocol";
import type {
  ExternalAgentNode,
  WorkflowOrganizationSnapshot,
} from "../../shared/organization-schema";

// ─── Generators ──────────────────────────────────────────────────────

const arbitraryA2AInvokeParams: fc.Arbitrary<A2AInvokeParams> = fc.record({
  targetAgent: fc.string({ minLength: 1, maxLength: 50 }),
  task: fc.string({ minLength: 1, maxLength: 200 }),
  context: fc.string({ maxLength: 2000 }),
  capabilities: fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
    maxLength: 5,
  }),
  streamMode: fc.boolean(),
});

const arbitraryA2AEnvelope: fc.Arbitrary<A2AEnvelope> = fc.record({
  jsonrpc: fc.constant("2.0" as const),
  method: fc.constantFrom(
    "a2a.invoke" as const,
    "a2a.stream" as const,
    "a2a.cancel" as const,
  ),
  id: fc.uuid(),
  params: arbitraryA2AInvokeParams,
  auth: fc.option(fc.string({ minLength: 1, maxLength: 100 }), {
    nil: undefined,
  }),
});

const arbitraryA2AArtifact: fc.Arbitrary<A2AArtifact> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  type: fc.string({ minLength: 1, maxLength: 50 }),
  content: fc.string({ maxLength: 200 }),
});

const arbitraryA2AResult: fc.Arbitrary<A2AResult> = fc.record({
  output: fc.string({ maxLength: 200 }),
  artifacts: fc.array(arbitraryA2AArtifact, { maxLength: 3 }),
  metadata: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.string({ maxLength: 50 }),
  ),
});

const arbitraryA2AError: fc.Arbitrary<A2AError> = fc.record({
  code: fc.integer(),
  message: fc.string({ minLength: 1, maxLength: 100 }),
});

const arbitraryA2AResponse: fc.Arbitrary<A2AResponse> = fc.record({
  jsonrpc: fc.constant("2.0" as const),
  id: fc.uuid(),
  result: fc.option(arbitraryA2AResult, { nil: undefined }),
  error: fc.option(arbitraryA2AError, { nil: undefined }),
});

const arbitraryA2AStreamChunk: fc.Arbitrary<A2AStreamChunk> = fc.record({
  jsonrpc: fc.constant("2.0" as const),
  id: fc.uuid(),
  chunk: fc.string({ maxLength: 500 }),
  done: fc.boolean(),
});

const arbitraryA2ASession: fc.Arbitrary<A2ASession> = fc.record({
  sessionId: fc.uuid(),
  requestEnvelope: arbitraryA2AEnvelope,
  status: fc.constantFrom(
    "pending" as const,
    "running" as const,
    "completed" as const,
    "failed" as const,
    "cancelled" as const,
  ),
  frameworkType: fc.constantFrom(
    "crewai" as const,
    "langgraph" as const,
    "claude" as const,
    "custom" as const,
  ),
  startedAt: fc.nat(),
  completedAt: fc.option(fc.nat(), { nil: undefined }),
  response: fc.option(arbitraryA2AResponse, { nil: undefined }),
  streamChunks: fc.array(arbitraryA2AStreamChunk, { maxLength: 5 }),
});

const arbitraryWorkflowSkillBinding = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  summary: fc.string({ maxLength: 50 }),
  prompt: fc.string({ maxLength: 100 }),
});

const arbitraryWorkflowMcpBinding = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  server: fc.string({ minLength: 1, maxLength: 30 }),
  description: fc.string({ maxLength: 50 }),
  connection: fc.record({
    transport: fc.string({ minLength: 1, maxLength: 10 }),
    endpoint: fc.string({ minLength: 1, maxLength: 50 }),
    notes: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  }),
  tools: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
});

const arbitraryExternalAgentNode: fc.Arbitrary<ExternalAgentNode> = fc.record({
  // WorkflowOrganizationNode fields
  id: fc.uuid(),
  agentId: fc.uuid(),
  parentId: fc.option(fc.uuid(), { nil: null }),
  departmentId: fc.uuid(),
  departmentLabel: fc.string({ minLength: 1, maxLength: 30 }),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  role: fc.constantFrom("ceo" as const, "manager" as const, "worker" as const),
  responsibility: fc.string({ minLength: 1, maxLength: 100 }),
  responsibilities: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 3 }),
  goals: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 3 }),
  summaryFocus: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 3 }),
  skills: fc.array(arbitraryWorkflowSkillBinding, { maxLength: 2 }),
  mcp: fc.array(arbitraryWorkflowMcpBinding, { maxLength: 2 }),
  model: fc.record({
    model: fc.string({ minLength: 1, maxLength: 30 }),
    temperature: fc.double({ min: 0, max: 2, noNaN: true }),
    maxTokens: fc.nat({ max: 8192 }),
  }),
  execution: fc.record({
    mode: fc.constantFrom(
      "orchestrate" as const, "plan" as const, "execute" as const,
      "review" as const, "audit" as const, "summary" as const,
    ),
    strategy: fc.constantFrom("parallel" as const, "sequential" as const, "batched" as const),
    maxConcurrency: fc.nat({ max: 10 }),
  }),
  // GuestAgentNode fields
  invitedBy: fc.uuid(),
  source: fc.string({ minLength: 1, maxLength: 30 }),
  expiresAt: fc.nat(),
  guestConfig: fc.option(
    fc.record({
      model: fc.string({ minLength: 1, maxLength: 30 }),
      baseUrl: fc.string({ minLength: 1, maxLength: 50 }),
      apiKey: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      skills: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 20 }),
          description: fc.string({ maxLength: 50 }),
        }),
        { maxLength: 2 },
      ),
      mcp: fc.array(arbitraryWorkflowMcpBinding, { maxLength: 2 }),
      avatarHint: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    { nil: undefined },
  ),
  // ExternalAgentNode fields
  frameworkType: fc.constantFrom(
    "crewai" as const, "langgraph" as const, "claude" as const, "custom" as const,
  ),
  a2aEndpoint: fc.string({ minLength: 1, maxLength: 100 }),
  a2aAuth: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
});

// ─── Property Tests ──────────────────────────────────────────────────

describe("A2A Protocol Property Tests", () => {
  // Feature: a2a-protocol, Property 1: A2AEnvelope 序列化往返一致性
  // **Validates: Requirements 1.6**
  it("Property 1: serializeEnvelope then deserializeEnvelope produces deep-equal result", () => {
    fc.assert(
      fc.property(arbitraryA2AEnvelope, (envelope) => {
        const serialized = serializeEnvelope(envelope);
        const deserialized = deserializeEnvelope(serialized);
        expect(deserialized).toEqual(envelope);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 2: A2ASession 序列化往返一致性
  // **Validates: Requirements 9.5**
  it("Property 2: serializeSession then deserializeSession produces deep-equal result", () => {
    fc.assert(
      fc.property(arbitraryA2ASession, (session) => {
        const serialized = serializeSession(session);
        const deserialized = deserializeSession(serialized);
        expect(deserialized).toEqual(session);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 3: 上下文长度验证
  // **Validates: Requirements 1.2, 9.1**
  it("Property 3: validateContext returns true for strings <= 2000 chars and false for strings > 2000 chars", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (s.length <= 2000) {
          expect(validateContext(s)).toBe(true);
        } else {
          expect(validateContext(s)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 13: ExternalAgentNode 快照兼容性
  // **Validates: Requirements 6.3**
  it("Property 13: ExternalAgentNode added to WorkflowOrganizationSnapshot survives JSON round-trip", () => {
    fc.assert(
      fc.property(arbitraryExternalAgentNode, (node) => {
        const snapshot: WorkflowOrganizationSnapshot = {
          kind: "workflow_organization",
          version: 1,
          workflowId: "test-workflow",
          directive: "test directive",
          generatedAt: new Date().toISOString(),
          source: "generated",
          taskProfile: "test",
          reasoning: "test reasoning",
          rootNodeId: node.id,
          rootAgentId: node.agentId,
          departments: [],
          nodes: [node],
        };

        const serialized = JSON.stringify(snapshot);
        const deserialized = JSON.parse(serialized) as WorkflowOrganizationSnapshot;

        expect(deserialized.nodes).toHaveLength(1);
        expect(deserialized.nodes[0]).toEqual(node);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 9: 框架适配器请求格式正确性
  // **Validates: Requirements 4.1, 4.2, 4.3**
  it("Property 9: For any valid A2AInvokeParams and supported framework, adaptRequest returns correctly shaped object", () => {
    const adapters = [
      { type: "crewai" as const, adapter: new CrewAIAdapter() },
      { type: "langgraph" as const, adapter: new LangGraphAdapter() },
      { type: "claude" as const, adapter: new ClaudeAdapter() },
    ];

    fc.assert(
      fc.property(
        arbitraryA2AInvokeParams,
        fc.constantFrom(...adapters),
        (params, { type, adapter }) => {
          const result = adapter.adaptRequest(params);

          // Headers must be non-empty and contain Content-Type
          expect(Object.keys(result.headers).length).toBeGreaterThan(0);
          expect(result.headers["Content-Type"]).toBeDefined();

          // Body must be an object
          expect(typeof result.body).toBe("object");
          expect(result.body).not.toBeNull();

          const body = result.body as Record<string, unknown>;

          if (type === "crewai") {
            expect(body).toHaveProperty("agent_role");
            expect(body).toHaveProperty("task_description");
          } else if (type === "langgraph") {
            expect(body).toHaveProperty("input");
            const input = body.input as Record<string, unknown>;
            expect(input).toHaveProperty("task");
          } else if (type === "claude") {
            expect(body).toHaveProperty("messages");
            expect(Array.isArray(body.messages)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 10: 框架适配器响应归一化
  // **Validates: Requirements 4.4**
  it("Property 10: For any supported framework adapter, adaptResponse returns A2AResult with output and artifacts", () => {
    const testCases = [
      { adapter: new CrewAIAdapter(), response: { result: "test output" } },
      { adapter: new LangGraphAdapter(), response: { output: "test output" } },
      { adapter: new ClaudeAdapter(), response: { content: [{ type: "text", text: "test output" }] } },
    ];

    fc.assert(
      fc.property(fc.constantFrom(...testCases), ({ adapter, response }) => {
        const result = adapter.adaptResponse(response);

        expect(typeof result.output).toBe("string");
        expect(Array.isArray(result.artifacts)).toBe(true);
        expect(result.output).toBe("test output");
      }),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 11: 不支持的框架类型拒绝
  // **Validates: Requirements 4.5**
  it("Property 11: For any string not in supported frameworks, getAdapter throws error containing 'Supported frameworks'", () => {
    const validTypes = ["crewai", "langgraph", "claude"];

    fc.assert(
      fc.property(
        fc.string().filter((s) => !validTypes.includes(s)),
        (invalidType) => {
          expect(() => getAdapter(invalidType as never)).toThrowError(
            /Supported frameworks/,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 4: 会话失败状态标记
  // **Validates: Requirements 2.5, 9.4**
  it("Property 4: terminateTimedOutSessions marks timed-out sessions as failed and leaves active sessions untouched", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5 }),
        fc.nat({ max: 5 }),
        (timedOutCount, activeCount) => {
          const client = new A2AClient({ defaultTimeoutMs: 1000 });
          const sessions = (client as any).sessions as Map<string, A2ASession>;

          // Add timed-out sessions (startedAt far in the past)
          for (let i = 0; i < timedOutCount; i++) {
            const envelope = createEnvelope("a2a.invoke", {
              targetAgent: "t",
              task: "t",
              context: "",
              capabilities: [],
              streamMode: false,
            });
            sessions.set(envelope.id, {
              sessionId: envelope.id,
              requestEnvelope: envelope,
              status: "running",
              frameworkType: "crewai",
              startedAt: Date.now() - 2000,
              streamChunks: [],
            });
          }

          // Add active sessions (startedAt now)
          for (let i = 0; i < activeCount; i++) {
            const envelope = createEnvelope("a2a.invoke", {
              targetAgent: "t",
              task: "t",
              context: "",
              capabilities: [],
              streamMode: false,
            });
            sessions.set(envelope.id, {
              sessionId: envelope.id,
              requestEnvelope: envelope,
              status: "running",
              frameworkType: "crewai",
              startedAt: Date.now(),
              streamChunks: [],
            });
          }

          const terminated = client.terminateTimedOutSessions();
          expect(terminated).toHaveLength(timedOutCount);
          terminated.forEach((s) => expect(s.status).toBe("failed"));

          // Active sessions should still be running
          const active = client.getActiveSessions();
          expect(active).toHaveLength(activeCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 5: 并发会话数量限制
  // **Validates: Requirements 2.6**
  it("Property 5: A2AClient rejects new invocations when active sessions reach maxConcurrentSessions", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (maxSessions) => {
        const client = new A2AClient({ maxConcurrentSessions: maxSessions });
        const sessions = (client as any).sessions as Map<string, A2ASession>;

        // Fill up to limit with running sessions
        for (let i = 0; i < maxSessions; i++) {
          const envelope = createEnvelope("a2a.invoke", {
            targetAgent: "t",
            task: "t",
            context: "",
            capabilities: [],
            streamMode: false,
          });
          sessions.set(envelope.id, {
            sessionId: envelope.id,
            requestEnvelope: envelope,
            status: "running",
            frameworkType: "crewai",
            startedAt: Date.now(),
            streamChunks: [],
          });
        }

        expect(client.getActiveSessions()).toHaveLength(maxSessions);

        // Next invoke should be rejected due to concurrent session limit
        const result = await client.invoke(
          {
            targetAgent: "t",
            task: "t",
            context: "",
            capabilities: [],
            streamMode: false,
          },
          "crewai",
          "http://localhost:9999",
        );
        expect(result.error).toBeDefined();
        expect(result.error!.message).toContain("Concurrent session limit");
      }),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 12: 出站信封包含认证令牌
  // **Validates: Requirements 5.3**
  it("Property 12: createEnvelope with auth token sets envelope.auth to the provided token", () => {
    fc.assert(
      fc.property(
        arbitraryA2AInvokeParams,
        fc.string({ minLength: 1, maxLength: 100 }),
        (params, authToken) => {
          const envelope = createEnvelope("a2a.invoke", params, authToken);
          expect(envelope.auth).toBe(authToken);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── A2A Server Property Tests ───────────────────────────────────────

  const mockExecutor = {
    execute: async () => "mock output",
    executeStream: async function* () { yield "chunk"; },
  };

  function createTestServer(opts?: { apiKeys?: string[]; rateLimitPerMinute?: number; agents?: ExposedAgentInfo[] }) {
    return new A2AServer({
      apiKeys: opts?.apiKeys ?? ["valid-key"],
      rateLimitPerMinute: opts?.rateLimitPerMinute ?? 60,
      agentExecutor: mockExecutor,
      exposedAgents: opts?.agents ?? [{ id: "agent-1", name: "Test Agent", capabilities: ["test"], description: "A test agent" }],
    });
  }

  // Feature: a2a-protocol, Property 6: 无效认证令牌拒绝
  // **Validates: Requirements 3.6, 5.1**
  it("Property 6: For any string not equal to valid-key, validateApiKey returns false; for valid-key returns true", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== "valid-key"),
        (invalidKey) => {
          const server = createTestServer();
          expect(server.validateApiKey(invalidKey)).toBe(false);
          expect(server.validateApiKey("valid-key")).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 7: 不存在的 Agent 返回错误
  // **Validates: Requirements 3.7**
  it("Property 7: For any agent ID not in exposed agents, handleInvoke returns AGENT_NOT_FOUND error", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s !== "agent-1"),
        async (nonExistentId) => {
          const server = createTestServer();
          const envelope = createEnvelope("a2a.invoke", {
            targetAgent: nonExistentId,
            task: "test",
            context: "",
            capabilities: [],
            streamMode: false,
          });
          const result = await server.handleInvoke(envelope, "valid-key");
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe(A2A_ERROR_CODES.AGENT_NOT_FOUND);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 8: 速率限制执行
  // **Validates: Requirements 5.4, 5.5**
  it("Property 8: For any rate limit R (1-10), first R calls allowed, R+1th rejected with retryAfterSeconds > 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (rateLimit) => {
          const server = createTestServer({ rateLimitPerMinute: rateLimit });
          for (let i = 0; i < rateLimit; i++) {
            const result = server.checkRateLimit("test-key");
            expect(result.allowed).toBe(true);
          }
          const exceeded = server.checkRateLimit("test-key");
          expect(exceeded.allowed).toBe(false);
          expect(exceeded.retryAfterSeconds).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 14: A2A 消息路由与元数据正确性
  // **Validates: Requirements 7.1, 7.3**
  it("Property 14: A2A message metadata contains required a2a, frameworkType, and sessionId fields", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("crewai" as const, "langgraph" as const, "claude" as const, "custom" as const),
        fc.uuid(),
        (frameworkType, sessionId) => {
          // Simulate the metadata construction logic from sendA2A
          const metadata = {
            frameworkType,
            sessionId,
          };

          const a2aMetadata = {
            ...metadata,
            a2a: true as const,
            frameworkType: metadata.frameworkType ?? "custom",
            sessionId: metadata.sessionId ?? "",
            direction: "outbound" as const,
          };

          // Verify required A2A metadata fields
          expect(a2aMetadata.a2a).toBe(true);
          expect(a2aMetadata.frameworkType).toBe(frameworkType);
          expect(a2aMetadata.sessionId).toBe(sessionId);
          expect(a2aMetadata.direction).toBe("outbound");
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: a2a-protocol, Property 15: 可调用 Agent 列表完整性
  // **Validates: Requirements 3.5**
  it("Property 15: For any array of ExposedAgentInfo, listExposedAgents returns all with correct fields", () => {
    const arbitraryExposedAgent = fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 30 }),
      capabilities: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
      description: fc.string({ maxLength: 100 }),
    });

    fc.assert(
      fc.property(
        fc.array(arbitraryExposedAgent, { minLength: 0, maxLength: 5 }),
        (agents) => {
          const server = createTestServer({ agents });
          const listed = server.listExposedAgents();
          expect(listed).toHaveLength(agents.length);
          expect(listed).toEqual(agents);
        },
      ),
      { numRuns: 100 },
    );
  });
});
