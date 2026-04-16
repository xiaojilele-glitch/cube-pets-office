import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionEvent } from "../../shared/replay/contracts.js";
import type { ReplayStoreInterface } from "../../shared/replay/store-interface.js";
import { EventCollector } from "../replay/event-collector.js";
import {
  installMissionInterceptor,
  installMessageBusInterceptor,
  installExecutorInterceptor,
} from "../replay/interceptors.js";

/* ─── Helpers ─── */

function createMockStore(): ReplayStoreInterface & {
  calls: Array<{ missionId: string; events: ExecutionEvent[] }>;
} {
  const calls: Array<{ missionId: string; events: ExecutionEvent[] }> = [];
  return {
    calls,
    appendEvents: vi.fn(async (missionId: string, events: ExecutionEvent[]) => {
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

function createCollectorAndStore() {
  const store = createMockStore();
  const collector = new EventCollector(store, {
    bufferSize: 1000,
    flushIntervalMs: 100_000, // large interval to avoid auto-flush
  });
  return { store, collector };
}

function flushAndGetEvents(
  store: ReturnType<typeof createMockStore>,
  collector: EventCollector
) {
  return collector.flush().then(() => store.calls.flatMap(c => c.events));
}

/* ─── installMissionInterceptor ─── */

describe("installMissionInterceptor", () => {
  let store: ReturnType<typeof createMockStore>;
  let collector: EventCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ store, collector } = createCollectorAndStore());
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  it("emits AGENT_STARTED when mission is created (queued status)", async () => {
    const orchestrator = { hooks: {} };
    installMissionInterceptor(orchestrator, collector);

    await orchestrator.hooks.onMissionUpdated({
      id: "mission-1",
      status: "queued",
      currentStageKey: "receive",
      title: "Test Mission",
      kind: "brain-dispatch",
      events: [{ kind: "created", source: "brain" }],
    });

    const events = await flushAndGetEvents(store, collector);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("AGENT_STARTED");
    expect(events[0].missionId).toBe("mission-1");
    expect(events[0].eventData).toMatchObject({ action: "mission_created" });
  });

  it("emits MILESTONE_REACHED + AGENT_STOPPED when mission completes", async () => {
    const orchestrator = { hooks: {} };
    installMissionInterceptor(orchestrator, collector);

    await orchestrator.hooks.onMissionUpdated({
      id: "mission-2",
      status: "done",
      currentStageKey: "finalize",
      summary: "All done",
      progress: 100,
      events: [{ kind: "progress", source: "executor" }],
    });

    const events = await flushAndGetEvents(store, collector);
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe("MILESTONE_REACHED");
    expect(events[0].eventData).toMatchObject({ action: "mission_completed" });
    expect(events[1].eventType).toBe("AGENT_STOPPED");
  });

  it("emits ERROR_OCCURRED + AGENT_STOPPED when mission fails", async () => {
    const orchestrator = { hooks: {} };
    installMissionInterceptor(orchestrator, collector);

    await orchestrator.hooks.onMissionUpdated({
      id: "mission-3",
      status: "failed",
      currentStageKey: "execute",
      summary: "Something broke",
      events: [{ kind: "error", source: "executor" }],
    });

    const events = await flushAndGetEvents(store, collector);
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe("ERROR_OCCURRED");
    expect(events[0].eventData).toMatchObject({ action: "mission_failed" });
    expect(events[1].eventType).toBe("AGENT_STOPPED");
  });

  it("emits MILESTONE_REACHED for stage transitions (running status)", async () => {
    const orchestrator = { hooks: {} };
    installMissionInterceptor(orchestrator, collector);

    await orchestrator.hooks.onMissionUpdated({
      id: "mission-4",
      status: "running",
      currentStageKey: "plan",
      progress: 30,
      events: [{ kind: "progress", source: "brain", detail: "Building plan" }],
    });

    const events = await flushAndGetEvents(store, collector);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("MILESTONE_REACHED");
    expect(events[0].eventData).toMatchObject({
      action: "stage_transition",
      stageKey: "plan",
    });
  });

  it("preserves existing onMissionUpdated hook", async () => {
    const existingHookCalled = vi.fn();
    const orchestrator = {
      hooks: { onMissionUpdated: existingHookCalled },
    };
    installMissionInterceptor(orchestrator, collector);

    await orchestrator.hooks.onMissionUpdated({
      id: "mission-5",
      status: "running",
      currentStageKey: "execute",
      events: [],
    });

    expect(existingHookCalled).toHaveBeenCalledOnce();
  });

  it("does not throw if orchestrator has no hooks property", () => {
    const orchestrator = {};
    expect(() =>
      installMissionInterceptor(orchestrator, collector)
    ).not.toThrow();
  });
});

/* ─── installMessageBusInterceptor ─── */

describe("installMessageBusInterceptor", () => {
  let store: ReturnType<typeof createMockStore>;
  let collector: EventCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ store, collector } = createCollectorAndStore());
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  it("wraps send() and emits MESSAGE_SENT + MESSAGE_RECEIVED", async () => {
    const originalResult = { id: 42, created_at: "2024-01-01" };
    const messageBus = {
      send: vi.fn().mockResolvedValue(originalResult),
    };

    installMessageBusInterceptor(messageBus, collector);

    const result = await messageBus.send(
      "agent-a",
      "agent-b",
      "hello",
      "wf-1",
      "plan"
    );
    expect(result).toBe(originalResult);

    const events = await flushAndGetEvents(store, collector);
    expect(events).toHaveLength(2);

    const sent = events.find(e => e.eventType === "MESSAGE_SENT");
    const received = events.find(e => e.eventType === "MESSAGE_RECEIVED");

    expect(sent).toBeDefined();
    expect(sent!.sourceAgent).toBe("agent-a");
    expect(sent!.targetAgent).toBe("agent-b");
    expect(sent!.eventData).toMatchObject({
      senderId: "agent-a",
      receiverId: "agent-b",
      messageContent: "hello",
    });

    expect(received).toBeDefined();
    expect(received!.sourceAgent).toBe("agent-b");
    expect(received!.targetAgent).toBe("agent-a");
  });

  it("still calls original send() and returns its result", async () => {
    const originalSend = vi.fn().mockResolvedValue({ id: 99 });
    const messageBus = { send: originalSend };

    installMessageBusInterceptor(messageBus, collector);

    const result = await messageBus.send("a", "b", "msg", "wf", "execute");
    expect(result).toEqual({ id: 99 });
    expect(originalSend).toHaveBeenCalledWith(
      "a",
      "b",
      "msg",
      "wf",
      "execute",
      undefined
    );
  });

  it("does not break if original send() throws", async () => {
    const messageBus = {
      send: vi.fn().mockRejectedValue(new Error("bus error")),
    };

    installMessageBusInterceptor(messageBus, collector);

    await expect(
      messageBus.send("a", "b", "msg", "wf", "plan")
    ).rejects.toThrow("bus error");
  });
});

/* ─── installExecutorInterceptor ─── */

describe("installExecutorInterceptor", () => {
  let store: ReturnType<typeof createMockStore>;
  let collector: EventCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ store, collector } = createCollectorAndStore());
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  function createMockReqRes(body: any) {
    const req = { body } as any;
    const res = {} as any;
    const next = vi.fn();
    return { req, res, next };
  }

  it("emits CODE_EXECUTED for executor progress events", async () => {
    const middleware = installExecutorInterceptor(collector);
    const { req, res, next } = createMockReqRes({
      event: {
        missionId: "mission-1",
        eventId: "evt-1",
        jobId: "job-1",
        executor: "lobster",
        type: "job.progress",
        status: "running",
        stageKey: "execute",
        detail: "Running code",
      },
    });

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    const events = await flushAndGetEvents(store, collector);
    const codeEvent = events.find(e => e.eventType === "CODE_EXECUTED");
    expect(codeEvent).toBeDefined();
    expect(codeEvent!.missionId).toBe("mission-1");
    expect(codeEvent!.sourceAgent).toBe("lobster");
  });

  it("emits RESOURCE_ACCESSED for artifact events", async () => {
    const middleware = installExecutorInterceptor(collector);
    const { req, res, next } = createMockReqRes({
      event: {
        missionId: "mission-2",
        eventId: "evt-2",
        jobId: "job-2",
        executor: "lobster",
        type: "job.completed",
        status: "completed",
        stageKey: "finalize",
        artifacts: [
          {
            kind: "file",
            name: "output.txt",
            path: "/tmp/output.txt",
            description: "Result file",
          },
        ],
      },
    });

    middleware(req, res, next);

    const events = await flushAndGetEvents(store, collector);
    const resourceEvent = events.find(e => e.eventType === "RESOURCE_ACCESSED");
    expect(resourceEvent).toBeDefined();
    expect(resourceEvent!.eventData).toMatchObject({
      resourceType: "FILE",
      resourceId: "/tmp/output.txt",
      accessType: "WRITE",
    });
  });

  it("emits RESOURCE_ACCESSED for container instance events", async () => {
    const middleware = installExecutorInterceptor(collector);
    const { req, res, next } = createMockReqRes({
      event: {
        missionId: "mission-3",
        eventId: "evt-3",
        jobId: "job-3",
        executor: "lobster",
        type: "job.progress",
        status: "running",
        stageKey: "provision",
        payload: {
          instance: {
            id: "container-123",
            image: "node:18",
          },
        },
      },
    });

    middleware(req, res, next);

    const events = await flushAndGetEvents(store, collector);
    const resourceEvent = events.find(
      e =>
        e.eventType === "RESOURCE_ACCESSED" &&
        (e.eventData as any).resourceId === "container-123"
    );
    expect(resourceEvent).toBeDefined();
    expect(resourceEvent!.eventData).toMatchObject({
      resourceType: "API",
      accessType: "EXECUTE",
    });
  });

  it("calls next() even when event body is missing", () => {
    const middleware = installExecutorInterceptor(collector);
    const { req, res, next } = createMockReqRes({});

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("calls next() even when body is undefined", () => {
    const middleware = installExecutorInterceptor(collector);
    const { req, res, next } = createMockReqRes(undefined);

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
