import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  QdrantAdapter,
  createQdrantAdapter,
} from "../rag/store/qdrant-adapter.js";
import type { VectorStoreAdapter } from "../rag/store/vector-store-adapter.js";
import type { VectorRecord } from "../../shared/rag/contracts.js";

// ---------------------------------------------------------------------------
// Helper: mock fetch
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Map([["content-type", "application/json"]]),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
    headers: new Map([["content-type", "application/json"]]),
  });
}

function mockFetchPlainText(text: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
    headers: new Map([["content-type", "text/plain"]]),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:6333";

function lastFetchCall(mock: ReturnType<typeof vi.fn>) {
  const calls = mock.mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

function allFetchUrls(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c: any[]) => c[0] as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QdrantAdapter", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Constructor & interface
  // -----------------------------------------------------------------------

  it("satisfies VectorStoreAdapter interface", () => {
    const adapter: VectorStoreAdapter = new QdrantAdapter(BASE_URL);
    expect(typeof adapter.createCollection).toBe("function");
    expect(typeof adapter.upsert).toBe("function");
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.delete).toBe("function");
    expect(typeof adapter.collectionInfo).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
  });

  it("strips trailing slashes from connectionUrl", async () => {
    globalThis.fetch = mockFetchJson({ result: [] });
    const adapter = new QdrantAdapter("http://localhost:6333///");
    await adapter.healthCheck();
    const [url] = lastFetchCall(globalThis.fetch as any);
    expect(url).toBe("http://localhost:6333/healthz");
  });

  // -----------------------------------------------------------------------
  // createCollection
  // -----------------------------------------------------------------------

  describe("createCollection", () => {
    it("creates collection and 4 payload indexes", async () => {
      globalThis.fetch = mockFetchJson({ result: true });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.createCollection("rag_proj1", 1536);

      const urls = allFetchUrls(globalThis.fetch as any);

      // 1 PUT collection + 4 PUT index
      expect(urls).toHaveLength(5);
      expect(urls[0]).toBe(`${BASE_URL}/collections/rag_proj1`);

      // Index creation calls
      const indexUrls = urls.slice(1);
      expect(
        indexUrls.every(u => u === `${BASE_URL}/collections/rag_proj1/index`)
      ).toBe(true);

      // Verify collection creation body
      const [, collectionInit] = (globalThis.fetch as any).mock.calls[0];
      const collectionBody = JSON.parse(collectionInit.body);
      expect(collectionBody).toEqual({
        vectors: { size: 1536, distance: "Cosine" },
      });

      // Verify index field names
      const indexBodies = (globalThis.fetch as any).mock.calls
        .slice(1)
        .map((c: any[]) => JSON.parse(c[1].body));
      const fieldNames = indexBodies.map((b: any) => b.field_name).sort();
      expect(fieldNames).toEqual([
        "agentId",
        "codeLanguage",
        "sourceType",
        "timestamp",
      ]);

      // keyword indexes
      const keywordFields = indexBodies.filter(
        (b: any) => b.field_schema === "keyword"
      );
      expect(keywordFields).toHaveLength(3);

      // integer index for timestamp
      const intFields = indexBodies.filter(
        (b: any) => b.field_schema === "integer"
      );
      expect(intFields).toHaveLength(1);
      expect(intFields[0].field_name).toBe("timestamp");
    });

    it("throws on API error during collection creation", async () => {
      globalThis.fetch = mockFetchError(409, "Collection already exists");
      const adapter = new QdrantAdapter(BASE_URL);

      await expect(adapter.createCollection("rag_proj1", 1536)).rejects.toThrow(
        /Qdrant API error 409/
      );
    });
  });

  // -----------------------------------------------------------------------
  // upsert
  // -----------------------------------------------------------------------

  describe("upsert", () => {
    it("sends points with id, vector, and payload", async () => {
      globalThis.fetch = mockFetchJson({ result: { status: "ok" } });
      const adapter = new QdrantAdapter(BASE_URL);

      const records: VectorRecord[] = [
        {
          id: "chunk-1",
          vector: [0.1, 0.2, 0.3],
          content: "hello world",
          metadata: { sourceType: "task_result", agentId: "agent-1" },
        },
      ];

      await adapter.upsert("rag_proj1", records);

      const [url, init] = lastFetchCall(globalThis.fetch as any);
      expect(url).toBe(`${BASE_URL}/collections/rag_proj1/points`);
      expect(init.method).toBe("PUT");

      const body = JSON.parse(init.body as string);
      expect(body.points).toHaveLength(1);
      expect(body.points[0].id).toBe("chunk-1");
      expect(body.points[0].vector).toEqual([0.1, 0.2, 0.3]);
      expect(body.points[0].payload.content).toBe("hello world");
      expect(body.points[0].payload.sourceType).toBe("task_result");
      expect(body.points[0].payload.agentId).toBe("agent-1");
    });

    it("skips fetch call for empty records array", async () => {
      globalThis.fetch = mockFetchJson({});
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.upsert("rag_proj1", []);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("handles multiple records in a single batch", async () => {
      globalThis.fetch = mockFetchJson({ result: { status: "ok" } });
      const adapter = new QdrantAdapter(BASE_URL);

      const records: VectorRecord[] = [
        { id: "c1", vector: [0.1], content: "a" },
        { id: "c2", vector: [0.2], content: "b" },
        { id: "c3", vector: [0.3], content: "c" },
      ];

      await adapter.upsert("rag_proj1", records);

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      expect(body.points).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // search
  // -----------------------------------------------------------------------

  describe("search", () => {
    it("sends search request and returns mapped hits", async () => {
      const mockResult = {
        result: [
          {
            id: "c1",
            score: 0.95,
            payload: { content: "hello", sourceType: "task_result" },
          },
          {
            id: "c2",
            score: 0.8,
            payload: { content: "world", sourceType: "document" },
          },
        ],
      };
      globalThis.fetch = mockFetchJson(mockResult);
      const adapter = new QdrantAdapter(BASE_URL);

      const hits = await adapter.search("rag_proj1", [0.1, 0.2], { topK: 10 });

      expect(hits).toHaveLength(2);
      expect(hits[0]).toEqual({
        id: "c1",
        score: 0.95,
        metadata: { content: "hello", sourceType: "task_result" },
      });
      expect(hits[1]).toEqual({
        id: "c2",
        score: 0.8,
        metadata: { content: "world", sourceType: "document" },
      });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      expect(body.vector).toEqual([0.1, 0.2]);
      expect(body.limit).toBe(10);
      expect(body.with_payload).toBe(true);
    });

    it("includes minScore as score_threshold", async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.search("rag_proj1", [0.1], { topK: 5, minScore: 0.7 });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      expect(body.score_threshold).toBe(0.7);
    });

    it("builds keyword match filter for string values", async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.search("rag_proj1", [0.1], {
        topK: 5,
        filter: { sourceType: "code_snippet", agentId: "agent-1" },
      });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      expect(body.filter).toBeDefined();
      expect(body.filter.must).toHaveLength(2);

      const sourceFilter = body.filter.must.find(
        (m: any) => m.key === "sourceType"
      );
      expect(sourceFilter.match).toEqual({ value: "code_snippet" });

      const agentFilter = body.filter.must.find(
        (m: any) => m.key === "agentId"
      );
      expect(agentFilter.match).toEqual({ value: "agent-1" });
    });

    it('builds array match filter with "any" operator', async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.search("rag_proj1", [0.1], {
        topK: 5,
        filter: { sourceType: ["task_result", "document"] },
      });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      const sourceFilter = body.filter.must.find(
        (m: any) => m.key === "sourceType"
      );
      expect(sourceFilter.match).toEqual({ any: ["task_result", "document"] });
    });

    it("builds range filter for timestamp object", async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.search("rag_proj1", [0.1], {
        topK: 5,
        filter: { timestamp: { gte: "2025-01-01", lte: "2025-12-31" } },
      });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      const tsFilter = body.filter.must.find((m: any) => m.key === "timestamp");
      expect(tsFilter.range).toEqual({ gte: "2025-01-01", lte: "2025-12-31" });
    });

    it("omits filter when no filter options provided", async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.search("rag_proj1", [0.1], { topK: 5 });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      expect(body.filter).toBeUndefined();
    });

    it("skips null/undefined filter values", async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.search("rag_proj1", [0.1], {
        topK: 5,
        filter: {
          sourceType: "task_result",
          agentId: undefined,
          codeLanguage: null,
        },
      });

      const body = JSON.parse(
        lastFetchCall(globalThis.fetch as any)[1].body as string
      );
      expect(body.filter.must).toHaveLength(1);
      expect(body.filter.must[0].key).toBe("sourceType");
    });

    it("returns empty array when result is empty", async () => {
      globalThis.fetch = mockFetchJson({ result: [] });
      const adapter = new QdrantAdapter(BASE_URL);

      const hits = await adapter.search("rag_proj1", [0.1], { topK: 5 });
      expect(hits).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("sends delete request with point ids", async () => {
      globalThis.fetch = mockFetchJson({ result: { status: "ok" } });
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.delete("rag_proj1", ["c1", "c2"]);

      const [url, init] = lastFetchCall(globalThis.fetch as any);
      expect(url).toBe(`${BASE_URL}/collections/rag_proj1/points/delete`);
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string);
      expect(body.points).toEqual(["c1", "c2"]);
    });

    it("skips fetch call for empty ids array", async () => {
      globalThis.fetch = mockFetchJson({});
      const adapter = new QdrantAdapter(BASE_URL);

      await adapter.delete("rag_proj1", []);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // collectionInfo
  // -----------------------------------------------------------------------

  describe("collectionInfo", () => {
    it("returns collection info with vector count and dimension", async () => {
      globalThis.fetch = mockFetchJson({
        result: {
          status: "green",
          points_count: 42,
          config: {
            params: {
              vectors: { size: 1536 },
            },
          },
        },
      });
      const adapter = new QdrantAdapter(BASE_URL);

      const info = await adapter.collectionInfo("rag_proj1");

      expect(info).toEqual({
        name: "rag_proj1",
        vectorCount: 42,
        dimension: 1536,
        status: "green",
      });
    });

    it("falls back to vectors_count when points_count is missing", async () => {
      globalThis.fetch = mockFetchJson({
        result: {
          status: "green",
          vectors_count: 100,
          config: { params: { vectors: { size: 768 } } },
        },
      });
      const adapter = new QdrantAdapter(BASE_URL);

      const info = await adapter.collectionInfo("rag_proj1");
      expect(info.vectorCount).toBe(100);
    });

    it("returns 0 for vectorCount and dimension when data is missing", async () => {
      globalThis.fetch = mockFetchJson({
        result: { status: "yellow" },
      });
      const adapter = new QdrantAdapter(BASE_URL);

      const info = await adapter.collectionInfo("rag_proj1");
      expect(info.vectorCount).toBe(0);
      expect(info.dimension).toBe(0);
      expect(info.status).toBe("yellow");
    });
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  describe("healthCheck", () => {
    it("returns connected=true on successful response", async () => {
      globalThis.fetch = mockFetchPlainText("ok");
      const adapter = new QdrantAdapter(BASE_URL);

      const health = await adapter.healthCheck();

      expect(health.connected).toBe(true);
      expect(health.backend).toBe("qdrant");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns connected=false on fetch failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const adapter = new QdrantAdapter(BASE_URL);

      const health = await adapter.healthCheck();

      expect(health.connected).toBe(false);
      expect(health.backend).toBe("qdrant");
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns connected=false on non-ok status", async () => {
      globalThis.fetch = mockFetchError(503, "Service Unavailable");
      const adapter = new QdrantAdapter(BASE_URL);

      const health = await adapter.healthCheck();

      expect(health.connected).toBe(false);
      expect(health.backend).toBe("qdrant");
    });
  });

  // -----------------------------------------------------------------------
  // Timeout handling
  // -----------------------------------------------------------------------

  describe("timeout", () => {
    it("throws timeout error when request exceeds timeoutMs", async () => {
      globalThis.fetch = vi
        .fn()
        .mockImplementation((_url: string, opts: any) => {
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        });

      const adapter = new QdrantAdapter(BASE_URL, 50);

      await expect(
        adapter.upsert("rag_proj1", [
          { id: "c1", vector: [0.1], content: "test" },
        ])
      ).rejects.toThrow(/timed out after 50ms/);
    });
  });

  // -----------------------------------------------------------------------
  // createQdrantAdapter factory
  // -----------------------------------------------------------------------

  describe("createQdrantAdapter", () => {
    it("creates a QdrantAdapter instance", () => {
      const adapter = createQdrantAdapter("http://localhost:6333");
      expect(adapter).toBeInstanceOf(QdrantAdapter);
    });
  });
});
