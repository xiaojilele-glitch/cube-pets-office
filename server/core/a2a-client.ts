import type {
  A2AFrameworkType,
  A2AInvokeParams,
  A2AResponse,
  A2ASession,
  A2AStreamChunk,
} from "../../shared/a2a-protocol";
import { createEnvelope, A2A_ERROR_CODES } from "../../shared/a2a-protocol";
import { getAdapter } from "./a2a-adapters";

export interface A2AClientOptions {
  maxConcurrentSessions?: number; // default 10
  defaultTimeoutMs?: number; // default 60000
}

export class A2AClient {
  private sessions: Map<string, A2ASession> = new Map();
  private maxConcurrentSessions: number;
  private defaultTimeoutMs: number;

  constructor(options: A2AClientOptions = {}) {
    this.maxConcurrentSessions = options.maxConcurrentSessions ?? 10;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60000;
  }

  async invoke(
    params: A2AInvokeParams,
    frameworkType: A2AFrameworkType,
    endpoint: string,
    auth?: string
  ): Promise<A2AResponse> {
    // Check concurrent session limit
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length >= this.maxConcurrentSessions) {
      return {
        jsonrpc: "2.0",
        id: "",
        error: {
          code: A2A_ERROR_CODES.INVALID_PARAMS,
          message: `Concurrent session limit reached (${this.maxConcurrentSessions})`,
        },
      };
    }

    // Truncate context to 2000 chars
    const truncatedParams: A2AInvokeParams = {
      ...params,
      context: params.context.slice(0, 2000),
    };

    // Build envelope with auth
    const envelope = createEnvelope("a2a.invoke", truncatedParams, auth);

    // Create session
    const session: A2ASession = {
      sessionId: envelope.id,
      requestEnvelope: envelope,
      status: "pending",
      frameworkType,
      startedAt: Date.now(),
      streamChunks: [],
    };
    this.sessions.set(session.sessionId, session);

    try {
      // Get adapter and adapt request
      const adapter = getAdapter(frameworkType);
      const adapted = adapter.adaptRequest(truncatedParams);
      const url = endpoint + adapted.url;
      const headers: Record<string, string> = { ...adapted.headers };
      if (auth) headers["Authorization"] = `Bearer ${auth}`;

      // Update status
      session.status = "running";

      // Make HTTP request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.defaultTimeoutMs
      );

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(adapted.body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const rawResponse = await res.json();
      const result = adapter.adaptResponse(rawResponse);

      const response: A2AResponse = {
        jsonrpc: "2.0",
        id: envelope.id,
        result,
      };
      session.status = "completed";
      session.completedAt = Date.now();
      session.response = response;
      return response;
    } catch (err) {
      session.status = "failed";
      session.completedAt = Date.now();
      const message = err instanceof Error ? err.message : "Unknown error";
      const response: A2AResponse = {
        jsonrpc: "2.0",
        id: envelope.id,
        error: { code: A2A_ERROR_CODES.FRAMEWORK_ERROR, message },
      };
      session.response = response;
      return response;
    }
  }

  async *invokeStream(
    params: A2AInvokeParams,
    frameworkType: A2AFrameworkType,
    endpoint: string,
    auth?: string
  ): AsyncGenerator<A2AStreamChunk> {
    // Check concurrent session limit
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length >= this.maxConcurrentSessions) {
      throw new Error(
        `Concurrent session limit reached (${this.maxConcurrentSessions})`
      );
    }

    const truncatedParams: A2AInvokeParams = {
      ...params,
      context: params.context.slice(0, 2000),
      streamMode: true,
    };
    const envelope = createEnvelope("a2a.stream", truncatedParams, auth);

    const session: A2ASession = {
      sessionId: envelope.id,
      requestEnvelope: envelope,
      status: "pending",
      frameworkType,
      startedAt: Date.now(),
      streamChunks: [],
    };
    this.sessions.set(session.sessionId, session);

    try {
      const adapter = getAdapter(frameworkType);
      const adapted = adapter.adaptRequest(truncatedParams);
      const url = endpoint + adapted.url;
      const headers: Record<string, string> = { ...adapted.headers };
      if (auth) headers["Authorization"] = `Bearer ${auth}`;

      session.status = "running";

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.defaultTimeoutMs
      );

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(adapted.body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.body) throw new Error("No response body for stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const chunk: A2AStreamChunk = {
          jsonrpc: "2.0",
          id: envelope.id,
          chunk: text,
          done: false,
        };
        session.streamChunks.push(chunk);
        yield chunk;
      }

      const doneChunk: A2AStreamChunk = {
        jsonrpc: "2.0",
        id: envelope.id,
        chunk: "",
        done: true,
      };
      session.streamChunks.push(doneChunk);
      yield doneChunk;

      session.status = "completed";
      session.completedAt = Date.now();
    } catch (err) {
      session.status = "failed";
      session.completedAt = Date.now();
      throw err;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (
      session &&
      (session.status === "pending" || session.status === "running")
    ) {
      session.status = "cancelled";
      session.completedAt = Date.now();
    }
  }

  getActiveSessions(): A2ASession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.status === "pending" || s.status === "running"
    );
  }

  getSession(sessionId: string): A2ASession | undefined {
    return this.sessions.get(sessionId);
  }

  terminateTimedOutSessions(): A2ASession[] {
    const now = Date.now();
    const timedOut: A2ASession[] = [];
    for (const session of Array.from(this.sessions.values())) {
      if (
        (session.status === "pending" || session.status === "running") &&
        now - session.startedAt > this.defaultTimeoutMs
      ) {
        session.status = "failed";
        session.completedAt = now;
        session.response = {
          jsonrpc: "2.0",
          id: session.requestEnvelope.id,
          error: {
            code: A2A_ERROR_CODES.TIMEOUT,
            message: "Session timed out",
          },
        };
        timedOut.push(session);
      }
    }
    return timedOut;
  }
}
