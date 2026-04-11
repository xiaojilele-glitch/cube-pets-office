import { useCallback, useEffect, useState } from "react";
import { Clock, Database, RotateCcw } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { RecoveryDialog } from "@/components/RecoveryDialog";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n";
import { listSnapshots } from "@/lib/browser-runtime-storage";
import {
  discardSnapshot,
  restoreFromSnapshot,
  type RecoveryCandidate,
} from "@/lib/recovery-detector";
import { validateChecksum } from "@/lib/snapshot-serializer";
import { SNAPSHOT_VERSION } from "@shared/mission/contracts";
import type { SnapshotRecord } from "@shared/mission/contracts";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
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
    setLoading(true);
    try {
      const nextSnapshots = await listSnapshots();
      setSnapshots(nextSnapshots);
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
    if (snapshot.version !== SNAPSHOT_VERSION) {
      setCandidate({
        snapshot,
        isValid: false,
        invalidReason: "version_incompatible",
      });
      return;
    }

    const checksumOk = await validateChecksum(snapshot);
    if (!checksumOk) {
      setCandidate({
        snapshot,
        isValid: false,
        invalidReason: "checksum_mismatch",
      });
      return;
    }

    setCandidate({ snapshot, isValid: true });
  }, []);

  const handleResume = useCallback(async () => {
    if (!candidate) return;

    setIsRestoring(true);
    setRestorePhase("Restoring mission snapshot...");
    setRestoreProgress(30);

    try {
      await restoreFromSnapshot(candidate.snapshot);
      setRestoreProgress(100);
      setCandidate(null);
    } catch (error) {
      console.error("[SessionHistoryTab] restore failed:", error);
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

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-xs text-[#8B7355]">
            <Clock className="mx-auto mb-2 size-4 animate-spin" />
            Loading local snapshots...
          </div>
        ) : snapshots.length === 0 ? (
          <EmptyHintBlock
            tone="info"
            icon={<Database className="size-5" />}
            title={copy.workflow.sessions.empty}
            description="No local recovery snapshot has been saved on this device yet."
            hint="Run a mission in browser preview or advanced mode, then return here to resume from a saved checkpoint."
            actionLabel="Refresh"
            onAction={() => void refresh()}
          />
        ) : (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#6B5A4A] transition-colors hover:bg-[#F8F4F0]"
              >
                <RotateCcw className="size-3" />
                Refresh
              </button>
            </div>

            {snapshots.map(snapshot => (
              <button
                key={snapshot.id}
                onClick={() => void handleSelect(snapshot)}
                className="w-full rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3 text-left transition-colors hover:bg-[#F0E8E0]"
              >
                <p className="mb-1 truncate text-xs font-medium text-[#3A2A1A]">
                  {snapshot.missionTitle}
                </p>
                <div className="mb-1.5 flex items-center justify-between text-[10px] text-[#B0A090]">
                  <span>
                    {copy.workflow.sessions.savedAt}{" "}
                    {formatTime(snapshot.createdAt)}
                  </span>
                  <span>
                    {copy.workflow.sessions.progress}{" "}
                    {Math.round(snapshot.missionProgress)}%
                  </span>
                </div>
                <Progress
                  value={snapshot.missionProgress}
                  className="h-1 bg-stone-100"
                  aria-label={`${Math.round(snapshot.missionProgress)}%`}
                />
              </button>
            ))}
          </>
        )}
      </div>

      {candidate ? (
        <RecoveryDialog
          candidate={candidate}
          onResume={() => void handleResume()}
          onDiscard={() => void handleDiscard()}
          isRestoring={isRestoring}
          restoreProgress={restoreProgress}
          restorePhase={restorePhase}
        />
      ) : null}
    </div>
  );
}
