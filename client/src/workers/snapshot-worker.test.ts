/**
 * Unit tests for snapshot-worker.ts
 *
 * Since Web Workers can't be directly instantiated in Vitest/Node,
 * we simulate the worker's onmessage handler by importing the module
 * and invoking the logic through a mock self/postMessage setup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SnapshotPayload,
  MissionStatus,
} from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";
import type { WorkerRequest, WorkerResponse } from "./snapshot-worker";

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

async function computeSHA256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Worker simulation ───

let postedMessages: WorkerResponse[];
let onmessageHandler: (event: MessageEvent<WorkerRequest>) => void;

beforeEach(async () => {
  postedMessages = [];

  // Mock self.postMessage to capture responses
  (globalThis as any).self = {
    postMessage: (msg: WorkerResponse) => {
      postedMessages.push(msg);
    },
    onmessage: null as any,
  };

  // Intercept self.onmessage assignment
  let _onmessage: any = null;
  Object.defineProperty((globalThis as any).self, "onmessage", {
    get: () => _onmessage,
    set: (fn: any) => {
      _onmessage = fn;
    },
    configurable: true,
  });

  // Clear module cache and re-import to trigger self.onmessage assignment
  vi.resetModules();
  await import("./snapshot-worker");

  onmessageHandler = _onmessage;
});

describe("snapshot-worker", () => {
  it("should return a serialized SnapshotRecord for a valid request", async () => {
    const payload = makePayload();
    const request: WorkerRequest = {
      type: "serialize",
      payload,
      missionId: "mission-1",
      missionTitle: "Test Mission",
      missionProgress: 42,
      missionStatus: "running" as MissionStatus,
    };

    await onmessageHandler(new MessageEvent("message", { data: request }));

    expect(postedMessages).toHaveLength(1);
    const resp = postedMessages[0];
    expect(resp.type).toBe("serialized");

    if (resp.type !== "serialized") throw new Error("unexpected type");

    const record = resp.record;
    expect(record.missionId).toBe("mission-1");
    expect(record.missionTitle).toBe("Test Mission");
    expect(record.missionProgress).toBe(42);
    expect(record.missionStatus).toBe("running");
    expect(record.version).toBe(SNAPSHOT_VERSION);
    expect(record.payload).toEqual(payload);
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBeGreaterThan(0);
  });

  it("should compute a valid SHA-256 hex checksum of the payload JSON", async () => {
    const payload = makePayload();
    const request: WorkerRequest = {
      type: "serialize",
      payload,
      missionId: "m1",
      missionTitle: "T",
      missionProgress: 0,
      missionStatus: "running" as MissionStatus,
    };

    await onmessageHandler(new MessageEvent("message", { data: request }));

    const resp = postedMessages[0];
    if (resp.type !== "serialized") throw new Error("unexpected type");

    // Independently compute expected checksum
    const expectedChecksum = await computeSHA256Hex(JSON.stringify(payload));
    expect(resp.record.checksum).toBe(expectedChecksum);
    // SHA-256 hex is 64 chars
    expect(resp.record.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should generate a unique UUID for each snapshot", async () => {
    const payload = makePayload();
    const request: WorkerRequest = {
      type: "serialize",
      payload,
      missionId: "m1",
      missionTitle: "T",
      missionProgress: 0,
      missionStatus: "running" as MissionStatus,
    };

    await onmessageHandler(new MessageEvent("message", { data: request }));
    await onmessageHandler(new MessageEvent("message", { data: request }));

    expect(postedMessages).toHaveLength(2);
    const id1 = (postedMessages[0] as any).record.id;
    const id2 = (postedMessages[1] as any).record.id;
    expect(id1).not.toBe(id2);
  });

  it("should return an error response for unknown request types", async () => {
    const badRequest = { type: "unknown_type" } as any;

    await onmessageHandler(new MessageEvent("message", { data: badRequest }));

    expect(postedMessages).toHaveLength(1);
    const resp = postedMessages[0];
    expect(resp.type).toBe("error");
    if (resp.type !== "error") throw new Error("unexpected type");
    expect(resp.message).toContain("Unknown request type");
  });

  it("should return an error response when serialization throws", async () => {
    // Create a payload with a circular reference to force JSON.stringify to throw
    const circular: any = { id: "m1" };
    circular.self = circular;

    const request: WorkerRequest = {
      type: "serialize",
      payload: circular as any,
      missionId: "m1",
      missionTitle: "T",
      missionProgress: 0,
      missionStatus: "running" as MissionStatus,
    };

    await onmessageHandler(new MessageEvent("message", { data: request }));

    expect(postedMessages).toHaveLength(1);
    const resp = postedMessages[0];
    expect(resp.type).toBe("error");
    if (resp.type !== "error") throw new Error("unexpected type");
    expect(resp.message).toBeTruthy();
  });

  it("should produce consistent checksums for the same payload", async () => {
    const payload = makePayload({
      mission: { id: "stable", title: "Stable" } as any,
    });
    const request: WorkerRequest = {
      type: "serialize",
      payload,
      missionId: "m1",
      missionTitle: "T",
      missionProgress: 50,
      missionStatus: "waiting" as MissionStatus,
    };

    await onmessageHandler(new MessageEvent("message", { data: request }));
    await onmessageHandler(new MessageEvent("message", { data: request }));

    const checksum1 = (postedMessages[0] as any).record.checksum;
    const checksum2 = (postedMessages[1] as any).record.checksum;
    expect(checksum1).toBe(checksum2);
  });
});
