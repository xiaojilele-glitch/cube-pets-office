/**
 * Unit tests + Property-based tests for AuditLogger
 *
 * Validates: Requirements 11.1–11.5
 */

import { describe, expect, it, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  PermissionAuditEntry,
  ResourceType,
  Action,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES, ACTIONS } from "../../shared/permission/contracts.js";
import { AuditLogger } from "./audit-logger.js";
import type { AuditLoggerDb } from "./audit-logger.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb(): AuditLoggerDb {
  let audit: PermissionAuditEntry[] = [];
  return {
    getPermissionAudit: () => audit,
    addPermissionAudit: (entry: PermissionAuditEntry) => {
      audit.push(entry);
    },
  };
}

/* ─── Helper to create a raw log entry (without id/timestamp) ─── */

function makeEntry(overrides: Partial<Omit<PermissionAuditEntry, "id" | "timestamp">> = {}) {
  return {
    agentId: overrides.agentId ?? "agent-1",
    operation: overrides.operation ?? "check",
    resourceType: overrides.resourceType ?? ("filesystem" as ResourceType),
    action: overrides.action ?? ("read" as Action),
    resource: overrides.resource ?? "/data/test.txt",
    result: overrides.result ?? ("allowed" as const),
    reason: overrides.reason,
    operator: overrides.operator,
    metadata: overrides.metadata,
  };
}

/* ─── Unit Tests ─── */

describe("AuditLogger", () => {
  let db: AuditLoggerDb;
  let logger: AuditLogger;

  beforeEach(() => {
    db = createInMemoryDb();
    logger = new AuditLogger(db);
  });

  describe("log()", () => {
    it("should auto-generate id and timestamp", () => {
      logger.log(makeEntry());
      const entries = db.getPermissionAudit();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBeDefined();
      expect(entries[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(entries[0].timestamp).toBeDefined();
      expect(new Date(entries[0].timestamp).getTime()).not.toBeNaN();
    });

    it("should preserve all fields from the input entry", () => {
      logger.log(makeEntry({
        agentId: "agent-x",
        operation: "grant",
        resourceType: "network",
        action: "connect",
        resource: "example.com",
        result: "allowed",
        reason: "test reason",
        operator: "admin",
        metadata: { key: "value" },
      }));
      const entries = db.getPermissionAudit();
      expect(entries[0].agentId).toBe("agent-x");
      expect(entries[0].operation).toBe("grant");
      expect(entries[0].resourceType).toBe("network");
      expect(entries[0].action).toBe("connect");
      expect(entries[0].resource).toBe("example.com");
      expect(entries[0].result).toBe("allowed");
      expect(entries[0].reason).toBe("test reason");
      expect(entries[0].operator).toBe("admin");
      expect(entries[0].metadata).toEqual({ key: "value" });
    });

    it("should generate unique ids for multiple entries", () => {
      logger.log(makeEntry());
      logger.log(makeEntry());
      const entries = db.getPermissionAudit();
      expect(entries[0].id).not.toBe(entries[1].id);
    });
  });

  describe("getAuditTrail()", () => {
    it("should return entries for a specific agent", () => {
      logger.log(makeEntry({ agentId: "agent-1" }));
      logger.log(makeEntry({ agentId: "agent-2" }));
      logger.log(makeEntry({ agentId: "agent-1" }));

      const trail = logger.getAuditTrail("agent-1");
      expect(trail).toHaveLength(2);
      expect(trail.every((e) => e.agentId === "agent-1")).toBe(true);
    });

    it("should return empty array for unknown agent", () => {
      logger.log(makeEntry({ agentId: "agent-1" }));
      expect(logger.getAuditTrail("unknown")).toEqual([]);
    });

    it("should filter by time range when provided", () => {
      // Manually insert entries with known timestamps
      db.addPermissionAudit({
        id: "e1",
        timestamp: "2025-01-01T00:00:00.000Z",
        agentId: "agent-1",
        operation: "check",
        resourceType: "filesystem",
        action: "read",
        resource: "/a",
        result: "allowed",
      });
      db.addPermissionAudit({
        id: "e2",
        timestamp: "2025-06-15T12:00:00.000Z",
        agentId: "agent-1",
        operation: "check",
        resourceType: "filesystem",
        action: "write",
        resource: "/b",
        result: "denied",
      });
      db.addPermissionAudit({
        id: "e3",
        timestamp: "2025-12-31T23:59:59.000Z",
        agentId: "agent-1",
        operation: "check",
        resourceType: "network",
        action: "connect",
        resource: "example.com",
        result: "allowed",
      });

      const trail = logger.getAuditTrail("agent-1", {
        from: "2025-03-01T00:00:00.000Z",
        to: "2025-09-01T00:00:00.000Z",
      });
      expect(trail).toHaveLength(1);
      expect(trail[0].id).toBe("e2");
    });
  });

  describe("getUsageReport()", () => {
    it("should aggregate allowed and denied counts", () => {
      logger.log(makeEntry({ agentId: "a1", result: "allowed", resourceType: "filesystem" }));
      logger.log(makeEntry({ agentId: "a1", result: "denied", resourceType: "filesystem" }));
      logger.log(makeEntry({ agentId: "a1", result: "allowed", resourceType: "network" }));
      logger.log(makeEntry({ agentId: "a1", result: "error", resourceType: "api" }));

      const report = logger.getUsageReport("a1", {
        from: "2000-01-01T00:00:00.000Z",
        to: "2099-12-31T23:59:59.000Z",
      });

      expect(report.agentId).toBe("a1");
      expect(report.totalChecks).toBe(4);
      expect(report.allowedCount).toBe(2);
      expect(report.deniedCount).toBe(1);
    });

    it("should break down counts by resource type", () => {
      logger.log(makeEntry({ agentId: "a1", result: "allowed", resourceType: "filesystem" }));
      logger.log(makeEntry({ agentId: "a1", result: "denied", resourceType: "filesystem" }));
      logger.log(makeEntry({ agentId: "a1", result: "allowed", resourceType: "network" }));
      logger.log(makeEntry({ agentId: "a1", result: "denied", resourceType: "network" }));
      logger.log(makeEntry({ agentId: "a1", result: "denied", resourceType: "network" }));

      const report = logger.getUsageReport("a1", {
        from: "2000-01-01T00:00:00.000Z",
        to: "2099-12-31T23:59:59.000Z",
      });

      expect(report.resourceBreakdown.filesystem).toEqual({ allowed: 1, denied: 1 });
      expect(report.resourceBreakdown.network).toEqual({ allowed: 1, denied: 2 });
      expect(report.resourceBreakdown.api).toEqual({ allowed: 0, denied: 0 });
      expect(report.resourceBreakdown.database).toEqual({ allowed: 0, denied: 0 });
      expect(report.resourceBreakdown.mcp_tool).toEqual({ allowed: 0, denied: 0 });
    });

    it("should initialize all resource types even with no entries", () => {
      const report = logger.getUsageReport("empty-agent", {
        from: "2000-01-01T00:00:00.000Z",
        to: "2099-12-31T23:59:59.000Z",
      });

      expect(report.totalChecks).toBe(0);
      expect(report.allowedCount).toBe(0);
      expect(report.deniedCount).toBe(0);
      for (const rt of RESOURCE_TYPES) {
        expect(report.resourceBreakdown[rt]).toEqual({ allowed: 0, denied: 0 });
      }
    });
  });

  describe("getViolations()", () => {
    it("should return only denied entries", () => {
      logger.log(makeEntry({ agentId: "a1", result: "allowed" }));
      logger.log(makeEntry({ agentId: "a1", result: "denied" }));
      logger.log(makeEntry({ agentId: "a2", result: "denied" }));
      logger.log(makeEntry({ agentId: "a1", result: "error" }));

      const violations = logger.getViolations();
      expect(violations).toHaveLength(2);
      expect(violations.every((e) => e.result === "denied")).toBe(true);
    });

    it("should filter violations by time range", () => {
      db.addPermissionAudit({
        id: "v1",
        timestamp: "2025-01-01T00:00:00.000Z",
        agentId: "a1",
        operation: "check",
        resourceType: "filesystem",
        action: "write",
        resource: "/etc/passwd",
        result: "denied",
      });
      db.addPermissionAudit({
        id: "v2",
        timestamp: "2025-06-15T00:00:00.000Z",
        agentId: "a1",
        operation: "check",
        resourceType: "network",
        action: "connect",
        resource: "10.0.0.1",
        result: "denied",
      });

      const violations = logger.getViolations({
        from: "2025-05-01T00:00:00.000Z",
        to: "2025-12-31T23:59:59.000Z",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].id).toBe("v2");
    });

    it("should return empty array when no violations exist", () => {
      logger.log(makeEntry({ result: "allowed" }));
      expect(logger.getViolations()).toEqual([]);
    });
  });

  describe("exportReport()", () => {
    it("should export all entries as valid JSON", () => {
      logger.log(makeEntry({ agentId: "a1", result: "allowed" }));
      logger.log(makeEntry({ agentId: "a2", result: "denied" }));

      const json = logger.exportReport("json");
      const parsed = JSON.parse(json);

      expect(parsed.format).toBe("json");
      expect(parsed.generatedAt).toBeDefined();
      expect(parsed.totalEntries).toBe(2);
      expect(parsed.entries).toHaveLength(2);
    });

    it("should filter by time range when provided", () => {
      db.addPermissionAudit({
        id: "x1",
        timestamp: "2025-01-01T00:00:00.000Z",
        agentId: "a1",
        operation: "check",
        resourceType: "filesystem",
        action: "read",
        resource: "/a",
        result: "allowed",
      });
      db.addPermissionAudit({
        id: "x2",
        timestamp: "2025-12-01T00:00:00.000Z",
        agentId: "a1",
        operation: "check",
        resourceType: "filesystem",
        action: "read",
        resource: "/b",
        result: "allowed",
      });

      const json = logger.exportReport("json", {
        from: "2025-06-01T00:00:00.000Z",
        to: "2025-12-31T23:59:59.000Z",
      });
      const parsed = JSON.parse(json);
      expect(parsed.totalEntries).toBe(1);
      expect(parsed.entries[0].id).toBe("x2");
    });

    it("should return all entries when no time range specified", () => {
      logger.log(makeEntry());
      logger.log(makeEntry());
      logger.log(makeEntry());

      const parsed = JSON.parse(logger.exportReport("json"));
      expect(parsed.totalEntries).toBe(3);
    });
  });

  /* ─── Property 11: 权限变更审计完整性 ─── */
  /* **Validates: Requirements 11.4** */

  describe("Property 11: 权限变更审计完整性", () => {
    const operationArb = fc.constantFrom("grant", "revoke", "escalate", "policy_change");
    const resourceTypeArb = fc.constantFrom(...RESOURCE_TYPES);
    const actionArb = fc.constantFrom(...ACTIONS);

    const auditEntryArb = fc.record({
      agentId: fc.stringMatching(/^agent-[a-z0-9]{1,8}$/),
      operation: operationArb,
      resourceType: resourceTypeArb,
      action: actionArb,
      resource: fc.stringMatching(/^\/[a-z]{1,10}$/),
      result: fc.constantFrom("allowed" as const, "denied" as const, "error" as const),
      reason: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    });

    it("every permission change operation should produce a matching audit record", () => {
      fc.assert(
        fc.property(
          fc.array(auditEntryArb, { minLength: 1, maxLength: 20 }),
          (entries) => {
            const freshDb = createInMemoryDb();
            const freshLogger = new AuditLogger(freshDb);

            for (const entry of entries) {
              freshLogger.log(entry);
            }

            const allAudit = freshDb.getPermissionAudit();

            // Every logged entry must have a matching record
            for (const entry of entries) {
              const match = allAudit.find(
                (a) =>
                  a.agentId === entry.agentId &&
                  a.operation === entry.operation &&
                  a.resourceType === entry.resourceType &&
                  a.action === entry.action &&
                  a.resource === entry.resource &&
                  a.result === entry.result,
              );
              expect(match).toBeDefined();
              // Must have auto-generated id and timestamp
              expect(match!.id).toBeTruthy();
              expect(match!.timestamp).toBeTruthy();
            }

            // Total count must match
            expect(allAudit.length).toBe(entries.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("audit records for change operations contain agentId, operation, and timestamp", () => {
      fc.assert(
        fc.property(
          auditEntryArb,
          (entry) => {
            const freshDb = createInMemoryDb();
            const freshLogger = new AuditLogger(freshDb);

            freshLogger.log(entry);

            const records = freshDb.getPermissionAudit();
            expect(records).toHaveLength(1);

            const record = records[0];
            expect(record.agentId).toBe(entry.agentId);
            expect(record.operation).toBe(entry.operation);
            expect(record.timestamp).toBeTruthy();
            // Timestamp must be a valid ISO date
            expect(new Date(record.timestamp).getTime()).not.toBeNaN();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
