/**
 * Semaphore-based concurrency limiter.
 *
 * - `acquire()` resolves immediately when under capacity, otherwise queues
 *   the caller until a permit becomes available.
 * - `release()` frees a permit and unblocks the next waiter (FIFO).
 */
export class ConcurrencyLimiter {
  private current = 0;
  private waiters: Array<() => void> = [];

  constructor(private maxConcurrent: number) {}

  /**
   * Acquire a permit. Resolves immediately if under capacity,
   * otherwise waits until a permit is released.
   */
  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Release a permit. If there are queued waiters, the next one
   * is unblocked (FIFO order). Otherwise the permit count is decremented.
   */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit directly to the next waiter — current count stays the same
      next();
    } else {
      this.current--;
    }
  }
}
