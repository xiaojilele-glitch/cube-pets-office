/**
 * Unit tests for recovery-detector.ts
 *
 * Tests detectRecoveryCandidate, restoreFromSnapshot, and discardSnapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  SnapshotRecord,
  SnapshotPayload,
} from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";

vi.mock("./browser-runtime-storage", () => ({
  getLatestSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

vi.mock("./snapshot-serializer", () => ({
  validateChecksum: vi.fn(),
}));

import {
  detectRecoveryCandidate,
  restoreFromSnapshot,
  discardSnapshot,
} from "./recovery-detector";
import { getLatestSnapshot, deleteSnapshot } from "./browser-runtime-storage";
import { validateChecksum } from "./snapshot-serializer";

// ─── Helpers ───

function makePayload(overrides?: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    mission: { id: "m1", title: "Test Mission", status: "running" } as any,
    agentMemories: [],
    sceneLayout: {
      cameraPosition: [0, 8, 12],
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

function makeSnapshot(overrides?: Partial<SnapshotRecord>): SnapshotRecord {
  return {
    id: "snap-1",
    missionId: "mission-1",
    version: SNAPSHOT_VERSION,
    checksum: "abc123",
    createdAt: Date.now(),
    missionTitle: "Test Mission",
    missionProgress: 50,
    missionStatus: "running",
    payload: makePayload(),
    ...overrides,
  };
}

// ─── Tests ───

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up globalThis accessors
  delete (globalThis as any).__snapshotRestoreZustand;
  delete (globalThis as any).__snapshotRestoreScene;
});

afterEach(() => {
  delete (globalThis as any).__snapshotRestoreZustand;
  delete (globalThis as any).__snapshotRestoreScene;
});

describe("detectRecoveryCandidate", () => {
  it("should return null when no snapshots exist", async () => {
    vi.mocked(getLatestSnapshot).mockResolvedValue(null);

    const result = await detectRecoveryCandidate();
    expect(result).toBeNull();
  });

  it("should return null when latest snapshot is not running or waiting", async () => {
    vi.mocked(getLatestSnapshot).mockResolvedValue(
      makeSnapshot({ missionStatus: "done" })
    );

    const result = await detectRecoveryCandidate();
    expect(result).toBeNull();
  });

  it("should return null for failed mission status", async () => {
    vi.mocked(getLatestSnapshot).mockResolvedValue(
      makeSnapshot({ missionStatus: "failed" })
    );

    const result = await detectRecoveryCandidate();
    expect(result).toBeNull();
  });

  it("should return valid candidate for running snapshot with valid checksum and version", async () => {
    const snapshot = makeSnapshot({ missionStatus: "running" });
    vi.mocked(getLatestSnapshot).mockResolvedValue(snapshot);
    vi.mocked(validateChecksum).mockResolvedValue(true);

    const result = await detectRecoveryCandidate();

    expect(result).not.toBeNull();
    expect(result!.snapshot).toBe(snapshot);
    expect(result!.isValid).toBe(true);
    expect(result!.invalidReason).toBeUndefined();
  });

  it("should return valid candidate for waiting snapshot", async () => {
    const snapshot = makeSnapshot({ missionStatus: "waiting" });
    vi.mocked(getLatestSnapshot).mockResolvedValue(snapshot);
    vi.mocked(validateChecksum).mockResolvedValue(true);

    const result = await detectRecoveryCandidate();

    expect(result).not.toBeNull();
    expect(result!.snapshot).toBe(snapshot);
    expect(result!.isValid).toBe(true);
  });

  it("should return invalid candidate with checksum_mismatch when checksum fails", async () => {
    const snapshot = makeSnapshot({ missionStatus: "running" });
    vi.mocked(getLatestSnapshot).mockResolvedValue(snapshot);
    vi.mocked(validateChecksum).mockResolvedValue(false);

    const result = await detectRecoveryCandidate();

    expect(result).not.toBeNull();
    expect(result!.snapshot).toBe(snapshot);
    expect(result!.isValid).toBe(false);
    expect(result!.invalidReason).toBe("checksum_mismatch");
  });

  it("should return invalid candidate with version_incompatible when version doesn't match", async () => {
    const snapshot = makeSnapshot({
      missionStatus: "running",
      version: SNAPSHOT_VERSION + 99,
    });
    vi.mocked(getLatestSnapshot).mockResolvedValue(snapshot);

    const result = await detectRecoveryCandidate();

    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(false);
    expect(result!.invalidReason).toBe("version_incompatible");
    // validateChecksum should NOT be called when version is incompatible
    expect(validateChecksum).not.toHaveBeenCalled();
  });
});

describe("discardSnapshot", () => {
  it("should call deleteSnapshot with the given id", async () => {
    vi.mocked(deleteSnapshot).mockResolvedValue(undefined);

    await discardSnapshot("snap-42");

    expect(deleteSnapshot).toHaveBeenCalledWith("snap-42");
    expect(deleteSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe("restoreFromSnapshot", () => {
  it("should call the Zustand accessor with zustandSlice", async () => {
    const restoreZustand = vi.fn();
    (globalThis as any).__snapshotRestoreZustand = restoreZustand;

    const snapshot = makeSnapshot();
    await restoreFromSnapshot(snapshot);

    expect(restoreZustand).toHaveBeenCalledWith(snapshot.payload.zustandSlice);
    expect(restoreZustand).toHaveBeenCalledTimes(1);
  });

  it("should call the scene accessor with sceneLayout", async () => {
    const restoreScene = vi.fn();
    (globalThis as any).__snapshotRestoreScene = restoreScene;

    const snapshot = makeSnapshot();
    await restoreFromSnapshot(snapshot);

    expect(restoreScene).toHaveBeenCalledWith(snapshot.payload.sceneLayout);
    expect(restoreScene).toHaveBeenCalledTimes(1);
  });

  it("should not throw when accessors are not registered", async () => {
    const snapshot = makeSnapshot();
    // No accessors registered — should complete without error
    await expect(restoreFromSnapshot(snapshot)).resolves.toBeUndefined();
  });
});
