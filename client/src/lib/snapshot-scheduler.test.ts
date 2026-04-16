/**
 * Unit tests for snapshot-scheduler.ts
 *
 * Uses vi.useFakeTimers() to control setInterval behavior.
 * Mocks serializeSnapshot, saveSnapshot, pruneSnapshots dependencies.
 *
 * Requirements: 1.1, 1.2, 8.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  SnapshotPayload,
  SnapshotRecord,
} from "../../../shared/mission/contracts";

// ─── Mocks ───

vi.mock("./snapshot-serializer", () => ({
  serializeSnapshot: vi.fn(),
}));

vi.mock("./browser-runtime-storage", () => ({
  saveSnapshot: vi.fn(),
  pruneSnapshots: vi.fn(),
}));

import { createSnapshotScheduler } from "./snapshot-scheduler";
import { serializeSnapshot } from "./snapshot-serializer";
import { saveSnapshot, pruneSnapshots } from "./browser-runtime-storage";

// ─── Helpers ───

function makePayload(overrides?: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    mission: { id: "m1", title: "Test Mission", status: "running" } as any,
    agentMemories: [],
    sceneLayout: {
      cameraPosition: [0, 0, 5],
      cameraTarget: [0, 0, 0],
      selectedPet: null,
    },
    decisionHistory: [],
    attachmentIndex: [],
    zustandSlice: {
      runtimeMode: "frontend",
      aiConfig: {} as any,
      chatMessages: [],
    },
    ...overrides,
  };
}

function makeFakeRecord(missionId: string): SnapshotRecord {
  return {
    id: "snap-1",
    missionId,
    version: 1,
    checksum: "abc123",
    createdAt: Date.now(),
    missionTitle: "Test Mission",
    missionProgress: 0,
    missionStatus: "running",
    payload: makePayload(),
  };
}

// ─── Setup ───

const mockedSerialize = vi.mocked(serializeSnapshot);
const mockedSave = vi.mocked(saveSnapshot);
const mockedPrune = vi.mocked(pruneSnapshots);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockedSerialize.mockResolvedValue(makeFakeRecord("mission-1"));
  mockedSave.mockResolvedValue(undefined);
  mockedPrune.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── isRunning / start / stop ───

describe("createSnapshotScheduler - lifecycle", () => {
  it("should not be running initially", () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });
    expect(scheduler.isRunning()).toBe(false);
  });

  it("should be running after start()", () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });
    scheduler.start("mission-1");
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });

  it("should not be running after stop()", () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });
    scheduler.start("mission-1");
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it("should handle stop() when not started", () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });
    // Should not throw
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it("should allow restart after stop", () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });
    scheduler.start("mission-1");
    scheduler.stop();
    scheduler.start("mission-2");
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });
});

// ─── Timer-driven snapshots ───

describe("createSnapshotScheduler - timer", () => {
  it("should trigger snapshot cycle after intervalMs", async () => {
    const payload = makePayload();
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => payload,
    });

    scheduler.start("mission-1");

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockedSerialize).toHaveBeenCalledTimes(1);
    expect(mockedSerialize).toHaveBeenCalledWith(payload, {
      missionId: "mission-1",
      missionTitle: "Test Mission",
      missionProgress: 0,
      missionStatus: "running",
    });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedPrune).toHaveBeenCalledWith(5);

    scheduler.stop();
  });

  it("should trigger multiple snapshots over multiple intervals", async () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 10000,
      collectState: () => makePayload(),
    });

    scheduler.start("mission-1");

    await vi.advanceTimersByTimeAsync(30000);

    expect(mockedSerialize).toHaveBeenCalledTimes(3);
    expect(mockedSave).toHaveBeenCalledTimes(3);
    expect(mockedPrune).toHaveBeenCalledTimes(3);

    scheduler.stop();
  });

  it("should not trigger snapshots after stop()", async () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 10000,
      collectState: () => makePayload(),
    });

    scheduler.start("mission-1");
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockedSerialize).toHaveBeenCalledTimes(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(30000);

    // Still only 1 call from before stop
    expect(mockedSerialize).toHaveBeenCalledTimes(1);
  });

  it("should use new missionId when restarted", async () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 10000,
      collectState: () => makePayload(),
    });

    scheduler.start("mission-A");
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockedSerialize).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ missionId: "mission-A" })
    );

    scheduler.stop();
    scheduler.start("mission-B");
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockedSerialize).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ missionId: "mission-B" })
    );

    scheduler.stop();
  });
});

// ─── triggerImmediate ───

describe("createSnapshotScheduler - triggerImmediate", () => {
  it("should perform a snapshot cycle immediately", async () => {
    const payload = makePayload();
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => payload,
    });

    scheduler.start("mission-1");
    await scheduler.triggerImmediate();

    expect(mockedSerialize).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedPrune).toHaveBeenCalledWith(5);

    scheduler.stop();
  });

  it("should do nothing if scheduler is not started", async () => {
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });

    await scheduler.triggerImmediate();

    expect(mockedSerialize).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("should derive meta from payload", async () => {
    const payload = makePayload({
      mission: {
        id: "m-x",
        title: "My Custom Mission",
        status: "waiting",
      } as any,
    });
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => payload,
    });

    scheduler.start("mission-x");
    await scheduler.triggerImmediate();

    expect(mockedSerialize).toHaveBeenCalledWith(payload, {
      missionId: "mission-x",
      missionTitle: "My Custom Mission",
      missionProgress: 0,
      missionStatus: "waiting",
    });

    scheduler.stop();
  });
});

// ─── Error handling (Requirement 8.2) ───

describe("createSnapshotScheduler - error handling", () => {
  it("should call onError when serializeSnapshot throws", async () => {
    const onError = vi.fn();
    mockedSerialize.mockRejectedValueOnce(new Error("serialize failed"));

    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
      onError,
    });

    scheduler.start("mission-1");
    await scheduler.triggerImmediate();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("serialize failed");
    // Scheduler should still be running
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it("should call onError when saveSnapshot throws", async () => {
    const onError = vi.fn();
    mockedSave.mockRejectedValueOnce(new Error("save failed"));

    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
      onError,
    });

    scheduler.start("mission-1");
    await scheduler.triggerImmediate();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("save failed");
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it("should call onError when collectState throws", async () => {
    const onError = vi.fn();
    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => {
        throw new Error("collect failed");
      },
      onError,
    });

    scheduler.start("mission-1");
    await scheduler.triggerImmediate();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("collect failed");
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it("should use console.error when no onError provided", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedSerialize.mockRejectedValueOnce(new Error("oops"));

    const scheduler = createSnapshotScheduler({
      intervalMs: 30000,
      collectState: () => makePayload(),
    });

    scheduler.start("mission-1");
    await scheduler.triggerImmediate();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[SnapshotScheduler]",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    scheduler.stop();
  });

  it("should continue running after timer-triggered errors", async () => {
    const onError = vi.fn();
    mockedSerialize.mockRejectedValue(new Error("always fails"));

    const scheduler = createSnapshotScheduler({
      intervalMs: 10000,
      collectState: () => makePayload(),
      onError,
    });

    scheduler.start("mission-1");

    // Advance through 3 intervals - all will fail
    await vi.advanceTimersByTimeAsync(30000);

    // Errors should be caught, scheduler still running
    expect(onError).toHaveBeenCalledTimes(3);
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });
});
