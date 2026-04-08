import type {
  A2AEnvelope,
  A2AResponse,
  A2AStreamChunk,
} from "../../shared/a2a-protocol";
import { A2A_ERROR_CODES } from "../../shared/a2a-protocol";

export interface ExposedAgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  description: string;
}

export interface AgentExecutor {
  execute(agentId: string, task: string, context: string): Promise<string>;
  executeStream(
    agentId: string,
    task: string,
    context: string,
  ): AsyncGenerator<string>;
}

export interface A2AServerOptions {
  apiKeys?: string[]; // defaults to parsing A2A_API_KEYS env var
  rateLimitPerMinute?: number; // default 60
  agentExecutor: AgentExecutor;
  exposedAgents: ExposedAgentInfo[];
}

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

export class A2AServer {
  private apiKeys: Set<string>;
  private rateLimitPerMinute: number;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private agentExecutor: AgentExecutor;
  private exposedAgents: ExposedAgentInfo[];

  constructor(options: A2AServerOptions) {
    const envKeys = (process.env.A2A_API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.apiKeys = new Set([...envKeys, ...(options.apiKeys ?? [])]);
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 60;
    this.agentExecutor = options.agentExecutor;
    this.exposedAgents = options.exposedAgents;
  }

  validateApiKey(key: string): boolean {
    return this.apiKeys.has(key);
  }

  checkRateLimit(key: string): {
    allowed: boolean;
    retryAfterSeconds?: number;
  } {
    const now = Date.now();
    const windowMs = 60_000;
    let entry = this.rateLimits.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { windowStart: now, count: 0 };
      this.rateLimits.set(key, entry);
    }

    entry.count++;

    if (entry.count > this.rateLimitPerMinute) {
      const retryAfterSeconds = Math.ceil(
        (entry.windowStart + windowMs - now) / 1000,
      );
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true };
  }

  async handleInvoke(
    envelope: A2AEnvelope,
    apiKey: string,
  ): Promise<A2AResponse> {
    if (!this.validateApiKey(apiKey)) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AUTH_FAILED,
          message: "Invalid API key",
        },
      };
    }

    const rateCheck = this.checkRateLimit(apiKey);
    if (!rateCheck.allowed) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.RATE_LIMITED,
          message: `Rate limit exceeded. Retry after ${rateCheck.retryAfterSeconds} seconds`,
          data: { retryAfter: rateCheck.retryAfterSeconds },
        },
      };
    }

    const agent = this.exposedAgents.find(
      (a) => a.id === envelope.params.targetAgent,
    );
    if (!agent) {
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AGENT_NOT_FOUND,
          message: `Agent "${envelope.params.targetAgent}" not found`,
        },
      };
    }

    try {
      const output = await this.agentExecutor.execute(
        agent.id,
        envelope.params.task,
        envelope.params.context,
      );
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        result: { output, artifacts: [], metadata: {} },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message },
      };
    }
  }

  async *handleStream(
    envelope: A2AEnvelope,
    apiKey: string,
  ): AsyncGenerator<A2AStreamChunk | A2AResponse> {
    if (!this.validateApiKey(apiKey)) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AUTH_FAILED,
          message: "Invalid API key",
        },
      } as A2AResponse;
      return;
    }

    const rateCheck = this.checkRateLimit(apiKey);
    if (!rateCheck.allowed) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.RATE_LIMITED,
          message: "Rate limit exceeded",
          data: { retryAfter: rateCheck.retryAfterSeconds },
        },
      } as A2AResponse;
      return;
    }

    const agent = this.exposedAgents.find(
      (a) => a.id === envelope.params.targetAgent,
    );
    if (!agent) {
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: {
          code: A2A_ERROR_CODES.AGENT_NOT_FOUND,
          message: `Agent "${envelope.params.targetAgent}" not found`,
        },
      } as A2AResponse;
      return;
    }

    try {
      const stream = this.agentExecutor.executeStream(
        agent.id,
        envelope.params.task,
        envelope.params.context,
      );
      for await (const text of stream) {
        yield { jsonrpc: "2.0", id: envelope.id, chunk: text, done: false };
      }
      yield { jsonrpc: "2.0", id: envelope.id, chunk: "", done: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      yield {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.INTERNAL_ERROR, message },
      } as A2AResponse;
    }
  }

  async handleCancel(
    sessionId: string,
    apiKey: string,
  ): Promise<A2AResponse> {
    if (!this.validateApiKey(apiKey)) {
      return {
        jsonrpc: "2.0",
        id: sessionId,
        error: {
          code: A2A_ERROR_CODES.AUTH_FAILED,
          message: "Invalid API key",
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: sessionId,
      result: { output: "cancelled", artifacts: [], metadata: {} },
    };
  }

  listExposedAgents(): ExposedAgentInfo[] {
    return [...this.exposedAgents];
  }
}
