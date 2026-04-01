/**
 * RecoveryDialog — 恢复对话框
 *
 * 检测到未完成快照时弹出，提供 Resume / Discard 选项。
 * 损坏或版本不兼容的快照仅显示 Discard。
 * 恢复过程中显示进度条和阶段描述。
 *
 * Requirements: 2.2, 2.5, 2.6, 7.1, 7.2, 7.3
 */

import { AlertTriangle, Play, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import type { RecoveryCandidate } from "@/lib/recovery-detector";

export interface RecoveryDialogProps {
  candidate: RecoveryCandidate;
  onResume: () => void;
  onDiscard: () => void;
  isRestoring: boolean;
  restoreProgress: number; // 0-100
  restorePhase: string; // "恢复 Mission 数据..." 等
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

const ERROR_MESSAGES: Record<string, string> = {
  checksum_mismatch: "快照数据已损坏，无法恢复",
  version_incompatible: "快照版本不兼容，无法恢复",
};

export function RecoveryDialog({
  candidate,
  onResume,
  onDiscard,
  isRestoring,
  restoreProgress,
  restorePhase,
}: RecoveryDialogProps) {
  const { snapshot, isValid, invalidReason } = candidate;

  return (
    <Dialog open modal>
      <DialogContent
        showCloseButton={false}
        className="max-w-md rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]"
        onPointerDownOutside={(e: Event) => e.preventDefault()}
        onEscapeKeyDown={(e: Event) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-stone-200/80 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-stone-900">
            <RotateCcw className="size-4 text-amber-600" />
            检测到未完成的任务
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-stone-500">
            {isValid
              ? "上次会话中有未完成的 Mission，是否恢复？"
              : "上次会话中有未完成的 Mission，但快照存在问题。"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-6 py-5">
          {/* Mission info */}
          <div className="grid gap-2">
            <p className="text-sm font-medium text-stone-800 truncate">
              {snapshot.missionTitle}
            </p>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>保存于 {formatTime(snapshot.createdAt)}</span>
              <span>进度 {Math.round(snapshot.missionProgress)}%</span>
            </div>
            {/* Mini progress indicator for mission progress */}
            <Progress
              value={snapshot.missionProgress}
              className="h-1.5 bg-stone-100"
              aria-label={`Mission 进度 ${Math.round(snapshot.missionProgress)}%`}
            />
          </div>

          {/* Error state for invalid snapshots */}
          {!isValid && invalidReason && (
            <div
              className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{ERROR_MESSAGES[invalidReason]}</span>
            </div>
          )}

          {/* Restore progress */}
          {isRestoring && (
            <div className="grid gap-2" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>{restorePhase}</span>
                <span>{Math.round(restoreProgress)}%</span>
              </div>
              <Progress
                value={restoreProgress}
                className="h-2 bg-stone-100"
                aria-label={`恢复进度 ${Math.round(restoreProgress)}%`}
              />
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-stone-200/80 px-6 py-5">
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white/80"
            onClick={onDiscard}
            disabled={isRestoring}
            aria-label="丢弃快照"
          >
            <Trash2 className="size-4" />
            丢弃
          </Button>
          {isValid && (
            <Button
              type="button"
              className="rounded-full bg-[#d07a4f] text-white hover:bg-[#c26d42]"
              onClick={onResume}
              disabled={isRestoring}
              aria-label="恢复任务"
            >
              <Play className="size-4" />
              恢复
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
