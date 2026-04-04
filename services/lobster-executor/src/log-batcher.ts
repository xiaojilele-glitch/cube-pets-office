/**
 * Batches log output by stream type and flushes based on size / time constraints.
 *
 * Two usage patterns:
 *
 * 1. **Legacy callback mode** (`push(line)` + `onFlush` callback):
 *    Used by DockerRunner for `job.log` events.
 *
 * 2. **Stream-aware mode** (`append(stream, chunk)` + `flush()` return value):
 *    Used by sandbox-live-preview for `job.log_stream` events.
 *    Each flush result contains `{ stream, data }` with `data ≤ maxBatchSize`.
 *
 * Flush triggers:
 * - Accumulated data reaches `maxBatchSize` (default 4096 bytes)
 * - Timer fires after `maxIntervalMs` (default 500ms) since last append
 * - Explicit `flush()` or `destroy()` call
 */

export interface LogBatchEntry {
  stream: "stdout" | "stderr";
  data: string;
}

export class LogBatcher {
  readonly maxIntervalMs: number;
  readonly maxBatchSize: number;

  /* ── Legacy mode state ── */
  private buffer: string[] = [];
  private currentSizeBytes = 0;

  /* ── Stream-aware mode state ── */
  /** Completed batches waiting to be returned by flush(). */
  private completedBatches: LogBatchEntry[] = [];
  /** Current pending batch being accumulated. */
  private pendingStream: "stdout" | "stderr" | null = null;
  private pendingData = "";
  private pendingBytes = 0;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private onFlushCb: ((lines: string[]) => void) | null;

  constructor(
    onFlush?: ((lines: string[]) => void) | null,
    maxIntervalMs = 500,
    maxBatchSize = 4096,
  ) {
    this.onFlushCb = onFlush ?? null;
    this.maxIntervalMs = maxIntervalMs;
    this.maxBatchSize = maxBatchSize;
  }

  /* ═══════════════════════════════════════════════════════
   * Stream-aware API (sandbox-live-preview)
   * ═══════════════════════════════════════════════════════ */

  /**
   * Append a chunk of log data for the given stream.
   *
   * If the chunk itself exceeds `maxBatchSize`, it is split into
   * multiple entries so that each entry's data ≤ `maxBatchSize`.
   *
   * When accumulated bytes reach `maxBatchSize`, the current batch
   * is sealed and a new one begins.
   */
  append(stream: "stdout" | "stderr", chunk: string): void {
    if (this.destroyed) return;
    if (chunk.length === 0) return;

    const chunkBytes = Buffer.byteLength(chunk, "utf8");

    // If the single chunk exceeds maxBatchSize, split it
    if (chunkBytes > this.maxBatchSize) {
      this.splitAndAppend(stream, chunk);
      this.resetTimer();
      return;
    }

    // Stream type changed — seal the current pending batch
    if (this.pendingStream !== null && this.pendingStream !== stream) {
      this.sealPending();
    }

    // Would adding this chunk exceed the batch size? Seal first.
    if (this.pendingBytes + chunkBytes > this.maxBatchSize) {
      this.sealPending();
    }

    this.pendingStream = stream;
    this.pendingData += chunk;
    this.pendingBytes += chunkBytes;

    // If we've exactly hit the limit, seal immediately
    if (this.pendingBytes >= this.maxBatchSize) {
      this.sealPending();
    }

    this.resetTimer();
  }

  /**
   * Flush all accumulated stream data and return the batches.
   *
   * Each returned entry has `data` whose byte length ≤ `maxBatchSize`.
   *
   * Also flushes legacy buffer if it has content (for backward compat).
   */
  flush(): LogBatchEntry[] {
    // Flush legacy buffer first (calls onFlushCb)
    this.flushLegacyBuffer();

    // Seal any pending stream data
    this.sealPending();

    // Collect and reset
    const result = this.completedBatches;
    this.completedBatches = [];
    this.clearTimer();
    return result;
  }

  /* ═══════════════════════════════════════════════════════
   * Legacy API (DockerRunner compatibility)
   * ═══════════════════════════════════════════════════════ */

  /**
   * Add a line to the current legacy batch.
   * If adding the line would exceed `maxBatchSize`, the current batch is
   * flushed first, then a new batch is started with this line.
   * Starts / resets the auto-flush timer.
   */
  push(line: string): void {
    if (this.destroyed) return;

    const lineBytes = Buffer.byteLength(line, "utf8");

    if (this.buffer.length > 0 && this.currentSizeBytes + lineBytes > this.maxBatchSize) {
      this.flushLegacyBuffer();
    }

    this.buffer.push(line);
    this.currentSizeBytes += lineBytes;
    this.resetTimer();
  }

  /**
   * Flush remaining data and tear down the timer.
   * After `destroy()`, `push()` and `append()` become no-ops.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.flushLegacyBuffer();
    this.sealPending();
    this.destroyed = true;
    this.clearTimer();
  }

  /* ═══════════════════════════════════════════════════════
   * Private helpers
   * ═══════════════════════════════════════════════════════ */

  /**
   * Split a chunk that exceeds maxBatchSize into multiple entries,
   * each with data ≤ maxBatchSize bytes.
   */
  private splitAndAppend(stream: "stdout" | "stderr", chunk: string): void {
    // Seal any existing pending data first
    if (this.pendingStream !== null && (this.pendingStream !== stream || this.pendingBytes > 0)) {
      this.sealPending();
    }

    let remaining = chunk;
    while (remaining.length > 0) {
      const slice = this.sliceToMaxBytes(remaining, this.maxBatchSize);
      this.completedBatches.push({ stream, data: slice });
      remaining = remaining.slice(slice.length);
    }
  }

  /**
   * Return the longest prefix of `str` whose UTF-8 byte length ≤ `maxBytes`.
   */
  private sliceToMaxBytes(str: string, maxBytes: number): string {
    // Fast path: entire string fits
    if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;

    // Binary search for the cut point
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (Buffer.byteLength(str.slice(0, mid), "utf8") <= maxBytes) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return str.slice(0, lo);
  }

  /** Seal the current pending stream data into a completed batch. */
  private sealPending(): void {
    if (this.pendingStream === null || this.pendingData.length === 0) return;
    this.completedBatches.push({ stream: this.pendingStream, data: this.pendingData });
    this.pendingStream = null;
    this.pendingData = "";
    this.pendingBytes = 0;
  }

  /** Flush the legacy (push-based) buffer via the onFlush callback. */
  private flushLegacyBuffer(): void {
    if (this.buffer.length === 0) return;

    const lines = this.buffer;
    this.buffer = [];
    this.currentSizeBytes = 0;

    if (this.onFlushCb) {
      this.onFlushCb(lines);
    }
  }

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      // Timer-based auto-flush: flush legacy buffer via callback
      this.flushLegacyBuffer();
    }, this.maxIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
