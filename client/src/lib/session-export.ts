/**
 * Session Export Service
 *
 * Exports the latest snapshot as a ZIP bundle (manifest.json + snapshot.json + attachments/).
 * Triggers a browser file download.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import JSZip from "jszip";
import type { SnapshotRecord } from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";
import { getLatestSnapshot, saveSnapshot } from "./browser-runtime-storage";

/**
 * Build a ZIP blob from a SnapshotRecord.
 * Exported for testing — callers normally use `exportSession`.
 */
export async function buildSessionZip(snapshot: SnapshotRecord): Promise<Blob> {
  const zip = new JSZip();

  // manifest.json
  const manifest = {
    version: snapshot.version,
    checksum: snapshot.checksum,
    exportedAt: Date.now(),
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // snapshot.json — full SnapshotRecord
  zip.file("snapshot.json", JSON.stringify(snapshot, null, 2));

  // attachments/ folder — create entries for indexed attachments
  const attachmentsFolder = zip.folder("attachments")!;
  for (const entry of snapshot.payload.attachmentIndex) {
    // Placeholder: actual file content would need to be fetched from storage.
    attachmentsFolder.file(entry.name, "");
  }

  return zip.generateAsync({ type: "blob" });
}

/**
 * Build a safe download filename from a snapshot.
 */
export function buildFilename(snapshot: SnapshotRecord): string {
  const safeTitle = snapshot.missionTitle.replace(
    /[^a-zA-Z0-9_\-\u4e00-\u9fff]/g,
    "_",
  );
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `session-${safeTitle}-${ts}.zip`;
}

/**
 * Trigger a browser file download for a Blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Export the latest snapshot for the given mission (or the global latest) as a ZIP download.
 *
 * ZIP structure:
 *   session-bundle.zip
 *   ├── manifest.json   // { version, checksum, exportedAt }
 *   ├── snapshot.json   // full SnapshotRecord
 *   └── attachments/    // attachment files (folder always present)
 */
export async function exportSession(missionId?: string): Promise<void> {
  const snapshot = await getLatestSnapshot(missionId);
  if (!snapshot) {
    throw new Error(
      missionId
        ? `No snapshot found for mission "${missionId}"`
        : "No snapshot found",
    );
  }

  const blob = await buildSessionZip(snapshot);
  triggerDownload(blob, buildFilename(snapshot));
}


/**
 * Import a session from a ZIP file (Session_Bundle).
 *
 * Validates manifest checksum and version before writing the snapshot to the store.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export async function importSession(file: File | Blob): Promise<void> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Invalid session bundle: missing manifest.json");
  }

  const snapshotFile = zip.file("snapshot.json");
  if (!snapshotFile) {
    throw new Error("Invalid session bundle: missing snapshot.json");
  }

  const manifest = JSON.parse(await manifestFile.async("string")) as {
    version: number;
    checksum: string;
    exportedAt: number;
  };

  const snapshot = JSON.parse(
    await snapshotFile.async("string"),
  ) as SnapshotRecord;

  // Req 4.3 — version compatibility check
  if (manifest.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Version incompatible: bundle version ${manifest.version} does not match current version ${SNAPSHOT_VERSION}`,
    );
  }

  // Req 4.1 — checksum validation
  if (manifest.checksum !== snapshot.checksum) {
    throw new Error(
      `Checksum validation failed: manifest checksum "${manifest.checksum}" does not match snapshot checksum "${snapshot.checksum}"`,
    );
  }

  // Req 4.4 — write to SnapshotStore
  await saveSnapshot(snapshot);
}

/**
 * Import a session from a base64-encoded ZIP (e.g. from URL parameter `?restore=<base64>`).
 *
 * Requirements: 4.5
 */
export async function importSessionFromBase64(encoded: string): Promise<void> {
  const binaryStr = atob(encoded);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const file = new File([bytes], "session-bundle.zip", {
    type: "application/zip",
  });
  await importSession(file);
}
