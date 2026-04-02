/**
 * Replay Audit Logger
 *
 * Records replay operations to `data/replay/{missionId}/audit.jsonl`
 * and supports querying audit entries by userId, missionId, and time range.
 *
 * Requirements: 20.1, 20.2
 */

import { resolve, join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import type { AuditEntry } from '../../shared/replay/contracts.js';

const BASE_DIR = resolve('data/replay');

function auditPath(missionId: string): string {
  return join(BASE_DIR, missionId, 'audit.jsonl');
}

export interface AuditQuery {
  userId?: string;
  missionId?: string;
  startTime?: number;
  endTime?: number;
}

export class ReplayAuditLogger {
  /**
   * Append an audit entry to the mission's audit.jsonl file.
   */
  async logAction(
    userId: string,
    missionId: string,
    action: AuditEntry['action'],
    details?: Record<string, unknown>,
  ): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: randomUUID(),
      userId,
      missionId,
      action,
      timestamp: Date.now(),
      details,
    };

    const dir = join(BASE_DIR, missionId);
    await mkdir(dir, { recursive: true });
    await appendFile(auditPath(missionId), JSON.stringify(entry) + '\n', 'utf-8');

    return entry;
  }

  /**
   * Query audit log entries. When missionId is provided, reads that mission's
   * audit file. Otherwise scans all mission directories (simplified: requires missionId).
   */
  async queryAuditLog(query: AuditQuery): Promise<AuditEntry[]> {
    if (!query.missionId) {
      return [];
    }

    const filePath = auditPath(query.missionId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return [];
    }

    const entries: AuditEntry[] = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEntry);

    return entries.filter((entry) => {
      if (query.userId && entry.userId !== query.userId) return false;
      if (query.startTime && entry.timestamp < query.startTime) return false;
      if (query.endTime && entry.timestamp > query.endTime) return false;
      return true;
    });
  }
}
