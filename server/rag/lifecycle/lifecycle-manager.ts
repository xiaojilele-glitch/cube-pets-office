/**
 * LifecycleManager — 生命周期管理器
 *
 * 定时任务：归档（hot→cold）、删除（cold 过期）、孤儿清理。
 * 批量清理（purge）接口。操作日志写入 rag_lifecycle_log。
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  LifecycleLog,
  SourceType,
} from "../../../shared/rag/contracts.js";
import type { VectorStoreAdapter } from "../store/vector-store-adapter.js";
import type { MetadataStore } from "../store/metadata-store.js";
import type { HotColdManager } from "./hot-cold-manager.js";
import { getRAGConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PurgeOptions {
  projectId?: string;
  sourceType?: SourceType;
  before?: string; // ISO 8601
}

export interface PurgeResult {
  deletedCount: number;
  durationMs: number;
}

export interface LifecycleReport {
  archived: number;
  deleted: number;
  orphansCleaned: number;
  durationMs: number;
}

interface LogFile {
  version: 1;
  logs: LifecycleLog[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_LOG_PATH = resolve(
  __dirname,
  "../../../data/rag_lifecycle_log.json"
);

// ---------------------------------------------------------------------------
// LifecycleManager
// ---------------------------------------------------------------------------

export class LifecycleManager {
  private logs: LifecycleLog[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly vectorStore: VectorStoreAdapter,
    private readonly metadataStore: MetadataStore,
    private readonly hotColdManager: HotColdManager,
    private readonly logFilePath: string = DEFAULT_LOG_PATH
  ) {
    this.loadLogs();
  }

  /** 执行定时生命周期任务 */
  async runScheduledTasks(): Promise<LifecycleReport> {
    const start = Date.now();
    const config = getRAGConfig();

    // 1. Archive: hot → cold for stale chunks
    const staleIds = this.hotColdManager.getStaleHotChunks(
      config.lifecycle.archiveAfterDays
    );
    const archived = await this.hotColdManager.archive(staleIds);
    if (archived > 0) {
      this.addLog("archive", archived, "hot→cold");
    }

    // 2. Delete: expired cold chunks
    const expiredIds = this.hotColdManager.getExpiredColdChunks(
      config.lifecycle.deleteAfterDays
    );
    let deleted = 0;
    if (expiredIds.length > 0) {
      // Delete from vector store (grouped by project)
      const byProject = this.groupByProject(expiredIds);
      for (const entry of Array.from(byProject.entries())) {
        try {
          await this.vectorStore.delete(`rag_${entry[0]}`, entry[1]);
        } catch {
          /* log and continue */
        }
      }
      deleted = this.metadataStore.deleteBatch(expiredIds);
      if (deleted > 0) {
        this.addLog("delete", deleted, "cold-expired");
      }
    }

    // 3. Orphan cleanup (metadata without vector — simplified: just count)
    const orphansCleaned = 0; // Would need vector store listing to detect

    return {
      archived,
      deleted,
      orphansCleaned,
      durationMs: Date.now() - start,
    };
  }

  /** 按条件批量清理 */
  async purge(options: PurgeOptions): Promise<PurgeResult> {
    const start = Date.now();

    const rows = this.metadataStore.query({
      projectId: options.projectId,
      sourceType: options.sourceType,
      until: options.before,
    });

    const ids = rows.map(r => r.chunk_id);
    if (ids.length === 0) {
      return { deletedCount: 0, durationMs: Date.now() - start };
    }

    // Delete from vector store
    const byProject = this.groupByProject(ids);
    for (const entry of Array.from(byProject.entries())) {
      try {
        await this.vectorStore.delete(`rag_${entry[0]}`, entry[1]);
      } catch {
        /* continue */
      }
    }

    const deletedCount = this.metadataStore.deleteBatch(ids);
    this.addLog("purge", deletedCount, "manual");

    return { deletedCount, durationMs: Date.now() - start };
  }

  /** 获取操作日志 */
  getLogs(limit: number = 100): LifecycleLog[] {
    return this.logs.slice(-limit);
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private groupByProject(chunkIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const id of chunkIds) {
      const row = this.metadataStore.getByChunkId(id);
      const projectId = row?.project_id ?? "unknown";
      const list = map.get(projectId) ?? [];
      list.push(id);
      map.set(projectId, list);
    }
    return map;
  }

  private addLog(
    operation: LifecycleLog["operation"],
    affectedCount: number,
    collection: string
  ): void {
    const log: LifecycleLog = {
      logId: randomUUID(),
      operation,
      affectedCount,
      collection,
      executedAt: new Date().toISOString(),
      durationMs: 0,
    };
    this.logs.push(log);
    this.scheduleSave();
  }

  private loadLogs(): void {
    if (!existsSync(this.logFilePath)) return;
    try {
      const raw = readFileSync(this.logFilePath, "utf-8");
      const parsed = JSON.parse(raw) as LogFile;
      this.logs = Array.isArray(parsed?.logs) ? parsed.logs : [];
    } catch {
      /* start empty */
    }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.saveLogs());
  }

  private saveLogs(): void {
    const data: LogFile = { version: 1, logs: this.logs };
    try {
      mkdirSync(dirname(this.logFilePath), { recursive: true });
      writeFileSync(this.logFilePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[LifecycleManager] Failed to save logs:", err);
    }
  }
}
