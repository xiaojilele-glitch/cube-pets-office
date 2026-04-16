/**
 * Lifecycle Management Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 21: Promoting cold chunk updates tier to hot
 * Property 22: Stale hot chunks get archived
 * Property 23: Purge with projectId filter only deletes matching records
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { VectorRecord } from "../../shared/rag/contracts.js";
import type {
  VectorStoreAdapter,
  SearchHit,
  CollectionInfo,
  HealthStatus,
} from "../rag/store/vector-store-adapter.js";
import {
  MetadataStore,
  type RagChunkMetadataRow,
} from "../rag/store/metadata-store.js";
import { HotColdManager } from "../rag/lifecycle/hot-cold-manager.js";
import { LifecycleManager } from "../rag/lifecycle/lifecycle-manager.js";
import { resetRAGConfigCache } from "../rag/config.js";

const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const META_PATH = resolve(__dn, "../../data/test_lc_meta.json");
const LOG_PATH = resolve(__dn, "../../data/test_lc_log.json");

function cleanup() {
  for (const p of [META_PATH, LOG_PATH]) if (existsSync(p)) unlinkSync(p);
}

class InMemoryVectorStore implements VectorStoreAdapter {
  private collections = new Map<string, Map<string, VectorRecord>>();
  async createCollection(name: string) {
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
    return { name, vectorCount: 0, dimension: 8, status: "ready" };
  }
  async healthCheck(): Promise<HealthStatus> {
    return { connected: true, backend: "memory", latencyMs: 0 };
  }
}

function makeRow(
  id: string,
  projectId: string,
  tier: "hot" | "cold",
  daysAgo: number
): RagChunkMetadataRow {
  const date = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000
  ).toISOString();
  return {
    chunk_id: id,
    source_type: "task_result",
    source_id: "src-1",
    project_id: projectId,
    chunk_index: 0,
    content_hash: "abc123",
    token_count: 100,
    code_language: null,
    function_signature: null,
    agent_id: null,
    ingested_at: date,
    last_accessed_at: date,
    storage_tier: tier,
    metadata_json: "{}",
  };
}

/* ---- Property 21: Promoting cold chunk updates tier to hot ---- */

describe("Property 21: Promoting cold chunk updates tier to hot", () => {
  beforeEach(() => {
    cleanup();
    resetRAGConfigCache();
  });
  afterEach(() => cleanup());

  it("promoting a cold chunk updates its tier to hot and refreshes lastAccessedAt", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^chunk-[a-z0-9]{3,6}$/),
        async chunkId => {
          const metaStore = new MetadataStore(META_PATH);
          const vectorStore = new InMemoryVectorStore();
          const manager = new HotColdManager(vectorStore, metaStore);

          metaStore.upsert(makeRow(chunkId, "proj-1", "cold", 100));
          const beforePromote = metaStore.getByChunkId(chunkId)!;
          expect(beforePromote.storage_tier).toBe("cold");
          const oldAccessTime = beforePromote.last_accessed_at;

          const count = await manager.promote([chunkId]);
          expect(count).toBe(1);

          const after = metaStore.getByChunkId(chunkId)!;
          expect(after.storage_tier).toBe("hot");
          expect(after.last_accessed_at >= oldAccessTime).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("promoting a hot chunk does nothing", async () => {
    const metaStore = new MetadataStore(META_PATH);
    const vectorStore = new InMemoryVectorStore();
    const manager = new HotColdManager(vectorStore, metaStore);

    metaStore.upsert(makeRow("chunk-hot", "proj-1", "hot", 5));
    const count = await manager.promote(["chunk-hot"]);
    expect(count).toBe(0);
  });
});

/* ---- Property 22: Stale hot chunks get archived ---- */

describe("Property 22: Stale hot chunks get archived with lifecycle logs", () => {
  beforeEach(() => {
    cleanup();
    resetRAGConfigCache();
  });
  afterEach(() => cleanup());

  it("stale hot chunks get archived and produce lifecycle logs", async () => {
    const metaStore = new MetadataStore(META_PATH);
    const vectorStore = new InMemoryVectorStore();
    const hotCold = new HotColdManager(vectorStore, metaStore);
    const lcManager = new LifecycleManager(
      vectorStore,
      metaStore,
      hotCold,
      LOG_PATH
    );

    metaStore.upsert(makeRow("stale-1", "proj-1", "hot", 200));
    metaStore.upsert(makeRow("stale-2", "proj-1", "hot", 150));
    metaStore.upsert(makeRow("fresh-1", "proj-1", "hot", 5));

    const report = await lcManager.runScheduledTasks();

    expect(report.archived).toBe(2);
    expect(metaStore.getByChunkId("stale-1")!.storage_tier).toBe("cold");
    expect(metaStore.getByChunkId("stale-2")!.storage_tier).toBe("cold");
    expect(metaStore.getByChunkId("fresh-1")!.storage_tier).toBe("hot");

    const logs = lcManager.getLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(l => l.operation === "archive")).toBe(true);
  });
});

/* ---- Property 23: Purge with projectId filter only deletes matching records ---- */

describe("Property 23: Purge with projectId filter only deletes matching records", () => {
  beforeEach(() => {
    cleanup();
    resetRAGConfigCache();
  });
  afterEach(() => cleanup());

  it("purge with projectId filter only deletes matching records", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^proj-[a-z]{2,4}$/),
        fc.stringMatching(/^proj-[a-z]{2,4}$/),
        async (targetProject, otherProject) => {
          if (targetProject === otherProject) return;

          const metaStore = new MetadataStore(META_PATH);
          const vectorStore = new InMemoryVectorStore();
          const hotCold = new HotColdManager(vectorStore, metaStore);
          const lcManager = new LifecycleManager(
            vectorStore,
            metaStore,
            hotCold,
            LOG_PATH
          );

          metaStore.upsert(makeRow("target-1", targetProject, "hot", 10));
          metaStore.upsert(makeRow("target-2", targetProject, "hot", 20));
          metaStore.upsert(makeRow("other-1", otherProject, "hot", 10));

          const result = await lcManager.purge({ projectId: targetProject });

          expect(result.deletedCount).toBe(2);
          expect(metaStore.getByChunkId("target-1")).toBeUndefined();
          expect(metaStore.getByChunkId("target-2")).toBeUndefined();
          expect(metaStore.getByChunkId("other-1")).toBeDefined();
        }
      ),
      { numRuns: 15 }
    );
  });
});
