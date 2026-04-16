/**
 * Ingestion Pipeline Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 2: IngestionPayload has all required fields
 * Property 3: Idempotent ingestion
 * Property 4: Dead Letter Queue on embedding failure
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOURCE_TYPES,
  type SourceType,
  type IngestionPayload,
} from "../../shared/rag/contracts.js";
import type { EmbeddingProvider } from "../rag/embedding/embedding-provider.js";
import { EmbeddingGenerator } from "../rag/embedding/embedding-generator.js";
import { IngestionPipeline } from "../rag/ingestion/ingestion-pipeline.js";
import { DedupChecker } from "../rag/ingestion/dedup-checker.js";
import { DataCleaner } from "../rag/ingestion/data-cleaner.js";
import { DeadLetterQueue } from "../rag/ingestion/dead-letter-queue.js";
import { ChunkRouter } from "../rag/chunking/chunk-router.js";
import { SlidingWindowChunker } from "../rag/chunking/sliding-window-chunker.js";
import { CodeChunker } from "../rag/chunking/code-chunker.js";
import { ConversationChunker } from "../rag/chunking/conversation-chunker.js";
import { DocumentChunker } from "../rag/chunking/document-chunker.js";
import { PassthroughChunker } from "../rag/chunking/passthrough-chunker.js";
import { MetadataStore } from "../rag/store/metadata-store.js";
import { resetRAGConfigCache } from "../rag/config.js";

import type {
  VectorStoreAdapter,
  SearchOptions,
  SearchHit,
  CollectionInfo,
  HealthStatus,
} from "../rag/store/vector-store-adapter.js";
import type { VectorRecord } from "../../shared/rag/contracts.js";

class InMemoryVectorStore implements VectorStoreAdapter {
  private collections = new Map<string, Map<string, VectorRecord>>();
  async createCollection(name: string, _dim: number) {
    this.collections.set(name, new Map());
  }
  async upsert(col: string, records: VectorRecord[]) {
    let c = this.collections.get(col);
    if (!c) {
      c = new Map();
      this.collections.set(col, c);
    }
    for (const r of records) c.set(r.id, r);
  }
  async search() {
    return [];
  }
  async delete(col: string, ids: string[]) {
    const c = this.collections.get(col);
    if (c) ids.forEach(id => c.delete(id));
  }
  async collectionInfo(name: string): Promise<CollectionInfo> {
    return {
      name,
      vectorCount: this.collections.get(name)?.size ?? 0,
      dimension: 8,
      status: "ready",
    };
  }
  async healthCheck(): Promise<HealthStatus> {
    return { connected: true, backend: "memory", latencyMs: 0 };
  }
  getCount(col: string): number {
    return this.collections.get(col)?.size ?? 0;
  }
}

class SuccessProvider implements EmbeddingProvider {
  readonly dimension = 8;
  readonly modelName = "test";
  async embed(texts: string[]) {
    return texts.map(() => Array.from({ length: 8 }, () => 0.5));
  }
}

class FailProvider implements EmbeddingProvider {
  readonly dimension = 8;
  readonly modelName = "fail";
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error("Embedding failed");
  }
}

/* ---- Test file paths ---- */
const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const DEDUP_PATH = resolve(__dn, "../../data/test_ingest_dedup.json");
const DLQ_PATH = resolve(__dn, "../../data/test_ingest_dlq.json");
const META_PATH = resolve(__dn, "../../data/test_ingest_meta.json");

function cleanup() {
  for (const p of [DEDUP_PATH, DLQ_PATH, META_PATH]) {
    if (existsSync(p)) unlinkSync(p);
  }
}

function buildRouter(): ChunkRouter {
  const r = new ChunkRouter();
  r.register("syntax_aware", new CodeChunker());
  r.register("conversation_turn", new ConversationChunker());
  r.register("semantic_paragraph", new DocumentChunker());
  r.register("sliding_window", new SlidingWindowChunker());
  r.register("passthrough", new PassthroughChunker());
  return r;
}

/* ---- Arbitraries ---- */
const arbSourceType = fc.constantFrom(...SOURCE_TYPES);

const arbPayload: fc.Arbitrary<IngestionPayload> = fc.record({
  sourceType: arbSourceType,
  sourceId: fc.stringMatching(/^src-[a-z0-9]{3,8}$/),
  projectId: fc.stringMatching(/^proj-[a-z0-9]{3,6}$/),
  content: fc
    .array(
      fc
        .string({ minLength: 1, maxLength: 12 })
        .filter(s => s.trim().length > 0),
      { minLength: 80, maxLength: 200 }
    )
    .map(words => words.join(" ")),
  metadata: fc.constant({}),
  timestamp: fc.constant(new Date().toISOString()),
  agentId: fc.option(fc.stringMatching(/^agent-[a-z]{2,5}$/), {
    nil: undefined,
  }),
});

/* ---- Property 2: IngestionPayload has all required fields ---- */

describe("Property 2: IngestionPayload contains all required fields with correct types", () => {
  it("for any ingested data, the IngestionPayload contains all required fields with correct types", () => {
    fc.assert(
      fc.property(arbPayload, payload => {
        expect(payload).toHaveProperty("sourceType");
        expect(payload).toHaveProperty("sourceId");
        expect(payload).toHaveProperty("projectId");
        expect(payload).toHaveProperty("content");
        expect(payload).toHaveProperty("metadata");
        expect(payload).toHaveProperty("timestamp");

        expect(typeof payload.sourceType).toBe("string");
        expect(SOURCE_TYPES).toContain(payload.sourceType);
        expect(typeof payload.sourceId).toBe("string");
        expect(payload.sourceId.length).toBeGreaterThan(0);
        expect(typeof payload.projectId).toBe("string");
        expect(payload.projectId.length).toBeGreaterThan(0);
        expect(typeof payload.content).toBe("string");
        expect(payload.content.length).toBeGreaterThan(0);
        expect(typeof payload.metadata).toBe("object");
        expect(typeof payload.timestamp).toBe("string");
      }),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 3: Idempotent ingestion ---- */

describe("Property 3: Ingesting same payload twice produces same vector count", () => {
  beforeEach(() => {
    resetRAGConfigCache();
    cleanup();
  });
  afterEach(() => cleanup());

  it("ingesting the same payload twice produces the same vector count as once", async () => {
    await fc.assert(
      fc.asyncProperty(arbPayload, async payload => {
        const vectorStore = new InMemoryVectorStore();
        const collName = `rag_${payload.projectId}`;
        await vectorStore.createCollection(collName, 8);

        const pipeline = new IngestionPipeline({
          dedupChecker: new DedupChecker(DEDUP_PATH),
          dataCleaner: new DataCleaner(),
          chunkRouter: buildRouter(),
          embeddingGenerator: new EmbeddingGenerator(new SuccessProvider()),
          vectorStore,
          metadataStore: new MetadataStore(META_PATH),
          deadLetterQueue: new DeadLetterQueue(DLQ_PATH),
        });

        const r1 = await pipeline.ingest(payload);
        expect(r1.success).toBe(true);
        const countAfterFirst = vectorStore.getCount(collName);

        const r2 = await pipeline.ingest(payload);
        expect(r2.success).toBe(true);
        expect(r2.deduplicated).toBe(true);
        const countAfterSecond = vectorStore.getCount(collName);

        expect(countAfterSecond).toBe(countAfterFirst);
      }),
      { numRuns: 15 }
    );
  });
});

/* ---- Property 4: Embedding failure sends payload to DLQ ---- */

describe("Property 4: Embedding failure sends payload to Dead Letter Queue", () => {
  beforeEach(() => {
    resetRAGConfigCache();
    cleanup();
  });
  afterEach(() => cleanup());

  it("when embedding fails, the payload appears in the DLQ with error info", async () => {
    await fc.assert(
      fc.asyncProperty(arbPayload, async payload => {
        const dlq = new DeadLetterQueue(DLQ_PATH);
        const pipeline = new IngestionPipeline({
          dedupChecker: new DedupChecker(DEDUP_PATH),
          dataCleaner: new DataCleaner(),
          chunkRouter: buildRouter(),
          embeddingGenerator: new EmbeddingGenerator(new FailProvider()),
          vectorStore: new InMemoryVectorStore(),
          metadataStore: new MetadataStore(META_PATH),
          deadLetterQueue: dlq,
        });

        const result = await pipeline.ingest(payload);
        expect(result.success).toBe(false);

        const entries = dlq.list();
        expect(entries.length).toBeGreaterThan(0);

        const lastEntry = entries[entries.length - 1];
        expect(lastEntry.error).toBeDefined();
        expect(lastEntry.error.length).toBeGreaterThan(0);
        expect(lastEntry.stage).toBe("embed");
        expect(lastEntry.payload.sourceId).toBe(payload.sourceId);
      }),
      { numRuns: 15 }
    );
  });
});
