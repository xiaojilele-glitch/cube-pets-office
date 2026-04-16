/**
 * 纯前端模式遥测 IndexedDB 存储
 *
 * 在 IndexedDB 中缓存遥测快照，支持页面刷新后恢复。
 * 同时提供 recordBrowserLLMCall 用于在浏览器端 LLM 调用后更新遥测指标。
 */

import type { TelemetrySnapshot, LLMCallRecord } from "@shared/telemetry";
import { useTelemetryStore } from "./telemetry-store";

const DB_NAME = "cpo_telemetry";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "current";

function openTelemetryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 将遥测快照持久化到 IndexedDB */
export async function saveTelemetrySnapshot(
  snapshot: TelemetrySnapshot
): Promise<void> {
  try {
    const db = await openTelemetryDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[BrowserTelemetry] Failed to save snapshot:", err);
  }
}

/** 从 IndexedDB 恢复遥测快照 */
export async function loadTelemetrySnapshot(): Promise<TelemetrySnapshot | null> {
  try {
    const db = await openTelemetryDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
    const result = await new Promise<TelemetrySnapshot | undefined>(
      (resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    return result ?? null;
  } catch (err) {
    console.warn("[BrowserTelemetry] Failed to load snapshot:", err);
    return null;
  }
}

function createEmptySnapshot(): TelemetrySnapshot {
  return {
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCost: 0,
    totalCalls: 0,
    activeAgentCount: 0,
    agentTimings: [],
    missionStageTimings: [],
    alerts: [],
    updatedAt: Date.now(),
  };
}

/** 记录一次浏览器端 LLM 调用并更新遥测快照 */
export function recordBrowserLLMCall(record: LLMCallRecord): void {
  const store = useTelemetryStore.getState();
  const prev = store.snapshot ?? createEmptySnapshot();

  const updated: TelemetrySnapshot = {
    ...prev,
    totalTokensIn: prev.totalTokensIn + record.tokensIn,
    totalTokensOut: prev.totalTokensOut + record.tokensOut,
    totalCost: prev.totalCost + record.cost,
    totalCalls: prev.totalCalls + 1,
    updatedAt: Date.now(),
  };

  store.setSnapshot(updated);
  saveTelemetrySnapshot(updated).catch(() => {});
}
