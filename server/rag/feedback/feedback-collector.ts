/**
 * FeedbackCollector — 反馈收集
 *
 * 实现 recordImplicit（计算 utilizationRate）和 recordExplicit。
 * 持久化到 rag_feedback JSON 文件。
 *
 * Requirements: 6.1, 6.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { FeedbackRecord } from "../../../shared/rag/contracts.js";

interface FeedbackFile {
  version: 1;
  records: FeedbackRecord[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_FILE_PATH = resolve(__dirname, "../../../data/rag_feedback.json");

export interface ExplicitFeedback {
  taskId: string;
  agentId: string;
  projectId: string;
  helpfulChunkIds: string[];
  irrelevantChunkIds: string[];
  missingContext?: string;
}

export interface FeedbackStatsOptions {
  projectId?: string;
  sourceType?: string;
  since?: string;
  until?: string;
}

export interface FeedbackStats {
  totalFeedbacks: number;
  avgUtilizationRate: number;
  totalHelpful: number;
  totalIrrelevant: number;
}

export class FeedbackCollector {
  private records: FeedbackRecord[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = DEFAULT_FILE_PATH) {
    this.load();
  }

  /** 记录隐式反馈（utilizationRate = usedCount / injectedCount） */
  recordImplicit(
    taskId: string,
    agentId: string,
    projectId: string,
    injectedCount: number,
    usedCount: number
  ): FeedbackRecord {
    const utilizationRate = injectedCount > 0 ? usedCount / injectedCount : 0;
    const record: FeedbackRecord = {
      feedbackId: randomUUID(),
      taskId,
      agentId,
      projectId,
      helpfulChunkIds: [],
      irrelevantChunkIds: [],
      utilizationRate,
      timestamp: new Date().toISOString(),
    };
    this.records.push(record);
    this.scheduleSave();
    return record;
  }

  /** 记录显式反馈 */
  recordExplicit(feedback: ExplicitFeedback): FeedbackRecord {
    const record: FeedbackRecord = {
      feedbackId: randomUUID(),
      taskId: feedback.taskId,
      agentId: feedback.agentId,
      projectId: feedback.projectId,
      helpfulChunkIds: feedback.helpfulChunkIds,
      irrelevantChunkIds: feedback.irrelevantChunkIds,
      missingContext: feedback.missingContext,
      utilizationRate: 0,
      timestamp: new Date().toISOString(),
    };
    this.records.push(record);
    this.scheduleSave();
    return record;
  }

  /** 获取反馈统计 */
  getStats(options?: FeedbackStatsOptions): FeedbackStats {
    let filtered = this.records;
    if (options?.projectId)
      filtered = filtered.filter(r => r.projectId === options.projectId);
    if (options?.since)
      filtered = filtered.filter(r => r.timestamp >= options.since!);
    if (options?.until)
      filtered = filtered.filter(r => r.timestamp <= options.until!);

    const totalFeedbacks = filtered.length;
    const avgUtilizationRate =
      totalFeedbacks > 0
        ? filtered.reduce((sum, r) => sum + r.utilizationRate, 0) /
          totalFeedbacks
        : 0;
    const totalHelpful = filtered.reduce(
      (sum, r) => sum + r.helpfulChunkIds.length,
      0
    );
    const totalIrrelevant = filtered.reduce(
      (sum, r) => sum + r.irrelevantChunkIds.length,
      0
    );

    return {
      totalFeedbacks,
      avgUtilizationRate,
      totalHelpful,
      totalIrrelevant,
    };
  }

  /** 获取最近的 utilizationRate 值列表 */
  recentUtilizationRates(limit: number = 10): number[] {
    return this.records.slice(-limit).map(r => r.utilizationRate);
  }

  count(): number {
    return this.records.length;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as FeedbackFile;
      this.records = Array.isArray(parsed?.records) ? parsed.records : [];
    } catch {
      /* start empty */
    }
  }

  private scheduleSave(): void {
    this.writeQueue = this.writeQueue.then(() => this.save());
  }

  private save(): void {
    const data: FeedbackFile = { version: 1, records: this.records };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[FeedbackCollector] Failed to save:", err);
    }
  }
}
