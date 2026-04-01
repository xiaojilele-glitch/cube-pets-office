/**
 * Unit tests for SnapshotStore (browser-runtime-storage.ts snapshot API).
 *
 * Uses fake-indexeddb to provide an in-memory IndexedDB implementation.
 * Each test gets a fresh database via dynamic import + module cache reset.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SnapshotRecord, SnapshotPayload, MissionStatus } from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";

// We dynamically import the module under test so we can reset IndexedDB + module cache per test
let saveSnapshot: typeof import("./browser-runtime-storage").saveSnapshot;
let getSnapshot: typeof import("./browser-runtime-storage").getSnapshot;
let getLatestSnapshot: typeof import("./browser-runtime-storage").getLatestSnapshot;
let listSnapshots: typeof import("./browser-runtime-storage").listSnapshots;
let deleteSnapshot: typeof import("./browser-runtime-storage").deleteSnapshot;
let pruneSnapshots: typeof import("./browser-runtime-storage").pruneSnapshots;

function makePayload(overrides?: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    mission: { id: "m1", title: "Test Mission" } as any,
    agentMemories: [],
    sceneLayout: { cameraPosition: [0, 0, 5], cameraTarget: [0, 0, 0], selectedPet: null },
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
    id: crypto.randomUUID(),
    missionId: "mission-1",
    version: SNAPSHOT_VERSION,
    checksum: "abc123",
    createdAt: Date.now(),
    missionTitle: "Test Mission",
    missionProgress: 50,
    missionStatus: "running" as MissionStatus,
    payload: makePayload(),
    ...overrides,
  };
}

// Reset fake-indexeddb and re-import module before each test for full isolation
beforeEach(async () => {
  // Reset fake-indexeddb global
  const FDBFactory = (await import("fake-indexeddb/lib/FDBFactory")).default;
  const fresh = new FDBFactory();
  globalThis.indexedDB = fresh;

  // canUseIndexedDb() checks window.indexedDB, so we need to shim window in Node
  (globalThis as any).window = globalThis;

  // Clear module cache so openDatabase() creates a fresh connection
  vi.resetModules();

  const mod = await import("./browser-runtime-storage");
  saveSnapshot = mod.saveSnapshot;
  getSnapshot = mod.getSnapshot;
  getLatestSnapshot = mod.getLatestSnapshot;
  listSnapshots = mod.listSnapshots;
  deleteSnapshot = mod.deleteSnapshot;
  pruneSnapshots = mod.pruneSnapshots;
});

describe("SnapshotStore", () => {
  describe("saveSnapshot / getSnapshot", () => {
    it("should save and retrieve a snapshot by id", async () => {
      const snap = makeSnapshot({ id: "snap-1" });
      await saveSnapshot(snap);
      const result = await getSnapshot("snap-1");
      expect(result).toEqual(snap);
    });

    it("should return null for non-existent id", async () => {
      const result = await getSnapshot("non-existent");
      expect(result).toBeNull();
    });

    it("should overwrite snapshot with same id", async () => {
      const snap1 = makeSnapshot({ id: "snap-1", missionProgress: 30 });
      const snap2 = makeSnapshot({ id: "snap-1", missionProgress: 80 });
      await saveSnapshot(snap1);
      await saveSnapshot(snap2);
      const result = await getSnapshot("snap-1");
      expect(result?.missionProgress).toBe(80);
    });
  });

  describe("listSnapshots", () => {
    it("should return empty array when no snapshots exist", async () => {
      const result = await listSnapshots();
      expect(result).toEqual([]);
    });

    it("should return snapshots sorted by createdAt descending", async () => {
      const s1 = makeSnapshot({ id: "s1", createdAt: 1000 });
      const s2 = makeSnapshot({ id: "s2", createdAt: 3000 });
      const s3 = makeSnapshot({ id: "s3", createdAt: 2000 });
      await saveSnapshot(s1);
      await saveSnapshot(s2);
      await saveSnapshot(s3);

      const result = await listSnapshots();
      expect(result.map((r) => r.id)).toEqual(["s2", "s3", "s1"]);
    });
  });

  describe("getLatestSnapshot", () => {
    it("should return null when no snapshots exist", async () => {
      const result = await getLatestSnapshot();
      expect(result).toBeNull();
    });

    it("should return the most recent snapshot across all missions", async () => {
      await saveSnapshot(makeSnapshot({ id: "s1", createdAt: 1000, missionId: "m1" }));
      await saveSnapshot(makeSnapshot({ id: "s2", createdAt: 3000, missionId: "m2" }));
      await saveSnapshot(makeSnapshot({ id: "s3", createdAt: 2000, missionId: "m1" }));

      const result = await getLatestSnapshot();
      expect(result?.id).toBe("s2");
    });

    it("should filter by missionId when provided", async () => {
      await saveSnapshot(makeSnapshot({ id: "s1", createdAt: 1000, missionId: "m1" }));
      await saveSnapshot(makeSnapshot({ id: "s2", createdAt: 3000, missionId: "m2" }));
      await saveSnapshot(makeSnapshot({ id: "s3", createdAt: 2000, missionId: "m1" }));

      const result = await getLatestSnapshot("m1");
      expect(result?.id).toBe("s3");
    });

    it("should return null when missionId has no snapshots", async () => {
      await saveSnapshot(makeSnapshot({ id: "s1", missionId: "m1" }));
      const result = await getLatestSnapshot("m-nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("deleteSnapshot", () => {
    it("should remove the specified snapshot", async () => {
      await saveSnapshot(makeSnapshot({ id: "s1" }));
      await saveSnapshot(makeSnapshot({ id: "s2" }));
      await deleteSnapshot("s1");

      expect(await getSnapshot("s1")).toBeNull();
      expect(await getSnapshot("s2")).not.toBeNull();
    });

    it("should not throw when deleting non-existent id", async () => {
      await expect(deleteSnapshot("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("pruneSnapshots", () => {
    it("should keep only the most recent keepCount snapshots", async () => {
      for (let i = 0; i < 7; i++) {
        await saveSnapshot(makeSnapshot({ id: `s${i}`, createdAt: 1000 * (i + 1) }));
      }

      await pruneSnapshots(3);
      const remaining = await listSnapshots();
      expect(remaining).toHaveLength(3);
      // Should keep s6, s5, s4 (most recent by createdAt)
      expect(remaining.map((r) => r.id)).toEqual(["s6", "s5", "s4"]);
    });

    it("should do nothing when count is within keepCount", async () => {
      await saveSnapshot(makeSnapshot({ id: "s1" }));
      await saveSnapshot(makeSnapshot({ id: "s2" }));

      await pruneSnapshots(5);
      const remaining = await listSnapshots();
      expect(remaining).toHaveLength(2);
    });

    it("should handle keepCount of 0 by deleting all", async () => {
      await saveSnapshot(makeSnapshot({ id: "s1" }));
      await saveSnapshot(makeSnapshot({ id: "s2" }));

      await pruneSnapshots(0);
      const remaining = await listSnapshots();
      expect(remaining).toHaveLength(0);
    });
  });
});
