/**
 * Batches log lines and flushes them based on size and time constraints.
 *
 * - Each batch will not exceed `maxSizeBytes` (default 4096).
 * - Buffered lines are auto-flushed after `maxIntervalMs` (default 500ms).
 * - After `destroy()`, no further flushes will fire.
 */
export class LogBatcher {
  private buffer: string[] = [];
  private currentSizeBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private onFlush: (lines: string[]) => void,
    private maxIntervalMs = 500,
    private maxSizeBytes = 4096,
  ) {}

  /**
   * Add a line to the current batch.
   * If adding the line would exceed `maxSizeBytes`, the current batch is
   * flushed first, then a new batch is started with this line.
   * Starts / resets the auto-flush timer.
   */
  push(line: string): void {
    if (this.destroyed) return;

    const lineBytes = Buffer.byteLength(line, "utf8");

    if (this.buffer.length > 0 && this.currentSizeBytes + lineBytes > this.maxSizeBytes) {
      this.flush();
    }

    this.buffer.push(line);
    this.currentSizeBytes += lineBytes;
    this.resetTimer();
  }

  /**
   * Flush the current batch immediately.
   * Calls `onFlush(lines)` with the buffered lines and resets the buffer.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const lines = this.buffer;
    this.buffer = [];
    this.currentSizeBytes = 0;
    this.clearTimer();
    this.onFlush(lines);
  }

  /**
   * Flush remaining lines and tear down the timer.
   * After `destroy()`, `push()` becomes a no-op and no more auto-flushes occur.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.flush();
    this.destroyed = true;
    this.clearTimer();
  }

  /* ── private helpers ── */

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.maxIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
