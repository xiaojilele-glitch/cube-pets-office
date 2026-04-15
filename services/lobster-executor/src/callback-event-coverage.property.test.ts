/**
 * Property 6: 回调投递覆盖所有事件
 *
 * For any sequence of events emitted during Job execution, each event should
 * trigger exactly one HTTP POST to callback.eventsUrl.
 *
 * **Validates: Requirements 2.1**
 *
 * Feature: lobster-executor-real, Property 6: 回调投递覆盖所有事件
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";

import { CallbackSender } from "./callback-sender.js";
import type { ExecutorEvent } from "../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";

/* ─── Helpers ─── */

function makeEvent(type: ExecutorEvent["type"], index: number): ExecutorEvent {
  return {
    version: EXECUTOR_CONTRACT_VERSION,
    eventId: `evt-p6-${index}`,
    missionId: "m-prop6",
    jobId: "j-prop6",
    executor: "lobster",
    type,
    status: "running",
    occurredAt: new Date().toISOString(),
    message: `property 6 event #${index}`,
  };
}

/* ─── Arbitraries ─── */

const arbEventTypes = fc.array(
  fc.constantFrom(
    "job.started" as const,
    "job.progress" as const,
    "job.completed" as const,
    "job.failed" as const,
    "job.log" as const,
  ),
  { minLength: 1, maxLength: 20 },
);

/* ─── Tests ─── */

describe("Property 6: 回调投递覆盖所有事件", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("N events → exactly N fetch calls, each body matches the corresponding event", async () => {
    await fc.assert(
      fc.asyncProperty(arbEventTypes, async (eventTypes) => {
        const mockFetch = vi.fn<typeof fetch>(async () =>
          new Response(null, { status: 200 }),
        );

        const sender = new CallbackSender(
          { secret: "test-secret", executorId: "exec-1", maxRetries: 0, baseDelayMs: 1 },
          mockFetch,
        );

        const events = eventTypes.map((t, i) => makeEvent(t, i));
        const eventsUrl = "https://brain.local/api/executor/events";

        // Send each event sequentially
        for (const event of events) {
          await sender.send(eventsUrl, event);
        }

        // Exactly one fetch call per event
        expect(mockFetch).toHaveBeenCalledTimes(events.length);

        // Each call body matches the corresponding event
        for (let i = 0; i < events.length; i++) {
          const call = mockFetch.mock.calls[i];
          const [url, init] = call;
          expect(url).toBe(eventsUrl);

          const body = JSON.parse(init!.body as string) as { event: ExecutorEvent };
          expect(body.event.type).toBe(events[i].type);
          expect(body.event.eventId).toBe(events[i].eventId);
          expect(body.event.message).toBe(events[i].message);
        }
      }),
      { numRuns: 100 },
    );
  });
});
