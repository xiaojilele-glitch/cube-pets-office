/**
 * Collaboration Replay System — Browser Replay Store
 *
 * IndexedDB-backed hot data store for replay events, timelines, and snapshots.
 * Implements the same ReplayStoreInterface as ServerReplayStore.
 *
 * Database: 'replay-db', version 1
 * Object stores:
 *   - replay-events     (keyPath: eventId, indexes: missionId, timestamp)
 *   - replay-timelines  (keyPath: missionId)
 *   - replay-snapshots  (keyPath: snapshotId, index: missionId)
 *
 * Requirements: 19.1
 */

import type {
  ExecutionEvent,
  EventQuery,
  ExecutionTimeline,
  ReplayEventType,
} from "../../../../shared/replay/contracts";
import type { ReplayStoreInterface } from "../../../../shared/replay/store-interface";

// ---------------------------------------------------------------------------
// IndexedDB constants
// ---------------------------------------------------------------------------

const DB_NAME = "replay-db";
const DB_VERSION = 1;
const STORE_EVENTS = "replay-events";
const STORE_TIMELINES = "replay-timelines";
const STORE_SNAPSHOTS = "replay-snapshots";

// ---------------------------------------------------------------------------
// IndexedDB promise helpers
// ---------------------------------------------------------------------------

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openReplayDatabase(): Promise<IDBDatabase> {
  if (
    typeof window === "undefined" ||
    typeof window.indexedDB === "undefined"
  ) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const evStore = db.createObjectStore(STORE_EVENTS, {
            keyPath: "eventId",
          });
          evStore.createIndex("missionId", "missionId", { unique: false });
          evStore.createIndex("timestamp", "timestamp", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_TIMELINES)) {
          db.createObjectStore(STORE_TIMELINES, { keyPath: "missionId" });
        }

        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const snapStore = db.createObjectStore(STORE_SNAPSHOTS, {
            keyPath: "snapshotId",
          });
          snapStore.createIndex("missionId", "missionId", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Index helpers (same logic as ServerReplayStore)
// ---------------------------------------------------------------------------

function buildIndices(events: ExecutionEvent[]): ExecutionTimeline["indices"] {
  const byTime = new Map<number, number[]>();
  const byAgent = new Map<string, number[]>();
  const byType = new Map<ReplayEventType, number[]>();
  const byResource = new Map<string, number[]>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    const timeBucket = Math.floor(ev.timestamp / 1000) * 1000;
    if (!byTime.has(timeBucket)) byTime.set(timeBucket, []);
    byTime.get(timeBucket)!.push(i);

    if (!byAgent.has(ev.sourceAgent)) byAgent.set(ev.sourceAgent, []);
    byAgent.get(ev.sourceAgent)!.push(i);
    if (ev.targetAgent) {
      if (!byAgent.has(ev.targetAgent)) byAgent.set(ev.targetAgent, []);
      byAgent.get(ev.targetAgent)!.push(i);
    }

    if (!byType.has(ev.eventType)) byType.set(ev.eventType, []);
    byType.get(ev.eventType)!.push(i);

    const resourceId = (ev.eventData as Record<string, unknown>)?.resourceId;
    if (typeof resourceId === "string") {
      if (!byResource.has(resourceId)) byResource.set(resourceId, []);
      byResource.get(resourceId)!.push(i);
    }
  }

  return { byTime, byAgent, byType, byResource };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// BrowserReplayStore
// ---------------------------------------------------------------------------

export class BrowserReplayStore implements ReplayStoreInterface {
  /** Put events into the replay-events store. */
  async appendEvents(
    missionId: string,
    events: ExecutionEvent[]
  ): Promise<void> {
    if (events.length === 0) return;

    const db = await openReplayDatabase();
    const tx = db.transaction([STORE_EVENTS, STORE_TIMELINES], "readwrite");
    const evStore = tx.objectStore(STORE_EVENTS);

    for (const event of events) {
      evStore.put(event);
    }

    await transactionToPromise(tx);

    // Rebuild timeline metadata after appending
    const allEvents = await this.getEventsByMission(missionId);
    await this.saveTimelineMeta(missionId, allEvents);
  }

  /** Query events by missionId index, then filter in memory. */
  async queryEvents(query: EventQuery): Promise<ExecutionEvent[]> {
    let events = await this.getEventsByMission(query.missionId);

    if (query.timeRange) {
      const { start, end } = query.timeRange;
      events = events.filter(e => e.timestamp >= start && e.timestamp <= end);
    }

    if (query.agentIds && query.agentIds.length > 0) {
      const agentSet = new Set(query.agentIds);
      events = events.filter(
        e =>
          agentSet.has(e.sourceAgent) ||
          (e.targetAgent && agentSet.has(e.targetAgent))
      );
    }

    if (query.eventTypes && query.eventTypes.length > 0) {
      const typeSet = new Set(query.eventTypes);
      events = events.filter(e => typeSet.has(e.eventType));
    }

    if (query.resourceIds && query.resourceIds.length > 0) {
      const resSet = new Set(query.resourceIds);
      events = events.filter(e => {
        const rid = (e.eventData as Record<string, unknown>)?.resourceId;
        return typeof rid === "string" && resSet.has(rid);
      });
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? events.length;
    return events.slice(offset, offset + limit);
  }

  /** Get timeline from stored metadata, or build from events. */
  async getTimeline(missionId: string): Promise<ExecutionTimeline> {
    const events = await this.getEventsByMission(missionId);

    const db = await openReplayDatabase();
    const tx = db.transaction(STORE_TIMELINES, "readonly");
    const store = tx.objectStore(STORE_TIMELINES);
    const stored = await requestToPromise(store.get(missionId));
    await transactionToPromise(tx);

    if (stored) {
      return {
        missionId: stored.missionId,
        events,
        startTime: stored.startTime,
        endTime: stored.endTime,
        totalDuration: stored.totalDuration,
        eventCount: stored.eventCount,
        indices: buildIndices(events),
        version: stored.version,
        checksum: stored.checksum,
      };
    }

    // No stored timeline — build from scratch
    const startTime = events.length > 0 ? events[0].timestamp : 0;
    const endTime = events.length > 0 ? events[events.length - 1].timestamp : 0;

    return {
      missionId,
      events,
      startTime,
      endTime,
      totalDuration: endTime - startTime,
      eventCount: events.length,
      indices: buildIndices(events),
      version: 0,
      checksum: "",
    };
  }

  /** Export events as JSON or CSV. */
  async exportEvents(
    missionId: string,
    format: "json" | "csv"
  ): Promise<string> {
    const events = await this.getEventsByMission(missionId);

    if (format === "json") {
      return JSON.stringify(events, null, 2);
    }

    const headers = [
      "eventId",
      "missionId",
      "timestamp",
      "eventType",
      "sourceAgent",
      "targetAgent",
    ];
    const rows = events.map(e =>
      [
        e.eventId,
        e.missionId,
        String(e.timestamp),
        e.eventType,
        e.sourceAgent,
        e.targetAgent ?? "",
      ]
        .map(csvEscape)
        .join(",")
    );
    return [headers.join(","), ...rows].join("\n");
  }

  /** Verify eventCount matches actual stored events. */
  async verifyIntegrity(missionId: string): Promise<boolean> {
    const db = await openReplayDatabase();
    const tx = db.transaction(STORE_TIMELINES, "readonly");
    const store = tx.objectStore(STORE_TIMELINES);
    const stored = await requestToPromise(store.get(missionId));
    await transactionToPromise(tx);

    if (!stored) return false;

    const events = await this.getEventsByMission(missionId);
    return events.length === stored.eventCount;
  }

  /** No-op for browser store — IndexedDB manages its own storage. */
  async compact(_missionId: string): Promise<void> {
    // No-op: IndexedDB handles storage internally
  }

  /** Delete events older than the given number of days. */
  async cleanup(olderThanDays: number): Promise<number> {
    const thresholdMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    const db = await openReplayDatabase();
    const tx = db.transaction(STORE_EVENTS, "readwrite");
    const store = tx.objectStore(STORE_EVENTS);
    const index = store.index("timestamp");

    const range = IDBKeyRange.upperBound(thresholdMs);
    let cleaned = 0;

    return new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range);

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cleaned++;
          cursor.continue();
        } else {
          // Cursor exhausted — commit
          tx.oncomplete = () => resolve(cleaned);
        }
      };

      cursorReq.onerror = () => reject(cursorReq.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Fetch all events for a missionId via the index, sorted by timestamp. */
  private async getEventsByMission(
    missionId: string
  ): Promise<ExecutionEvent[]> {
    const db = await openReplayDatabase();
    const tx = db.transaction(STORE_EVENTS, "readonly");
    const store = tx.objectStore(STORE_EVENTS);
    const index = store.index("missionId");

    const events = await requestToPromise(
      index.getAll(IDBKeyRange.only(missionId)) as IDBRequest<ExecutionEvent[]>
    );
    await transactionToPromise(tx);

    events.sort((a, b) => a.timestamp - b.timestamp);
    return events;
  }

  /** Persist timeline metadata to the timelines store. */
  private async saveTimelineMeta(
    missionId: string,
    events: ExecutionEvent[]
  ): Promise<void> {
    const db = await openReplayDatabase();
    const tx = db.transaction(STORE_TIMELINES, "readwrite");
    const store = tx.objectStore(STORE_TIMELINES);

    const existing = await requestToPromise(store.get(missionId));
    const version = existing ? (existing.version ?? 0) + 1 : 1;

    const startTime = events.length > 0 ? events[0].timestamp : 0;
    const endTime = events.length > 0 ? events[events.length - 1].timestamp : 0;

    store.put({
      missionId,
      startTime,
      endTime,
      totalDuration: endTime - startTime,
      eventCount: events.length,
      version,
      checksum: "",
    });

    await transactionToPromise(tx);
  }
}
