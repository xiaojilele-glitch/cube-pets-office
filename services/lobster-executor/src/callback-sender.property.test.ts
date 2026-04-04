/**
 * Property 7: 回调重试与容错
 *
 * For any callback failure scenario, CallbackSender should retry up to 3 times
 * with exponential backoff, and Job execution should continue after all retries
 * fail (send() never throws).
 *
 * **Validates: Requirements 2.4, 2.5**
 *
 * Feature: lobster-executor-real, Property 7: 回调重试与容错
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";

import { CallbackSender } from "./callback-sender.js";
import type { ExecutorEvent } from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";

/* ─── Helpers ─── */

function makeEvent(overrides?: Partial<ExecutorEvent>): ExecutorEvent {
  return {
    version: EXECUTOR_CONTRACT_VERSION,
    eventId: "evt-prop7",
    missionId: "m-prop7",
    jobId: "j-prop7",
    executor: "lobster",
    type: "job.started",
    status: "running",
    occurredAt: new Date().toISOString(),
    message: "property test event",
    ...overrides,
  };
}

/**
 * Creates a mock fetch that fails `failCount` times then succeeds.
 * If failCount > maxRetries, all attempts fail.
 */
function createCountingFetch(failCount: number) {
  let callCount = 0;
  const fn = vi.fn<typeof fetch>(async () => {
    callCount++;
    if (callCount <= failCount) {
      throw new Error(`simulated failure #${callCount}`);
    }
    return new Response(null, { status: 200 });
  });
  return { fn, getCallCount: () => callCount };
}

/* ─── Arbitraries ─── */

/** maxRetries: 1–5 (design default is 3, but test the general contract) */
const arbMaxRetries = fc.integer({ min: 1, max: 5 });

/** failCount relative to maxRetries: 0 means instant success, maxRetries+1 means all fail */
const arbFailCountFactor = fc.integer({ min: 0, max: 1 }); // 0 = partial, 1 = all-fail

/** Random event type to ensure send() is agnostic to event content */
const arbEventType = fc.constantFrom(
  "job.accepted" as const,
  "job.started" as const,
  "job.progress" as const,
  "job.completed" as const,
  "job.failed" as const,
  "job.log" as const,
);

/* ─── Tests ─── */

describe("Property 7: 回调重试与容错", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("partial failures: fetch is called exactly failCount + 1 times (failures + 1 success)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMaxRetries.chain((maxRetries) =>
          fc.integer({ min: 0, max: maxRetries }).map((failCount) => ({
            maxRetries,
            failCount,
          })),
        ),
        arbEventType,
        async ({ maxRetries, failCount }, eventType) => {
          const { fn: mockFetch } = createCountingFetch(failCount);

          const sender = new CallbackSender(
            { secret: "s", executorId: "e", maxRetries, baseDelayMs: 1 },
            mockFetch,
          );

          await sender.send("https://test.local/events", makeEvent({ type: eventType }));

          // failCount failures + 1 successful call
          expect(mockFetch).toHaveBeenCalledTimes(failCount + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all retries exhausted: send() resolves (never throws) and fetch called maxRetries + 1 times", async () => {
    await fc.assert(
      fc.asyncProperty(arbMaxRetries, arbEventType, async (maxRetries, eventType) => {
        // failCount > maxRetries → every attempt fails
        const totalAttempts = maxRetries + 1;
        const { fn: mockFetch } = createCountingFetch(totalAttempts);

        const sender = new CallbackSender(
          { secret: "s", executorId: "e", maxRetries, baseDelayMs: 1 },
          mockFetch,
        );

        // Must resolve, not reject — callback failure never blocks Job
        await expect(
          sender.send("https://test.local/events", makeEvent({ type: eventType })),
        ).resolves.toBeUndefined();

        // 1 initial attempt + maxRetries retries
        expect(mockFetch).toHaveBeenCalledTimes(totalAttempts);
      }),
      { numRuns: 100 },
    );
  });

  it("send() never throws regardless of fetch behavior (network errors, HTTP errors, or success)", async () => {
    const arbFetchBehavior = fc.constantFrom<"network-error" | "http-error" | "success">(
      "network-error",
      "http-error",
      "success",
    );

    await fc.assert(
      fc.asyncProperty(
        arbMaxRetries,
        arbFetchBehavior,
        arbEventType,
        async (maxRetries, behavior, eventType) => {
          const mockFetch = vi.fn<typeof fetch>(async () => {
            switch (behavior) {
              case "network-error":
                throw new Error("ECONNREFUSED");
              case "http-error":
                return new Response(null, { status: 503, statusText: "Service Unavailable" });
              case "success":
                return new Response(null, { status: 200 });
            }
          });

          const sender = new CallbackSender(
            { secret: "s", executorId: "e", maxRetries, baseDelayMs: 1 },
            mockFetch,
          );

          // Must always resolve — this is the core fault-tolerance guarantee
          await expect(
            sender.send("https://test.local/events", makeEvent({ type: eventType })),
          ).resolves.toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
