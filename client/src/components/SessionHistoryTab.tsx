/**
 * SessionHistoryTab — 历史会话标签
 *
 * 列出所有本地快照（Mission 标题、保存时间、进度百分比），
 * 选择快照后显示 RecoveryDialog（Resume/Delete）。
 *
 * Requirements: 9.1, 9.2, 9.3
 */

import { useCallback, useEffect, useState } from "react";
import { Clock, Database } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { RecoveryDialog } from "@/components/RecoveryDialog";
import { useI18n } from "@/i18n";
import { listSnapshots } from "@/lib/browser-runtime-storage";
import {
  restoreFromSnapshot,
  discardSnapshot,
  type RecoveryCandidate,
} from "@/lib/recovery-detector";
import { validateChecksum } from "@/lib/snapshot-serializer";
import { SNAPSHOT_VERSION } from "@shared/mission/contracts";
import type { SnapshotRecord } from "@shared/mission/contracts";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function SessionHistoryTab() {
  const { copy } = useI18n();
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restorePhase, setRestorePhase] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await listSnapshots();
      setSnapshots(list);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSelect = useCallback(async (snapshot: SnapshotRecord) => {
    // Build RecoveryCandidate with validation
    if (snapshot.version !== SNAPSHOT_VERSION) {
      setCandidate({ snapshot, isValid: false, invalidReason: "version_incompatible" });
      return;
    }
    const checksumOk = await validateChecksum(snapshot);
    if (!checksumOk) {
      setCandidate({ snapshot, isValid: false, invalidReason: "checksum_mismatch" });
      return;
    }
    setCandidate({ snapshot, isValid: true });
  }, []);

  const handleResume = useCallback(async () => {
    if (!candidate) return;
    setIsRestoring(true);
    setRestorePhase("恢复 Mission 数据...");
    setRestoreProgress(30);
    try {
      await restoreFromSnapshot(candidate.snapshot);
      setRestoreProgress(100);
      setCandidate(null);
    } catch (err) {
      console.error("[SessionHistoryTab] restore failed:", err);
    } finally {
      setIsRestoring(false);
      setRestoreProgress(0);
      setRestorePhase("");
    }
  }, [candidate]);

  const handleDiscard = useCallback(async () => {
    if (!candidate) return;
    await discardSnapshot(candidate.snapshot.id);
    setCandidate(null);
    void refresh();
  }, [candidate, refresh]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-[#3A2A1A]">
          <Database className="size-4 text-amber-600" />
          {copy.workflow.sessions.title}
        </h4>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-xs text-[#8B7355]">
            <Clock className="mx-auto mb-2 size-4 animate-spin" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8B7355]">
            {copy.workflow.sessions.empty}
          </div>
        ) : (
          snapshots.map((snap) => (
            <button
              key={snap.id}
              onClick={() => void handleSelect(snap)}
              className="w-full rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3 text-left transition-colors hover:bg-[#F0E8E0]"
            >
              <p className="mb-1 truncate text-xs font-medium text-[#3A2A1A]">
                {snap.missionTitle}
              </p>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-[#B0A090]">
                <span>{copy.workflow.sessions.savedAt} {formatTime(snap.createdAt)}</span>
                <span>{copy.workflow.sessions.progress} {Math.round(snap.missionProgress)}%</span>
              </div>
              <Progress
                value={snap.missionProgress}
                className="h-1 bg-stone-100"
                aria-label={`${Math.round(snap.missionProgress)}%`}
              />
            </button>
          ))
        )}
      </div>

      {candidate && (
        <RecoveryDialog
          candidate={candidate}
          onResume={() => void handleResume()}
          onDiscard={() => void handleDiscard()}
          isRestoring={isRestoring}
          restoreProgress={restoreProgress}
          restorePhase={restorePhase}
        />
      )}
    </div>
  );
}
