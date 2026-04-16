/**
 * 摄入管道单元测试
 *
 * Feature: vector-db-rag-pipeline
 * Requirements: 1.3, 1.5, 1.6
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  IngestionPayload,
  VectorRecord,
} from "../../shared/rag/contracts.js";
import type { EmbeddingProvider } from "../rag/embedding/embedding-provider.js";
import { EmbeddingGenerator } from "../rag/embedding/embedding-generator.js";
import { IngestionPipeline } from "../rag/ingestion/ingestion-pipeline.js";
import { DedupChecker, buildDedupKey } from "../rag/ingestion/dedup-checker.js";
import { DataCleaner } from "../rag/ingestion/data-cleaner.js";
import { DeadLetterQueue } from "../rag/ingestion/dead-letter-queue.js";
import {
  RAGEventListener,
  RAG_EVENT_TYPES,
} from "../rag/ingestion/event-listener.js";
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
  SearchHit,
  CollectionInfo,
  HealthStatus,
} from "../rag/store/vector-store-adapter.js";

/* ─── Mocks ─── */

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
  async delete() {}
  async collectionInfo(name: string): Promise<CollectionInfo> {
    return { name, vectorCount: 0, dimension: 8, status: "ready" };
  }
  async healthCheck(): Promise<HealthStatus> {
    return { connected: true, backend: "memory", latencyMs: 0 };
  }
}

class SuccessProvider implements EmbeddingProvider {
  readonly dimension = 8;
  readonly modelName = "test";
  async embed(texts: string[]) {
    return texts.map(() => Array.from({ length: 8 }, () => 0.5));
  }
}

/* ─── Paths ─── */
const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const DEDUP_PATH = resolve(__dn, "../../data/test_unit_dedup.json");
const DLQ_PATH = resolve(__dn, "../../data/test_unit_dlq.json");
const META_PATH = resolve(__dn, "../../data/test_unit_meta.json");

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

function makeContent(n: number) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

function makePayload(overrides?: Partial<IngestionPayload>): IngestionPayload {
  return {
    sourceType: "task_result",
    sourceId: "src-001",
    projectId: "proj-test",
    content: makeContent(100),
    metadata: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * EventListener 事件转换测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("RAGEventListener", () => {
  it("converts task.completed to task_result IngestionPayload", () => {
    const event = RAGEventListener.toRAGEvent({
      type: "task.completed",
      payload: {
        id: "task-1",
        projectId: "proj-1",
        content: "Task done",
        agentId: "agent-a",
      },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("task.completed");
    expect(event!.id).toBe("task-1");
    expect(event!.projectId).toBe("proj-1");
  });

  it("converts mission.finished to mission_log", () => {
    const event = RAGEventListener.toRAGEvent({
      type: "mission.finished",
      payload: {
        id: "mission-1",
        projectId: "proj-1",
        content: "Mission complete",
      },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("mission.finished");
  });

  it("converts code.committed to code_snippet", () => {
    const event = RAGEventListener.toRAGEvent({
      type: "code.committed",
      payload: {
        id: "commit-1",
        projectId: "proj-1",
        content: "function foo() {}",
      },
    });
    expect(event).not.toBeNull();
  });

  it("converts document.uploaded to document", () => {
    const event = RAGEventListener.toRAGEvent({
      type: "document.uploaded",
      payload: {
        id: "doc-1",
        projectId: "proj-1",
        content: "Document content",
      },
    });
    expect(event).not.toBeNull();
  });

  it("returns null for unsupported event types", () => {
    const event = RAGEventListener.toRAGEvent({
      type: "unknown.event",
      payload: {},
    });
    expect(event).toBeNull();
  });

  it("handles missing payload fields gracefully", () => {
    const event = RAGEventListener.toRAGEvent({ type: "task.completed" });
    expect(event).not.toBeNull();
    expect(event!.id).toBe("");
    expect(event!.projectId).toBe("");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * DedupChecker 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("DedupChecker", () => {
  beforeEach(() => {
    cleanup();
  });
  afterEach(() => {
    cleanup();
  });

  it("returns false for first check, true for second", () => {
    const checker = new DedupChecker(DEDUP_PATH);
    expect(checker.isDuplicate("task_result", "src-1", "hash1")).toBe(false);
    checker.markIngested("task_result", "src-1", "hash1");
    expect(checker.isDuplicate("task_result", "src-1", "hash1")).toBe(true);
  });

  it("different content hash is not duplicate", () => {
    const checker = new DedupChecker(DEDUP_PATH);
    checker.markIngested("task_result", "src-1", "hash1");
    expect(checker.isDuplicate("task_result", "src-1", "hash2")).toBe(false);
  });

  it("buildDedupKey produces expected format", () => {
    expect(buildDedupKey("task_result", "src-1", "abc")).toBe(
      "task_result:src-1:abc"
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * DeadLetterQueue 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("DeadLetterQueue", () => {
  beforeEach(() => {
    cleanup();
  });
  afterEach(() => {
    cleanup();
  });

  it("push adds entry and list returns it", () => {
    const dlq = new DeadLetterQueue(DLQ_PATH);
    const payload = makePayload();
    dlq.push(payload, "test error", "embed");
    const entries = dlq.list();
    expect(entries.length).toBe(1);
    expect(entries[0].error).toBe("test error");
    expect(entries[0].stage).toBe("embed");
  });

  it("markRetry increments retryCount", () => {
    const dlq = new DeadLetterQueue(DLQ_PATH);
    const entry = dlq.push(makePayload(), "err", "chunk");
    expect(entry.retryCount).toBe(0);
    dlq.markRetry(entry.entryId);
    const updated = dlq.get(entry.entryId);
    expect(updated!.retryCount).toBe(1);
  });

  it("remove deletes entry", () => {
    const dlq = new DeadLetterQueue(DLQ_PATH);
    const entry = dlq.push(makePayload(), "err", "store");
    expect(dlq.count()).toBe(1);
    dlq.remove(entry.entryId);
    expect(dlq.count()).toBe(0);
  });

  it("list supports limit and offset", () => {
    const dlq = new DeadLetterQueue(DLQ_PATH);
    for (let i = 0; i < 5; i++) {
      dlq.push(makePayload({ sourceId: `src-${i}` }), `err-${i}`, "embed");
    }
    expect(dlq.list({ limit: 2 }).length).toBe(2);
    expect(dlq.list({ offset: 3 }).length).toBe(2);
    expect(dlq.list({ limit: 2, offset: 3 }).length).toBe(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * DataCleaner 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("DataCleaner", () => {
  const cleaner = new DataCleaner();

  it("throws on empty content", () => {
    expect(() => cleaner.clean(makePayload({ content: "" }))).toThrow();
    expect(() => cleaner.clean(makePayload({ content: "   " }))).toThrow();
  });

  it("normalizes line endings", () => {
    const result = cleaner.clean(
      makePayload({ content: "hello\r\nworld\rfoo" })
    );
    expect(result.content).toBe("hello\nworld\nfoo");
  });

  it("generates contentHash", () => {
    const result = cleaner.clean(makePayload({ content: "test content" }));
    expect(result.contentHash).toBeDefined();
    expect(typeof result.contentHash).toBe("string");
    expect(result.contentHash.length).toBe(16);
  });
});
