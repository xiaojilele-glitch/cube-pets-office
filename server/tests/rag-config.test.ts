import { describe, expect, it, afterEach } from "vitest";
import { getRAGConfig, resetRAGConfigCache } from "../rag/config.js";
import type { RAGConfig } from "../rag/config.js";

afterEach(() => {
  resetRAGConfigCache();
});

describe("getRAGConfig", () => {
  it("returns sensible defaults when no env vars are set", () => {
    const cfg = getRAGConfig({});

    expect(cfg.enabled).toBe(false);
    expect(cfg.embedding.provider).toBe("openai");
    expect(cfg.embedding.model).toBe("text-embedding-3-small");
    expect(cfg.embedding.dimension).toBe(1536);
    expect(cfg.embedding.batchSize).toBe(64);
    expect(cfg.vectorStore.backend).toBe("qdrant");
    expect(cfg.vectorStore.connectionUrl).toBe("http://localhost:6333");
    expect(cfg.retrieval.defaultTopK).toBe(10);
    expect(cfg.retrieval.defaultMinScore).toBe(0.5);
    expect(cfg.retrieval.defaultMode).toBe("hybrid");
    expect(cfg.retrieval.contextWindowChunks).toBe(1);
    expect(cfg.augmentation.mode).toBe("auto");
    expect(cfg.augmentation.tokenBudget).toBe(4096);
    expect(cfg.augmentation.reranker).toBe("noop");
    expect(cfg.lifecycle.archiveAfterDays).toBe(90);
    expect(cfg.lifecycle.deleteAfterDays).toBe(365);
    expect(cfg.lifecycle.scheduleIntervalHours).toBe(24);
    expect(cfg.quota).toEqual({});
  });

  it("reads rag.enabled from RAG_ENABLED env var", () => {
    expect(
      getRAGConfig({ RAG_ENABLED: "true" }, { noCache: true }).enabled
    ).toBe(true);
    resetRAGConfigCache();
    expect(getRAGConfig({ RAG_ENABLED: "1" }, { noCache: true }).enabled).toBe(
      true
    );
    resetRAGConfigCache();
    expect(
      getRAGConfig({ RAG_ENABLED: "false" }, { noCache: true }).enabled
    ).toBe(false);
    resetRAGConfigCache();
    expect(getRAGConfig({ RAG_ENABLED: "0" }, { noCache: true }).enabled).toBe(
      false
    );
  });

  it("reads embedding config from env vars", () => {
    const cfg = getRAGConfig({
      RAG_EMBEDDING_PROVIDER: "local",
      RAG_EMBEDDING_MODEL: "bge-small-en",
      RAG_EMBEDDING_DIMENSION: "384",
      RAG_EMBEDDING_BATCH_SIZE: "32",
      RAG_EMBEDDING_API_KEY: "sk-test",
      RAG_EMBEDDING_BASE_URL: "http://local:8080",
    });

    expect(cfg.embedding.provider).toBe("local");
    expect(cfg.embedding.model).toBe("bge-small-en");
    expect(cfg.embedding.dimension).toBe(384);
    expect(cfg.embedding.batchSize).toBe(32);
    expect(cfg.embedding.apiKey).toBe("sk-test");
    expect(cfg.embedding.baseUrl).toBe("http://local:8080");
  });

  it("falls back to OPENAI_API_KEY / OPENAI_BASE_URL for embedding", () => {
    const cfg = getRAGConfig({
      OPENAI_API_KEY: "sk-openai",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
    });

    expect(cfg.embedding.apiKey).toBe("sk-openai");
    expect(cfg.embedding.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("reads vectorStore config from env vars", () => {
    const cfg = getRAGConfig({
      RAG_VECTOR_STORE_BACKEND: "pgvector",
      RAG_VECTOR_STORE_URL: "postgresql://localhost:5432/rag",
    });

    expect(cfg.vectorStore.backend).toBe("pgvector");
    expect(cfg.vectorStore.connectionUrl).toBe(
      "postgresql://localhost:5432/rag"
    );
  });

  it("ignores invalid enum values and uses defaults", () => {
    const cfg = getRAGConfig({
      RAG_EMBEDDING_PROVIDER: "invalid_provider",
      RAG_VECTOR_STORE_BACKEND: "redis",
      RAG_RETRIEVAL_MODE: "magic",
      RAG_AUGMENTATION_MODE: "turbo",
      RAG_AUGMENTATION_RERANKER: "deep",
    });

    expect(cfg.embedding.provider).toBe("openai");
    expect(cfg.vectorStore.backend).toBe("qdrant");
    expect(cfg.retrieval.defaultMode).toBe("hybrid");
    expect(cfg.augmentation.mode).toBe("auto");
    expect(cfg.augmentation.reranker).toBe("noop");
  });

  it("provides default chunking config for all source types", () => {
    const cfg = getRAGConfig({});

    expect(cfg.chunking.task_result?.strategy).toBe("sliding_window");
    expect(cfg.chunking.task_result?.windowSize).toBe(512);
    expect(cfg.chunking.task_result?.overlap).toBe(64);
    expect(cfg.chunking.code_snippet?.strategy).toBe("syntax_aware");
    expect(cfg.chunking.conversation?.strategy).toBe("conversation_turn");
    expect(cfg.chunking.document?.strategy).toBe("semantic_paragraph");
    expect(cfg.chunking.mission_log?.strategy).toBe("sliding_window");
    expect(cfg.chunking.architecture_decision?.strategy).toBe("passthrough");
    expect(cfg.chunking.bug_report?.strategy).toBe("sliding_window");
  });

  it("supports per-sourceType chunking overrides via RAG_CHUNKING_OVERRIDES", () => {
    const overrides = {
      code_snippet: { strategy: "custom_ast", maxTokens: 2048 },
      document: { overlap: 128 },
    };
    const cfg = getRAGConfig({
      RAG_CHUNKING_OVERRIDES: JSON.stringify(overrides),
    });

    // code_snippet: fully overridden fields + defaults for non-overridden
    expect(cfg.chunking.code_snippet?.strategy).toBe("custom_ast");
    expect(cfg.chunking.code_snippet?.maxTokens).toBe(2048);
    expect(cfg.chunking.code_snippet?.minTokens).toBe(64); // default preserved

    // document: partial override merges with defaults
    expect(cfg.chunking.document?.strategy).toBe("semantic_paragraph"); // default preserved
    expect(cfg.chunking.document?.overlap).toBe(128); // overridden
  });

  it("handles invalid RAG_CHUNKING_OVERRIDES JSON gracefully", () => {
    const cfg = getRAGConfig({
      RAG_CHUNKING_OVERRIDES: "not-valid-json{{{",
    });

    // Should fall back to defaults
    expect(cfg.chunking.task_result?.strategy).toBe("sliding_window");
  });

  it("reads quota from RAG_QUOTA JSON env var", () => {
    const quota = {
      "project-a": { maxVectors: 100000, maxDailyEmbeddingTokens: 500000 },
      "project-b": { maxVectors: 50000, maxDailyEmbeddingTokens: 200000 },
    };
    const cfg = getRAGConfig({ RAG_QUOTA: JSON.stringify(quota) });

    expect(cfg.quota["project-a"]?.maxVectors).toBe(100000);
    expect(cfg.quota["project-b"]?.maxDailyEmbeddingTokens).toBe(200000);
  });

  it("caches config by default and respects noCache", () => {
    const cfg1 = getRAGConfig({ RAG_ENABLED: "true" });
    // Second call with different env should return cached
    const cfg2 = getRAGConfig({ RAG_ENABLED: "false" });
    expect(cfg1).toBe(cfg2);
    expect(cfg2.enabled).toBe(true);

    // With noCache, should re-read
    const cfg3 = getRAGConfig({ RAG_ENABLED: "false" }, { noCache: true });
    expect(cfg3.enabled).toBe(false);
  });

  it("resetRAGConfigCache clears the cache", () => {
    const cfg1 = getRAGConfig({ RAG_ENABLED: "true" });
    expect(cfg1.enabled).toBe(true);

    resetRAGConfigCache();

    const cfg2 = getRAGConfig({ RAG_ENABLED: "false" });
    expect(cfg2.enabled).toBe(false);
  });
});
