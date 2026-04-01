/**
 * Snapshot Scheduler
 *
 * 定时和事件驱动的快照触发器。
 * - createSnapshotScheduler: 工厂函数，返回 SnapshotScheduler 实例
 * - start(missionId): 启动定时快照（默认 30s 间隔）
 * - stop(): 停止定时器
 * - triggerImmediate(): 立即触发一次快照
 * - isRunning(): 返回定时器是否活跃
 *
 * Requirements: 1.1, 1.2, 8.2
 */

import type { SnapshotPayload } from "../../../shared/mission/contracts";
import { serializeSnapshot } from "./snapshot-serializer";
import { saveSnapshot, pruneSnapshots } from "./browser-runtime-storage";

const MAX_SNAPSHOTS = 5;

export interface SnapshotScheduler {
  start(missionId: string): void;
  stop(): void;
  triggerImmediate(): Promise<void>;
  isRunning(): boolean;
}

export interface SnapshotSchedulerOptions {
  intervalMs: number;
  collectState: () => SnapshotPayload;
  onError?: (error: Error) => void;
}

/**
 * 执行一次完整的快照周期：收集状态 → 序列化 → 保存 → 修剪
 */
async function performSnapshotCycle(
  missionId: string,
  collectState: () => SnapshotPayload,
  onError: (error: Error) => void,
): Promise<void> {
  try {
    const payload = collectState();

    const missionTitle = payload.mission?.title ?? "Unknown";
    const missionStatus = payload.mission?.status ?? "running";
    // Simple progress heuristic: default to 0 if not derivable
    const missionProgress =
      typeof (payload.mission as any)?.progress === "number"
        ? (payload.mission as any).progress
        : 0;

    const record = await serializeSnapshot(payload, {
      missionId,
      missionTitle,
      missionProgress,
      missionStatus,
    });

    await saveSnapshot(record);
    await pruneSnapshots(MAX_SNAPSHOTS);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export function createSnapshotScheduler(
  options: SnapshotSchedulerOptions,
): SnapshotScheduler {
  const { intervalMs, collectState, onError } = options;
  const handleError = onError ?? ((err: Error) => console.error("[SnapshotScheduler]", err));

  let timerId: ReturnType<typeof setInterval> | null = null;
  let currentMissionId: string | null = null;

  return {
    start(missionId: string): void {
      // Stop any existing timer first
      if (timerId !== null) {
        clearInterval(timerId);
      }
      currentMissionId = missionId;
      timerId = setInterval(() => {
        performSnapshotCycle(missionId, collectState, handleError);
      }, intervalMs);
    },

    stop(): void {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      currentMissionId = null;
    },

    async triggerImmediate(): Promise<void> {
      if (currentMissionId === null) {
        return;
      }
      await performSnapshotCycle(currentMissionId, collectState, handleError);
    },

    isRunning(): boolean {
      return timerId !== null;
    },
  };
}
