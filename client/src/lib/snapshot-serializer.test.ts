/**
 * Unit tests for snapshot-serializer.ts
 *
 * Tests serializeSnapshot (with Worker fallback) and validateChecksum.
 * In Vitest/Node, Web Workers are not available, so serializeSnapshot
 * will always fall back to main-thread serialization.
 */
import { describe, it, expect } from "vitest";
import type {
  SnapshotPayload,
  SnapshotRecord,
  MissionStatus,
} from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";
import { serializeSnapshot, validateChecksum } from "./snapshot-serializer";
import type { SnapshotMeta } from "./snapshot-serializer";

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

function makeMeta(overrides?: Partial<SnapshotMeta>): SnapshotMeta {
  return {
    missionId: "mission-1",
    missionTitle: "Test Mission",
    missionProgress: 42,
    missionStatus: "running" as MissionStatus,
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

// ─── serializeSnapshot tests ───

describe("serializeSnapshot", () => {
  it("should return a valid SnapshotRecord with correct meta fields", async () => {
    const payload = makePayload();
    const meta = makeMeta();

    const record = await serializeSnapshot(payload, meta);

    expect(record.missionId).toBe("mission-1");
    expect(record.missionTitle).toBe("Test Mission");
    expect(record.missionProgress).toBe(42);
    expect(record.missionStatus).toBe("running");
    expect(record.version).toBe(SNAPSHOT_VERSION);
    expect(record.payload).toEqual(payload);
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBeGreaterThan(0);
  });

  it("should compute a valid SHA-256 hex checksum", async () => {
    const payload = makePayload();
    const meta = makeMeta();

    const record = await serializeSnapshot(payload, meta);

    const expected = await computeSHA256Hex(JSON.stringify(payload));
    expect(record.checksum).toBe(expected);
    expect(record.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should generate unique IDs for each call", async () => {
    const payload = makePayload();
    const meta = makeMeta();

    const r1 = await serializeSnapshot(payload, meta);
    const r2 = await serializeSnapshot(payload, meta);

    expect(r1.id).not.toBe(r2.id);
  });

  it("should produce consistent checksums for the same payload", async () => {
    const payload = makePayload();
    const meta = makeMeta();

    const r1 = await serializeSnapshot(payload, meta);
    const r2 = await serializeSnapshot(payload, meta);

    expect(r1.checksum).toBe(r2.checksum);
  });

  it("should produce different checksums for different payloads", async () => {
    const meta = makeMeta();
    const r1 = await serializeSnapshot(
      makePayload({ mission: { id: "a", title: "A" } as any }),
      meta
    );
    const r2 = await serializeSnapshot(
      makePayload({ mission: { id: "b", title: "B" } as any }),
      meta
    );

    expect(r1.checksum).not.toBe(r2.checksum);
  });
});

// ─── validateChecksum tests ───

describe("validateChecksum", () => {
  it("should return true for a record with valid checksum", async () => {
    const payload = makePayload();
    const record = await serializeSnapshot(payload, makeMeta());

    expect(await validateChecksum(record)).toBe(true);
  });

  it("should return false when checksum is tampered", async () => {
    const record = await serializeSnapshot(makePayload(), makeMeta());
    const tampered: SnapshotRecord = {
      ...record,
      checksum: "0".repeat(64),
    };

    expect(await validateChecksum(tampered)).toBe(false);
  });

  it("should return false when payload is modified after serialization", async () => {
    const record = await serializeSnapshot(makePayload(), makeMeta());
    const modified: SnapshotRecord = {
      ...record,
      payload: {
        ...record.payload,
        mission: { ...record.payload.mission, title: "MODIFIED" },
      },
    };

    expect(await validateChecksum(modified)).toBe(false);
  });

  it("should validate correctly with complex payload data", async () => {
    const payload = makePayload({
      agentMemories: [
        {
          agentId: "agent-1",
          soulMdHash: "abc",
          recentExchanges: [{ q: "hi", a: "hello" }],
        },
      ],
      decisionHistory: [
        {
          stageKey: "plan",
          decision: {
            prompt: "Choose",
            options: [{ id: "o1", label: "Option 1" }],
          },
          timestamp: Date.now(),
        },
      ],
      attachmentIndex: [{ name: "report.pdf", kind: "file", size: 1024 }],
    });

    const record = await serializeSnapshot(payload, makeMeta());
    expect(await validateChecksum(record)).toBe(true);
  });
});
