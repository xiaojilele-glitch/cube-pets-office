import { describe, expect, it } from "vitest";
import { DocumentChunker } from "../rag/chunking/document-chunker.js";
import type { ChunkMetadata } from "../../shared/rag/contracts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(): ChunkMetadata {
  return {
    ingestedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    contentHash: "test-hash",
  };
}

/** Generate a string with exactly `n` whitespace-separated tokens */
function makeTokens(n: number, prefix = "w"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

/** Build a document with paragraphs of given token counts separated by \n\n */
function makeParagraphs(tokenCounts: number[]): string {
  return tokenCounts.map((n, i) => makeTokens(n, `p${i}_`)).join("\n\n");
}

// ---------------------------------------------------------------------------
// DocumentChunker — basic behavior
// ---------------------------------------------------------------------------

describe("DocumentChunker", () => {
  const meta = makeMetadata();

  it("returns empty array for empty content", () => {
    const chunker = new DocumentChunker();
    expect(chunker.chunk("", meta)).toEqual([]);
    expect(chunker.chunk("   ", meta)).toEqual([]);
    expect(chunker.chunk("\n\n\n", meta)).toEqual([]);
  });

  it("returns single chunk for a single paragraph within range", () => {
    const chunker = new DocumentChunker({ minTokens: 1, maxTokens: 1024 });
    const content = makeTokens(100);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(1);
    expect(result[0].tokenCount).toBe(100);
    expect(result[0].chunkIndex).toBe(0);
    expect(result[0].sourceType).toBe("document");
  });

  // -----------------------------------------------------------------------
  // Double newline splitting
  // -----------------------------------------------------------------------

  it("splits content by double newlines into separate chunks", () => {
    const chunker = new DocumentChunker({ minTokens: 1, maxTokens: 1024 });
    const content = makeParagraphs([80, 90, 70]);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(3);
    expect(result[0].tokenCount).toBe(80);
    expect(result[1].tokenCount).toBe(90);
    expect(result[2].tokenCount).toBe(70);
  });

  it("handles multiple blank lines between paragraphs", () => {
    const chunker = new DocumentChunker({ minTokens: 1, maxTokens: 1024 });
    const p1 = makeTokens(80, "a_");
    const p2 = makeTokens(90, "b_");
    const content = p1 + "\n\n\n\n" + p2;
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Merge small paragraphs
  // -----------------------------------------------------------------------

  it("merges small paragraphs with previous paragraph", () => {
    // Three paragraphs: 80, 20, 80 tokens. minTokens=64
    // 20 < 64 → merge with prev (80+20=100 <= 1024) → [100, 80]
    const chunker = new DocumentChunker({ minTokens: 64, maxTokens: 1024 });
    const content = makeParagraphs([80, 20, 80]);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(2);
    expect(result[0].tokenCount).toBeGreaterThanOrEqual(64);
    expect(result[1].tokenCount).toBeGreaterThanOrEqual(64);
  });

  it("merges first small paragraph forward when no previous exists", () => {
    // Two paragraphs: 10, 80 tokens. minTokens=64
    // 10 < 64, no prev → stays. Then forward merge: 10+80=90 <= 1024 → merge → [90]
    const chunker = new DocumentChunker({ minTokens: 64, maxTokens: 1024 });
    const content = makeParagraphs([10, 80]);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(1);
    expect(result[0].tokenCount).toBe(90);
  });

  it("does not merge if combined would exceed maxTokens", () => {
    // Two paragraphs: 900, 30 tokens. minTokens=64, maxTokens=100
    // After split of 900: multiple chunks of <=100
    // 30 < 64 but prev is at maxTokens boundary → can't merge
    const chunker = new DocumentChunker({ minTokens: 64, maxTokens: 100 });
    const content = makeParagraphs([100, 30]);
    const result = chunker.chunk(content, meta);

    // 100 fits, 30 < 64 → try merge: 100+30=130 > 100 → can't merge
    // 30 stays as separate chunk (below minTokens but can't merge)
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // Split large paragraphs
  // -----------------------------------------------------------------------

  it("splits paragraphs exceeding maxTokens", () => {
    const chunker = new DocumentChunker({ minTokens: 1, maxTokens: 100 });
    const content = makeTokens(250);
    const result = chunker.chunk(content, meta);

    // 250 / 100 = 3 chunks (100, 100, 50)
    expect(result).toHaveLength(3);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  // -----------------------------------------------------------------------
  // Token range invariant [minTokens, maxTokens]
  // -----------------------------------------------------------------------

  it("ensures all chunks are within [minTokens, maxTokens] for large input", () => {
    const chunker = new DocumentChunker({ minTokens: 64, maxTokens: 1024 });
    // 5 paragraphs of 400 tokens each
    const content = makeParagraphs([400, 400, 400, 400, 400]);
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(64);
      expect(chunk.tokenCount).toBeLessThanOrEqual(1024);
    }
  });

  // -----------------------------------------------------------------------
  // ChunkRecord structure
  // -----------------------------------------------------------------------

  it("produces valid ChunkRecord fields", () => {
    const chunker = new DocumentChunker({ minTokens: 1, maxTokens: 1024 });
    const content = makeParagraphs([80, 90]);
    const result = chunker.chunk(content, meta);

    for (let i = 0; i < result.length; i++) {
      const chunk = result[i];
      expect(chunk.chunkId).toBe(`chunk:${i}`);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.sourceType).toBe("document");
      expect(chunk.content).toBeTruthy();
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.metadata).toBe(meta);
    }
  });

  // -----------------------------------------------------------------------
  // fromConfig factory
  // -----------------------------------------------------------------------

  it("creates instance from ChunkingConfig via fromConfig", () => {
    const chunker = DocumentChunker.fromConfig({
      strategy: "semantic_paragraph",
      maxTokens: 200,
      minTokens: 10,
    });
    const content = makeParagraphs([150, 150, 150]);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(3);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it("fromConfig uses defaults when config is undefined", () => {
    const chunker = DocumentChunker.fromConfig(undefined);
    const content = makeParagraphs([200, 200, 200]);
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Preserves paragraph separation in merged content
  // -----------------------------------------------------------------------

  it("uses double newline separator when merging paragraphs", () => {
    const chunker = new DocumentChunker({ minTokens: 64, maxTokens: 1024 });
    // Two small paragraphs that will be merged
    const p1 = makeTokens(30, "a_");
    const p2 = makeTokens(30, "b_");
    const content = p1 + "\n\n" + p2;
    const result = chunker.chunk(content, meta);

    // Both < 64, first has no prev so stays, then forward merge
    expect(result).toHaveLength(1);
    // Merged content should contain \n\n separator
    expect(result[0].content).toContain("\n\n");
  });
});
