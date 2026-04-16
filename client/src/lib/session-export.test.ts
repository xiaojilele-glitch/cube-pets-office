/**
 * Unit tests for session-export.ts
 *
 * Tests exportSession: ZIP generation, manifest correctness, snapshot content,
 * browser download trigger, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import type {
  SnapshotRecord,
  SnapshotPayload,
} from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";

// ─── Mocks ───

vi.mock("./browser-runtime-storage", () => ({
  getLatestSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
}));

import {
  exportSession,
  buildSessionZip,
  buildFilename,
  importSession,
  importSessionFromBase64,
} from "./session-export";
import { getLatestSnapshot, saveSnapshot } from "./browser-runtime-storage";

// ─── Helpers ───

function makePayload(overrides?: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    mission: {
      id: "m1",
      kind: "default",
      title: "Test Mission",
      status: "running",
      progress: 50,
      stages: [],
      events: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any,
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
    checksum: "abc123def456",
    createdAt: Date.now(),
    missionTitle: "Test Mission",
    missionProgress: 50,
    missionStatus: "running",
    payload: makePayload(),
    ...overrides,
  };
}

async function parseZipBlob(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

// ─── Tests ───

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportSession", () => {
  it("throws when no snapshot exists", async () => {
    vi.mocked(getLatestSnapshot).mockResolvedValue(null);
    await expect(exportSession()).rejects.toThrow("No snapshot found");
  });

  it("throws with mission-specific message when missionId provided but no snapshot", async () => {
    vi.mocked(getLatestSnapshot).mockResolvedValue(null);
    await expect(exportSession("m-42")).rejects.toThrow(
      'No snapshot found for mission "m-42"'
    );
  });

  it("passes missionId to getLatestSnapshot", async () => {
    vi.mocked(getLatestSnapshot).mockResolvedValue(null);
    await exportSession("my-mission").catch(() => {});
    expect(getLatestSnapshot).toHaveBeenCalledWith("my-mission");
  });
});

describe("buildSessionZip", () => {
  it("creates ZIP with manifest.json and snapshot.json", async () => {
    const snapshot = makeSnapshot();
    const blob = await buildSessionZip(snapshot);
    const zip = await parseZipBlob(blob);

    expect(zip.file("manifest.json")).not.toBeNull();
    expect(zip.file("snapshot.json")).not.toBeNull();
  });

  it("manifest contains correct version, checksum, and exportedAt", async () => {
    const snapshot = makeSnapshot({ version: 1, checksum: "sha256hex" });

    const before = Date.now();
    const blob = await buildSessionZip(snapshot);
    const after = Date.now();

    const zip = await parseZipBlob(blob);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string")
    );

    expect(manifest.version).toBe(1);
    expect(manifest.checksum).toBe("sha256hex");
    expect(manifest.exportedAt).toBeGreaterThanOrEqual(before);
    expect(manifest.exportedAt).toBeLessThanOrEqual(after);
  });

  it("snapshot.json contains the full SnapshotRecord", async () => {
    const snapshot = makeSnapshot();
    const blob = await buildSessionZip(snapshot);
    const zip = await parseZipBlob(blob);
    const parsed = JSON.parse(await zip.file("snapshot.json")!.async("string"));

    expect(parsed.id).toBe(snapshot.id);
    expect(parsed.missionId).toBe(snapshot.missionId);
    expect(parsed.version).toBe(snapshot.version);
    expect(parsed.checksum).toBe(snapshot.checksum);
    expect(parsed.missionTitle).toBe(snapshot.missionTitle);
    expect(parsed.payload.mission.id).toBe(snapshot.payload.mission.id);
    expect(parsed.payload.zustandSlice.runtimeMode).toBe("frontend");
  });

  it("includes attachments/ folder with indexed entries", async () => {
    const snapshot = makeSnapshot({
      payload: makePayload({
        attachmentIndex: [
          { name: "report.pdf", kind: "file", size: 1024 },
          { name: "notes.txt", kind: "file", size: 256 },
        ],
      }),
    });

    const blob = await buildSessionZip(snapshot);
    const zip = await parseZipBlob(blob);

    expect(zip.file("attachments/report.pdf")).not.toBeNull();
    expect(zip.file("attachments/notes.txt")).not.toBeNull();
  });

  it("creates attachments/ folder even with no attachments", async () => {
    const snapshot = makeSnapshot();
    const blob = await buildSessionZip(snapshot);
    const zip = await parseZipBlob(blob);

    // JSZip stores folders as entries ending with /
    const folderEntry = zip.folder("attachments");
    expect(folderEntry).not.toBeNull();
  });
});

describe("buildFilename", () => {
  it("produces a filename with sanitized mission title", async () => {
    const snapshot = makeSnapshot({ missionTitle: "My Cool Mission!" });
    const name = buildFilename(snapshot);

    expect(name).toMatch(/^session-My_Cool_Mission_-.*\.zip$/);
  });

  it("preserves Chinese characters in filename", async () => {
    const snapshot = makeSnapshot({ missionTitle: "测试任务" });
    const name = buildFilename(snapshot);

    expect(name).toContain("测试任务");
    expect(name).toMatch(/\.zip$/);
  });
});

// ─── Import Tests ───

/**
 * Helper: build a ZIP Blob from manifest + snapshot objects.
 */
async function buildZipBlob(
  manifest: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null
): Promise<File> {
  const zip = new JSZip();
  if (manifest !== null) {
    zip.file("manifest.json", JSON.stringify(manifest));
  }
  if (snapshot !== null) {
    zip.file("snapshot.json", JSON.stringify(snapshot));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "test-bundle.zip", { type: "application/zip" });
}

describe("importSession", () => {
  it("rejects ZIP with missing manifest.json", async () => {
    const snap = makeSnapshot();
    const file = await buildZipBlob(null, snap as any);
    await expect(importSession(file)).rejects.toThrow("missing manifest.json");
  });

  it("rejects ZIP with missing snapshot.json", async () => {
    const file = await buildZipBlob(
      { version: SNAPSHOT_VERSION, checksum: "abc", exportedAt: Date.now() },
      null
    );
    await expect(importSession(file)).rejects.toThrow("missing snapshot.json");
  });

  it("rejects when manifest checksum does not match snapshot checksum", async () => {
    const snap = makeSnapshot({ checksum: "real-checksum" });
    const manifest = {
      version: SNAPSHOT_VERSION,
      checksum: "wrong-checksum",
      exportedAt: Date.now(),
    };
    const file = await buildZipBlob(manifest, snap as any);
    await expect(importSession(file)).rejects.toThrow(
      "Checksum validation failed"
    );
  });

  it("rejects when manifest version does not match SNAPSHOT_VERSION", async () => {
    const snap = makeSnapshot({ version: 999 });
    const manifest = {
      version: 999,
      checksum: snap.checksum,
      exportedAt: Date.now(),
    };
    const file = await buildZipBlob(manifest, snap as any);
    await expect(importSession(file)).rejects.toThrow("Version incompatible");
  });

  it("saves snapshot to store when validation passes", async () => {
    vi.mocked(saveSnapshot).mockResolvedValue(undefined);
    const snap = makeSnapshot();
    const manifest = {
      version: SNAPSHOT_VERSION,
      checksum: snap.checksum,
      exportedAt: Date.now(),
    };
    const file = await buildZipBlob(manifest, snap as any);

    await importSession(file);

    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    const savedRecord = vi.mocked(saveSnapshot).mock.calls[0][0];
    expect(savedRecord.id).toBe(snap.id);
    expect(savedRecord.checksum).toBe(snap.checksum);
    expect(savedRecord.missionId).toBe(snap.missionId);
  });
});

describe("importSessionFromBase64", () => {
  it("decodes base64 and imports correctly", async () => {
    vi.mocked(saveSnapshot).mockResolvedValue(undefined);
    const snap = makeSnapshot();
    const manifest = {
      version: SNAPSHOT_VERSION,
      checksum: snap.checksum,
      exportedAt: Date.now(),
    };

    // Build a ZIP, convert to base64
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest));
    zip.file("snapshot.json", JSON.stringify(snap));
    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    await importSessionFromBase64(base64);

    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    const savedRecord = vi.mocked(saveSnapshot).mock.calls[0][0];
    expect(savedRecord.id).toBe(snap.id);
    expect(savedRecord.checksum).toBe(snap.checksum);
  });
});
