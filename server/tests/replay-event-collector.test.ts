import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";

import type {
  ExecutionEvent,
  ReplayEventType,
} from "../../shared/replay/contracts";
import {
  REPLAY_EVENT_TYPES,
  MESSAGE_TYPES,
  MESSAGE_STATUSES,
  EXECUTION_STATUSES,
  RESOURCE_TYPES,
  ACCESS_TYPES,
} from "../../shared/replay/contracts";
import type { ReplayStoreInterface } from "../../shared/replay/store-interface";
import { EventCollector } from "../../server/replay/event-collector";
import {
  installMissionInterceptor,
  installMessageBusInterceptor,
  installExecutorInterceptor,
} from "../../server/replay/interceptors";
import {
  encryptMessage,
  decryptMessage,
  generateEncryptionKey,
  maskSensitiveData,
} from "../../server/replay/sensitive-data";

/* ─── Shared Helpers ─── */

function createMockStore(options?: {
  shouldFail?: boolean;
  neverResolve?: boolean;
}): ReplayStoreInterface & {
  calls: Array<{ missionId: string; events: ExecutionEvent[] }>;
} {
  const calls: Array<{ missionId: string; events: ExecutionEvent[] }> = [];
  return {
    calls,
    appendEvents: vi.fn(async (missionId: string, events: ExecutionEvent[]) => {
      if (options?.neverResolve) return new Promise<void>(() => {});
      if (options?.shouldFail) throw new Error("store write failed");
      calls.push({ missionId, events });
    }),
    queryEvents: vi.fn(async () => []),
    getTimeline: vi.fn(async () => ({
      missionId: "",
      events: [],
      startTime: 0,
      endTime: 0,
      totalDuration: 0,
      eventCount: 0,
      indices: {
        byTime: new Map(),
        byAgent: new Map(),
        byType: new Map(),
        byResource: new Map(),
      },
      version: 0,
      checksum: "",
    })),
    exportEvents: vi.fn(async () => ""),
    verifyIntegrity: vi.fn(async () => true),
    compact: vi.fn(async () => {}),
    cleanup: vi.fn(async () => 0),
  };
}

function makePartialEvent(
  overrides: Partial<Omit<ExecutionEvent, "eventId" | "timestamp">> = {}
): Omit<ExecutionEvent, "eventId" | "timestamp"> {
  return {
    missionId: overrides.missionId ?? "mission-1",
    eventType: overrides.eventType ?? ("AGENT_STARTED" as const),
    sourceAgent: overrides.sourceAgent ?? "agent-1",
    eventData: overrides.eventData ?? {},
    ...(overrides.targetAgent ? { targetAgent: overrides.targetAgent } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

/* ─── Arbitraries for fast-check ─── */

const eventTypeArb: fc.Arbitrary<ReplayEventType> = fc.constantFrom(
  ...REPLAY_EVENT_TYPES
);

const partialEventArb: fc.Arbitrary<
  Omit<ExecutionEvent, "eventId" | "timestamp">
> = fc.record({
  missionId: fc.string({ minLength: 1, maxLength: 20 }).map(s => `m-${s}`),
  eventType: eventTypeArb,
  sourceAgent: fc
    .string({ minLength: 1, maxLength: 20 })
    .map(s => `agent-${s}`),
  eventData: fc.constant({} as Record<string, unknown>),
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 2.2 — Property 2: Event collection non-blocking
 * Feature: collaboration-replay, Property 2: 事件采集非阻塞
 * Validates: Requirements 1.4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Property 2: Event collection non-blocking", () => {
  it("emit() returns synchronously even when store never resolves", () => {
    // **Validates: Requirements 1.4**
    fc.assert(
      fc.property(
        fc.array(partialEventArb, { minLength: 1, maxLength: 50 }),
        events => {
          // Store whose appendEvents returns a never-resolving promise
          const neverStore = createMockStore({ neverResolve: true });
          const collector = new EventCollector(neverStore, {
            bufferSize: 1000,
            flushIntervalMs: 999_999, // prevent auto-flush
          });

          try {
            // emit() should return synchronously for every event — no hang, no throw
            for (const evt of events) {
              collector.emit(evt);
            }

            // Buffer should have grown (up to bufferSize)
            const stats = collector.getStats();
            expect(stats.total).toBe(events.length);
            // buffered may be less than total if buffer overflow triggered a flush,
            // but total must always equal the number of emits
            expect(stats.buffered).toBeGreaterThan(0);
            expect(stats.buffered).toBeLessThanOrEqual(events.length);
          } finally {
            collector.destroy();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("emit() does not await persistence — store.appendEvents is not called synchronously", () => {
    // **Validates: Requirements 1.4**
    fc.assert(
      fc.property(partialEventArb, evt => {
        const store = createMockStore({ neverResolve: true });
        const collector = new EventCollector(store, {
          bufferSize: 1000,
          flushIntervalMs: 999_999,
        });

        try {
          collector.emit(evt);
          // appendEvents should NOT have been called synchronously by emit()
          // (it's only called during flush)
          expect(store.appendEvents).not.toHaveBeenCalled();
        } finally {
          collector.destroy();
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 2.3 — Property 3: Collection failure buffering and retry
 * Feature: collaboration-replay, Property 3: 采集失败缓冲与重试
 * Validates: Requirements 1.6
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Property 3: Collection failure buffering and retry", () => {
  it("failed flush moves events to failedQueue; successful retry removes them", async () => {
    // **Validates: Requirements 1.6**
    await fc.assert(
      fc.asyncProperty(
        fc.array(partialEventArb, { minLength: 1, maxLength: 20 }),
        async events => {
          let callCount = 0;
          const store = createMockStore();
          // Override appendEvents: fail on first call, succeed on subsequent
          (store.appendEvents as ReturnType<typeof vi.fn>).mockImplementation(
            async (_missionId: string, _events: ExecutionEvent[]) => {
              callCount++;
              if (callCount === 1) throw new Error("transient failure");
              // success on retry
            }
          );

          const collector = new EventCollector(store, {
            bufferSize: 1000,
            flushIntervalMs: 999_999,
            maxRetries: 3,
          });

          try {
            // Emit all events
            for (const evt of events) {
              collector.emit(evt);
            }

            const beforeFlush = collector.getStats();
            expect(beforeFlush.buffered).toBe(events.length);
            expect(beforeFlush.failed).toBe(0);

            // Flush — should fail, events move to failedQueue
            await collector.flush();

            const afterFlush = collector.getStats();
            expect(afterFlush.buffered).toBe(0);
            // failedQueue grows by the batch size (all events in one missionId group
            // or multiple groups — total should equal events.length)
            expect(afterFlush.failed).toBeGreaterThan(0);
            expect(afterFlush.failed).toBeLessThanOrEqual(events.length);

            const failedBefore = afterFlush.failed;

            // Retry — should succeed now (callCount > 1)
            await collector.retryFailed();

            const afterRetry = collector.getStats();
            // Successfully retried events removed from failedQueue
            expect(afterRetry.failed).toBeLessThan(failedBefore);
            expect(afterRetry.failed).toBe(0);
          } finally {
            collector.destroy();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 2.5 — Interceptor unit tests
 * Feature: collaboration-replay, Interceptor correctness
 * Validates: Requirements 1.3, 2.1
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Interceptor unit tests", () => {
  function createCollectorAndStore() {
    const store = createMockStore();
    const collector = new EventCollector(store, {
      bufferSize: 1000,
      flushIntervalMs: 999_999,
    });
    return { store, collector };
  }

  async function flushAndGetEvents(
    store: ReturnType<typeof createMockStore>,
    collector: EventCollector
  ) {
    await collector.flush();
    return store.calls.flatMap(c => c.events);
  }

  /* ── installMissionInterceptor ── */

  describe("installMissionInterceptor", () => {
    it("emits AGENT_STARTED when mission is created", async () => {
      const { store, collector } = createCollectorAndStore();
      try {
        const orchestrator: any = { hooks: {} };
        installMissionInterceptor(orchestrator, collector);

        await orchestrator.hooks.onMissionUpdated({
          id: "mission-1",
          status: "queued",
          currentStageKey: "receive",
          title: "Test",
          kind: "brain-dispatch",
          events: [{ kind: "created", source: "brain" }],
        });

        const events = await flushAndGetEvents(store, collector);
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events.some(e => e.eventType === "AGENT_STARTED")).toBe(true);
      } finally {
        collector.destroy();
      }
    });

    it("emits MILESTONE_REACHED when mission completes", async () => {
      const { store, collector } = createCollectorAndStore();
      try {
        const orchestrator: any = { hooks: {} };
        installMissionInterceptor(orchestrator, collector);

        await orchestrator.hooks.onMissionUpdated({
          id: "mission-2",
          status: "done",
          currentStageKey: "finalize",
          summary: "Done",
          progress: 100,
          events: [{ kind: "progress", source: "executor" }],
        });

        const events = await flushAndGetEvents(store, collector);
        expect(events.some(e => e.eventType === "MILESTONE_REACHED")).toBe(
          true
        );
        expect(events.some(e => e.eventType === "AGENT_STOPPED")).toBe(true);
      } finally {
        collector.destroy();
      }
    });

    it("emits MILESTONE_REACHED for stage transitions", async () => {
      const { store, collector } = createCollectorAndStore();
      try {
        const orchestrator: any = { hooks: {} };
        installMissionInterceptor(orchestrator, collector);

        await orchestrator.hooks.onMissionUpdated({
          id: "mission-3",
          status: "running",
          currentStageKey: "plan",
          progress: 30,
          events: [{ kind: "progress", source: "brain", detail: "Planning" }],
        });

        const events = await flushAndGetEvents(store, collector);
        expect(events.some(e => e.eventType === "MILESTONE_REACHED")).toBe(
          true
        );
        const milestone = events.find(
          e => e.eventType === "MILESTONE_REACHED"
        )!;
        expect(milestone.eventData).toMatchObject({
          action: "stage_transition",
          stageKey: "plan",
        });
      } finally {
        collector.destroy();
      }
    });
  });

  /* ── installMessageBusInterceptor ── */

  describe("installMessageBusInterceptor", () => {
    it("emits MESSAGE_SENT events when send() is called", async () => {
      const { store, collector } = createCollectorAndStore();
      try {
        const messageBus: any = {
          send: vi.fn().mockResolvedValue({ id: 1 }),
        };
        installMessageBusInterceptor(messageBus, collector);

        await messageBus.send("agent-a", "agent-b", "hello", "wf-1", "plan");

        const events = await flushAndGetEvents(store, collector);
        const sent = events.find(e => e.eventType === "MESSAGE_SENT");
        expect(sent).toBeDefined();
        expect(sent!.sourceAgent).toBe("agent-a");
        expect(sent!.targetAgent).toBe("agent-b");
        expect(sent!.eventData).toMatchObject({
          senderId: "agent-a",
          receiverId: "agent-b",
          messageContent: "hello",
        });
      } finally {
        collector.destroy();
      }
    });

    it("emits MESSAGE_RECEIVED events when send() is called", async () => {
      const { store, collector } = createCollectorAndStore();
      try {
        const messageBus: any = {
          send: vi.fn().mockResolvedValue({ id: 2 }),
        };
        installMessageBusInterceptor(messageBus, collector);

        await messageBus.send("agent-x", "agent-y", "data", "wf-2", "execute");

        const events = await flushAndGetEvents(store, collector);
        const received = events.find(e => e.eventType === "MESSAGE_RECEIVED");
        expect(received).toBeDefined();
        expect(received!.sourceAgent).toBe("agent-y");
        expect(received!.targetAgent).toBe("agent-x");
      } finally {
        collector.destroy();
      }
    });
  });

  /* ── installExecutorInterceptor ── */

  describe("installExecutorInterceptor", () => {
    it("emits CODE_EXECUTED for executor callback events", async () => {
      const { store, collector } = createCollectorAndStore();
      try {
        const middleware = installExecutorInterceptor(collector);
        const req = {
          body: {
            event: {
              missionId: "mission-exec",
              eventId: "evt-1",
              jobId: "job-1",
              executor: "lobster",
              type: "job.progress",
              status: "running",
              stageKey: "execute",
              detail: "Running code",
            },
          },
        } as any;
        const res = {} as any;
        const next = vi.fn();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();

        const events = await flushAndGetEvents(store, collector);
        const codeEvent = events.find(e => e.eventType === "CODE_EXECUTED");
        expect(codeEvent).toBeDefined();
        expect(codeEvent!.missionId).toBe("mission-exec");
        expect(codeEvent!.sourceAgent).toBe("lobster");
      } finally {
        collector.destroy();
      }
    });

    it("calls next() even when body is missing", () => {
      const { collector } = createCollectorAndStore();
      try {
        const middleware = installExecutorInterceptor(collector);
        const next = vi.fn();
        middleware({ body: {} } as any, {} as any, next);
        expect(next).toHaveBeenCalled();
      } finally {
        collector.destroy();
      }
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 2.7 — Property 5: Sensitive data protection
 * Feature: collaboration-replay, Property 5: 敏感数据保护
 * Validates: Requirements 2.4, 5.5
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Property 5: Sensitive data protection", () => {
  it("encryptMessage produces ciphertext different from plaintext, decryptMessage recovers original", () => {
    // **Validates: Requirements 2.4, 5.5**
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), plaintext => {
        const key = generateEncryptionKey();
        const encrypted = encryptMessage(plaintext, key);

        // Ciphertext must differ from original plaintext
        expect(encrypted.ciphertext).not.toBe(plaintext);

        // Decryption must recover the original
        const decrypted = decryptMessage(encrypted, key);
        expect(decrypted).toBe(plaintext);
      }),
      { numRuns: 100 }
    );
  });

  it("maskSensitiveData changes text containing emails", () => {
    // **Validates: Requirements 2.4, 5.5**
    fc.assert(
      fc.property(
        fc.tuple(
          fc
            .string({ minLength: 1, maxLength: 10 })
            .filter(s => /^[a-z]+$/.test(s)),
          fc
            .string({ minLength: 1, maxLength: 10 })
            .filter(s => /^[a-z]+$/.test(s))
        ),
        ([local, domain]) => {
          const email = `${local}@${domain}.com`;
          const text = `contact: ${email} for info`;
          const masked = maskSensitiveData(text);
          // Masked text should differ from original (email is masked)
          expect(masked).not.toBe(text);
          // The domain part should still be present
          expect(masked).toContain(`@${domain}.com`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("maskSensitiveData changes text containing phone numbers", () => {
    // **Validates: Requirements 2.4, 5.5**
    fc.assert(
      fc.property(
        // Generate valid 11-digit Chinese phone numbers: 1[3-9]X XXXX XXXX
        fc.tuple(
          fc.integer({ min: 3, max: 9 }),
          fc.integer({ min: 100000000, max: 999999999 })
        ),
        ([secondDigit, rest]) => {
          const phone = `1${secondDigit}${rest}`;
          // phone is now exactly 11 digits: "1" + 1 digit + 9 digits
          const text = `call ${phone} now`;
          const masked = maskSensitiveData(text);
          // Phone number should be masked
          expect(masked).not.toContain(phone);
          expect(masked).not.toBe(text);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("maskSensitiveData changes text containing passwords", () => {
    // **Validates: Requirements 2.4, 5.5**
    fc.assert(
      fc.property(
        // Generate alphanumeric passwords to avoid regex special chars
        fc
          .array(
            fc.constantFrom(
              ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
            ),
            { minLength: 3, maxLength: 20 }
          )
          .map(chars => chars.join("")),
        pwd => {
          const text = `password=${pwd}`;
          const masked = maskSensitiveData(text);
          // Password value should be replaced with ***
          expect(masked).toBe("password=***");
          if (pwd !== "***") {
            expect(masked).not.toBe(text);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
