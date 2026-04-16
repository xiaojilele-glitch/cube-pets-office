/**
 * Unit tests for SlidingWindowRateLimiter
 *
 * Validates: Requirements 4.5, 6.5
 */

import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { NetworkChecker } from "./checkers/network-checker.js";
import { ApiChecker } from "./checkers/api-checker.js";
import type { PermissionConstraints } from "../../shared/permission/contracts.js";

// ─── SlidingWindowRateLimiter Unit Tests ────────────────────────────────────

describe("SlidingWindowRateLimiter", () => {
  it("allows requests under the limit", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);

    expect(limiter.check("key1", 5)).toBe(true);
    limiter.record("key1");
    expect(limiter.check("key1", 5)).toBe(true);
    limiter.record("key1");
    expect(limiter.check("key1", 5)).toBe(true);
  });

  it("denies requests at the limit", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);

    for (let i = 0; i < 3; i++) {
      expect(limiter.check("key1", 3)).toBe(true);
      limiter.record("key1");
    }
    // 4th request should be denied
    expect(limiter.check("key1", 3)).toBe(false);
  });

  it("tracks keys independently", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);

    for (let i = 0; i < 3; i++) {
      limiter.record("key1");
    }
    // key1 is at limit
    expect(limiter.check("key1", 3)).toBe(false);
    // key2 is fresh
    expect(limiter.check("key2", 3)).toBe(true);
  });

  it("allows requests after window expires", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);

    for (let i = 0; i < 3; i++) {
      limiter.record("key1");
    }
    expect(limiter.check("key1", 3)).toBe(false);

    // Advance past the 60s window
    time = 1000 + 60_001;
    expect(limiter.check("key1", 3)).toBe(true);
  });

  it("sliding window only counts recent requests", () => {
    let time = 0;
    const limiter = new SlidingWindowRateLimiter(() => time);

    // Record 2 requests at t=0
    limiter.record("k");
    limiter.record("k");

    // Advance to t=50s, record 1 more
    time = 50_000;
    limiter.record("k");

    // At t=50s, all 3 are within window → limit of 3 reached
    expect(limiter.check("k", 3)).toBe(false);

    // Advance to t=60.001s → first 2 requests expire
    time = 60_001;
    expect(limiter.check("k", 3)).toBe(true);
  });

  it("getCount returns correct count within window", () => {
    let time = 0;
    const limiter = new SlidingWindowRateLimiter(() => time);

    expect(limiter.getCount("k")).toBe(0);
    limiter.record("k");
    limiter.record("k");
    expect(limiter.getCount("k")).toBe(2);

    time = 60_001;
    expect(limiter.getCount("k")).toBe(0);
  });

  it("cleanup removes expired entries", () => {
    let time = 0;
    const limiter = new SlidingWindowRateLimiter(() => time);

    limiter.record("a");
    limiter.record("b");

    time = 60_001;
    limiter.cleanup();

    // After cleanup, both keys should have 0 count
    expect(limiter.getCount("a")).toBe(0);
    expect(limiter.getCount("b")).toBe(0);
  });

  it("reset clears all data", () => {
    let time = 0;
    const limiter = new SlidingWindowRateLimiter(() => time);

    limiter.record("k");
    limiter.record("k");
    expect(limiter.getCount("k")).toBe(2);

    limiter.reset();
    expect(limiter.getCount("k")).toBe(0);
  });
});

// ─── NetworkChecker rate limit integration ──────────────────────────────────

describe("NetworkChecker rate limit integration", () => {
  it("denies after exceeding rate limit", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);
    const checker = new NetworkChecker(limiter);
    checker.setAgentId("agent-1");

    const constraints: PermissionConstraints = {
      domainPatterns: ["*"],
      rateLimit: { maxPerMinute: 3 },
    };

    // 3 allowed
    for (let i = 0; i < 3; i++) {
      expect(
        checker.checkConstraints("connect", "example.com:443", constraints)
      ).toBe(true);
    }
    // 4th denied
    expect(
      checker.checkConstraints("connect", "example.com:443", constraints)
    ).toBe(false);
  });

  it("allows again after window expires", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);
    const checker = new NetworkChecker(limiter);
    checker.setAgentId("agent-1");

    const constraints: PermissionConstraints = {
      domainPatterns: ["*"],
      rateLimit: { maxPerMinute: 2 },
    };

    checker.checkConstraints("connect", "example.com:443", constraints);
    checker.checkConstraints("connect", "example.com:443", constraints);
    expect(
      checker.checkConstraints("connect", "example.com:443", constraints)
    ).toBe(false);

    // Advance past window
    time = 1000 + 60_001;
    expect(
      checker.checkConstraints("connect", "example.com:443", constraints)
    ).toBe(true);
  });

  it("does not enforce rate limit when rateLimit is not set", () => {
    const limiter = new SlidingWindowRateLimiter();
    const checker = new NetworkChecker(limiter);
    checker.setAgentId("agent-1");

    const constraints: PermissionConstraints = {
      domainPatterns: ["*"],
    };

    // Should always pass (no rate limit)
    for (let i = 0; i < 100; i++) {
      expect(
        checker.checkConstraints("connect", "example.com:443", constraints)
      ).toBe(true);
    }
  });
});

// ─── ApiChecker rate limit integration ──────────────────────────────────────

describe("ApiChecker rate limit integration", () => {
  it("denies after exceeding rate limit", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);
    const checker = new ApiChecker(limiter);
    checker.setAgentId("agent-2");

    const constraints: PermissionConstraints = {
      endpoints: ["/api/**"],
      rateLimit: { maxPerMinute: 2 },
    };

    expect(
      checker.checkConstraints("call", "GET /api/v1/users", constraints)
    ).toBe(true);
    expect(
      checker.checkConstraints("call", "GET /api/v1/users", constraints)
    ).toBe(true);
    expect(
      checker.checkConstraints("call", "GET /api/v1/users", constraints)
    ).toBe(false);
  });

  it("tracks different endpoints separately", () => {
    let time = 1000;
    const limiter = new SlidingWindowRateLimiter(() => time);
    const checker = new ApiChecker(limiter);
    checker.setAgentId("agent-3");

    const constraints: PermissionConstraints = {
      endpoints: ["/api/**"],
      rateLimit: { maxPerMinute: 1 },
    };

    expect(
      checker.checkConstraints("call", "GET /api/v1/users", constraints)
    ).toBe(true);
    // Same endpoint — denied
    expect(
      checker.checkConstraints("call", "GET /api/v1/users", constraints)
    ).toBe(false);
    // Different endpoint — allowed
    expect(
      checker.checkConstraints("call", "GET /api/v1/posts", constraints)
    ).toBe(true);
  });

  it("does not enforce rate limit when rateLimit is not set", () => {
    const limiter = new SlidingWindowRateLimiter();
    const checker = new ApiChecker(limiter);
    checker.setAgentId("agent-4");

    const constraints: PermissionConstraints = {
      endpoints: ["/api/**"],
    };

    for (let i = 0; i < 100; i++) {
      expect(
        checker.checkConstraints("call", "GET /api/v1/users", constraints)
      ).toBe(true);
    }
  });
});

// ─── Property Tests ─────────────────────────────────────────────────────────

import fc from "fast-check";

describe("Rate Limiter Property Tests", () => {
  /**
   * **Validates: Requirements 4.5, 6.5**
   *
   * Property 14: 速率限制正确性 —
   * For any rateLimit config, after maxPerMinute requests within 1 minute,
   * the next check returns false (denied).
   */
  describe("Property 14: Rate limit correctness", () => {
    const maxPerMinuteArb = fc.integer({ min: 1, max: 200 });

    it("after exactly maxPerMinute requests, the next check is denied", () => {
      fc.assert(
        fc.property(maxPerMinuteArb, maxPerMinute => {
          let time = 0;
          const limiter = new SlidingWindowRateLimiter(() => time);
          const key = "test-agent:network";

          // Record exactly maxPerMinute requests
          for (let i = 0; i < maxPerMinute; i++) {
            expect(limiter.check(key, maxPerMinute)).toBe(true);
            limiter.record(key);
          }

          // The (maxPerMinute + 1)th check should be denied
          expect(limiter.check(key, maxPerMinute)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("requests are allowed again after the window expires", () => {
      fc.assert(
        fc.property(maxPerMinuteArb, maxPerMinute => {
          let time = 0;
          const limiter = new SlidingWindowRateLimiter(() => time);
          const key = "test-agent:network";

          // Fill up the limit
          for (let i = 0; i < maxPerMinute; i++) {
            limiter.record(key);
          }
          expect(limiter.check(key, maxPerMinute)).toBe(false);

          // Advance past the 60s window
          time = 60_001;
          expect(limiter.check(key, maxPerMinute)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it("count never exceeds maxPerMinute when check is respected", () => {
      fc.assert(
        fc.property(
          maxPerMinuteArb,
          fc.integer({ min: 1, max: 500 }),
          (maxPerMinute, totalAttempts) => {
            let time = 0;
            const limiter = new SlidingWindowRateLimiter(() => time);
            const key = "agent:resource";
            let accepted = 0;

            for (let i = 0; i < totalAttempts; i++) {
              if (limiter.check(key, maxPerMinute)) {
                limiter.record(key);
                accepted++;
              }
            }

            // Within a single window, accepted should never exceed maxPerMinute
            expect(accepted).toBeLessThanOrEqual(maxPerMinute);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
