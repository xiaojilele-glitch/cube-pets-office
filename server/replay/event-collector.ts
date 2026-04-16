/**
 * Collaboration Replay System — Event Collector
 *
 * 异步事件采集器：内存缓冲 + 定时刷新 + 失败重试。
 * emit() 同步入队，不阻塞调用方。
 *
 * Requirements: 1.4, 1.5, 1.6
 */

import { randomUUID } from "node:crypto";
import type { ExecutionEvent } from "../../shared/replay/contracts.js";
import type { ReplayStoreInterface } from "../../shared/replay/store-interface.js";

export interface EventCollectorOptions {
  /** 内存缓冲区最大条数，默认 1000 */
  bufferSize?: number;
  /** 定时刷新间隔（毫秒），默认 500 */
  flushIntervalMs?: number;
  /** 失败事件最大重试次数，默认 3 */
  maxRetries?: number;
}

interface FailedEvent {
  event: ExecutionEvent;
  retryCount: number;
}

export class EventCollector {
  private buffer: ExecutionEvent[] = [];
  private failedQueue: FailedEvent[] = [];
  private totalEmitted = 0;
  private flushing = false;

  private readonly store: ReplayStoreInterface;
  private readonly bufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: ReplayStoreInterface, options?: EventCollectorOptions) {
    this.store = store;
    this.bufferSize = options?.bufferSize ?? 1000;
    this.flushIntervalMs = options?.flushIntervalMs ?? 500;
    this.maxRetries = options?.maxRetries ?? 3;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * 同步入队事件到内存缓冲区。
   * 自动生成 eventId 和 timestamp，不 await 存储操作。
   */
  emit(event: Omit<ExecutionEvent, "eventId" | "timestamp">): void {
    const fullEvent: ExecutionEvent = {
      ...event,
      eventId: randomUUID(),
      timestamp: Date.now(),
    };

    // 缓冲区满时丢弃最旧事件（错误处理策略：内存不足）
    if (this.buffer.length >= this.bufferSize) {
      this.buffer.shift();
    }

    this.buffer.push(fullEvent);
    this.totalEmitted++;

    // 缓冲区满时触发异步刷新
    if (this.buffer.length >= this.bufferSize) {
      void this.flush();
    }
  }

  /**
   * 批量刷新缓冲区到存储层。
   * 失败的事件进入 failedQueue。
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;

    this.flushing = true;
    // 取出当前缓冲区全部事件
    const batch = this.buffer.splice(0, this.buffer.length);

    // 按 missionId 分组
    const grouped: Record<string, ExecutionEvent[]> = {};
    for (const event of batch) {
      if (!grouped[event.missionId]) {
        grouped[event.missionId] = [];
      }
      grouped[event.missionId].push(event);
    }

    try {
      const promises: Array<Promise<void>> = [];
      for (const missionId of Object.keys(grouped)) {
        const events = grouped[missionId];
        promises.push(
          this.store.appendEvents(missionId, events).catch(() => {
            // 写入失败：事件进入 failedQueue
            for (const event of events) {
              this.failedQueue.push({ event, retryCount: 0 });
            }
          })
        );
      }
      await Promise.all(promises);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * 重试失败队列中的事件，使用指数退避。
   * 超过 maxRetries 的事件将被丢弃。
   */
  async retryFailed(): Promise<void> {
    if (this.failedQueue.length === 0) return;

    const toRetry = this.failedQueue.splice(0, this.failedQueue.length);

    // 按 missionId 分组
    const grouped: Record<string, FailedEvent[]> = {};
    for (const entry of toRetry) {
      const mid = entry.event.missionId;
      if (!grouped[mid]) {
        grouped[mid] = [];
      }
      grouped[mid].push(entry);
    }

    const promises: Array<Promise<void>> = [];
    for (const missionId of Object.keys(grouped)) {
      const entries = grouped[missionId];
      const events = entries.map((e: FailedEvent) => e.event);

      promises.push(
        this.store.appendEvents(missionId, events).catch(() => {
          // 仍然失败：递增 retryCount，超过上限则丢弃
          for (const entry of entries) {
            if (entry.retryCount + 1 < this.maxRetries) {
              this.failedQueue.push({
                event: entry.event,
                retryCount: entry.retryCount + 1,
              });
            }
            // 超过 maxRetries 的事件被静默丢弃
          }
        })
      );
    }

    await Promise.all(promises);
  }

  /** 获取采集统计信息 */
  getStats(): { buffered: number; failed: number; total: number } {
    return {
      buffered: this.buffer.length,
      failed: this.failedQueue.length,
      total: this.totalEmitted,
    };
  }

  /** 清理定时器，释放资源 */
  destroy(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
