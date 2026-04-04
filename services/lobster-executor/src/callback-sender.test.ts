import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallbackSender } from "./callback-sender.js";
import type { ExecutorEvent } from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";

function makeEvent(overrides?: Partial<ExecutorEvent>): ExecutorEvent {
  return {
    version: EXECUTOR_CONTRACT_VERSION,
    eventId: "evt-1",
    missionId: "m-1",
    jobId: "j-1",
    executor: "lobster",
    type: "job.started",
    status: "running",
    occurredAt: new Date().toISOString(),
    message: "Job started",
    ...overrides,
  };
}

const BASE_CONFIG = {
  secret: "test-secret",
  executorId: "exec-1",
  maxRetries: 3,
  baseDelayMs: 1, // 1ms for fast tests
};

describe("CallbackSender", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("sends event successfully on first attempt", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const sender = new CallbackSender(BASE_CONFIG, mockFetch);
    await sender.send("https://brain.test/events", makeEvent());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://brain.test/events");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeDefined();

    const headers = init!.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(typeof init?.body).toBe("string");
  });

  it("retries on failure and succeeds on 2nd attempt", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const sender = new CallbackSender(BASE_CONFIG, mockFetch);
    await sender.send("https://brain.test/events", makeEvent());

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // First attempt failed, logged a warning
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on non-2xx HTTP status", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const sender = new CallbackSender(BASE_CONFIG, mockFetch);
    await sender.send("https://brain.test/events", makeEvent());

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("exhausts all retries without throwing", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network error"));

    const sender = new CallbackSender(BASE_CONFIG, mockFetch);

    // Should NOT throw
    await expect(
      sender.send("https://brain.test/events", makeEvent()),
    ).resolves.toBeUndefined();

    // 1 initial + 3 retries = 4 total attempts
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Warnings: 3 retry warnings + 1 final exhaustion warning
    expect(warnSpy).toHaveBeenCalled();
  });

  it("includes HMAC headers in the request", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const sender = new CallbackSender(BASE_CONFIG, mockFetch);
    await sender.send("https://brain.test/events", makeEvent());

    const headers = mockFetch.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["x-cube-executor-signature"]).toBeDefined();
    expect(headers["x-cube-executor-timestamp"]).toBeDefined();
    expect(headers["x-cube-executor-id"]).toBe("exec-1");
  });

  it("serializes event body as JSON", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const event = makeEvent({ type: "job.completed", status: "completed" });
    const sender = new CallbackSender(BASE_CONFIG, mockFetch);
    await sender.send("https://brain.test/events", event);

    const body = mockFetch.mock.calls[0][1]!.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.type).toBe("job.completed");
    expect(parsed.status).toBe("completed");
  });
});
