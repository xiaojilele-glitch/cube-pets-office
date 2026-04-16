/**
 * 血缘路由集成测试
 * 覆盖 Task 8.1 ~ 8.5: 所有 /api/lineage/* 路由的请求/响应形状
 *
 * 使用 express app + node http 测试，无需 supertest 依赖。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { createLineageRouter } from "../routes/lineage.js";
import { LineageQueryService } from "../lineage/lineage-query.js";
import { LineageAuditService } from "../lineage/lineage-audit.js";
import { ChangeDetectionService } from "../lineage/change-detection.js";
import { LineageExportService } from "../lineage/lineage-export.js";
import type { LineageStorageAdapter } from "../lineage/lineage-store.js";
import type {
  DataLineageNode,
  LineageStoreStats,
} from "../../shared/lineage/contracts.js";

// ─── Mock Store ────────────────────────────────────────────────────────────

function makeNode(overrides?: Partial<DataLineageNode>): DataLineageNode {
  return {
    lineageId: "node-1",
    type: "source",
    timestamp: 1000,
    context: { sessionId: "s1", userId: "user-1" },
    sourceId: "src-1",
    sourceName: "TestSource",
    resultHash: "abc123",
    ...overrides,
  };
}

const sampleNodes: DataLineageNode[] = [
  makeNode({
    lineageId: "node-1",
    type: "source",
    timestamp: 1000,
    sourceId: "src-1",
    resultHash: "hash-a",
  }),
  makeNode({
    lineageId: "node-2",
    type: "transformation",
    timestamp: 2000,
    agentId: "agent-1",
    upstream: ["node-1"],
  }),
  makeNode({
    lineageId: "node-3",
    type: "decision",
    timestamp: 3000,
    decisionId: "dec-1",
    upstream: ["node-2"],
    result: "approve",
    confidence: 0.95,
  }),
];

function createMockStore(): LineageStorageAdapter {
  return {
    async batchInsertNodes() {},
    async batchInsertEdges() {},
    async getNode(id: string) {
      return sampleNodes.find(n => n.lineageId === id);
    },
    async queryNodes(filter: Record<string, unknown>) {
      let results = [...sampleNodes];
      if (filter.type) results = results.filter(n => n.type === filter.type);
      if (filter.decisionId)
        results = results.filter(n => n.decisionId === filter.decisionId);
      if (filter.agentId)
        results = results.filter(n => n.agentId === filter.agentId);
      return results;
    },
    async queryEdges() {
      return [];
    },
    async purgeExpired() {
      return 0;
    },
    async getStats(): Promise<LineageStoreStats> {
      return {
        totalNodes: sampleNodes.length,
        totalEdges: 0,
        nodesByType: { source: 1, transformation: 1, decision: 1 },
        oldestTimestamp: 1000,
        newestTimestamp: 3000,
      };
    },
  };
}

// ─── HTTP helper (no supertest dependency) ─────────────────────────────────

function fetch(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, "http://localhost");
    const options: http.RequestOptions = {
      method,
      hostname: "localhost",
      port: (server.address() as { port: number }).port,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(options, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({
            status: res.statusCode!,
            body: { raw: data } as Record<string, unknown>,
          });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── App Setup ─────────────────────────────────────────────────────────────

function createApp() {
  const store = createMockStore();
  const queryService = new LineageQueryService(store);
  const auditService = new LineageAuditService(store, queryService);
  const changeDetectionService = new ChangeDetectionService(
    store,
    queryService
  );
  const exportService = new LineageExportService(store);

  const app = express();
  app.use(express.json());
  app.use(
    "/api/lineage",
    createLineageRouter({
      queryService,
      auditService,
      exportService,
      changeDetectionService,
      store,
    })
  );
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Lineage Routes", () => {
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>(resolve => {
        const app = createApp();
        server = app.listen(0, resolve);
      })
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      })
  );

  // ── Query routes ──

  describe("GET /api/lineage/:id", () => {
    it("returns a node by id", async () => {
      const res = await fetch(server, "GET", "/api/lineage/node-1");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect((res.body.node as Record<string, unknown>).lineageId).toBe(
        "node-1"
      );
    });

    it("returns 404 for unknown node", async () => {
      const res = await fetch(server, "GET", "/api/lineage/nonexistent");
      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("GET /api/lineage (queryNodes)", () => {
    it("returns all nodes when no filter", async () => {
      const res = await fetch(server, "GET", "/api/lineage");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.nodes)).toBe(true);
      expect((res.body.nodes as unknown[]).length).toBe(3);
    });

    it("filters by type", async () => {
      const res = await fetch(server, "GET", "/api/lineage?type=decision");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const nodes = res.body.nodes as Array<Record<string, unknown>>;
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe("decision");
    });
  });

  describe("GET /api/lineage/:id/upstream", () => {
    it("returns upstream graph", async () => {
      const res = await fetch(server, "GET", "/api/lineage/node-2/upstream");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const graph = res.body.graph as Record<string, unknown>;
      expect(graph.nodes).toBeDefined();
      expect(graph.edges).toBeDefined();
    });
  });

  describe("GET /api/lineage/:id/downstream", () => {
    it("returns downstream graph", async () => {
      const res = await fetch(server, "GET", "/api/lineage/node-1/downstream");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.graph).toBeDefined();
    });
  });

  describe("GET /api/lineage/path", () => {
    it("requires sourceId and decisionId", async () => {
      const res = await fetch(server, "GET", "/api/lineage/path");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns full path graph", async () => {
      const res = await fetch(
        server,
        "GET",
        "/api/lineage/path?sourceId=node-1&decisionId=node-3"
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.graph).toBeDefined();
    });
  });

  describe("GET /api/lineage/:id/impact", () => {
    it("returns impact analysis result", async () => {
      const res = await fetch(server, "GET", "/api/lineage/node-1/impact");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const result = res.body.result as Record<string, unknown>;
      expect(result.riskLevel).toBeDefined();
      expect(result.affectedNodes).toBeDefined();
      expect(result.affectedDecisions).toBeDefined();
    });
  });

  // ── Audit routes ──

  describe("GET /api/lineage/audit/trail", () => {
    it("requires userId, start, end", async () => {
      const res = await fetch(server, "GET", "/api/lineage/audit/trail");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns audit entries", async () => {
      const res = await fetch(
        server,
        "GET",
        "/api/lineage/audit/trail?userId=user-1&start=0&end=99999"
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.entries)).toBe(true);
    });
  });

  describe("GET /api/lineage/audit/anomalies", () => {
    it("requires start and end", async () => {
      const res = await fetch(server, "GET", "/api/lineage/audit/anomalies");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns anomaly alerts", async () => {
      const res = await fetch(
        server,
        "GET",
        "/api/lineage/audit/anomalies?start=0&end=99999"
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.alerts)).toBe(true);
    });
  });

  describe("GET /api/lineage/audit/report/:decisionId", () => {
    it("returns a lineage report for a decision", async () => {
      const res = await fetch(server, "GET", "/api/lineage/audit/report/dec-1");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const report = res.body.report as Record<string, unknown>;
      expect(report.decisionId).toBe("dec-1");
    });
  });

  // ── Export/Import routes ──

  describe("GET /api/lineage/export", () => {
    it("requires startTime and endTime", async () => {
      const res = await fetch(server, "GET", "/api/lineage/export");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns exported data", async () => {
      const res = await fetch(
        server,
        "GET",
        "/api/lineage/export?startTime=0&endTime=99999"
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe("POST /api/lineage/import", () => {
    it("requires data field", async () => {
      const res = await fetch(server, "POST", "/api/lineage/import", {});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("imports lineage data", async () => {
      const payload = JSON.stringify({ nodes: [], edges: [] });
      const res = await fetch(server, "POST", "/api/lineage/import", {
        format: "json",
        data: payload,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const result = res.body.result as Record<string, unknown>;
      expect(typeof result.importedNodes).toBe("number");
    });
  });

  // ── Change detection routes ──

  describe("POST /api/lineage/changes/detect", () => {
    it("requires sourceId", async () => {
      const res = await fetch(
        server,
        "POST",
        "/api/lineage/changes/detect",
        {}
      );
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns change detection result", async () => {
      const res = await fetch(server, "POST", "/api/lineage/changes/detect", {
        sourceId: "src-1",
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect("alert" in res.body).toBe(true);
    });
  });

  describe("GET /api/lineage/quality/:dataId", () => {
    it("returns quality metrics", async () => {
      const res = await fetch(server, "GET", "/api/lineage/quality/node-1");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const metrics = res.body.metrics as Record<string, unknown>;
      expect(typeof metrics.freshness).toBe("number");
      expect(typeof metrics.completeness).toBe("number");
      expect(typeof metrics.accuracy).toBe("number");
    });
  });

  describe("GET /api/lineage/stats", () => {
    it("returns store statistics", async () => {
      const res = await fetch(server, "GET", "/api/lineage/stats");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const stats = res.body.stats as Record<string, unknown>;
      expect(typeof stats.totalNodes).toBe("number");
      expect(typeof stats.totalEdges).toBe("number");
      expect(stats.nodesByType).toBeDefined();
    });
  });
});
