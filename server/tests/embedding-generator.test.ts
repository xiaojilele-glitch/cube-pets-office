import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingGenerator, type EmbeddedChunk } from '../rag/embedding/embedding-generator.js';
import type { EmbeddingProvider } from '../rag/embedding/embedding-provider.js';
import type { ChunkRecord } from '../../shared/rag/contracts.js';
import { resetRAGConfigCache } from '../rag/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(index: number, content = `chunk-${index}`): ChunkRecord {
  return {
    chunkId: `test:src:${index}`,
    sourceType: 'document',
    sourceId: 'src',
    projectId: 'proj',
    chunkIndex: index,
    content,
    tokenCount: content.length,
    metadata: {
      ingestedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      contentHash: 'hash',
    },
  };
}

function makeFakeProvider(overrides?: Partial<EmbeddingProvider>): EmbeddingProvider {
  return {
    dimension: 3,
    modelName: 'fake-model',
    embed: vi.fn(async (texts: string[]) =>
      texts.map((_, i) => [i * 0.1, i * 0.2, i * 0.3]),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingGenerator', () => {
  beforeEach(() => {
    // Set a small batchSize for testing
    vi.stubEnv('RAG_EMBEDDING_BATCH_SIZE', '3');
    resetRAGConfigCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRAGConfigCache();
    vi.restoreAllMocks();
  });

  // ---- generateSingle ----

  describe('generateSingle', () => {
    it('returns a vector for a single text', async () => {
      const provider = makeFakeProvider();
      const gen = new EmbeddingGenerator(provider);

      const vector = await gen.generateSingle('hello');

      expect(vector).toEqual([0, 0, 0]);
      expect(provider.embed).toHaveBeenCalledWith(['hello']);
    });

    it('propagates provider errors', async () => {
      const provider = makeFakeProvider({
        embed: vi.fn().mockRejectedValue(new Error('API down')),
      });
      const gen = new EmbeddingGenerator(provider);

      await expect(gen.generateSingle('fail')).rejects.toThrow('API down');
    });
  });

  // ---- generateBatch ----

  describe('generateBatch', () => {
    it('returns empty array for empty input', async () => {
      const provider = makeFakeProvider();
      const gen = new EmbeddingGenerator(provider);

      const result = await gen.generateBatch([]);

      expect(result).toEqual([]);
      expect(provider.embed).not.toHaveBeenCalled();
    });

    it('processes chunks in batches of configured batchSize', async () => {
      const provider = makeFakeProvider();
      const gen = new EmbeddingGenerator(provider);
      // batchSize=3, 5 chunks → 2 batches (3 + 2)
      const chunks = Array.from({ length: 5 }, (_, i) => makeChunk(i));

      const result = await gen.generateBatch(chunks);

      expect(result).toHaveLength(5);
      expect(provider.embed).toHaveBeenCalledTimes(2);
      // First batch: 3 texts
      expect((provider.embed as any).mock.calls[0][0]).toHaveLength(3);
      // Second batch: 2 texts
      expect((provider.embed as any).mock.calls[1][0]).toHaveLength(2);
    });

    it('pairs each chunk with its vector correctly', async () => {
      const provider = makeFakeProvider({
        embed: vi.fn(async (texts: string[]) =>
          texts.map((t) => [t.length, t.length * 2]),
        ),
      });
      const gen = new EmbeddingGenerator(provider);
      const chunks = [makeChunk(0, 'ab'), makeChunk(1, 'cde')];

      const result = await gen.generateBatch(chunks);

      expect(result[0].chunk.content).toBe('ab');
      expect(result[0].vector).toEqual([2, 4]);
      expect(result[1].chunk.content).toBe('cde');
      expect(result[1].vector).toEqual([3, 6]);
    });

    it('degrades to single-item retry when a batch fails', async () => {
      let callCount = 0;
      const provider = makeFakeProvider({
        embed: vi.fn(async (texts: string[]) => {
          callCount++;
          // First call (batch of 3) fails; subsequent single calls succeed
          if (callCount === 1) throw new Error('batch fail');
          return texts.map(() => [1, 2, 3]);
        }),
      });
      const gen = new EmbeddingGenerator(provider);
      const chunks = [makeChunk(0), makeChunk(1), makeChunk(2)];

      const result = await gen.generateBatch(chunks);

      // 1 batch call (failed) + 3 single retries = 4 calls
      expect(provider.embed).toHaveBeenCalledTimes(4);
      expect(result).toHaveLength(3);
    });

    it('skips chunks that fail even on single retry', async () => {
      let callCount = 0;
      const provider = makeFakeProvider({
        embed: vi.fn(async (texts: string[]) => {
          callCount++;
          // Batch fails
          if (callCount === 1) throw new Error('batch fail');
          // Single retry: second chunk fails
          if (texts[0] === 'chunk-1') throw new Error('single fail');
          return texts.map(() => [1, 2, 3]);
        }),
      });
      const gen = new EmbeddingGenerator(provider);
      const chunks = [makeChunk(0), makeChunk(1), makeChunk(2)];

      const result = await gen.generateBatch(chunks);

      // chunk-1 was skipped
      expect(result).toHaveLength(2);
      expect(result.map(r => r.chunk.chunkIndex)).toEqual([0, 2]);
    });

    it('handles mixed success/failure across multiple batches', async () => {
      let batchCall = 0;
      const provider = makeFakeProvider({
        embed: vi.fn(async (texts: string[]) => {
          batchCall++;
          // First batch (3 items) succeeds, second batch (2 items) fails
          if (batchCall === 2) throw new Error('second batch fail');
          return texts.map(() => [0.5]);
        }),
      });
      const gen = new EmbeddingGenerator(provider);
      const chunks = Array.from({ length: 5 }, (_, i) => makeChunk(i));

      const result = await gen.generateBatch(chunks);

      // First batch: 3 succeed. Second batch fails → 2 single retries succeed
      // batchCall increments: 1 (batch ok), 2 (batch fail), 3 (single ok), 4 (single ok)
      expect(result).toHaveLength(5);
    });
  });

  // ---- switchProvider ----

  describe('switchProvider', () => {
    it('uses the new provider after switching', async () => {
      const oldProvider = makeFakeProvider({
        embed: vi.fn(async () => [[1, 1, 1]]),
      });
      const newProvider = makeFakeProvider({
        embed: vi.fn(async () => [[9, 9, 9]]),
      });
      const gen = new EmbeddingGenerator(oldProvider);

      gen.switchProvider(newProvider);
      const vector = await gen.generateSingle('test');

      expect(vector).toEqual([9, 9, 9]);
      expect(oldProvider.embed).not.toHaveBeenCalled();
      expect(newProvider.embed).toHaveBeenCalledOnce();
    });
  });
});
