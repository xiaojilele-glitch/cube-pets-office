/**
 * AuditQuery 查询引擎 单元测试
 * 覆盖 Task 7.1 ~ 7.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { AuditQuery } from "../audit/audit-query.js";
import { AuditChain } from "../audit/audit-chain.js";
import { AuditCollector } from "../audit/audit-collector.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
import type { AuditEvent } from "../../shared/audit/contracts.js";
import { AuditEventType } from "../../shared/audit/contracts.js";

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function generateTestKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey: privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function makeEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    eventId: `ae_test_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    eventType: AuditEventType.AGENT_EXECUTED,
    timestamp: Date.now(),
    actor: { type: "agent", id: "agent-1", name: "TestAgent" },
    action: "execute_task",
    resource: { type: "mission", id: "m-1", name: "TestMission" },
    result: "success",
    context: { sessionId: "sess-1" },
    ...overrides,
  };
}

describe("AuditQuery", () => {
  let chain: AuditChain;
  let collector: AuditCollector;
  let query: AuditQuery;
  let tsProvider: TimestampProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    const keys = generateTestKeys();
    chain = new AuditChain({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });
    tsProvider = new TimestampProvider();
    collector = new AuditCollector(chain, tsProvider);
    query = new AuditQuery(chain, collector);
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  // ─── 7.1 query() — 多条件过滤 + 分页 ─────────────────────────────────────

  describe("7.1 query() — multi-filter + pagination", () => {
    it("should return empty result for empty chain", () => {
      const result = query.query({}, { pageSize: 50, pageNum: 1 });
      expect(result.entries).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("should filter by eventType (single)", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      chain.append(makeEvent({ eventType: AuditEventType.USER_LOGIN }));
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));

      const result = query.query(
        { eventType: AuditEventType.AGENT_EXECUTED },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(2);
      expect(
        result.entries.every(
          e => e.event.eventType === AuditEventType.AGENT_EXECUTED
        )
      ).toBe(true);
    });

    it("should filter by eventType (array)", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      chain.append(makeEvent({ eventType: AuditEventType.USER_LOGIN }));
      chain.append(makeEvent({ eventType: AuditEventType.CONFIG_CHANGED }));

      const result = query.query(
        {
          eventType: [AuditEventType.AGENT_EXECUTED, AuditEventType.USER_LOGIN],
        },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(2);
    });

    it("should filter by actorId", () => {
      chain.append(makeEvent({ actor: { type: "agent", id: "a-1" } }));
      chain.append(makeEvent({ actor: { type: "agent", id: "a-2" } }));
      chain.append(makeEvent({ actor: { type: "agent", id: "a-1" } }));

      const result = query.query(
        { actorId: "a-1" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(2);
    });

    it("should filter by actorType", () => {
      chain.append(makeEvent({ actor: { type: "agent", id: "a-1" } }));
      chain.append(makeEvent({ actor: { type: "user", id: "u-1" } }));

      const result = query.query(
        { actorType: "user" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.actor.type).toBe("user");
    });

    it("should filter by resourceType and resourceId", () => {
      chain.append(makeEvent({ resource: { type: "mission", id: "m-1" } }));
      chain.append(makeEvent({ resource: { type: "config", id: "c-1" } }));
      chain.append(makeEvent({ resource: { type: "mission", id: "m-2" } }));

      const r1 = query.query(
        { resourceType: "mission" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(r1.total).toBe(2);

      const r2 = query.query(
        { resourceId: "m-1" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(r2.total).toBe(1);
    });

    it("should filter by result", () => {
      chain.append(makeEvent({ result: "success" }));
      chain.append(makeEvent({ result: "denied" }));
      chain.append(makeEvent({ result: "failure" }));

      const result = query.query(
        { result: "denied" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.result).toBe("denied");
    });

    it("should filter by severity via DEFAULT_EVENT_TYPE_REGISTRY", () => {
      // AGENT_EXECUTED = INFO, AGENT_FAILED = WARNING, DECISION_MADE = CRITICAL
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_FAILED }));
      chain.append(makeEvent({ eventType: AuditEventType.DECISION_MADE }));

      const result = query.query(
        { severity: "CRITICAL" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.eventType).toBe(
        AuditEventType.DECISION_MADE
      );
    });

    it("should filter by category via DEFAULT_EVENT_TYPE_REGISTRY", () => {
      // AGENT_EXECUTED = operational, USER_LOGIN = security, AUDIT_QUERY = compliance
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      chain.append(makeEvent({ eventType: AuditEventType.USER_LOGIN }));
      chain.append(makeEvent({ eventType: AuditEventType.AUDIT_QUERY }));

      const result = query.query(
        { category: "security" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.eventType).toBe(AuditEventType.USER_LOGIN);
    });

    it("should filter by timeRange", () => {
      chain.append(makeEvent({ timestamp: 1000 }));
      chain.append(makeEvent({ timestamp: 2000 }));
      chain.append(makeEvent({ timestamp: 3000 }));

      const result = query.query(
        { timeRange: { start: 1500, end: 2500 } },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
      expect(result.entries[0].event.timestamp).toBe(2000);
    });

    it("should filter by keyword in action/resource/metadata", () => {
      chain.append(makeEvent({ action: "deploy_service" }));
      chain.append(makeEvent({ action: "execute_task" }));
      chain.append(
        makeEvent({ action: "deploy_container", metadata: { note: "urgent" } })
      );

      const result = query.query(
        { keyword: "deploy" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(2);
    });

    it("should combine multiple filters", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.AGENT_EXECUTED,
          actor: { type: "agent", id: "a-1" },
          result: "success",
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.AGENT_EXECUTED,
          actor: { type: "agent", id: "a-2" },
          result: "success",
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.USER_LOGIN,
          actor: { type: "user", id: "a-1" },
          result: "success",
        })
      );

      const result = query.query(
        { eventType: AuditEventType.AGENT_EXECUTED, actorId: "a-1" },
        { pageSize: 50, pageNum: 1 }
      );
      expect(result.total).toBe(1);
    });

    it("should paginate correctly", () => {
      for (let i = 0; i < 10; i++) {
        chain.append(makeEvent());
      }

      const page1 = query.query({}, { pageSize: 3, pageNum: 1 });
      expect(page1.entries).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.page.pageSize).toBe(3);
      expect(page1.page.pageNum).toBe(1);

      const page2 = query.query({}, { pageSize: 3, pageNum: 2 });
      expect(page2.entries).toHaveLength(3);

      const page4 = query.query({}, { pageSize: 3, pageNum: 4 });
      expect(page4.entries).toHaveLength(1);
    });

    it("should cap pageSize at 200", () => {
      for (let i = 0; i < 5; i++) chain.append(makeEvent());

      const result = query.query({}, { pageSize: 999, pageNum: 1 });
      expect(result.page.pageSize).toBe(200);
    });

    it("should default pageNum to 1 if invalid", () => {
      chain.append(makeEvent());
      const result = query.query({}, { pageSize: 50, pageNum: 0 });
      expect(result.page.pageNum).toBe(1);
      expect(result.entries).toHaveLength(1);
    });
  });

  // ─── 7.2 search() — 全文搜索 ─────────────────────────────────────────────

  describe("7.2 search() — full-text search", () => {
    it("should match keyword in action", () => {
      chain.append(makeEvent({ action: "deploy_service" }));
      chain.append(makeEvent({ action: "execute_task" }));

      const result = query.search("deploy", { pageSize: 50, pageNum: 1 });
      expect(result.total).toBe(1);
      expect(result.entries[0].event.action).toBe("deploy_service");
    });

    it("should match keyword in resource.type", () => {
      chain.append(makeEvent({ resource: { type: "mission", id: "m-1" } }));
      chain.append(makeEvent({ resource: { type: "config", id: "c-1" } }));

      const result = query.search("mission", { pageSize: 50, pageNum: 1 });
      expect(result.total).toBe(1);
    });

    it("should match keyword in resource.id", () => {
      chain.append(
        makeEvent({ resource: { type: "mission", id: "m-special-123" } })
      );
      chain.append(makeEvent({ resource: { type: "mission", id: "m-other" } }));

      const result = query.search("special", { pageSize: 50, pageNum: 1 });
      expect(result.total).toBe(1);
    });

    it("should match keyword in resource.name", () => {
      chain.append(
        makeEvent({
          resource: { type: "mission", id: "m-1", name: "ImportantMission" },
        })
      );
      chain.append(
        makeEvent({
          resource: { type: "mission", id: "m-2", name: "OtherMission" },
        })
      );

      const result = query.search("important", { pageSize: 50, pageNum: 1 });
      expect(result.total).toBe(1);
    });

    it("should match keyword in metadata (JSON stringified)", () => {
      chain.append(
        makeEvent({ metadata: { description: "critical_deployment" } })
      );
      chain.append(makeEvent({ metadata: { note: "routine check" } }));

      const result = query.search("critical_deployment", {
        pageSize: 50,
        pageNum: 1,
      });
      expect(result.total).toBe(1);
    });

    it("should be case-insensitive", () => {
      chain.append(makeEvent({ action: "Deploy_Service" }));

      const r1 = query.search("deploy", { pageSize: 50, pageNum: 1 });
      expect(r1.total).toBe(1);

      const r2 = query.search("DEPLOY", { pageSize: 50, pageNum: 1 });
      expect(r2.total).toBe(1);
    });

    it("should paginate search results", () => {
      for (let i = 0; i < 10; i++) {
        chain.append(makeEvent({ action: `deploy_task_${i}` }));
      }

      const page1 = query.search("deploy", { pageSize: 3, pageNum: 1 });
      expect(page1.entries).toHaveLength(3);
      expect(page1.total).toBe(10);
    });

    it("should return empty for no matches", () => {
      chain.append(makeEvent({ action: "execute_task" }));
      const result = query.search("nonexistent_keyword", {
        pageSize: 50,
        pageNum: 1,
      });
      expect(result.total).toBe(0);
    });
  });

  // ─── 7.3 getPermissionTrail() ─────────────────────────────────────────────

  describe("7.3 getPermissionTrail()", () => {
    it("should return permission events where agent is actor", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          actor: { type: "system", id: "agent-x" },
          resource: { type: "permission", id: "perm-1" },
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.AGENT_EXECUTED,
          actor: { type: "agent", id: "agent-x" },
        })
      );

      const trail = query.getPermissionTrail("agent-x");
      expect(trail).toHaveLength(1);
      expect(trail[0].event.eventType).toBe(AuditEventType.PERMISSION_GRANTED);
    });

    it("should return permission events where agent is resource target", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_REVOKED,
          actor: { type: "system", id: "admin" },
          resource: { type: "agent", id: "agent-y" },
        })
      );

      const trail = query.getPermissionTrail("agent-y");
      expect(trail).toHaveLength(1);
      expect(trail[0].event.eventType).toBe(AuditEventType.PERMISSION_REVOKED);
    });

    it("should include ESCALATION_APPROVED events", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.ESCALATION_APPROVED,
          actor: { type: "user", id: "admin" },
          resource: { type: "agent", id: "agent-z" },
        })
      );

      const trail = query.getPermissionTrail("agent-z");
      expect(trail).toHaveLength(1);
      expect(trail[0].event.eventType).toBe(AuditEventType.ESCALATION_APPROVED);
    });

    it("should filter by timeRange", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          timestamp: 1000,
          actor: { type: "system", id: "agent-a" },
          resource: { type: "permission", id: "p-1" },
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          timestamp: 3000,
          actor: { type: "system", id: "agent-a" },
          resource: { type: "permission", id: "p-2" },
        })
      );

      const trail = query.getPermissionTrail("agent-a", {
        start: 2000,
        end: 4000,
      });
      expect(trail).toHaveLength(1);
      expect(trail[0].event.timestamp).toBe(3000);
    });

    it("should return sorted by timestamp", () => {
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_GRANTED,
          timestamp: 3000,
          actor: { type: "system", id: "agent-b" },
          resource: { type: "permission", id: "p-1" },
        })
      );
      chain.append(
        makeEvent({
          eventType: AuditEventType.PERMISSION_REVOKED,
          timestamp: 1000,
          actor: { type: "system", id: "agent-b" },
          resource: { type: "permission", id: "p-2" },
        })
      );

      const trail = query.getPermissionTrail("agent-b");
      expect(trail).toHaveLength(2);
      expect(trail[0].event.timestamp).toBeLessThanOrEqual(
        trail[1].event.timestamp
      );
    });

    it("should return empty for agent with no permission events", () => {
      chain.append(makeEvent({ eventType: AuditEventType.AGENT_EXECUTED }));
      const trail = query.getPermissionTrail("unknown-agent");
      expect(trail).toHaveLength(0);
    });
  });

  // ─── 7.4 getPermissionViolations() ────────────────────────────────────────

  describe("7.4 getPermissionViolations()", () => {
    it("should return entries with result=denied", () => {
      chain.append(makeEvent({ result: "success" }));
      chain.append(makeEvent({ result: "denied" }));
      chain.append(makeEvent({ result: "failure" }));
      chain.append(makeEvent({ result: "denied" }));

      const violations = query.getPermissionViolations();
      expect(violations).toHaveLength(2);
      expect(violations.every(e => e.event.result === "denied")).toBe(true);
    });

    it("should filter by timeRange", () => {
      chain.append(makeEvent({ result: "denied", timestamp: 1000 }));
      chain.append(makeEvent({ result: "denied", timestamp: 3000 }));

      const violations = query.getPermissionViolations({
        start: 2000,
        end: 4000,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].event.timestamp).toBe(3000);
    });

    it("should return sorted by timestamp", () => {
      chain.append(makeEvent({ result: "denied", timestamp: 5000 }));
      chain.append(makeEvent({ result: "denied", timestamp: 2000 }));

      const violations = query.getPermissionViolations();
      expect(violations).toHaveLength(2);
      expect(violations[0].event.timestamp).toBeLessThanOrEqual(
        violations[1].event.timestamp
      );
    });

    it("should return empty when no violations exist", () => {
      chain.append(makeEvent({ result: "success" }));
      const violations = query.getPermissionViolations();
      expect(violations).toHaveLength(0);
    });
  });

  // ─── 7.5 getDataLineageAudit() ───────────────────────────────────────────

  describe("7.5 getDataLineageAudit()", () => {
    it("should match by lineageId", () => {
      chain.append(makeEvent({ lineageId: "data-123" }));
      chain.append(makeEvent({ lineageId: "data-456" }));

      const result = query.getDataLineageAudit("data-123");
      expect(result).toHaveLength(1);
      expect(result[0].event.lineageId).toBe("data-123");
    });

    it("should match by resource.id", () => {
      chain.append(makeEvent({ resource: { type: "data", id: "data-789" } }));
      chain.append(makeEvent({ resource: { type: "data", id: "data-other" } }));

      const result = query.getDataLineageAudit("data-789");
      expect(result).toHaveLength(1);
      expect(result[0].event.resource.id).toBe("data-789");
    });

    it("should match both lineageId and resource.id", () => {
      chain.append(
        makeEvent({
          lineageId: "data-x",
          resource: { type: "data", id: "other" },
        })
      );
      chain.append(
        makeEvent({
          lineageId: "other",
          resource: { type: "data", id: "data-x" },
        })
      );
      chain.append(
        makeEvent({ lineageId: "nope", resource: { type: "data", id: "nope" } })
      );

      const result = query.getDataLineageAudit("data-x");
      expect(result).toHaveLength(2);
    });

    it("should return sorted by timestamp", () => {
      chain.append(makeEvent({ lineageId: "d-1", timestamp: 5000 }));
      chain.append(makeEvent({ lineageId: "d-1", timestamp: 1000 }));

      const result = query.getDataLineageAudit("d-1");
      expect(result).toHaveLength(2);
      expect(result[0].event.timestamp).toBeLessThanOrEqual(
        result[1].event.timestamp
      );
    });

    it("should return empty for unknown dataId", () => {
      chain.append(makeEvent());
      const result = query.getDataLineageAudit("nonexistent");
      expect(result).toHaveLength(0);
    });
  });

  // ─── 7.6 查询操作自身的审计记录 ──────────────────────────────────────────

  describe("7.6 Query audit recording (AUDIT_QUERY events)", () => {
    it("should record AUDIT_QUERY event after query()", () => {
      chain.append(makeEvent());
      const recordSpy = vi.spyOn(collector, "record");

      query.query({}, { pageSize: 50, pageNum: 1 });

      expect(recordSpy).toHaveBeenCalledTimes(1);
      const call = recordSpy.mock.calls[0][0];
      expect(call.eventType).toBe(AuditEventType.AUDIT_QUERY);
      expect(call.action).toBe("audit.query");
      expect(call.actor.id).toBe("audit-query");
      expect(call.metadata).toBeDefined();
      recordSpy.mockRestore();
    });

    it("should record AUDIT_QUERY event after search()", () => {
      chain.append(makeEvent());
      const recordSpy = vi.spyOn(collector, "record");

      query.search("test", { pageSize: 50, pageNum: 1 });

      expect(recordSpy).toHaveBeenCalledTimes(1);
      const call = recordSpy.mock.calls[0][0];
      expect(call.eventType).toBe(AuditEventType.AUDIT_QUERY);
      expect(call.action).toBe("audit.search");
      expect(call.metadata).toHaveProperty("keyword", "test");
      recordSpy.mockRestore();
    });

    it("should record AUDIT_QUERY event after getPermissionTrail()", () => {
      const recordSpy = vi.spyOn(collector, "record");

      query.getPermissionTrail("agent-1");

      expect(recordSpy).toHaveBeenCalledTimes(1);
      const call = recordSpy.mock.calls[0][0];
      expect(call.action).toBe("audit.getPermissionTrail");
      expect(call.metadata).toHaveProperty("agentId", "agent-1");
      recordSpy.mockRestore();
    });

    it("should record AUDIT_QUERY event after getPermissionViolations()", () => {
      const recordSpy = vi.spyOn(collector, "record");

      query.getPermissionViolations();

      expect(recordSpy).toHaveBeenCalledTimes(1);
      const call = recordSpy.mock.calls[0][0];
      expect(call.action).toBe("audit.getPermissionViolations");
      recordSpy.mockRestore();
    });

    it("should record AUDIT_QUERY event after getDataLineageAudit()", () => {
      const recordSpy = vi.spyOn(collector, "record");

      query.getDataLineageAudit("data-1");

      expect(recordSpy).toHaveBeenCalledTimes(1);
      const call = recordSpy.mock.calls[0][0];
      expect(call.action).toBe("audit.getDataLineageAudit");
      expect(call.metadata).toHaveProperty("dataId", "data-1");
      recordSpy.mockRestore();
    });

    it("should use record() (async buffer) to avoid recursion", () => {
      // AUDIT_QUERY is INFO severity, so record() buffers it (no sync write)
      const recordSpy = vi.spyOn(collector, "record");
      const recordSyncSpy = vi.spyOn(collector, "recordSync");

      query.query({}, { pageSize: 50, pageNum: 1 });

      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSyncSpy).not.toHaveBeenCalled();
      recordSpy.mockRestore();
      recordSyncSpy.mockRestore();
    });
  });
});
