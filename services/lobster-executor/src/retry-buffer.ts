/**
 * Buffers log entries when the callback endpoint is unreachable,
 * and retries sending them with exponential backoff.
 *
 * Constraints:
 * - Total buffered data ≤ 64KB (65536 bytes, measured by `data` field byte length)
 * - Maximum 3 retry attempts per `retryAll()` call
 * - Backoff formula: `delay = baseDelayMs * 2^attempt` (1s, 2s, 4s)
 *
 * When the buffer is full, new entries are silently dropped (`buffer()` returns false).
 */

export interface LogBufferEntry {
  missionId: string;
  jobId: string;
  stepIndex: number;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

export type SendFn = (entry: LogBufferEntry) => Promise<void>;

export class RetryBuffer {
  readonly maxBufferSize: number;
  readonly maxRetries: number;
  readonly baseDelayMs: number;

  private entries: LogBufferEntry[] = [];
  private bufferedBytes = 0;
  private readonly sendFn: SendFn;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    sendFn: SendFn,
    options?: {
      maxBufferSize?: number;
      maxRetries?: number;
      baseDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.sendFn = sendFn;
    this.maxBufferSize = options?.maxBufferSize ?? 65536;
    this.maxRetries = options?.maxRetries ?? 3;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.sleepFn = options?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Current total buffered bytes (sum of `data` field byte lengths). */
  get totalBytes(): number {
    return this.bufferedBytes;
  }

  /** Number of entries currently buffered. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Add an entry to the buffer.
   * Returns `false` if adding would exceed `maxBufferSize` — the entry is dropped.
   */
  buffer(entry: LogBufferEntry): boolean {
    const entryBytes = Buffer.byteLength(entry.data, "utf8");
    if (this.bufferedBytes + entryBytes > this.maxBufferSize) {
      return false;
    }
    this.entries.push(entry);
    this.bufferedBytes += entryBytes;
    return true;
  }

  /**
   * Attempt to send all buffered entries with exponential backoff.
   *
   * For each entry, up to `maxRetries` attempts are made.
   * Entries that are successfully sent are removed from the buffer.
   * Entries that exhaust all retries remain buffered.
   */
  async retryAll(): Promise<void> {
    const remaining: LogBufferEntry[] = [];
    let remainingBytes = 0;

    for (const entry of this.entries) {
      const sent = await this.sendWithBackoff(entry);
      if (!sent) {
        remaining.push(entry);
        remainingBytes += Buffer.byteLength(entry.data, "utf8");
      }
    }

    this.entries = remaining;
    this.bufferedBytes = remainingBytes;
  }

  /** Clear all buffered entries. */
  clear(): void {
    this.entries = [];
    this.bufferedBytes = 0;
  }

  private async sendWithBackoff(entry: LogBufferEntry): Promise<boolean> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.sendFn(entry);
        return true;
      } catch {
        const delayMs = this.baseDelayMs * 2 ** attempt;
        await this.sleepFn(delayMs);
      }
    }
    return false;
  }
}
