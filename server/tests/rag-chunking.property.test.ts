/**
 * Chunking Layer Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Properties: 1, 5, 6, 7
 */

import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';

import { SOURCE_TYPES, type SourceType, type ChunkMetadata } from '../../shared/rag/contracts.js';
import { ChunkRouter } from '../rag/chunking/chunk-router.js';
import { SlidingWindowChunker, estimateTokenCount } from '../rag/chunking/sliding-window-chunker.js';
import { CodeChunker } from '../rag/chunking/code-chunker.js';
import { ConversationChunker } from '../rag/chunking/conversation-chunker.js';
import { DocumentChunker } from '../rag/chunking/document-chunker.js';
import { PassthroughChunker } from '../rag/chunking/passthrough-chunker.js';
import { resetRAGConfigCache, getRAGConfig } from '../rag/config.js';

/* ---- Arbitraries ---- */

const arbSourceType: fc.Arbitrary<SourceType> = fc.constantFrom(...SOURCE_TYPES);

const arbInvalidSourceType: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(SOURCE_TYPES as readonly string[]).includes(s));

const arbChunkMetadata: fc.Arbitrary<ChunkMetadata> = fc.record({
  ingestedAt: fc.constant(new Date().toISOString()),
  lastAccessedAt: fc.constant(new Date().toISOString()),
  contentHash: fc.stringMatching(/^[0-9a-f]{16}$/),
});

function arbContentWithMinTokens(minTokens: number): fc.Arbitrary<string> {
  return fc
    .array(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0), {
      minLength: minTokens,
      maxLength: minTokens + 200,
    })
    .map((words) => words.join(' '));
}

const arbIdentifier: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.stringMatching(/^[a-zA-Z0-9_]{2,8}$/),
  )
  .map(([first, rest]) => first + rest);

const arbCodeContent: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('typescript', 'javascript', 'python'),
    fc.array(arbIdentifier, { minLength: 2, maxLength: 5 }),
  )
  .map(([lang, names]) => {
    if (lang === 'python') {
      return names
        .map(
          (name) =>
            `def ${name}(arg1, arg2):\n` +
            `    """Docstring for ${name}"""\n` +
            `    result = arg1 + arg2\n` +
            `    return result\n`,
        )
        .join('\n');
    }
    return (
      `import { something } from 'module';\n\n` +
      names
        .map(
          (name) =>
            `function ${name}(a: number, b: number): number {\n` +
            `  const result = a + b;\n` +
            `  return result;\n` +
            `}\n`,
        )
        .join('\n')
    );
  });


/* ---- Helpers ---- */

function buildRouter(): ChunkRouter {
  const router = new ChunkRouter();
  router.register('syntax_aware', new CodeChunker());
  router.register('conversation_turn', new ConversationChunker());
  router.register('semantic_paragraph', new DocumentChunker());
  router.register('sliding_window', new SlidingWindowChunker());
  router.register('passthrough', new PassthroughChunker());
  return router;
}

const EXPECTED_STRATEGY: Record<SourceType, string> = {
  code_snippet: 'syntax_aware',
  conversation: 'conversation_turn',
  document: 'semantic_paragraph',
  task_result: 'sliding_window',
  mission_log: 'sliding_window',
  architecture_decision: 'passthrough',
  bug_report: 'sliding_window',
};

const STRATEGY_TO_CLASS: Record<string, Function> = {
  syntax_aware: CodeChunker,
  conversation_turn: ConversationChunker,
  semantic_paragraph: DocumentChunker,
  sliding_window: SlidingWindowChunker,
  passthrough: PassthroughChunker,
};

/* ---- Property 1: Valid SourceType routes to correct Chunker; invalid throws ---- */

describe('Property 1: ChunkRouter routes valid SourceType to correct Chunker', () => {
  let router: ChunkRouter;

  beforeEach(() => {
    resetRAGConfigCache();
    router = buildRouter();
  });

  it('for any valid SourceType, ChunkRouter routes to the correct Chunker', () => {
    fc.assert(
      fc.property(arbSourceType, (sourceType) => {
        const chunker = router.route(sourceType);
        expect(chunker).toBeDefined();

        const expectedStrategy = EXPECTED_STRATEGY[sourceType];
        const expectedClass = STRATEGY_TO_CLASS[expectedStrategy];
        expect(chunker).toBeInstanceOf(expectedClass);
      }),
      { numRuns: 20 },
    );
  });

  it('for any invalid SourceType, ChunkRouter rejects with an error', () => {
    fc.assert(
      fc.property(arbInvalidSourceType, (invalidType) => {
        expect(() => router.route(invalidType as SourceType)).toThrow();
      }),
      { numRuns: 20 },
    );
  });
});

/* ---- Property 5: ChunkRecord has all required fields ---- */

describe('Property 5: ChunkRecord contains all required fields', () => {
  let router: ChunkRouter;

  beforeEach(() => {
    resetRAGConfigCache();
    router = buildRouter();
  });

  it('for any input content and sourceType, each ChunkRecord contains all required fields', () => {
    fc.assert(
      fc.property(
        arbSourceType,
        arbContentWithMinTokens(80),
        arbChunkMetadata,
        (sourceType, content, metadata) => {
          const chunker = router.route(sourceType);
          const chunks = chunker.chunk(content, metadata);

          for (const chunk of chunks) {
            expect(chunk).toHaveProperty('chunkId');
            expect(typeof chunk.chunkId).toBe('string');
            expect(chunk.chunkId.length).toBeGreaterThan(0);

            expect(chunk).toHaveProperty('sourceType');
            expect(typeof chunk.sourceType).toBe('string');

            expect(chunk).toHaveProperty('sourceId');
            expect(typeof chunk.sourceId).toBe('string');

            expect(chunk).toHaveProperty('projectId');
            expect(typeof chunk.projectId).toBe('string');

            expect(chunk).toHaveProperty('chunkIndex');
            expect(typeof chunk.chunkIndex).toBe('number');
            expect(chunk.chunkIndex).toBeGreaterThanOrEqual(0);

            expect(chunk).toHaveProperty('content');
            expect(typeof chunk.content).toBe('string');
            expect(chunk.content.length).toBeGreaterThan(0);

            expect(chunk).toHaveProperty('tokenCount');
            expect(typeof chunk.tokenCount).toBe('number');
            expect(chunk.tokenCount).toBeGreaterThan(0);

            expect(chunk).toHaveProperty('metadata');
            expect(typeof chunk.metadata).toBe('object');
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('for code_snippet type, metadata includes codeLanguage and functionSignature', () => {
    fc.assert(
      fc.property(arbCodeContent, arbChunkMetadata, (content, metadata) => {
        const chunker = router.route('code_snippet');
        const chunks = chunker.chunk(content, metadata);

        expect(chunks.length).toBeGreaterThan(0);

        for (const chunk of chunks) {
          expect(chunk.metadata.codeLanguage).toBeDefined();
          expect(typeof chunk.metadata.codeLanguage).toBe('string');
          expect(chunk.metadata.codeLanguage!.length).toBeGreaterThan(0);
        }

        const hasSignature = chunks.some(
          (c) => c.metadata.functionSignature !== undefined && c.metadata.functionSignature !== null,
        );
        expect(hasSignature).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});


/* ---- Property 6: Chunk tokenCount in [64, 1024] for content >= 64 tokens ---- */

describe('Property 6: Chunk tokenCount stays within [64, 1024]', () => {
  let router: ChunkRouter;

  beforeEach(() => {
    resetRAGConfigCache();
    router = buildRouter();
  });

  it('for any input content (>= 64 tokens), each chunk tokenCount is in [64, 1024]', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<SourceType>(
          'task_result',
          'mission_log',
          'bug_report',
          'document',
          'conversation',
          'code_snippet',
        ),
        arbContentWithMinTokens(128),
        arbChunkMetadata,
        (sourceType, content, metadata) => {
          const chunker = router.route(sourceType);
          const chunks = chunker.chunk(content, metadata);

          if (chunks.length === 0) return;

          for (const chunk of chunks) {
            expect(chunk.tokenCount).toBeGreaterThanOrEqual(64);
            expect(chunk.tokenCount).toBeLessThanOrEqual(1024);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('for conversation content with enough tokens, chunks respect token bounds', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('User', 'Agent', 'System'),
            fc.array(
              fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
              { minLength: 20, maxLength: 60 },
            ),
          ),
          { minLength: 3, maxLength: 8 },
        ),
        arbChunkMetadata,
        (turns, metadata) => {
          const content = turns
            .map(([speaker, words]) => `${speaker}: ${words.join(' ')}`)
            .join('\n');

          if (estimateTokenCount(content) < 64) return;

          const chunker = router.route('conversation');
          const chunks = chunker.chunk(content, metadata);

          for (const chunk of chunks) {
            expect(chunk.tokenCount).toBeGreaterThanOrEqual(64);
            expect(chunk.tokenCount).toBeLessThanOrEqual(1024);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/* ---- Property 7: Custom rag.chunking config overrides defaults ---- */

describe('Property 7: Custom chunking config overrides defaults', () => {
  beforeEach(() => {
    resetRAGConfigCache();
  });

  it('for any custom rag.chunking config, Chunker uses custom parameters instead of defaults', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 400 }),
        fc.integer({ min: 10, max: 50 }),
        fc.constantFrom<SourceType>('task_result', 'mission_log', 'bug_report'),
        arbContentWithMinTokens(200),
        arbChunkMetadata,
        (windowSize, overlap, sourceType, content, metadata) => {
          const customConfig = {
            [sourceType]: {
              strategy: 'sliding_window',
              maxTokens: 1024,
              minTokens: 64,
              windowSize,
              overlap,
            },
          };
          process.env.RAG_CHUNKING_OVERRIDES = JSON.stringify(customConfig);
          resetRAGConfigCache();

          try {
            const config = getRAGConfig(process.env, { noCache: true });
            const typeConfig = config.chunking[sourceType];
            expect(typeConfig).toBeDefined();
            expect(typeConfig!.windowSize).toBe(windowSize);
            expect(typeConfig!.overlap).toBe(overlap);

            const chunker = SlidingWindowChunker.fromConfig(typeConfig);
            const chunks = chunker.chunk(content, metadata);

            if (chunks.length > 1) {
              const defaultChunker = new SlidingWindowChunker();
              const defaultChunks = defaultChunker.chunk(content, metadata);

              if (windowSize < 512 && estimateTokenCount(content) > 512) {
                expect(chunks.length).toBeGreaterThanOrEqual(defaultChunks.length);
              }
            }
          } finally {
            delete process.env.RAG_CHUNKING_OVERRIDES;
            resetRAGConfigCache();
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('custom config for document type overrides default minTokens/maxTokens', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 32, max: 80 }),
        fc.integer({ min: 200, max: 600 }),
        arbContentWithMinTokens(150),
        arbChunkMetadata,
        (minTokens, maxTokens, content, metadata) => {
          const customConfig = {
            document: {
              strategy: 'semantic_paragraph',
              maxTokens,
              minTokens,
            },
          };
          process.env.RAG_CHUNKING_OVERRIDES = JSON.stringify(customConfig);
          resetRAGConfigCache();

          try {
            const config = getRAGConfig(process.env, { noCache: true });
            const typeConfig = config.chunking.document;
            expect(typeConfig).toBeDefined();
            expect(typeConfig!.maxTokens).toBe(maxTokens);
            expect(typeConfig!.minTokens).toBe(minTokens);

            const chunker = DocumentChunker.fromConfig(typeConfig);
            const chunks = chunker.chunk(content, metadata);

            for (const chunk of chunks) {
              expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens);
            }
          } finally {
            delete process.env.RAG_CHUNKING_OVERRIDES;
            resetRAGConfigCache();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
