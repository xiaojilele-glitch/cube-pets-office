import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MetadataStore } from "../rag/store/metadata-store.js";
import type { RagChunkMetadataRow } from "../rag/store/metadata-store.js";

function makeTempPath(): string {
  const dir = join(
    tmpdir(),
    "metadata-store-test-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2)
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "test-metadata.json");
}

function makeRow(
  overrides: Partial<RagChunkMetadataRow> = {}
): RagChunkMetadataRow {
  return {
    chunk_id: "task_result:src-1:0",
    source_type: "task_result",
    source_id: "src-1",
    project_id: "proj-1",
    chunk_index: 0,
    content_hash: "abc123",
    token_count: 256,
    code_language: null,
    function_signature: null,
    agent_id: null,
    ingested_at: "2025-01-01T00:00:00.000Z",
    last_accessed_at: "2025-01-01T00:00:00.000Z",
    storage_tier: "hot",
    metadata_json: "{}",
    ...overrides,
  };
}

describe("MetadataStore", () => {
  let filePath: string;
  let store: MetadataStore;

  beforeEach(() => {
    filePath = makeTempPath();
    store = new MetadataStore(filePath);
  });

  afterEach(async () => {
    await store.flush();
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  });

  // --- upsert & getByChunkId ---

  it("upserts and retrieves a row by chunk_id", async () => {
    const row = makeRow();
    store.upsert(row);
    const found = store.getByChunkId("task_result:src-1:0");
    expect(found).toEqual(row);
  });

  it("overwrites existing row on upsert with same chunk_id", async () => {
    store.upsert(makeRow({ token_count: 100 }));
    store.upsert(makeRow({ token_count: 200 }));
    expect(store.getByChunkId("task_result:src-1:0")?.token_count).toBe(200);
    expect(store.count()).toBe(1);
  });

  it("returns undefined for non-existent chunk_id", () => {
    expect(store.getByChunkId("nonexistent")).toBeUndefined();
  });

  // --- upsertBatch ---

  it("upserts multiple rows in batch", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "a:1:0", chunk_index: 0 }),
      makeRow({ chunk_id: "a:1:1", chunk_index: 1 }),
      makeRow({ chunk_id: "a:1:2", chunk_index: 2 }),
    ]);
    expect(store.count()).toBe(3);
    expect(store.getByChunkId("a:1:1")?.chunk_index).toBe(1);
  });

  // --- getBySourceId ---

  it("returns all chunks for a source_id sorted by chunk_index", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "a:src-1:2", source_id: "src-1", chunk_index: 2 }),
      makeRow({ chunk_id: "a:src-1:0", source_id: "src-1", chunk_index: 0 }),
      makeRow({ chunk_id: "a:src-1:1", source_id: "src-1", chunk_index: 1 }),
      makeRow({ chunk_id: "a:src-2:0", source_id: "src-2", chunk_index: 0 }),
    ]);
    const results = store.getBySourceId("src-1");
    expect(results).toHaveLength(3);
    expect(results.map(r => r.chunk_index)).toEqual([0, 1, 2]);
  });

  it("returns empty array for unknown source_id", () => {
    expect(store.getBySourceId("unknown")).toEqual([]);
  });

  // --- query with filters ---

  it("filters by projectId", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1", project_id: "proj-a" }),
      makeRow({ chunk_id: "c2", project_id: "proj-b" }),
    ]);
    const results = store.query({ projectId: "proj-a" });
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe("c1");
  });

  it("filters by sourceType", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1", source_type: "code_snippet" }),
      makeRow({ chunk_id: "c2", source_type: "conversation" }),
    ]);
    expect(store.query({ sourceType: "code_snippet" })).toHaveLength(1);
  });

  it("filters by agentId", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1", agent_id: "agent-x" }),
      makeRow({ chunk_id: "c2", agent_id: null }),
    ]);
    expect(store.query({ agentId: "agent-x" })).toHaveLength(1);
  });

  it("filters by storageTier", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1", storage_tier: "hot" }),
      makeRow({ chunk_id: "c2", storage_tier: "cold" }),
    ]);
    expect(store.query({ storageTier: "cold" })).toHaveLength(1);
  });

  it("filters by time range (since/until)", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1", ingested_at: "2025-01-01T00:00:00Z" }),
      makeRow({ chunk_id: "c2", ingested_at: "2025-06-01T00:00:00Z" }),
      makeRow({ chunk_id: "c3", ingested_at: "2025-12-01T00:00:00Z" }),
    ]);
    const results = store.query({
      since: "2025-03-01T00:00:00Z",
      until: "2025-09-01T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe("c2");
  });

  it("combines multiple filters (AND logic)", () => {
    store.upsertBatch([
      makeRow({
        chunk_id: "c1",
        project_id: "p1",
        source_type: "code_snippet",
        storage_tier: "hot",
      }),
      makeRow({
        chunk_id: "c2",
        project_id: "p1",
        source_type: "conversation",
        storage_tier: "hot",
      }),
      makeRow({
        chunk_id: "c3",
        project_id: "p2",
        source_type: "code_snippet",
        storage_tier: "hot",
      }),
    ]);
    const results = store.query({
      projectId: "p1",
      sourceType: "code_snippet",
    });
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe("c1");
  });

  it("returns all rows when filter is empty", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1" }),
      makeRow({ chunk_id: "c2" }),
    ]);
    expect(store.query({})).toHaveLength(2);
  });

  // --- delete ---

  it("deletes a row by chunk_id", () => {
    store.upsert(makeRow({ chunk_id: "c1" }));
    expect(store.delete("c1")).toBe(true);
    expect(store.getByChunkId("c1")).toBeUndefined();
    expect(store.count()).toBe(0);
  });

  it("returns false when deleting non-existent chunk_id", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("deletes multiple rows in batch", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1" }),
      makeRow({ chunk_id: "c2" }),
      makeRow({ chunk_id: "c3" }),
    ]);
    const deleted = store.deleteBatch(["c1", "c3", "nonexistent"]);
    expect(deleted).toBe(2);
    expect(store.count()).toBe(1);
    expect(store.getByChunkId("c2")).toBeDefined();
  });

  // --- updateAccessTime ---

  it("updates last_accessed_at timestamp", () => {
    store.upsert(
      makeRow({ chunk_id: "c1", last_accessed_at: "2025-01-01T00:00:00Z" })
    );
    const newTime = "2025-06-15T12:00:00Z";
    expect(store.updateAccessTime("c1", newTime)).toBe(true);
    expect(store.getByChunkId("c1")?.last_accessed_at).toBe(newTime);
  });

  it("returns false when updating access time for non-existent chunk", () => {
    expect(store.updateAccessTime("nonexistent")).toBe(false);
  });

  // --- updateStorageTier ---

  it("updates storage_tier", () => {
    store.upsert(makeRow({ chunk_id: "c1", storage_tier: "hot" }));
    expect(store.updateStorageTier("c1", "cold")).toBe(true);
    expect(store.getByChunkId("c1")?.storage_tier).toBe("cold");
  });

  // --- persistence ---

  it("persists data to JSON file and reloads on new instance", async () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1", token_count: 100 }),
      makeRow({ chunk_id: "c2", token_count: 200 }),
    ]);
    await store.flush();

    // Create a new store instance pointing to the same file
    const store2 = new MetadataStore(filePath);
    expect(store2.count()).toBe(2);
    expect(store2.getByChunkId("c1")?.token_count).toBe(100);
    expect(store2.getByChunkId("c2")?.token_count).toBe(200);
  });

  it("starts empty when file does not exist", () => {
    const freshStore = new MetadataStore(
      join(tmpdir(), "nonexistent-" + Date.now() + ".json")
    );
    expect(freshStore.count()).toBe(0);
  });

  it("starts empty when file contains invalid JSON", async () => {
    const { writeFileSync: wfs } = await import("node:fs");
    wfs(filePath, "not-valid-json{{{", "utf-8");
    const freshStore = new MetadataStore(filePath);
    expect(freshStore.count()).toBe(0);
  });

  // --- count & all ---

  it("count returns the number of stored rows", () => {
    expect(store.count()).toBe(0);
    store.upsert(makeRow({ chunk_id: "c1" }));
    expect(store.count()).toBe(1);
    store.upsert(makeRow({ chunk_id: "c2" }));
    expect(store.count()).toBe(2);
  });

  it("all returns all stored rows", () => {
    store.upsertBatch([
      makeRow({ chunk_id: "c1" }),
      makeRow({ chunk_id: "c2" }),
    ]);
    const all = store.all();
    expect(all).toHaveLength(2);
    expect(all.map(r => r.chunk_id).sort()).toEqual(["c1", "c2"]);
  });
});
