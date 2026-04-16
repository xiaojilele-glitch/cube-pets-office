import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  IngestionPayload,
  ChunkRecord,
  ChunkMetadata,
} from "../../shared/rag/contracts.js";
import type { EmbeddingProvider } from "../rag/embedding/embedding-provider.js";
import type { Chunker } from "../rag/chunking/chunk-router.js";
import type { VectorStoreAdapter } from "../rag/store/vector-store-adapter.js";
import { DedupChecker } from "../rag/ingestion/dedup-checker.js";
import { DataCleaner } from "../rag/ingestion/data-cleaner.js";
import { DeadLetterQueue } from "../rag/ingestion/dead-letter-queue.js";
import { ChunkRouter } from "../rag/chunking/chunk-router.js";
import { EmbeddingGenerator } from "../rag/embedding/embedding-generator.js";
import { MetadataStore } from "../rag/store/metadata-store.js";
import {
  IngestionPipeline,
  type IngestionPipelineDeps,
} from "../rag/ingestion/ingestion-pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpPath(name: string): string {
  const dir = join(
    tmpdir(),
    `ingestion-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

function makePayload(overrides?: Partial<IngestionPayload>): IngestionPayload {
  return {
    sourceType: "task_result",
    sourceId: `src-${Date.now()}`,
    projectId: "proj-1",
    content: "Hello world, this is test content for the ingestion pipeline.",
    metadata: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Simple in-memory chunker that returns one chunk per call */
class StubChunker implements Chunker {
  chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
    return [
      {
        chunkId: "",
        sourceType: "task_result",
        sourceId: "",
        projectId: "",
        chunkIndex: 0,
        content,
        tokenCount: content.split(/\s+/).length,
        metadata,
      },
    ];
  }
}

/** Fake embedding provider returning fixed-dimension vectors */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 4;
  readonly modelName = "fake-model";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
  }
}

/** Fake embedding provider that always throws */
class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 4;
  readonly modelName = "failing-model";
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error("Embedding API unavailable");
  }
}

/** In-memory VectorStoreAdapter stub */
function createStubVectorStore(): VectorStoreAdapter & {
  stored: Map<string, any[]>;
} {
  const stored = new Map<string, any[]>();
  return {
    stored,
    async createCollection() {},
    async upsert(collection, records) {
      const existing = stored.get(collection) ?? [];
      existing.push(...records);
      stored.set(collection, existing);
    },
    async search() {
      return [];
    },
    async delete() {},
    async collectionInfo(name) {
      return { name, vectorCount: 0, dimension: 4, status: "ready" };
    },
    async healthCheck() {
      return { connected: true, backend: "stub", latencyMs: 0 };
    },
  };
}

/** Build full pipeline deps with stubs */
function buildDeps(
  overrides?: Partial<IngestionPipelineDeps>
): IngestionPipelineDeps & {
  vectorStore: VectorStoreAdapter & { stored: Map<string, any[]> };
  dedupChecker: DedupChecker;
  deadLetterQueue: DeadLetterQueue;
  metadataStore: MetadataStore;
} {
  const chunkRouter = new ChunkRouter();
  chunkRouter.register("sliding_window", new StubChunker());
  chunkRouter.register("syntax_aware", new StubChunker());
  chunkRouter.register("conversation_turn", new StubChunker());
  chunkRouter.register("semantic_paragraph", new StubChunker());
  chunkRouter.register("passthrough", new StubChunker());

  const vectorStore = createStubVectorStore();
  const dedupChecker = new DedupChecker(tmpPath("dedup.json"));
  const deadLetterQueue = new DeadLetterQueue(tmpPath("dlq.json"));
  const metadataStore = new MetadataStore(tmpPath("metadata.json"));

  return {
    dedupChecker,
    dataCleaner: new DataCleaner(),
    chunkRouter,
    embeddingGenerator: new EmbeddingGenerator(new FakeEmbeddingProvider()),
    vectorStore,
    metadataStore,
    deadLetterQueue,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IngestionPipeline", () => {
  let deps: ReturnType<typeof buildDeps>;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    deps = buildDeps();
    pipeline = new IngestionPipeline(deps);
  });

  afterEach(async () => {
    await deps.dedupChecker.flush();
    await deps.deadLetterQueue.flush();
    await deps.metadataStore.flush();
  });

  // --- ingest: happy path ---

  it("ingests a payload successfully", async () => {
    const result = await pipeline.ingest(makePayload());
    expect(result.success).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.deduplicated).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("writes vectors to the correct collection (rag_{projectId})", async () => {
    await pipeline.ingest(makePayload({ projectId: "my-proj" }));
    expect(deps.vectorStore.stored.has("rag_my-proj")).toBe(true);
    expect(deps.vectorStore.stored.get("rag_my-proj")!.length).toBeGreaterThan(
      0
    );
  });

  it("writes metadata rows after successful ingest", async () => {
    const payload = makePayload();
    await pipeline.ingest(payload);
    expect(deps.metadataStore.count()).toBeGreaterThan(0);
  });

  it("builds chunkId as sourceType:sourceId:chunkIndex", async () => {
    const payload = makePayload({ sourceType: "document", sourceId: "doc-42" });
    await pipeline.ingest(payload);
    const rows = deps.metadataStore.all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].chunk_id).toBe("document:doc-42:0");
  });

  // --- ingest: dedup ---

  it("returns deduplicated=true on second ingest of same content", async () => {
    const payload = makePayload({
      sourceId: "dup-src",
      content: "same content",
    });
    const r1 = await pipeline.ingest(payload);
    expect(r1.success).toBe(true);
    expect(r1.deduplicated).toBe(false);

    const r2 = await pipeline.ingest(payload);
    expect(r2.success).toBe(true);
    expect(r2.deduplicated).toBe(true);
    expect(r2.chunkCount).toBe(0);
  });

  it("does not deduplicate when content changes", async () => {
    const p1 = makePayload({ sourceId: "src-x", content: "version 1" });
    const p2 = makePayload({
      sourceId: "src-x",
      content: "version 2 different",
    });
    await pipeline.ingest(p1);
    const r2 = await pipeline.ingest(p2);
    expect(r2.deduplicated).toBe(false);
    expect(r2.chunkCount).toBeGreaterThan(0);
  });

  // --- ingest: clean failure → DLQ ---

  it("writes to DLQ when content is empty after cleaning", async () => {
    const payload = makePayload({ content: "   " });
    const result = await pipeline.ingest(payload);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(deps.deadLetterQueue.count()).toBe(1);
    const entries = deps.deadLetterQueue.list();
    expect(entries[0].stage).toBe("clean");
  });

  // --- ingest: embed failure → DLQ ---

  it("writes to DLQ when embedding fails completely", async () => {
    const failDeps = buildDeps({
      embeddingGenerator: new EmbeddingGenerator(
        new FailingEmbeddingProvider()
      ),
    });
    const failPipeline = new IngestionPipeline(failDeps);
    const result = await failPipeline.ingest(makePayload());
    expect(result.success).toBe(false);
    expect(failDeps.deadLetterQueue.count()).toBe(1);
    const entries = failDeps.deadLetterQueue.list();
    expect(entries[0].stage).toBe("embed");
  });

  // --- ingest: store failure → DLQ ---

  it("writes to DLQ when vector store upsert fails", async () => {
    const failingStore = createStubVectorStore();
    failingStore.upsert = async () => {
      throw new Error("Store down");
    };
    const storeDeps = buildDeps({ vectorStore: failingStore });
    const storePipeline = new IngestionPipeline(storeDeps);
    const result = await storePipeline.ingest(makePayload());
    expect(result.success).toBe(false);
    expect(storeDeps.deadLetterQueue.count()).toBe(1);
    const entries = storeDeps.deadLetterQueue.list();
    expect(entries[0].stage).toBe("store");
  });

  // --- ingestBatch ---

  it("processes multiple payloads and returns batch result", async () => {
    const payloads = [
      makePayload({ sourceId: "b1", content: "content one" }),
      makePayload({ sourceId: "b2", content: "content two" }),
      makePayload({ sourceId: "b3", content: "content three" }),
    ];
    const batch = await pipeline.ingestBatch(payloads);
    expect(batch.total).toBe(3);
    expect(batch.succeeded).toBe(3);
    expect(batch.failed).toBe(0);
    expect(batch.results).toHaveLength(3);
  });

  it("counts failures in batch result", async () => {
    const payloads = [
      makePayload({ sourceId: "ok", content: "valid content" }),
      makePayload({ sourceId: "bad", content: "   " }), // will fail cleaning
    ];
    const batch = await pipeline.ingestBatch(payloads);
    expect(batch.total).toBe(2);
    expect(batch.succeeded).toBe(1);
    expect(batch.failed).toBe(1);
  });

  // --- getDeadLetters ---

  it("returns empty array when no failures", async () => {
    const entries = await pipeline.getDeadLetters();
    expect(entries).toEqual([]);
  });

  // --- retryDeadLetter ---

  it("retries a DLQ entry and removes it on success", async () => {
    // First, cause a failure by using a failing store
    const failingStore = createStubVectorStore();
    let shouldFail = true;
    failingStore.upsert = async (collection, records) => {
      if (shouldFail) throw new Error("Store down");
      const existing = failingStore.stored.get(collection) ?? [];
      existing.push(...records);
      failingStore.stored.set(collection, existing);
    };
    const retryDeps = buildDeps({ vectorStore: failingStore });
    const retryPipeline = new IngestionPipeline(retryDeps);

    const payload = makePayload({ content: "retry me please" });
    await retryPipeline.ingest(payload);
    expect(retryDeps.deadLetterQueue.count()).toBe(1);

    const dlqEntries = retryDeps.deadLetterQueue.list();
    const entryId = dlqEntries[0].entryId;

    // Fix the store and retry
    shouldFail = false;
    const retryResult = await retryPipeline.retryDeadLetter(entryId);
    expect(retryResult.success).toBe(true);
    expect(retryDeps.deadLetterQueue.count()).toBe(0);
  });

  it("returns error for non-existent DLQ entry", async () => {
    const result = await pipeline.retryDeadLetter("non-existent-id");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  // --- VectorRecord metadata ---

  it("includes sourceType, agentId, timestamp in vector metadata", async () => {
    const payload = makePayload({
      sourceType: "code_snippet",
      agentId: "agent-007",
      projectId: "proj-meta",
    });
    await pipeline.ingest(payload);
    const records = deps.vectorStore.stored.get("rag_proj-meta");
    expect(records).toBeDefined();
    expect(records!.length).toBeGreaterThan(0);
    const meta = records![0].metadata;
    expect(meta.sourceType).toBe("code_snippet");
    expect(meta.agentId).toBe("agent-007");
    expect(meta.timestamp).toBe(payload.timestamp);
  });

  // --- MetadataRow fields ---

  it("populates metadata row fields correctly", async () => {
    const payload = makePayload({
      sourceType: "task_result",
      sourceId: "meta-src",
      projectId: "proj-row",
      agentId: "agent-x",
    });
    await pipeline.ingest(payload);
    const rows = deps.metadataStore.all();
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.source_type).toBe("task_result");
    expect(row.source_id).toBe("meta-src");
    expect(row.project_id).toBe("proj-row");
    expect(row.agent_id).toBe("agent-x");
    expect(row.storage_tier).toBe("hot");
    expect(row.chunk_index).toBe(0);
  });
});
