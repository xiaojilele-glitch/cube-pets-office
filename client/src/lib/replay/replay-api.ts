/**
 * Collaboration Replay — REST API Client
 *
 * Thin fetch wrappers for the replay REST endpoints.
 * Follows the same patterns as mission-client.ts.
 *
 * Requirements: 6.2, 7.1
 */

import type {
  ExecutionEvent,
  ExecutionTimeline,
  ReplayEventType,
  ReplaySnapshot,
} from "../../../../shared/replay/contracts";

/* ─── Helpers ─── */

function withQuery(
  path: string,
  query?: Record<string, string | number | null | undefined>
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const error =
      typeof data?.error === "string"
        ? data.error
        : `Replay API ${response.status}`;
    throw new Error(error);
  }
  return data as T;
}

/* ─── Timeline metadata (without events array) ─── */

export async function fetchReplayTimeline(
  missionId: string
): Promise<Omit<ExecutionTimeline, "events" | "indices">> {
  const response = await fetch(`/api/replay/${encodeURIComponent(missionId)}`);
  return parseJson(response);
}

/* ─── Query events with optional filters ─── */

export interface ReplayEventsQuery {
  agentId?: string;
  eventType?: ReplayEventType;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export async function fetchReplayEvents(
  missionId: string,
  query?: ReplayEventsQuery
): Promise<ExecutionEvent[]> {
  const url = withQuery(
    `/api/replay/${encodeURIComponent(missionId)}/events`,
    query as Record<string, string | number | null | undefined>
  );
  const response = await fetch(url);
  return parseJson<ExecutionEvent[]>(response);
}

/* ─── Export events (JSON or CSV) ─── */

export async function fetchReplayExport(
  missionId: string,
  format: "json" | "csv" = "json"
): Promise<string> {
  const url = withQuery(`/api/replay/${encodeURIComponent(missionId)}/export`, {
    format,
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Replay export failed: ${response.status}`);
  }
  return response.text();
}

/* ─── Verify data integrity ─── */

export async function verifyReplayIntegrity(
  missionId: string
): Promise<{ valid: boolean }> {
  const response = await fetch(
    `/api/replay/${encodeURIComponent(missionId)}/verify`,
    { method: "POST" }
  );
  return parseJson(response);
}

/* ─── Snapshots ─── */

export async function fetchReplaySnapshots(
  missionId: string
): Promise<ReplaySnapshot[]> {
  const response = await fetch(
    `/api/replay/${encodeURIComponent(missionId)}/snapshots`
  );
  return parseJson<ReplaySnapshot[]>(response);
}

export async function createReplaySnapshot(
  missionId: string,
  snapshot: Partial<ReplaySnapshot>
): Promise<ReplaySnapshot> {
  const response = await fetch(
    `/api/replay/${encodeURIComponent(missionId)}/snapshots`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    }
  );
  return parseJson<ReplaySnapshot>(response);
}

/* ─── Audit log ─── */

export interface AuditLogQuery {
  userId?: string;
  startTime?: number;
  endTime?: number;
}

export async function fetchReplayAuditLog(
  missionId: string,
  query?: AuditLogQuery
): Promise<unknown[]> {
  const url = withQuery(
    `/api/replay/${encodeURIComponent(missionId)}/audit`,
    query as Record<string, string | number | null | undefined>
  );
  const response = await fetch(url);
  return parseJson<unknown[]>(response);
}
