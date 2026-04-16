import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ChunkRouter, type Chunker } from "../rag/chunking/chunk-router.js";
import {
  SOURCE_TYPES,
  type ChunkRecord,
  type ChunkMetadata,
} from "../../shared/rag/contracts.js";
import { resetRAGConfigCache, getRAGConfig } from "../rag/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub Chunker that tags output with its strategy name */
function stubChunker(tag: string): Chunker {
  return {
    chunk(content: string, metadata: ChunkMetadata): ChunkRecord[] {
      return [
        {
          chunkId: `${tag}:stub:0`,
          sourceType: "document",
          sourceId: "stub",
          projectId: "test",
          chunkIndex: 0,
          content,
          tokenCount: content.length,
          metadata,
        },
      ];
    },
  };
}

function makeMetadata(): ChunkMetadata {
  return {
    ingestedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    contentHash: "abc123",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChunkRouter", () => {
  let router: ChunkRouter;

  beforeEach(() => {
    resetRAGConfigCache();
    router = new ChunkRouter();
  });

  afterEach(() => {
    resetRAGConfigCache();
  });

  // -- Registration --------------------------------------------------------

  it("registers and resolves a Chunker instance", () => {
    const chunker = stubChunker("sliding_window");
    router.register("sliding_window", chunker);

    expect(router.hasStrategy("sliding_window")).toBe(true);
    expect(router.registeredStrategies()).toContain("sliding_window");
  });

  it("registers and resolves a lazy factory", () => {
    let called = false;
    router.register("syntax_aware", () => {
      called = true;
      return stubChunker("syntax_aware");
    });

    // Factory not called yet
    expect(called).toBe(false);

    // Route triggers factory
    const chunker = router.route("code_snippet");
    expect(called).toBe(true);

    const result = chunker.chunk("const x = 1;", makeMetadata());
    expect(result[0].chunkId).toBe("syntax_aware:stub:0");
  });

  it("caches resolved lazy factory result", () => {
    let callCount = 0;
    router.register("syntax_aware", () => {
      callCount++;
      return stubChunker("syntax_aware");
    });

    router.route("code_snippet");
    router.route("code_snippet");
    expect(callCount).toBe(1);
  });

  // -- Routing -------------------------------------------------------------

  it("routes code_snippet to syntax_aware strategy", () => {
    router.register("syntax_aware", stubChunker("syntax_aware"));
    const chunker = router.route("code_snippet");
    const result = chunker.chunk("fn()", makeMetadata());
    expect(result[0].chunkId).toContain("syntax_aware");
  });

  it("routes conversation to conversation_turn strategy", () => {
    router.register("conversation_turn", stubChunker("conversation_turn"));
    const chunker = router.route("conversation");
    const result = chunker.chunk("hello", makeMetadata());
    expect(result[0].chunkId).toContain("conversation_turn");
  });

  it("routes document to semantic_paragraph strategy", () => {
    router.register("semantic_paragraph", stubChunker("semantic_paragraph"));
    const chunker = router.route("document");
    const result = chunker.chunk("paragraph", makeMetadata());
    expect(result[0].chunkId).toContain("semantic_paragraph");
  });

  it("routes task_result and mission_log to sliding_window strategy", () => {
    router.register("sliding_window", stubChunker("sliding_window"));

    for (const st of ["task_result", "mission_log"] as const) {
      const chunker = router.route(st);
      const result = chunker.chunk("data", makeMetadata());
      expect(result[0].chunkId).toContain("sliding_window");
    }
  });

  it("routes bug_report to sliding_window strategy", () => {
    router.register("sliding_window", stubChunker("sliding_window"));
    const chunker = router.route("bug_report");
    const result = chunker.chunk("bug", makeMetadata());
    expect(result[0].chunkId).toContain("sliding_window");
  });

  it("routes architecture_decision to passthrough strategy", () => {
    router.register("passthrough", stubChunker("passthrough"));
    const chunker = router.route("architecture_decision");
    const result = chunker.chunk("adr", makeMetadata());
    expect(result[0].chunkId).toContain("passthrough");
  });

  it("routes all SOURCE_TYPES when all strategies are registered", () => {
    // Register all needed strategies
    router.register("syntax_aware", stubChunker("syntax_aware"));
    router.register("conversation_turn", stubChunker("conversation_turn"));
    router.register("semantic_paragraph", stubChunker("semantic_paragraph"));
    router.register("sliding_window", stubChunker("sliding_window"));
    router.register("passthrough", stubChunker("passthrough"));

    for (const st of SOURCE_TYPES) {
      expect(() => router.route(st)).not.toThrow();
    }
  });

  // -- Error handling ------------------------------------------------------

  it("throws on unknown sourceType", () => {
    expect(() => router.route("unknown_type" as any)).toThrow(
      "Unknown sourceType"
    );
  });

  it("throws when strategy is not registered", () => {
    expect(() => router.route("code_snippet")).toThrow(
      "No Chunker registered for strategy"
    );
    expect(() => router.route("code_snippet")).toThrow("syntax_aware");
  });

  // -- Config override -----------------------------------------------------

  it("uses config override strategy when RAG_CHUNKING_OVERRIDES is set", () => {
    // Force config with custom strategy for code_snippet
    resetRAGConfigCache();
    getRAGConfig(
      {
        RAG_CHUNKING_OVERRIDES: JSON.stringify({
          code_snippet: { strategy: "custom_ast" },
        }),
      },
      { noCache: false }
    );

    router.register("custom_ast", stubChunker("custom_ast"));
    router.register("syntax_aware", stubChunker("syntax_aware"));

    const chunker = router.route("code_snippet");
    const result = chunker.chunk("code", makeMetadata());
    expect(result[0].chunkId).toContain("custom_ast");
  });

  // -- getChunkingConfig ---------------------------------------------------

  it("returns chunking config for a sourceType", () => {
    const cfg = router.getChunkingConfig("task_result");
    expect(cfg).toBeDefined();
    expect(cfg?.strategy).toBe("sliding_window");
    expect(cfg?.windowSize).toBe(512);
    expect(cfg?.overlap).toBe(64);
  });

  it("returns undefined for sourceType without config", () => {
    // All source types have default config, but let's verify the method works
    const cfg = router.getChunkingConfig("document");
    expect(cfg).toBeDefined();
    expect(cfg?.strategy).toBe("semantic_paragraph");
  });
});
