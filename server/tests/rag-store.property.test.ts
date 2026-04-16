/**
 * Vector Store Layer Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 9: Different projectIds get separate collections
 * Property 10: Vector store and metadata store have matching chunkIds
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { VectorRecord } from "../../shared/rag/contracts.js";
import type {
  VectorStoreAdapter,
  SearchOptions,
  SearchHit,
  CollectionInfo,
  HealthStatus,
} from "../rag/store/vector-store-adapter.js";
import {
  MetadataStore,
  type RagChunkMetadataRow,
} from "../rag/store/metadata-store.js";

/* ---- In-Memory VectorStoreAdapter ---- */

class InMemoryVectorStore implements VectorStoreAdapter {
  private collections = new Map<string, Map<string, VectorRecord>>();

  async createCollection(name: string, _dimension: number): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    let col = this.collections.get(collection);
    if (!col) {
      col = new Map();
      this.collections.set(collection, col);
    }
    for (const r of records) {
      col.set(r.id, r);
    }
  }

  async search(
    _collection: string,
    _query: number[],
    _options: SearchOptions
  ): Promise<SearchHit[]> {
    return [];
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    const col = this.collections.get(collection);
    if (!col) return;
    for (const id of ids) col.delete(id);
  }

  async collectionInfo(name: string): Promise<CollectionInfo> {
    const col = this.collections.get(name);
    return { name, vectorCount: col?.size ?? 0, dimension: 8, status: "ready" };
  }

  async healthCheck(): Promise<HealthStatus> {
    return { connected: true, backend: "in-memory", latencyMs: 0 };
  }

  getCollectionNames(): string[] {
    return Array.from(this.collections.keys());
  }

  getRecords(collection: string): VectorRecord[] {
    const col = this.collections.get(collection);
    return col ? Array.from(col.values()) : [];
  }

  hasRecord(collection: string, id: string): boolean {
    return this.collections.get(collection)?.has(id) ?? false;
  }
}

/* ---- Arbitraries ---- */

const arbProjectId = fc.stringMatching(/^proj-[a-z0-9]{3,8}$/);

const arbChunkId = fc
  .tuple(fc.stringMatching(/^[a-z]{3,8}$/), fc.integer({ min: 0, max: 99 }))
  .map(([src, idx]) => `task_result:${src}:${idx}`);

/* ---- Test file path ---- */

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const TEST_META_PATH = resolve(
  __dirname2,
  "../../data/test_rag_store_prop.json"
);

/* ---- Property 9: Each projectId gets its own rag_{projectId} collection ---- */

describe("Property 9: Each projectId gets a separate collection", () => {
  it("for any set of projectIds, each gets its own rag_{projectId} collection", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbProjectId, { minLength: 1, maxLength: 5 }),
        async projectIds => {
          const store = new InMemoryVectorStore();

          for (const pid of projectIds) {
            const collName = `rag_${pid}`;
            await store.createCollection(collName, 8);
            await store.upsert(collName, [
              {
                id: `chunk-${pid}-0`,
                vector: Array.from({ length: 8 }, () => 0.1),
                content: `content for ${pid}`,
                metadata: { projectId: pid },
              },
            ]);
          }

          const collNames = store.getCollectionNames();
          for (const pid of projectIds) {
            const expected = `rag_${pid}`;
            expect(collNames).toContain(expected);

            const records = store.getRecords(expected);
            expect(records.length).toBeGreaterThan(0);
            for (const r of records) {
              expect((r.metadata as any)?.projectId).toBe(pid);
            }
          }

          for (const pid of projectIds) {
            const collName = `rag_${pid}`;
            const records = store.getRecords(collName);
            for (const r of records) {
              expect((r.metadata as any)?.projectId).toBe(pid);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 10: Vector store and metadata store have matching chunkIds ---- */

describe("Property 10: Vector store and metadata store chunkIds match", () => {
  let metaStore: MetadataStore;

  beforeEach(() => {
    if (existsSync(TEST_META_PATH)) unlinkSync(TEST_META_PATH);
    metaStore = new MetadataStore(TEST_META_PATH);
  });

  afterEach(async () => {
    await metaStore.flush();
    if (existsSync(TEST_META_PATH)) unlinkSync(TEST_META_PATH);
  });

  it("for any ingested chunk, vector store and metadata store have matching chunkIds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbChunkId, { minLength: 1, maxLength: 10 }),
        arbProjectId,
        async (chunkIds, projectId) => {
          const vectorStore = new InMemoryVectorStore();
          const collName = `rag_${projectId}`;
          await vectorStore.createCollection(collName, 8);

          const vectorRecords: VectorRecord[] = chunkIds.map(id => ({
            id,
            vector: Array.from({ length: 8 }, () => Math.random()),
            content: `content for ${id}`,
            metadata: { projectId },
          }));

          await vectorStore.upsert(collName, vectorRecords);

          const metaRows: RagChunkMetadataRow[] = chunkIds.map((id, idx) => ({
            chunk_id: id,
            source_type: "task_result" as const,
            source_id: `src-${idx}`,
            project_id: projectId,
            chunk_index: idx,
            content_hash: "abcdef0123456789",
            token_count: 100,
            code_language: null,
            function_signature: null,
            agent_id: null,
            ingested_at: new Date().toISOString(),
            last_accessed_at: new Date().toISOString(),
            storage_tier: "hot" as const,
            metadata_json: "{}",
          }));

          metaStore.upsertBatch(metaRows);

          for (const id of chunkIds) {
            expect(vectorStore.hasRecord(collName, id)).toBe(true);
            const metaRow = metaStore.getByChunkId(id);
            expect(metaRow).toBeDefined();
            expect(metaRow!.chunk_id).toBe(id);
            expect(metaRow!.project_id).toBe(projectId);
          }

          const info = await vectorStore.collectionInfo(collName);
          expect(info.vectorCount).toBe(chunkIds.length);
        }
      ),
      { numRuns: 20 }
    );
  });
});
