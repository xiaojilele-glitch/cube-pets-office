/**
 * Embedding Layer Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 8: Batch embedding failure degrades to single retry
 */

import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';

import type { ChunkRecord, ChunkMetadata } from '../../shared/rag/contracts.js';
import type { EmbeddingProvider } from '../rag/embedding/embedding-provider.js';
import { EmbeddingGenerator } from '../rag/embedding/embedding-generator.js';
import { resetRAGConfigCache } from '../rag/config.js';

/* ---- Mock EmbeddingProviders ---- */

class SuccessProvider implements EmbeddingProvider {
  readonly dimension = 8;
  readonly modelName = 'test-success';
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array.from({ length: 8 }, () => Math.random()));
  }
}

class BatchFailProvider implements EmbeddingProvider {
  readonly dimension = 8;
  readonly modelName = 'test-batch-fail';
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length > 1) {
      throw new Error('Batch embedding failed');
    }
    return texts.map(() => Array.from({ length: 8 }, () => 0.5));
  }
}

class PartialFailProvider implements EmbeddingProvider {
  readonly dimension = 8;
  readonly modelName = 'test-partial-fail';
  private callIndex = 0;
  constructor(private readonly failIndices: Set<number>) {}
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length > 1) {
      throw new Error('Batch embedding failed');
    }
    const idx = this.callIndex++;
    if (this.failIndices.has(idx)) {
      throw new Error(`Single embedding failed at index ${idx}`);
    }
    return texts.map(() => Array.from({ length: 8 }, () => 0.1));
  }
}

/* ---- Arbitraries ---- */

const arbChunkMetadata: fc.Arbitrary<ChunkMetadata> = fc.record({
  ingestedAt: fc.constant(new Date().toISOString()),
  lastAccessedAt: fc.constant(new Date().toISOString()),
  contentHash: fc.stringMatching(/^[0-9a-f]{16}$/),
});

function arbChunkRecords(minLen: number, maxLen: number): fc.Arbitrary<ChunkRecord[]> {
  return fc.array(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      arbChunkMetadata,
    ).map(([content, meta], idx) => ({
      chunkId: `chunk:${idx}`,
      sourceType: 'task_result' as const,
      sourceId: 'test-source',
      projectId: 'test-project',
      chunkIndex: idx,
      content,
      tokenCount: content.split(/\s+/).filter(Boolean).length || 1,
      metadata: meta,
    })),
    { minLength: minLen, maxLength: maxLen },
  );
}


/* ---- Property 8: Batch embedding failure degrades to single retry ---- */

describe('Property 8: Batch embedding failure degrades to single retry', () => {
  beforeEach(() => {
    resetRAGConfigCache();
  });

  it('when batch succeeds, all chunks get embeddings', async () => {
    await fc.assert(
      fc.asyncProperty(arbChunkRecords(1, 20), async (chunks) => {
        const gen = new EmbeddingGenerator(new SuccessProvider());
        const results = await gen.generateBatch(chunks);
        expect(results.length).toBe(chunks.length);
        for (const r of results) {
          expect(r.vector.length).toBe(8);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('when batch fails, falls back to single retry and all succeed', async () => {
    await fc.assert(
      fc.asyncProperty(arbChunkRecords(2, 20), async (chunks) => {
        const gen = new EmbeddingGenerator(new BatchFailProvider());
        const results = await gen.generateBatch(chunks);
        expect(results.length).toBe(chunks.length);
        for (const r of results) {
          expect(r.vector.length).toBe(8);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('when batch fails and some singles fail, successful count equals single successes', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbChunkRecords(3, 15),
        fc.uniqueArray(fc.integer({ min: 0, max: 14 }), { minLength: 1, maxLength: 5 }),
        async (chunks, failIndicesArr) => {
          const failIndices = new Set(failIndicesArr.filter(i => i < chunks.length));
          if (failIndices.size === 0) return;
          const expectedSuccessCount = chunks.length - failIndices.size;

          const gen = new EmbeddingGenerator(new PartialFailProvider(failIndices));
          const results = await gen.generateBatch(chunks);

          expect(results.length).toBe(expectedSuccessCount);
          for (const r of results) {
            expect(r.vector.length).toBe(8);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
