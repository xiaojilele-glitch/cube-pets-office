/**
 * DemoPlaybackEngine — 演示回放引擎核心类
 *
 * 按时间线调度 DemoTimelineEntry 序列，驱动前端状态更新。
 * 纯 TypeScript 类，不依赖 React。
 *
 * @Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.7
 */

import type { DemoDataBundle, DemoTimelineEntry } from "@shared/demo/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaybackState = "idle" | "playing" | "paused" | "completed" | "failed";

export interface PlaybackCallbacks {
  /** 每个时间线事件触发时调用 */
  onEvent: (entry: DemoTimelineEntry) => void;
  /** 回放状态变更时调用 */
  onStateChange: (state: PlaybackState) => void;
  /** 回放过程中发生异常时调用 */
  onError: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class DemoPlaybackEngine {
  private state: PlaybackState = "idle";
  private timers: ReturnType<typeof setTimeout>[] = [];
  private startTime = 0;
  private pausedAt: number | null = null;
  private currentIndex = 0;
  private firedCount = 0;

  private readonly events: DemoTimelineEntry[];

  constructor(
    private readonly bundle: DemoDataBundle,
    private readonly callbacks: PlaybackCallbacks,
  ) {
    this.events = bundle.timeline;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** 开始回放：调度所有事件 */
  start(): void {
    if (this.state === "playing") return;

    this.startTime = performance.now();
    this.currentIndex = 0;
    this.firedCount = 0;
    this.pausedAt = null;

    this.setState("playing");
    this.scheduleFrom(0, this.startTime);
  }

  /** 暂停回放：清除未触发的定时器，记录进度 */
  pause(): void {
    if (this.state !== "playing") return;

    this.clearTimers();
    this.pausedAt = performance.now();
    this.setState("paused");
  }

  /** 恢复回放：从暂停位置重新调度剩余事件 */
  resume(): void {
    if (this.state !== "paused" || this.pausedAt === null) return;

    // Shift the logical start time forward by the duration of the pause
    const pauseDuration = performance.now() - this.pausedAt;
    this.startTime += pauseDuration;
    this.pausedAt = null;

    this.setState("playing");
    this.scheduleFrom(this.currentIndex, this.startTime);
  }

  /** 停止回放：清理定时器，重置状态 */
  stop(): void {
    this.clearTimers();
    this.currentIndex = 0;
    this.firedCount = 0;
    this.pausedAt = null;
    this.setState("idle");
  }

  /** 获取当前回放状态 */
  getState(): PlaybackState {
    return this.state;
  }

  /** 销毁引擎：释放所有资源 */
  dispose(): void {
    this.clearTimers();
    this.currentIndex = 0;
    this.firedCount = 0;
    this.pausedAt = null;
    this.state = "idle";
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * 从 fromIndex 开始，为每个剩余事件计算延迟并调度 setTimeout。
   * referenceTime 是逻辑上的 "回放开始时间"（已考虑暂停偏移）。
   */
  private scheduleFrom(fromIndex: number, referenceTime: number): void {
    const now = performance.now();

    for (let i = fromIndex; i < this.events.length; i++) {
      const entry = this.events[i];
      const targetTime = referenceTime + entry.offsetMs;
      const delay = Math.max(0, targetTime - now);

      const timer = setTimeout(() => {
        this.fireEvent(i, entry);
      }, delay);

      this.timers.push(timer);
    }

    // Handle empty event list — transition directly to completed
    if (this.events.length === 0) {
      this.setState("completed");
    }
  }

  /** 触发单个事件，处理异常和完成检测 */
  private fireEvent(index: number, entry: DemoTimelineEntry): void {
    // Guard: if we're no longer playing (e.g. paused/stopped between schedule and fire)
    if (this.state !== "playing") return;

    try {
      this.callbacks.onEvent(entry);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.clearTimers();
      this.setState("failed");
      this.callbacks.onError(error);
      return;
    }

    this.firedCount++;
    // Track the next unplayed index for pause/resume
    this.currentIndex = index + 1;

    // All events fired → completed
    if (this.firedCount >= this.events.length) {
      this.setState("completed");
    }
  }

  private setState(next: PlaybackState): void {
    if (this.state === next) return;
    this.state = next;
    try {
      this.callbacks.onStateChange(next);
    } catch {
      // Swallow callback errors in state change notification to avoid recursion
    }
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers = [];
  }
}
