/**
 * Recovery Detector
 *
 * 启动时检测未完成快照，提供恢复、丢弃功能。
 * - detectRecoveryCandidate: 读取最新快照，校验 checksum 和 version
 * - restoreFromSnapshot: 从快照恢复 Zustand store、3D 场景布局、Agent 状态
 * - discardSnapshot: 删除指定快照
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6
 */

import type { SnapshotRecord } from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";
import { getLatestSnapshot, deleteSnapshot } from "./browser-runtime-storage";
import { validateChecksum } from "./snapshot-serializer";

export interface RecoveryCandidate {
  snapshot: SnapshotRecord;
  isValid: boolean;
  invalidReason?: "checksum_mismatch" | "version_incompatible";
}

/**
 * 检测是否存在可恢复的快照。
 *
 * 1. 读取最新快照
 * 2. 仅 running / waiting 状态的快照才是恢复候选
 * 3. 校验 checksum 和 version，标记 isValid
 */
export async function detectRecoveryCandidate(): Promise<RecoveryCandidate | null> {
  const snapshot = await getLatestSnapshot();
  if (!snapshot) return null;

  // Only running/waiting missions are recovery candidates
  if (snapshot.missionStatus !== "running" && snapshot.missionStatus !== "waiting") {
    return null;
  }

  // Check version compatibility first
  if (snapshot.version !== SNAPSHOT_VERSION) {
    return { snapshot, isValid: false, invalidReason: "version_incompatible" };
  }

  // Validate checksum
  const checksumValid = await validateChecksum(snapshot);
  if (!checksumValid) {
    return { snapshot, isValid: false, invalidReason: "checksum_mismatch" };
  }

  return { snapshot, isValid: true };
}

/**
 * 从快照恢复 Zustand store、3D 场景布局和 Agent 状态。
 *
 * 使用 globalThis accessor 模式（与 browser-runtime.ts 一致）避免循环依赖：
 * - globalThis.__snapshotRestoreZustand: 设置 Zustand store 状态
 * - globalThis.__snapshotRestoreScene: 恢复 3D 场景布局
 */
export async function restoreFromSnapshot(snapshot: SnapshotRecord): Promise<void> {
  const { zustandSlice, sceneLayout } = snapshot.payload;

  // Signal Scene3D to show the recovery overlay
  const setRecovering = (globalThis as any).__sceneSetRecovering as
    | ((value: boolean) => void)
    | undefined;
  setRecovering?.(true);

  try {
    // Restore Zustand store state
    console.log("[RecoveryDetector] Restoring Zustand store...");
    const restoreZustand = (globalThis as any).__snapshotRestoreZustand as
      | ((slice: typeof zustandSlice) => void)
      | undefined;
    if (restoreZustand) {
      restoreZustand(zustandSlice);
    } else {
      console.warn("[RecoveryDetector] __snapshotRestoreZustand accessor not registered, skipping Zustand restore");
    }

    // Restore 3D scene layout
    console.log("[RecoveryDetector] Restoring 3D scene layout...");
    const restoreScene = (globalThis as any).__snapshotRestoreScene as
      | ((layout: typeof sceneLayout) => void)
      | undefined;
    if (restoreScene) {
      restoreScene(sceneLayout);
    } else {
      console.warn("[RecoveryDetector] __snapshotRestoreScene accessor not registered, skipping scene restore");
    }

    console.log("[RecoveryDetector] Snapshot restoration complete for mission:", snapshot.missionId);
  } finally {
    // Hide the recovery overlay regardless of success/failure
    setRecovering?.(false);
  }
}

/**
 * 删除指定快照。
 */
export async function discardSnapshot(snapshotId: string): Promise<void> {
  await deleteSnapshot(snapshotId);
}
