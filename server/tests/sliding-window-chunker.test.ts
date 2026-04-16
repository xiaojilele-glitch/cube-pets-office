import { describe, expect, it } from "vitest";
import {
  SlidingWindowChunker,
  estimateTokenCount,
} from "../rag/chunking/sliding-window-chunker.js";
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

// ---------------------------------------------------------------------------
// estimateTokenCount
// ---------------------------------------------------------------------------

describe("estimateTokenCount", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(estimateTokenCount("   \n\t  ")).toBe(0);
  });

  it("counts whitespace-separated tokens", () => {
    expect(estimateTokenCount("hello world foo")).toBe(3);
  });

  it("handles multiple spaces and newlines", () => {
    expect(estimateTokenCount("a  b\n\nc   d")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// SlidingWindowChunker — basic behavior
// ---------------------------------------------------------------------------

describe("SlidingWindowChunker", () => {
  const meta = makeMetadata();

  it("returns empty array for empty content", () => {
    const chunker = new SlidingWindowChunker();
    expect(chunker.chunk("", meta)).toEqual([]);
    expect(chunker.chunk("   ", meta)).toEqual([]);
  });

  it("returns single chunk when content fits within maxTokens", () => {
    const chunker = new SlidingWindowChunker({ maxTokens: 100, minTokens: 1 });
    const content = makeTokens(50);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(1);
    expect(result[0].tokenCount).toBe(50);
    expect(result[0].chunkIndex).toBe(0);
  });

  it("returns single chunk for content under minTokens", () => {
    const chunker = new SlidingWindowChunker({ minTokens: 64 });
    const content = makeTokens(10);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(1);
    expect(result[0].tokenCount).toBe(10);
  });

  // -----------------------------------------------------------------------
  // Sliding window mechanics
  // -----------------------------------------------------------------------

  it("slides with correct window and overlap", () => {
    // 100 tokens, window=40, overlap=10 → step=30
    // chunks at: [0,40), [30,70), [60,100) → 3 chunks
    const chunker = new SlidingWindowChunker({
      windowSize: 40,
      overlap: 10,
      minTokens: 1,
      maxTokens: 1024,
    });
    const content = makeTokens(100);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(3);
    expect(result[0].tokenCount).toBe(40);
    expect(result[1].tokenCount).toBe(40);
    expect(result[2].tokenCount).toBe(40);
  });

  // -----------------------------------------------------------------------
  // Merge small tail chunks
  // -----------------------------------------------------------------------

  it("merges small tail chunk into previous", () => {
    // 50 tokens, window=40, overlap=0 → step=40
    // raw: [0,40)=40 tokens, [40,50)=10 tokens
    // 10 < minTokens=20 → merge into prev → single chunk of 50
    const chunker = new SlidingWindowChunker({
      windowSize: 40,
      overlap: 0,
      minTokens: 20,
      maxTokens: 1024,
    });
    const content = makeTokens(50);
    const result = chunker.chunk(content, meta);

    expect(result).toHaveLength(1);
    expect(result[0].tokenCount).toBe(50);
  });

  // -----------------------------------------------------------------------
  // Split large chunks
  // -----------------------------------------------------------------------

  it("splits chunks that exceed maxTokens after merge", () => {
    // Create a scenario where merge produces a chunk > maxTokens
    // 130 tokens, window=100, overlap=0, minTokens=50, maxTokens=100
    // raw: [0,100)=100, [100,130)=30 → 30 < 50 → merge → 130 tokens
    // 130 > maxTokens=100 → split → [0,100)=100, [100,130)=30
    // 30 < minTokens=50 but can merge back if prev <= maxTokens
    // prev=100, 100+30=130 > 100 → can't merge → keep as is
    const chunker = new SlidingWindowChunker({
      windowSize: 100,
      overlap: 0,
      minTokens: 50,
      maxTokens: 100,
    });
    const content = makeTokens(130);
    const result = chunker.chunk(content, meta);

    // After split: 100 + 30 (30 can't merge back since 100+30>100)
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  // -----------------------------------------------------------------------
  // Token range invariant [minTokens, maxTokens]
  // -----------------------------------------------------------------------

  it("ensures all chunks are within [minTokens, maxTokens] for large input", () => {
    const chunker = new SlidingWindowChunker({
      windowSize: 512,
      overlap: 64,
      minTokens: 64,
      maxTokens: 1024,
    });
    // 2000 tokens — well above the window size
    const content = makeTokens(2000);
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
    const chunker = new SlidingWindowChunker({
      windowSize: 10,
      overlap: 2,
      minTokens: 1,
      maxTokens: 100,
    });
    const content = makeTokens(25);
    const result = chunker.chunk(content, meta);

    for (let i = 0; i < result.length; i++) {
      const chunk = result[i];
      expect(chunk.chunkId).toBe(`chunk:${i}`);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.content).toBeTruthy();
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.metadata).toBe(meta);
    }
  });

  // -----------------------------------------------------------------------
  // fromConfig factory
  // -----------------------------------------------------------------------

  it("creates instance from ChunkingConfig via fromConfig", () => {
    const chunker = SlidingWindowChunker.fromConfig({
      strategy: "sliding_window",
      maxTokens: 200,
      minTokens: 10,
      windowSize: 100,
      overlap: 20,
    });
    const content = makeTokens(250);
    const result = chunker.chunk(content, meta);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it("fromConfig uses defaults when config is undefined", () => {
    const chunker = SlidingWindowChunker.fromConfig(undefined);
    const content = makeTokens(1000);
    const result = chunker.chunk(content, meta);

    // Default windowSize=512, overlap=64 → step=448
    // 1000 tokens → ceil((1000-512)/448)+1 ≈ 3 chunks
    expect(result.length).toBeGreaterThan(1);
  });

  // -----------------------------------------------------------------------
  // Default parameters (512 window, 64 overlap)
  // -----------------------------------------------------------------------

  it("uses default windowSize=512 and overlap=64", () => {
    const chunker = new SlidingWindowChunker();
    const content = makeTokens(1024);
    const result = chunker.chunk(content, meta);

    // step = 512 - 64 = 448
    // chunks: [0,512), [448,960), [896,1024) → 3 raw chunks
    // last chunk = 128 tokens >= 64 → no merge needed
    expect(result).toHaveLength(3);
  });
});
