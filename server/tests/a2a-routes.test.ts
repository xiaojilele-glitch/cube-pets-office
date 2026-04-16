/**
 * Unit tests for A2A API routes (server/routes/a2a.ts).
 *
 * Tests 401 (invalid token), 404 (agent not found), 429 (rate limited),
 * 500 (internal error), successful A2AResponse, and SSE stream format.
 *
 * Validates: Requirements 3.1, 3.6, 3.7, 5.4
 */
import { describe, it, expect, beforeAll } from "vitest";
import { A2A_ERROR_CODES, createEnvelope } from "../../shared/a2a-protocol";
import { A2AServer, type AgentExecutor } from "../core/a2a-server";
import { A2AClient } from "../core/a2a-client";

// ─── Shared fixtures ─────────────────────────────────────────────────

const VALID_KEY = "test-api-key";

const mockExecutor: AgentExecutor = {
  execute: async () => "mock output",
  executeStream: async function* () {
    yield "chunk1";
    yield "chunk2";
  },
};

const failingExecutor: AgentExecutor = {
  execute: async () => {
    throw new Error("executor boom");
  },
  executeStream: async function* () {
    throw new Error("stream boom");
  },
};

function makeEnvelope(targetAgent = "agent-1", streamMode = false) {
  return createEnvelope(streamMode ? "a2a.stream" : "a2a.invoke", {
    targetAgent,
    task: "do something",
    context: "some context",
    capabilities: [],
    streamMode,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("A2A API Route Unit Tests", () => {
  // ── 401: Invalid / missing token ────────────────────────────────────

  describe("401 – AUTH_FAILED", () => {
    it("handleInvoke returns AUTH_FAILED for an invalid API key", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: ["test"],
            description: "Test agent",
          },
        ],
      });

      const envelope = makeEnvelope();
      const result = await server.handleInvoke(envelope, "wrong-key");

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(A2A_ERROR_CODES.AUTH_FAILED);
      expect(result.error!.message).toMatch(/Invalid/i);
    });

    it("handleInvoke returns AUTH_FAILED for an empty API key", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const result = await server.handleInvoke(makeEnvelope(), "");
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(A2A_ERROR_CODES.AUTH_FAILED);
    });

    it("handleStream yields AUTH_FAILED for invalid key", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope("agent-1", true);
      const chunks: unknown[] = [];
      for await (const c of server.handleStream(envelope, "bad-key")) {
        chunks.push(c);
      }

      expect(chunks).toHaveLength(1);
      const first = chunks[0] as { error?: { code: number } };
      expect(first.error).toBeDefined();
      expect(first.error!.code).toBe(A2A_ERROR_CODES.AUTH_FAILED);
    });
  });

  // ── 404: Agent not found ────────────────────────────────────────────

  describe("404 – AGENT_NOT_FOUND", () => {
    it("handleInvoke returns AGENT_NOT_FOUND for non-existent agent", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope("no-such-agent");
      const result = await server.handleInvoke(envelope, VALID_KEY);

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(A2A_ERROR_CODES.AGENT_NOT_FOUND);
      expect(result.error!.message).toContain("no-such-agent");
    });

    it("handleStream yields AGENT_NOT_FOUND for non-existent agent", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope("ghost-agent", true);
      const chunks: unknown[] = [];
      for await (const c of server.handleStream(envelope, VALID_KEY)) {
        chunks.push(c);
      }

      expect(chunks).toHaveLength(1);
      const first = chunks[0] as { error?: { code: number } };
      expect(first.error!.code).toBe(A2A_ERROR_CODES.AGENT_NOT_FOUND);
    });
  });

  // ── 429: Rate limited ──────────────────────────────────────────────

  describe("429 – RATE_LIMITED", () => {
    it("handleInvoke returns RATE_LIMITED after exceeding rate limit", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 2,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope();

      // First two should succeed
      const r1 = await server.handleInvoke(envelope, VALID_KEY);
      expect(r1.error).toBeUndefined();
      const r2 = await server.handleInvoke(envelope, VALID_KEY);
      expect(r2.error).toBeUndefined();

      // Third should be rate limited
      const r3 = await server.handleInvoke(envelope, VALID_KEY);
      expect(r3.error).toBeDefined();
      expect(r3.error!.code).toBe(A2A_ERROR_CODES.RATE_LIMITED);
      expect(r3.error!.data).toHaveProperty("retryAfter");
    });

    it("handleStream yields RATE_LIMITED after exceeding rate limit", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 1,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      // Exhaust the limit
      await server.handleInvoke(makeEnvelope(), VALID_KEY);

      // Stream should be rate limited
      const envelope = makeEnvelope("agent-1", true);
      const chunks: unknown[] = [];
      for await (const c of server.handleStream(envelope, VALID_KEY)) {
        chunks.push(c);
      }

      expect(chunks).toHaveLength(1);
      const first = chunks[0] as { error?: { code: number } };
      expect(first.error!.code).toBe(A2A_ERROR_CODES.RATE_LIMITED);
    });
  });

  // ── 500: Internal error ────────────────────────────────────────────

  describe("500 – INTERNAL_ERROR", () => {
    it("handleInvoke returns INTERNAL_ERROR when executor throws", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: failingExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const result = await server.handleInvoke(makeEnvelope(), VALID_KEY);

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(A2A_ERROR_CODES.INTERNAL_ERROR);
      expect(result.error!.message).toContain("executor boom");
    });

    it("handleStream yields INTERNAL_ERROR when executor throws", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: failingExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope("agent-1", true);
      const chunks: unknown[] = [];
      for await (const c of server.handleStream(envelope, VALID_KEY)) {
        chunks.push(c);
      }

      // Should get an error chunk
      const errorChunk = chunks.find(
        c => (c as any).error?.code === A2A_ERROR_CODES.INTERNAL_ERROR
      );
      expect(errorChunk).toBeDefined();
    });
  });

  // ── Successful invoke ──────────────────────────────────────────────

  describe("Successful A2AResponse", () => {
    it("handleInvoke returns result with output for valid request", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: ["test"],
            description: "Test agent",
          },
        ],
      });

      const envelope = makeEnvelope();
      const result = await server.handleInvoke(envelope, VALID_KEY);

      expect(result.error).toBeUndefined();
      expect(result.result).toBeDefined();
      expect(result.result!.output).toBe("mock output");
      expect(result.result!.artifacts).toEqual([]);
      expect(result.result!.metadata).toEqual({});
      expect(result.jsonrpc).toBe("2.0");
      expect(result.id).toBe(envelope.id);
    });
  });

  // ── SSE stream format ──────────────────────────────────────────────

  describe("SSE stream response format", () => {
    it("handleStream yields data chunks followed by done=true terminator", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope("agent-1", true);
      const chunks: unknown[] = [];
      for await (const c of server.handleStream(envelope, VALID_KEY)) {
        chunks.push(c);
      }

      // At least one data chunk + done chunk
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // All non-terminal chunks have done=false and non-empty chunk text
      const dataChunks = chunks.filter(c => !(c as any).done);
      for (const dc of dataChunks) {
        const typed = dc as {
          jsonrpc: string;
          id: string;
          chunk: string;
          done: boolean;
        };
        expect(typed.jsonrpc).toBe("2.0");
        expect(typed.done).toBe(false);
        expect(typed.chunk.length).toBeGreaterThan(0);
      }

      // Last chunk is the done sentinel
      const last = chunks[chunks.length - 1] as {
        done: boolean;
        chunk: string;
      };
      expect(last.done).toBe(true);
      expect(last.chunk).toBe("");
    });

    it("each stream chunk can be serialized as SSE data line", async () => {
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: [
          {
            id: "agent-1",
            name: "Test",
            capabilities: [],
            description: "Test",
          },
        ],
      });

      const envelope = makeEnvelope("agent-1", true);
      const sseLines: string[] = [];
      for await (const chunk of server.handleStream(envelope, VALID_KEY)) {
        // Simulate the SSE formatting the route does: `data: ${JSON.stringify(chunk)}\n\n`
        const line = `data: ${JSON.stringify(chunk)}\n\n`;
        sseLines.push(line);

        // Each line must start with "data: " and be valid JSON after that prefix
        expect(line.startsWith("data: ")).toBe(true);
        const jsonPart = line.slice(6).trim();
        expect(() => JSON.parse(jsonPart)).not.toThrow();
      }

      expect(sseLines.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Agents & Sessions endpoints ────────────────────────────────────

  describe("Agents and Sessions endpoints", () => {
    it("listExposedAgents returns all configured agents with required fields", () => {
      const agents = [
        {
          id: "a1",
          name: "Alpha",
          capabilities: ["code"],
          description: "Alpha agent",
        },
        {
          id: "a2",
          name: "Beta",
          capabilities: ["review", "test"],
          description: "Beta agent",
        },
      ];
      const server = new A2AServer({
        apiKeys: [VALID_KEY],
        rateLimitPerMinute: 60,
        agentExecutor: mockExecutor,
        exposedAgents: agents,
      });

      const listed = server.listExposedAgents();
      expect(listed).toHaveLength(2);
      for (const agent of listed) {
        expect(agent).toHaveProperty("id");
        expect(agent).toHaveProperty("name");
        expect(agent).toHaveProperty("capabilities");
        expect(agent).toHaveProperty("description");
      }
      expect(listed).toEqual(agents);
    });

    it("getActiveSessions returns empty array for fresh client", () => {
      const client = new A2AClient();
      const sessions = client.getActiveSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions).toHaveLength(0);
    });
  });
});
