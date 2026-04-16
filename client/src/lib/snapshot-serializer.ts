/**
 * Snapshot Serializer
 *
 * 封装 Web Worker 通信和主线程回退逻辑，提供快照序列化和校验功能。
 * - serializeSnapshot: 优先使用 Worker 序列化，失败时回退到主线程
 * - validateChecksum: 重新计算 SHA-256 校验 payload 完整性
 *
 * Requirements: 5.1, 5.2, 5.3, 8.1
 */

import type {
  SnapshotPayload,
  SnapshotRecord,
  MissionStatus,
} from "../../../shared/mission/contracts";
import { SNAPSHOT_VERSION } from "../../../shared/mission/contracts";
import type { WorkerRequest, WorkerResponse } from "../workers/snapshot-worker";

export interface SnapshotMeta {
  missionId: string;
  missionTitle: string;
  missionProgress: number;
  missionStatus: MissionStatus;
}

/** Worker 响应超时时间（毫秒） */
const WORKER_TIMEOUT_MS = 10_000;

// ─── 工具函数 ───

async function computeSHA256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 主线程回退序列化：当 Worker 不可用时在主线程执行。
 */
async function serializeOnMainThread(
  payload: SnapshotPayload,
  meta: SnapshotMeta
): Promise<SnapshotRecord> {
  const payloadJson = JSON.stringify(payload);
  const checksum = await computeSHA256Hex(payloadJson);

  return {
    id: crypto.randomUUID(),
    missionId: meta.missionId,
    version: SNAPSHOT_VERSION,
    checksum,
    createdAt: Date.now(),
    missionTitle: meta.missionTitle,
    missionProgress: meta.missionProgress,
    missionStatus: meta.missionStatus,
    payload,
  };
}

/**
 * 通过 Web Worker 序列化快照。
 * 返回 Promise，在 Worker 响应或超时后 resolve/reject。
 */
function serializeViaWorker(
  worker: Worker,
  payload: SnapshotPayload,
  meta: SnapshotMeta
): Promise<SnapshotRecord> {
  return new Promise<SnapshotRecord>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Snapshot worker timed out"));
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      const resp = event.data;
      if (resp.type === "serialized") {
        resolve(resp.record);
      } else {
        reject(new Error(resp.message));
      }
    };

    worker.onerror = err => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(err.message || "Worker error"));
    };

    const request: WorkerRequest = {
      type: "serialize",
      payload,
      missionId: meta.missionId,
      missionTitle: meta.missionTitle,
      missionProgress: meta.missionProgress,
      missionStatus: meta.missionStatus,
    };

    worker.postMessage(request);
  });
}

/**
 * 序列化快照：优先使用 Web Worker，Worker 创建失败时回退到主线程。
 */
export async function serializeSnapshot(
  payload: SnapshotPayload,
  meta: SnapshotMeta
): Promise<SnapshotRecord> {
  try {
    const worker = new Worker(
      new URL("../workers/snapshot-worker.ts", import.meta.url),
      { type: "module" }
    );
    return await serializeViaWorker(worker, payload, meta);
  } catch {
    // Worker 创建失败（测试环境、不支持的浏览器等），回退到主线程
    return serializeOnMainThread(payload, meta);
  }
}

/**
 * 校验快照 checksum：重新计算 payload 的 SHA-256 并与记录中的 checksum 比较。
 */
export async function validateChecksum(
  record: SnapshotRecord
): Promise<boolean> {
  const payloadJson = JSON.stringify(record.payload);
  const computed = await computeSHA256Hex(payloadJson);
  return computed === record.checksum;
}
