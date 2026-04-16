import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuditEventType } from "../../shared/audit/contracts.js";
import type { AuditCollector } from "../audit/audit-collector.js";
import type { AuditEventInput } from "../audit/audit-collector.js";

/**
 * Minimal mock collector that captures record() calls.
 */
function createMockCollector() {
  const events: AuditEventInput[] = [];
  return {
    events,
    record: vi.fn((input: AuditEventInput) => {
      events.push(input);
    }),
    recordSync: vi.fn((input: AuditEventInput) => {
      events.push(input);
      return {} as any;
    }),
    flush: vi.fn(),
    getBufferSize: vi.fn(() => 0),
    destroy: vi.fn(),
  } as unknown as AuditCollector & { events: AuditEventInput[] };
}

describe("installAuditHooks", () => {
  let collector: ReturnType<typeof createMockCollector>;

  beforeEach(() => {
    collector = createMockCollector();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should export installAuditHooks function", async () => {
    const { installAuditHooks } = await import("../audit/audit-hooks.js");
    expect(typeof installAuditHooks).toBe("function");
  });

  it("should not throw when called with default deps", async () => {
    const { installAuditHooks } = await import("../audit/audit-hooks.js");
    expect(() => installAuditHooks({ collector })).not.toThrow();
  });
});
