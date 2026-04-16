/**
 * useRecoveryDetection — App 启动时的恢复检测 hook
 *
 * 1. 检查 URL 参数 `?restore=<base64>`，如有则导入会话并移除参数
 * 2. 调用 checkForRecovery(runtimeMode) 检测本地恢复候选
 * 3. 管理 RecoveryDialog 的显示状态和 Resume/Discard 回调
 *
 * Requirements: 2.1, 4.5
 */

import { useCallback, useEffect, useState } from "react";

import { useAppStore } from "@/lib/store";
import { checkForRecovery } from "@/runtime/browser-runtime";
import {
  discardSnapshot,
  restoreFromSnapshot,
  type RecoveryCandidate,
} from "@/lib/recovery-detector";
import { importSessionFromBase64 } from "@/lib/session-export";
import { initSnapshotLifecycleBridge } from "@/lib/snapshot-lifecycle-bridge";

export interface RecoveryState {
  candidate: RecoveryCandidate | null;
  isRestoring: boolean;
  restoreProgress: number;
  restorePhase: string;
  handleResume: () => void;
  handleDiscard: () => void;
}

export function useRecoveryDetection(
  navigate: (to: string) => void
): RecoveryState {
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restorePhase, setRestorePhase] = useState("");

  const runtimeMode = useAppStore(s => s.runtimeMode);

  // --- Snapshot lifecycle bridge (Task 9.2) ---------------------------------
  // Registers globalThis accessors and subscribes to workflow-store events
  // so the snapshot scheduler starts/stops with mission status changes.
  useEffect(() => {
    initSnapshotLifecycleBridge();
  }, []);

  // --- Startup detection ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      // 1. Handle URL ?restore=<base64> parameter
      try {
        const params = new URLSearchParams(window.location.search);
        const restoreParam = params.get("restore");
        if (restoreParam) {
          console.log(
            "[Recovery] Importing session from URL restore parameter"
          );
          await importSessionFromBase64(restoreParam);
          // Remove the param from URL without reload
          params.delete("restore");
          const nextSearch = params.toString();
          const nextUrl =
            window.location.pathname + (nextSearch ? `?${nextSearch}` : "");
          window.history.replaceState(null, "", nextUrl);
        }
      } catch (err) {
        // Req: URL restore 参数解码失败 → 忽略参数，正常启动
        console.warn(
          "[Recovery] Failed to import from URL restore param:",
          err
        );
      }

      // 2. Detect local recovery candidate
      try {
        const result = await checkForRecovery(runtimeMode);
        if (!cancelled && result) {
          setCandidate(result);
        }
      } catch (err) {
        console.warn("[Recovery] Detection failed:", err);
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
    // Run once on mount — runtimeMode is read at mount time only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Resume handler ------------------------------------------------------
  const handleResume = useCallback(async () => {
    if (!candidate || !candidate.isValid) return;

    setIsRestoring(true);
    setRestoreProgress(10);
    setRestorePhase("恢复 Mission 数据...");

    try {
      setRestoreProgress(30);
      setRestorePhase("恢复 Zustand 状态...");
      await restoreFromSnapshot(candidate.snapshot);

      setRestoreProgress(80);
      setRestorePhase("恢复 3D 场景...");

      // Brief pause so the user sees the progress update
      await new Promise(r => setTimeout(r, 200));

      setRestoreProgress(100);
      setRestorePhase("恢复完成");

      // Navigate to the restored mission
      const missionId = candidate.snapshot.missionId;
      setCandidate(null);
      if (missionId) {
        navigate(`/tasks/${missionId}`);
      }
    } catch (err) {
      console.error("[Recovery] Restore failed:", err);
      setRestorePhase("恢复失败");
    } finally {
      setIsRestoring(false);
    }
  }, [candidate, navigate]);

  // --- Discard handler -----------------------------------------------------
  const handleDiscard = useCallback(async () => {
    if (!candidate) return;
    try {
      await discardSnapshot(candidate.snapshot.id);
    } catch (err) {
      console.warn("[Recovery] Discard failed:", err);
    }
    setCandidate(null);
  }, [candidate]);

  return {
    candidate,
    isRestoring,
    restoreProgress,
    restorePhase,
    handleResume,
    handleDiscard,
  };
}
