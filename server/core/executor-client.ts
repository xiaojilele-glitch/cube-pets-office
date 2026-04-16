import {
  EXECUTOR_API_ROUTES,
  EXECUTOR_CALLBACK_HEADERS,
  type CreateExecutorJobResponse,
} from "../../shared/executor/api.js";
import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutionPlan,
  type ExecutorJobRequest,
} from "../../shared/executor/contracts.js";

export class ExecutorClientError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "protocol" | "rejected",
    readonly statusCode?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ExecutorClientError";
  }
}

export interface ExecutorClientOptions {
  baseUrl: string;
  callbackUrl: string;
  callbackTimeoutMs?: number;
  healthPath?: string;
  timeoutMs?: number;
  executorName?: ExecutorJobRequest["executor"];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
}

export interface DispatchExecutionPlanOptions {
  requestId?: string;
  jobId?: string;
  traceId?: string;
  idempotencyKey?: string;
}

export interface DispatchExecutionPlanResult {
  request: ExecutorJobRequest;
  response: CreateExecutorJobResponse;
}

function joinUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
}

function createOpaqueId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ExecutorClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly callbackTimeoutMs: number;
  private readonly healthPath: string;
  private readonly executorName: ExecutorJobRequest["executor"];
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: ExecutorClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Math.max(1_000, options.timeoutMs || 10_000);
    this.callbackTimeoutMs = Math.max(
      1_000,
      options.callbackTimeoutMs || 10_000
    );
    this.healthPath = options.healthPath || "/health";
    this.executorName = options.executorName || "lobster";
    this.now = options.now || (() => new Date());
    this.createId = options.createId || createOpaqueId;
  }

  buildJobRequest(
    plan: ExecutionPlan,
    dispatch: DispatchExecutionPlanOptions = {}
  ): ExecutorJobRequest {
    return {
      version: EXECUTOR_CONTRACT_VERSION,
      requestId: dispatch.requestId || this.createId(),
      missionId: plan.missionId,
      jobId: dispatch.jobId || this.createId(),
      executor: this.executorName,
      createdAt: this.now().toISOString(),
      traceId: dispatch.traceId,
      idempotencyKey: dispatch.idempotencyKey,
      plan,
      callback: {
        eventsUrl: this.options.callbackUrl,
        timeoutMs: this.callbackTimeoutMs,
        auth: {
          scheme: "hmac-sha256",
          executorHeader: EXECUTOR_CALLBACK_HEADERS.executorId,
          timestampHeader: EXECUTOR_CALLBACK_HEADERS.timestamp,
          signatureHeader: EXECUTOR_CALLBACK_HEADERS.signature,
          signedPayload: "timestamp.rawBody",
        },
      },
    };
  }

  async assertReachable(): Promise<void> {
    const url = joinUrl(this.options.baseUrl, this.healthPath);

    let response: Response;
    try {
      response = await this.request(url, { method: "GET" });
    } catch (error) {
      throw new ExecutorClientError(
        `Executor is unreachable at ${url}. Brain dispatch is failing fast instead of queueing blindly.`,
        "unavailable",
        undefined,
        { cause: error }
      );
    }

    if (!response.ok) {
      throw new ExecutorClientError(
        `Executor health check failed with HTTP ${response.status} at ${url}. Brain dispatch is failing fast.`,
        "unavailable",
        response.status
      );
    }
  }

  async dispatchPlan(
    plan: ExecutionPlan,
    dispatch: DispatchExecutionPlanOptions = {}
  ): Promise<DispatchExecutionPlanResult> {
    await this.assertReachable();

    const request = this.buildJobRequest(plan, dispatch);
    const url = joinUrl(this.options.baseUrl, EXECUTOR_API_ROUTES.createJob);

    let response: Response;
    try {
      response = await this.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new ExecutorClientError(
        `Executor create-job request failed for ${url}. Brain dispatch is failing fast.`,
        "unavailable",
        undefined,
        { cause: error }
      );
    }

    const rawBody = await response.text();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ExecutorClientError(
        `Executor returned a non-JSON response while creating a job at ${url}.`,
        "protocol",
        response.status
      );
    }

    if (!response.ok) {
      const errorMessage =
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        "error" in parsedBody &&
        typeof parsedBody.error === "string"
          ? parsedBody.error
          : `HTTP ${response.status}`;

      throw new ExecutorClientError(
        `Executor rejected the job request: ${errorMessage}`,
        "rejected",
        response.status
      );
    }

    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      !("ok" in parsedBody) ||
      !("accepted" in parsedBody) ||
      !("jobId" in parsedBody) ||
      typeof parsedBody.jobId !== "string"
    ) {
      throw new ExecutorClientError(
        `Executor create-job response is missing required fields.`,
        "protocol",
        response.status
      );
    }

    return {
      request,
      response: parsedBody as CreateExecutorJobResponse,
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ExecutorClientError(
          `Executor request to ${url} timed out after ${this.timeoutMs}ms.`,
          "unavailable",
          undefined,
          { cause: error }
        );
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
