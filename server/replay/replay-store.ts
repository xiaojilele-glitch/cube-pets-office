/**
 * Collaboration Replay System — Server Replay Store
 *
 * JSONL 文件持久化 + 多维索引 + gzip 压缩 + SHA-256 校验。
 *
 * 存储结构：
 *   data/replay/{missionId}/events.jsonl   — 事件流（每行一个 JSON）
 *   data/replay/{missionId}/timeline.json  — 时间轴元数据 + 序列化索引
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 19.1, 19.2, 19.3, 19.4, 19.5
 */

import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

import type {
  ExecutionEvent,
  EventQuery,
  ExecutionTimeline,
  ReplayEventType,
} from "../../shared/replay/contracts.js";
import type { ReplayStoreInterface } from "../../shared/replay/store-interface.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/* ─── Serialised timeline shape (Maps → plain objects) ─── */

interface SerializedIndices {
  byTime: Record<string, number[]>;
  byAgent: Record<string, number[]>;
  byType: Record<string, number[]>;
  byResource: Record<string, number[]>;
}

interface SerializedTimeline {
  missionId: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  eventCount: number;
  indices: SerializedIndices;
  version: number;
  checksum: string;
}

/* ─── Helpers ─── */

const BASE_DIR = resolve("data/replay");

function missionDir(missionId: string): string {
  return join(BASE_DIR, missionId);
}

function eventsPath(missionId: string): string {
  return join(missionDir(missionId), "events.jsonl");
}

function timelinePath(missionId: string): string {
  return join(missionDir(missionId), "timeline.json");
}

/** Compute SHA-256 hex digest of a buffer or string. */
function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Read all events from a JSONL file. Returns [] if file doesn't exist. */
async function readEventsFile(missionId: string): Promise<ExecutionEvent[]> {
  const filePath = eventsPath(missionId);
  if (!existsSync(filePath)) return [];

  const raw = await readFile(filePath, "utf-8");
  if (raw.trim().length === 0) return [];

  const lines = raw.trim().split("\n");
  const events: ExecutionEvent[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    // Support gzip-compressed lines (base64-encoded)
    if (line.startsWith("gz:")) {
      const buf = Buffer.from(line.slice(3), "base64");
      const decompressed = await gunzipAsync(buf);
      events.push(JSON.parse(decompressed.toString("utf-8")) as ExecutionEvent);
    } else {
      events.push(JSON.parse(line) as ExecutionEvent);
    }
  }
  return events;
}

/** Build multi-dimensional indices from an event array. */
function buildIndices(events: ExecutionEvent[]): ExecutionTimeline["indices"] {
  const byTime = new Map<number, number[]>();
  const byAgent = new Map<string, number[]>();
  const byType = new Map<ReplayEventType, number[]>();
  const byResource = new Map<string, number[]>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    // byTime — bucket by second (floor to nearest second)
    const timeBucket = Math.floor(ev.timestamp / 1000) * 1000;
    if (!byTime.has(timeBucket)) byTime.set(timeBucket, []);
    byTime.get(timeBucket)!.push(i);

    // byAgent — sourceAgent (and targetAgent if present)
    if (!byAgent.has(ev.sourceAgent)) byAgent.set(ev.sourceAgent, []);
    byAgent.get(ev.sourceAgent)!.push(i);
    if (ev.targetAgent) {
      if (!byAgent.has(ev.targetAgent)) byAgent.set(ev.targetAgent, []);
      byAgent.get(ev.targetAgent)!.push(i);
    }

    // byType
    if (!byType.has(ev.eventType)) byType.set(ev.eventType, []);
    byType.get(ev.eventType)!.push(i);

    // byResource — extract resourceId from eventData if present
    const resourceId = (ev.eventData as Record<string, unknown>)?.resourceId;
    if (typeof resourceId === "string") {
      if (!byResource.has(resourceId)) byResource.set(resourceId, []);
      byResource.get(resourceId)!.push(i);
    }
  }

  return { byTime, byAgent, byType, byResource };
}

/** Convert Map-based indices to plain objects for JSON serialization. */
function serializeIndices(
  indices: ExecutionTimeline["indices"]
): SerializedIndices {
  const toObj = <K extends string | number, V>(
    m: Map<K, V>
  ): Record<string, V> => {
    const obj: Record<string, V> = {};
    Array.from(m.entries()).forEach(([k, v]) => {
      obj[String(k)] = v;
    });
    return obj;
  };
  return {
    byTime: toObj(indices.byTime),
    byAgent: toObj(indices.byAgent),
    byType: toObj(indices.byType),
    byResource: toObj(indices.byResource),
  };
}

/** Convert plain-object indices back to Maps. */
function deserializeIndices(
  s: SerializedIndices
): ExecutionTimeline["indices"] {
  const toMap = <K extends string | number>(
    obj: Record<string, number[]>,
    parseKey?: (k: string) => K
  ): Map<K, number[]> => {
    const m = new Map<K, number[]>();
    for (const [k, v] of Object.entries(obj)) {
      m.set((parseKey ? parseKey(k) : k) as K, v);
    }
    return m;
  };
  return {
    byTime: toMap<number>(s.byTime, Number),
    byAgent: toMap<string>(s.byAgent),
    byType: toMap<ReplayEventType>(s.byType as Record<string, number[]>),
    byResource: toMap<string>(s.byResource),
  };
}

/* ─── ServerReplayStore ─── */

export class ServerReplayStore implements ReplayStoreInterface {
  /* ── appendEvents ── */

  async appendEvents(
    missionId: string,
    events: ExecutionEvent[]
  ): Promise<void> {
    if (events.length === 0) return;

    const dir = missionDir(missionId);
    await mkdir(dir, { recursive: true });

    // Append events as JSONL (one JSON line per event)
    const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(eventsPath(missionId), lines, "utf-8");

    // Rebuild timeline metadata
    const allEvents = await readEventsFile(missionId);
    // Sort by timestamp to ensure correct ordering
    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    const indices = buildIndices(allEvents);
    const checksum = sha256(await readFile(eventsPath(missionId)));

    // Load existing version or start at 0
    let version = 0;
    const tlPath = timelinePath(missionId);
    if (existsSync(tlPath)) {
      try {
        const existing: SerializedTimeline = JSON.parse(
          await readFile(tlPath, "utf-8")
        );
        version = existing.version;
      } catch {
        // corrupted — reset
      }
    }
    version++;

    const startTime = allEvents[0].timestamp;
    const endTime = allEvents[allEvents.length - 1].timestamp;

    const serialized: SerializedTimeline = {
      missionId,
      startTime,
      endTime,
      totalDuration: endTime - startTime,
      eventCount: allEvents.length,
      indices: serializeIndices(indices),
      version,
      checksum,
    };

    await writeFile(tlPath, JSON.stringify(serialized, null, 2), "utf-8");
  }

  /* ── queryEvents ── */

  async queryEvents(query: EventQuery): Promise<ExecutionEvent[]> {
    let events = await readEventsFile(query.missionId);
    events.sort((a, b) => a.timestamp - b.timestamp);

    // Apply filters
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

    // Pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? events.length;
    return events.slice(offset, offset + limit);
  }

  /* ── getTimeline ── */

  async getTimeline(missionId: string): Promise<ExecutionTimeline> {
    const events = await readEventsFile(missionId);
    events.sort((a, b) => a.timestamp - b.timestamp);

    const tlPath = timelinePath(missionId);
    if (existsSync(tlPath)) {
      try {
        const serialized: SerializedTimeline = JSON.parse(
          await readFile(tlPath, "utf-8")
        );
        return {
          missionId: serialized.missionId,
          events,
          startTime: serialized.startTime,
          endTime: serialized.endTime,
          totalDuration: serialized.totalDuration,
          eventCount: serialized.eventCount,
          indices: deserializeIndices(serialized.indices),
          version: serialized.version,
          checksum: serialized.checksum,
        };
      } catch {
        // Fall through to rebuild
      }
    }

    // No timeline.json yet — build from scratch
    const indices = buildIndices(events);
    const checksum = existsSync(eventsPath(missionId))
      ? sha256(await readFile(eventsPath(missionId)))
      : sha256("");

    const startTime = events.length > 0 ? events[0].timestamp : 0;
    const endTime = events.length > 0 ? events[events.length - 1].timestamp : 0;

    return {
      missionId,
      events,
      startTime,
      endTime,
      totalDuration: endTime - startTime,
      eventCount: events.length,
      indices,
      version: 0,
      checksum,
    };
  }

  /* ── exportEvents ── */

  async exportEvents(
    missionId: string,
    format: "json" | "csv"
  ): Promise<string> {
    const events = await readEventsFile(missionId);
    events.sort((a, b) => a.timestamp - b.timestamp);

    if (format === "json") {
      return JSON.stringify(events, null, 2);
    }

    // CSV export
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

  /* ── verifyIntegrity ── */

  async verifyIntegrity(missionId: string): Promise<boolean> {
    const tlPath = timelinePath(missionId);
    if (!existsSync(tlPath)) return false;

    const evPath = eventsPath(missionId);
    if (!existsSync(evPath)) return false;

    try {
      const serialized: SerializedTimeline = JSON.parse(
        await readFile(tlPath, "utf-8")
      );
      const currentChecksum = sha256(await readFile(evPath));
      return currentChecksum === serialized.checksum;
    } catch {
      return false;
    }
  }

  /* ── compact ── */

  async compact(missionId: string): Promise<void> {
    const events = await readEventsFile(missionId);
    if (events.length === 0) return;

    // Rewrite events.jsonl with gzip-compressed lines
    const compressedLines: string[] = [];
    for (const event of events) {
      const json = JSON.stringify(event);
      const compressed = await gzipAsync(Buffer.from(json, "utf-8"));
      compressedLines.push("gz:" + compressed.toString("base64"));
    }

    const evPath = eventsPath(missionId);
    await writeFile(evPath, compressedLines.join("\n") + "\n", "utf-8");

    // Update timeline checksum and version
    const tlPath = timelinePath(missionId);
    const newChecksum = sha256(await readFile(evPath));

    if (existsSync(tlPath)) {
      try {
        const serialized: SerializedTimeline = JSON.parse(
          await readFile(tlPath, "utf-8")
        );
        serialized.checksum = newChecksum;
        serialized.version++;
        await writeFile(tlPath, JSON.stringify(serialized, null, 2), "utf-8");
      } catch {
        // ignore
      }
    }
  }

  /* ── cleanup ── */

  async cleanup(olderThanDays: number): Promise<number> {
    if (!existsSync(BASE_DIR)) return 0;

    const thresholdMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const entries = await readdir(BASE_DIR);
    let cleaned = 0;

    for (const entry of entries) {
      const dirPath = join(BASE_DIR, entry);
      try {
        const dirStat = await stat(dirPath);
        if (!dirStat.isDirectory()) continue;

        // Use the directory's modification time as the age indicator
        if (dirStat.mtimeMs < thresholdMs) {
          await rm(dirPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // skip entries we can't stat
      }
    }

    return cleaned;
  }
}

/* ─── CSV helper ─── */

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
