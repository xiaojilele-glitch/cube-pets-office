/**
 * AuditCollector — 事件采集器
 *
 * 提供统一的事件记录接口，支持异步缓冲：
 * - record()：异步缓冲写入（INFO/WARNING 事件），CRITICAL 自动路由到 recordSync()
 * - recordSync()：同步写入（CRITICAL 事件）
 * - flush()：手动刷新缓冲区
 * - getBufferSize()：返回缓冲区大小
 * - destroy()：清理定时器
 *
 * 缓冲策略：
 * - 普通事件：写入内存缓冲，每 100ms 或缓冲满 50 条时批量刷新
 * - 关键事件（CRITICAL）：立即同步写入，不经过缓冲
 * - 采集失败：写入本地 fallback 文件 data/audit/buffer.jsonl，定时重试
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AuditEvent,
  AuditLogEntry,
} from "../../shared/audit/contracts.js";
import { DEFAULT_EVENT_TYPE_REGISTRY } from "../../shared/audit/contracts.js";
import type { AuditChain } from "./audit-chain.js";
import { auditChain } from "./audit-chain.js";
import type { TimestampProvider } from "./timestamp-provider.js";
import { timestampProvider } from "./timestamp-provider.js";

// ─── AuditEventInput 接口 ──────────────────────────────────────────────────

export interface AuditEventInput {
  eventType: AuditEvent["eventType"];
  actor: AuditEvent["actor"];
  action: string;
  resource: AuditEvent["resource"];
  result: AuditEvent["result"];
  context?: AuditEvent["context"];
  metadata?: Record<string, unknown>;
  lineageId?: string;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 50;
const FLUSH_INTERVAL_MS = 100;
const RETRY_INTERVAL_MS = 30_000;
const DEFAULT_FALLBACK_PATH = path.resolve("data/audit/buffer.jsonl");

// ─── AuditCollector 类 ─────────────────────────────────────────────────────

export class AuditCollector {
  private buffer: AuditEventInput[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private chain: AuditChain;
  private timestampProvider: TimestampProvider;
  private fallbackPath: string;

  constructor(
    chain: AuditChain,
    tsProvider: TimestampProvider,
    fallbackPath?: string
  ) {
    this.chain = chain;
    this.timestampProvider = tsProvider;
    this.fallbackPath = fallbackPath ?? DEFAULT_FALLBACK_PATH;
  }

  // ─── 5.1 record() — 异步缓冲写入 ──────────────────────────────────────

  /**
   * 采集事件并异步写入审计链。
   * - CRITICAL 事件自动路由到 recordSync()
   * - INFO/WARNING 事件写入内存缓冲
   * - 缓冲满 50 条时立即刷新
   * - 否则启动/重置 100ms 刷新定时器
   */
  record(input: AuditEventInput): void {
    // Auto-detect CRITICAL events and route to sync write
    const def = DEFAULT_EVENT_TYPE_REGISTRY[input.eventType];
    if (def && def.severity === "CRITICAL") {
      this.recordSync(input);
      return;
    }

    this.buffer.push(input);

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
      return;
    }

    // Start or reset the flush timer
    this.resetFlushTimer();
  }

  // ─── 5.2 recordSync() — 同步写入 ─────────────────────────────────────

  /**
   * 同步写入审计链（用于 CRITICAL 事件）。
   * 将 AuditEventInput 转换为 AuditEvent，直接调用 chain.append()。
   */
  recordSync(input: AuditEventInput): AuditLogEntry {
    const event = this.toAuditEvent(input);
    return this.chain.append(event);
  }

  // ─── 5.4 flush() — 手动刷新缓冲区 ────────────────────────────────────

  /**
   * 刷新缓冲区：将所有缓冲事件转换为 AuditEvent 并写入审计链。
   * 写入失败的事件会被写入 fallback 文件。
   */
  flush(): void {
    this.clearFlushTimer();

    if (this.buffer.length === 0) return;

    const pending = this.buffer.splice(0);
    const failed: AuditEventInput[] = [];

    for (const input of pending) {
      try {
        const event = this.toAuditEvent(input);
        this.chain.append(event);
      } catch {
        failed.push(input);
      }
    }

    if (failed.length > 0) {
      this.writeFallback(failed);
      this.ensureRetryTimer();
    }
  }

  // ─── getBufferSize() ─────────────────────────────────────────────────

  /** 返回当前缓冲区大小 */
  getBufferSize(): number {
    return this.buffer.length;
  }

  // ─── destroy() — 清理定时器 ──────────────────────────────────────────

  /** 清理所有定时器 */
  destroy(): void {
    this.clearFlushTimer();
    if (this.retryTimer !== null) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ─── 5.5 Fallback 机制 ───────────────────────────────────────────────

  /**
   * 将失败的事件写入 fallback 文件 (buffer.jsonl)
   */
  private writeFallback(events: AuditEventInput[]): void {
    try {
      const dir = path.dirname(this.fallbackPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
      fs.appendFileSync(this.fallbackPath, lines, "utf-8");
    } catch {
      // Last resort: log to console
      console.error(
        "[AuditCollector] Failed to write fallback file:",
        this.fallbackPath
      );
    }
  }

  /**
   * 从 fallback 文件读取并重试写入审计链。
   * 成功后清空 fallback 文件。
   */
  private retryFallback(): void {
    if (!fs.existsSync(this.fallbackPath)) {
      this.stopRetryTimer();
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(this.fallbackPath, "utf-8").trim();
    } catch {
      return;
    }

    if (!content) {
      this.stopRetryTimer();
      return;
    }

    const lines = content.split("\n");
    const stillFailed: AuditEventInput[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const input: AuditEventInput = JSON.parse(line);
        const event = this.toAuditEvent(input);
        this.chain.append(event);
      } catch {
        // Still failing — keep in fallback
        try {
          stillFailed.push(JSON.parse(line));
        } catch {
          // Corrupted line, discard
        }
      }
    }

    try {
      if (stillFailed.length === 0) {
        fs.unlinkSync(this.fallbackPath);
        this.stopRetryTimer();
      } else {
        const remaining =
          stillFailed.map(e => JSON.stringify(e)).join("\n") + "\n";
        fs.writeFileSync(this.fallbackPath, remaining, "utf-8");
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────

  /** 将 AuditEventInput 转换为 AuditEvent */
  private toAuditEvent(input: AuditEventInput): AuditEvent {
    const ts = this.timestampProvider.now();
    return {
      eventId: `ae_${ts.system}_${crypto.randomBytes(4).toString("hex")}`,
      eventType: input.eventType,
      timestamp: ts.system,
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      result: input.result,
      context: input.context ?? {},
      metadata: input.metadata,
      lineageId: input.lineageId,
    };
  }

  /** 清除刷新定时器 */
  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** 启动/重置 100ms 刷新定时器 */
  private resetFlushTimer(): void {
    this.clearFlushTimer();
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /** 确保重试定时器在运行 */
  private ensureRetryTimer(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setInterval(() => {
      this.retryFallback();
    }, RETRY_INTERVAL_MS);
  }

  /** 停止重试定时器 */
  private stopRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const auditCollector = new AuditCollector(auditChain, timestampProvider);
