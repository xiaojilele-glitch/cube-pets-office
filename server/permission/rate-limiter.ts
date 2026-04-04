/**
 * SlidingWindowRateLimiter — 滑动窗口速率限制器
 *
 * Tracks request timestamps per key (e.g. agentId:resourceType or agentId:endpoint).
 * Uses a sliding window of 60 seconds (1 minute) to enforce maxPerMinute limits.
 */

const WINDOW_MS = 60_000; // 60 seconds

export class SlidingWindowRateLimiter {
  /** key → sorted array of timestamps (ms) */
  private windows = new Map<string, number[]>();

  /** Provide a custom time source for testing; defaults to Date.now */
  private now: () => number;

  constructor(nowFn?: () => number) {
    this.now = nowFn ?? (() => Date.now());
  }

  /**
   * Check whether the key is under the rate limit.
   * Does NOT record a new request — call `record()` separately after a successful check.
   * @returns true if under limit, false if exceeded
   */
  check(key: string, maxPerMinute: number): boolean {
    const now = this.now();
    const timestamps = this.windows.get(key);
    if (!timestamps) return true;

    const cutoff = now - WINDOW_MS;
    // Count timestamps within the window
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] > cutoff) {
        count++;
      } else {
        break; // sorted ascending, so everything before is also expired
      }
    }
    return count < maxPerMinute;
  }

  /** Record a request timestamp for the given key. */
  record(key: string): void {
    const now = this.now();
    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }
    timestamps.push(now);
  }

  /** Remove expired timestamps (older than 60s) from all keys. */
  cleanup(): void {
    const cutoff = this.now() - WINDOW_MS;
    this.windows.forEach((timestamps, key) => {
      // Find first index within the window
      let firstValid = timestamps.length;
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] > cutoff) {
          firstValid = i;
          break;
        }
      }
      if (firstValid === timestamps.length) {
        this.windows.delete(key);
      } else if (firstValid > 0) {
        timestamps.splice(0, firstValid);
      }
    });
  }

  /** Get the current count of requests within the window for a key. */
  getCount(key: string): number {
    const now = this.now();
    const timestamps = this.windows.get(key);
    if (!timestamps) return 0;
    const cutoff = now - WINDOW_MS;
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] > cutoff) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /** Reset all tracked data. */
  reset(): void {
    this.windows.clear();
  }
}
