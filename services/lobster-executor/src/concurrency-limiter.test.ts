import { describe, it, expect } from "vitest";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";

describe("ConcurrencyLimiter", () => {
  it("acquire succeeds immediately when under capacity", async () => {
    const limiter = new ConcurrencyLimiter(2);

    // Both should resolve immediately
    await limiter.acquire();
    await limiter.acquire();

    // Clean up
    limiter.release();
    limiter.release();
  });

  it("acquire blocks when at capacity", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire();

    let blocked = true;
    const pending = limiter.acquire().then(() => {
      blocked = false;
    });

    // Give microtasks a chance to run
    await Promise.resolve();
    expect(blocked).toBe(true);

    // Release unblocks the waiter
    limiter.release();
    await pending;
    expect(blocked).toBe(false);

    limiter.release();
  });

  it("release unblocks the next waiter", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire();

    const order: number[] = [];
    const p1 = limiter.acquire().then(() => order.push(1));

    // Still blocked
    await Promise.resolve();
    expect(order).toEqual([]);

    limiter.release();
    await p1;
    expect(order).toEqual([1]);

    limiter.release();
  });

  it("multiple waiters are served in FIFO order", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire();

    const order: number[] = [];
    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));
    const p3 = limiter.acquire().then(() => order.push(3));

    // Release one at a time and verify FIFO
    limiter.release();
    await p1;
    expect(order).toEqual([1]);

    limiter.release();
    await p2;
    expect(order).toEqual([1, 2]);

    limiter.release();
    await p3;
    expect(order).toEqual([1, 2, 3]);

    limiter.release();
  });
});
