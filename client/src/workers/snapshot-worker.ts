/**
 * Snapshot Web Worker
 *
 * 在 Web Worker 中执行快照序列化和 SHA-256 校验和计算，
 * 避免阻塞主线程和 3D 渲染。
 *
 * Requirements: 5.1, 5.2, 8.1
 */

import type {
  SnapshotPayload,
  SnapshotRecord,
  MissionStatus,
} from "@shared/mission/contracts";
import { SNAPSHOT_VERSION } from "@shared/mission/contracts";

// ─── Worker 消息协议 ───

export type WorkerRequest = {
  type: "serialize";
  payload: SnapshotPayload;
  missionId: string;
  missionTitle: string;
  missionProgress: number;
  missionStatus: MissionStatus;
};

export type WorkerResponse =
  | { type: "serialized"; record: SnapshotRecord }
  | { type: "error"; message: string };

// ─── 工具函数 ───

async function computeSHA256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── 消息处理 ───

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const req = event.data;

    if (req.type !== "serialize") {
      const resp: WorkerResponse = {
        type: "error",
        message: `Unknown request type: ${(req as any).type}`,
      };
      self.postMessage(resp);
      return;
    }

    const payloadJson = JSON.stringify(req.payload);
    const checksum = await computeSHA256Hex(payloadJson);

    const record: SnapshotRecord = {
      id: crypto.randomUUID(),
      missionId: req.missionId,
      version: SNAPSHOT_VERSION,
      checksum,
      createdAt: Date.now(),
      missionTitle: req.missionTitle,
      missionProgress: req.missionProgress,
      missionStatus: req.missionStatus,
      payload: req.payload,
    };

    const resp: WorkerResponse = { type: "serialized", record };
    self.postMessage(resp);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const resp: WorkerResponse = { type: "error", message };
    self.postMessage(resp);
  }
};
