import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import type { SecurityAuditEntry } from "../../../shared/executor/contracts.js";

/**
 * Append-only audit logger that writes SecurityAuditEntry records
 * to `<dataRoot>/security-audit.jsonl` (one JSON object per line).
 */
export class SecurityAuditLogger {
  private readonly filePath: string;

  constructor(private readonly dataRoot: string) {
    this.filePath = join(dataRoot, "security-audit.jsonl");
  }

  /**
   * Append an audit entry. Timestamp is added automatically.
   */
  log(entry: Omit<SecurityAuditEntry, "timestamp">): void {
    const full: SecurityAuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, "utf-8");
  }

  /**
   * Return all audit entries for a given jobId.
   */
  getByJobId(jobId: string): SecurityAuditEntry[] {
    return this.readAll().filter((e) => e.jobId === jobId);
  }

  /**
   * Return all audit entries, optionally limited to the most recent `limit`.
   */
  getAll(limit?: number): SecurityAuditEntry[] {
    const all = this.readAll();
    if (limit !== undefined && limit >= 0) {
      return all.slice(-limit);
    }
    return all;
  }

  /* ── internal ── */

  private readAll(): SecurityAuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SecurityAuditEntry);
  }
}
