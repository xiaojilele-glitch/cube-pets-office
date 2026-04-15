/**
 * 知识图谱公开 API 路由测试
 *
 * 测试 createKnowledgeRouter 工厂函数生成的 Express 路由。
 * 使用内存中的 GraphStore、KnowledgeReviewQueue、KnowledgeService 实例。
 * 采用与 feishu-routes.test.ts 相同的 withServer 模式。
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect } from "vitest";

import { GraphStore } from "../knowledge/graph-store.js";
import { KnowledgeReviewQueue } from "../knowledge/review-queue.js";
import { KnowledgeService } from "../knowledge/knowledge-service.js";
import { KnowledgeGraphQuery } from "../knowledge/query-service.js";
import { OntologyRegistry } from "../knowledge/ontology-registry.js";
import { createKnowledgeRouter } from "../routes/knowledge.js";
import type { Entity } from "../../shared/knowledge/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDeps() {
  const graphStore = new GraphStore();
  const ontologyRegistry = new OntologyRegistry();
  const reviewQueue = new KnowledgeReviewQueue(graphStore);
  const queryService = new KnowledgeGraphQuery(graphStore, ontologyRegistry);
  const knowledgeService = new KnowledgeService(queryService, graphStore);
  return { graphStore, reviewQueue, knowledgeService };
}

function uniqueProjectId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function withServer(
  handler: (baseUrl: string, deps: ReturnType<typeof createTestDeps>) => Promise<void>,
): Promise<void> {
  const deps = createTestDeps();
  const app = express();
  app.use(express.json());
  app.use("/api/knowledge", createKnowledgeRouter(deps));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl, deps);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function seedEntity(graphStore: GraphStore, overrides: Partial<Entity> & { name: string } = { name: "test-module" }): Entity {
  return graphStore.createEntity({
    entityType: "CodeModule",
    description: "A test module",
    source: "code_analysis",
    confidence: 0.9,
    projectId: overrides.projectId ?? uniqueProjectId("proj"),
    needsReview: false,
    linkedMemoryIds: [],
    extendedAttributes: { filePath: `src/${overrides.name ?? "test"}.ts` },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// GET /api/knowledge/graph
// ---------------------------------------------------------------------------

describe("GET /api/knowledge/graph", () => {
  it("returns 400 when projectId is missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/knowledge/graph`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("projectId");
    });
  });

  it("returns nodes and edges for a project", async () => {
    await withServer(async (baseUrl, deps) => {
      const projectId = uniqueProjectId("proj");
      const e1 = seedEntity(deps.graphStore, { name: "mod-a", projectId });
      const e2 = seedEntity(deps.graphStore, { name: "mod-b", projectId });
      deps.graphStore.createRelation({
        relationType: "DEPENDS_ON",
        sourceEntityId: e1.entityId,
        targetEntityId: e2.entityId,
        weight: 1.0,
        evidence: "import",
        source: "code_analysis",
        confidence: 0.9,
        needsReview: false,
      });

      const res = await fetch(`${baseUrl}/api/knowledge/graph?projectId=${projectId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.nodes).toHaveLength(2);
      expect(body.edges).toHaveLength(1);
    });
  });

  it("filters nodes by entityTypes", async () => {
    await withServer(async (baseUrl, deps) => {
      const projectId = uniqueProjectId("proj");
      seedEntity(deps.graphStore, { name: "mod-a", entityType: "CodeModule", projectId });
      seedEntity(deps.graphStore, { name: "api-a", entityType: "API", projectId });

      const res = await fetch(`${baseUrl}/api/knowledge/graph?projectId=${projectId}&entityTypes=API`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nodes).toHaveLength(1);
      expect(body.nodes[0].entityType).toBe("API");
    });
  });

  it("returns empty for a project with no data", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/knowledge/graph?projectId=${uniqueProjectId("empty-proj")}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nodes).toHaveLength(0);
      expect(body.edges).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/knowledge/review-queue
// ---------------------------------------------------------------------------

describe("GET /api/knowledge/review-queue", () => {
  it("returns empty queue when no entities need review", async () => {
    await withServer(async (baseUrl, deps) => {
      seedEntity(deps.graphStore, { name: "ok-mod", confidence: 0.9, needsReview: false });

      const res = await fetch(`${baseUrl}/api/knowledge/review-queue`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(0);
    });
  });

  it("returns entities needing review", async () => {
    await withServer(async (baseUrl, deps) => {
      const projectId = uniqueProjectId("proj");
      seedEntity(deps.graphStore, { name: "low-conf", confidence: 0.3, needsReview: true, projectId });
      seedEntity(deps.graphStore, { name: "high-conf", confidence: 0.9, needsReview: false, projectId });

      const res = await fetch(`${baseUrl}/api/knowledge/review-queue?projectId=${projectId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe("low-conf");
    });
  });

  it("filters by entityType", async () => {
    await withServer(async (baseUrl, deps) => {
      seedEntity(deps.graphStore, { name: "mod", entityType: "CodeModule", confidence: 0.2, needsReview: true });
      seedEntity(deps.graphStore, { name: "api", entityType: "API", confidence: 0.2, needsReview: true });

      const res = await fetch(`${baseUrl}/api/knowledge/review-queue?entityType=API`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].entityType).toBe("API");
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/knowledge/review/:entityId
// ---------------------------------------------------------------------------

describe("POST /api/knowledge/review/:entityId", () => {
  it("approves an entity and raises confidence", async () => {
    await withServer(async (baseUrl, deps) => {
      const entity = seedEntity(deps.graphStore, { name: "needs-review", confidence: 0.3, needsReview: true });

      const res = await fetch(`${baseUrl}/api/knowledge/review/${entity.entityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", reviewedBy: "user-1", reviewerType: "human" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.entity.confidence).toBe(0.8);
      expect(body.entity.needsReview).toBe(false);
    });
  });

  it("rejects an entity and archives it", async () => {
    await withServer(async (baseUrl, deps) => {
      const entity = seedEntity(deps.graphStore, { name: "bad-entity", confidence: 0.3, needsReview: true });

      const res = await fetch(`${baseUrl}/api/knowledge/review/${entity.entityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reviewedBy: "user-1", reviewerType: "human", rejectionReason: "Inaccurate" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entity.status).toBe("archived");
    });
  });

  it("returns 404 for non-existent entity", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/knowledge/review/non-existent-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", reviewedBy: "user-1", reviewerType: "human" }),
      });

      expect(res.status).toBe(404);
    });
  });

  it("returns 400 when body is incomplete", async () => {
    await withServer(async (baseUrl, deps) => {
      const entity = seedEntity(deps.graphStore, { name: "incomplete", confidence: 0.3, needsReview: true });

      const res = await fetch(`${baseUrl}/api/knowledge/review/${entity.entityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      expect(res.status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/knowledge/query
// ---------------------------------------------------------------------------

describe("POST /api/knowledge/query", () => {
  it("returns 400 when question is missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/knowledge/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj-1" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("question");
    });
  });

  it("returns 400 when projectId is missing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/knowledge/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "What modules exist?" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("projectId");
    });
  });

  it("returns unified query results", async () => {
    await withServer(async (baseUrl, deps) => {
      const projectId = uniqueProjectId("proj");
      seedEntity(deps.graphStore, { name: "auth-module", projectId });

      const res = await fetch(`${baseUrl}/api/knowledge/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "What modules exist?", projectId }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.result).toBeDefined();
      expect(body.result.structuredResults).toBeDefined();
      expect(body.result.mergedSummary).toBeDefined();
    });
  });

  it("accepts optional mode in options", async () => {
    await withServer(async (baseUrl, deps) => {
      const projectId = uniqueProjectId("proj");
      seedEntity(deps.graphStore, { name: "auth-module", projectId });

      const res = await fetch(`${baseUrl}/api/knowledge/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "What modules exist?",
          projectId,
          options: { mode: "preferStructured" },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });
});
