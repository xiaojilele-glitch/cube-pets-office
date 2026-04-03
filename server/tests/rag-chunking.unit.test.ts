/**
 * 分块层单元测试
 *
 * Feature: vector-db-rag-pipeline
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { SOURCE_TYPES, type ChunkMetadata } from '../../shared/rag/contracts.js';
import { ChunkRouter } from '../rag/chunking/chunk-router.js';
import { SlidingWindowChunker, estimateTokenCount } from '../rag/chunking/sliding-window-chunker.js';
import { CodeChunker, detectLanguage, extractImports } from '../rag/chunking/code-chunker.js';
import { ConversationChunker } from '../rag/chunking/conversation-chunker.js';
import { DocumentChunker } from '../rag/chunking/document-chunker.js';
import { PassthroughChunker } from '../rag/chunking/passthrough-chunker.js';
import { resetRAGConfigCache } from '../rag/config.js';

/* ─── Helpers ─── */

const baseMeta: ChunkMetadata = {
  ingestedAt: new Date().toISOString(),
  lastAccessedAt: new Date().toISOString(),
  contentHash: 'abcdef0123456789',
};

function buildRouter(): ChunkRouter {
  const router = new ChunkRouter();
  router.register('syntax_aware', new CodeChunker());
  router.register('conversation_turn', new ConversationChunker());
  router.register('semantic_paragraph', new DocumentChunker());
  router.register('sliding_window', new SlidingWindowChunker());
  router.register('passthrough', new PassthroughChunker());
  return router;
}

/** Generate a string with approximately N tokens (space-separated words) */
function makeContent(tokenCount: number): string {
  return Array.from({ length: tokenCount }, (_, i) => `word${i}`).join(' ');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ChunkRouter 路由测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('ChunkRouter', () => {
  let router: ChunkRouter;

  beforeEach(() => {
    resetRAGConfigCache();
    router = buildRouter();
  });

  it('routes each valid sourceType without error', () => {
    for (const st of SOURCE_TYPES) {
      expect(() => router.route(st)).not.toThrow();
    }
  });

  it('throws on invalid sourceType', () => {
    expect(() => router.route('nonexistent' as any)).toThrow();
  });

  it('routes code_snippet to CodeChunker', () => {
    expect(router.route('code_snippet')).toBeInstanceOf(CodeChunker);
  });

  it('routes conversation to ConversationChunker', () => {
    expect(router.route('conversation')).toBeInstanceOf(ConversationChunker);
  });

  it('routes document to DocumentChunker', () => {
    expect(router.route('document')).toBeInstanceOf(DocumentChunker);
  });

  it('routes task_result to SlidingWindowChunker', () => {
    expect(router.route('task_result')).toBeInstanceOf(SlidingWindowChunker);
  });

  it('routes architecture_decision to PassthroughChunker', () => {
    expect(router.route('architecture_decision')).toBeInstanceOf(PassthroughChunker);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SlidingWindowChunker 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('SlidingWindowChunker', () => {
  const chunker = new SlidingWindowChunker();

  it('returns empty array for empty content', () => {
    expect(chunker.chunk('', baseMeta)).toEqual([]);
    expect(chunker.chunk('   ', baseMeta)).toEqual([]);
  });

  it('returns single chunk for short content', () => {
    const content = makeContent(100);
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBe(1);
    expect(chunks[0].tokenCount).toBe(100);
  });

  it('splits long content into multiple chunks', () => {
    const content = makeContent(1200);
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeGreaterThanOrEqual(64);
      expect(c.tokenCount).toBeLessThanOrEqual(1024);
    }
  });

  it('handles unicode and emoji content', () => {
    const content = Array.from({ length: 100 }, (_, i) => `词${i} 🎉`).join(' ');
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * CodeChunker 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('CodeChunker', () => {
  const chunker = new CodeChunker();

  it('returns empty array for empty content', () => {
    expect(chunker.chunk('', baseMeta)).toEqual([]);
    expect(chunker.chunk('   \n  ', baseMeta)).toEqual([]);
  });

  it('detects TypeScript language', () => {
    const ts = `import { foo } from 'bar';\n\nfunction hello(a: number): string {\n  return String(a);\n}\n`;
    expect(detectLanguage(ts)).toBe('typescript');
  });

  it('detects Python language', () => {
    const py = `def hello(name):\n    return f"Hello {name}"\n`;
    expect(detectLanguage(py)).toBe('python');
  });

  it('detects JavaScript language', () => {
    const js = `import something from 'module';\n\nfunction greet() {\n  console.log('hi');\n}\n`;
    expect(detectLanguage(js)).toBe('javascript');
  });

  it('extracts imports from JS/TS code', () => {
    const code = `import { foo } from 'bar';\nimport baz from 'qux';\n\nfunction test() {}\n`;
    const imports = extractImports(code);
    expect(imports.length).toBe(2);
    expect(imports).toContain("import { foo } from 'bar';");
    expect(imports).toContain("import baz from 'qux';");
  });

  it('extracts imports from Python code', () => {
    const code = `from os import path\nimport sys\n\ndef main():\n    pass\n`;
    const imports = extractImports(code);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts functionSignature for code_snippet chunks', () => {
    const code = Array.from({ length: 5 }, (_, i) =>
      `function handler${i}(req: Request, res: Response): void {\n` +
      `  const data = processRequest(req);\n` +
      `  const result = transformData(data);\n` +
      `  const output = formatResult(result);\n` +
      `  const validated = validateOutput(output);\n` +
      `  const serialized = serializeData(validated);\n` +
      `  const compressed = compressPayload(serialized);\n` +
      `  const encrypted = encryptData(compressed);\n` +
      `  const signed = signPayload(encrypted);\n` +
      `  const encoded = encodeResponse(signed);\n` +
      `  const buffered = bufferOutput(encoded);\n` +
      `  const streamed = streamResponse(buffered);\n` +
      `  const logged = logResponse(streamed);\n` +
      `  res.send(logged);\n` +
      `}\n`
    ).join('\n');
    const chunks = chunker.chunk(code, baseMeta);
    expect(chunks.length).toBeGreaterThan(0);
    const hasSignature = chunks.some(c => c.metadata.functionSignature != null);
    expect(hasSignature).toBe(true);
  });

  it('sets codeLanguage in metadata', () => {
    const code = `function hello(a: number): string {\n  return String(a);\n}\n` +
      makeContent(80);
    const chunks = chunker.chunk(code, baseMeta);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.metadata.codeLanguage).toBeDefined();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ConversationChunker 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('ConversationChunker', () => {
  const chunker = new ConversationChunker();

  it('returns empty array for empty content', () => {
    expect(chunker.chunk('', baseMeta)).toEqual([]);
  });

  it('parses speaker turns correctly', () => {
    const longMsg = makeContent(80);
    const content = `User: ${longMsg}\nAgent: ${longMsg}\n`;
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBeGreaterThan(0);
    // Should have speaker metadata
    for (const c of chunks) {
      expect(c.metadata.speaker).toBeDefined();
    }
  });

  it('handles single speaker with long content', () => {
    const longMsg = makeContent(1500);
    const content = `User: ${longMsg}`;
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(1024);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * DocumentChunker 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('DocumentChunker', () => {
  const chunker = new DocumentChunker();

  it('returns empty array for empty content', () => {
    expect(chunker.chunk('', baseMeta)).toEqual([]);
  });

  it('splits on double newlines', () => {
    const para1 = makeContent(100);
    const para2 = makeContent(100);
    const content = `${para1}\n\n${para2}`;
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('merges small paragraphs', () => {
    const small = makeContent(20);
    const content = Array.from({ length: 5 }, () => small).join('\n\n');
    const chunks = chunker.chunk(content, baseMeta);
    // 5 paragraphs of 20 tokens each = 100 total, should merge into 1-2 chunks
    expect(chunks.length).toBeLessThanOrEqual(2);
  });

  it('splits large paragraphs', () => {
    const large = makeContent(2000);
    const chunks = chunker.chunk(large, baseMeta);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(1024);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PassthroughChunker 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('PassthroughChunker', () => {
  const chunker = new PassthroughChunker();

  it('returns empty array for empty content', () => {
    expect(chunker.chunk('', baseMeta)).toEqual([]);
  });

  it('returns single chunk for any content', () => {
    const content = makeContent(500);
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].tokenCount).toBe(500);
  });

  it('preserves content with special characters', () => {
    const content = '决策记录：使用 Qdrant 作为向量数据库 🚀\n理由：开源、HTTP API 友好';
    const chunks = chunker.chunk(content, baseMeta);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain('Qdrant');
    expect(chunks[0].content).toContain('🚀');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * estimateTokenCount 单元测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('estimateTokenCount', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('   ')).toBe(0);
  });

  it('counts space-separated words', () => {
    expect(estimateTokenCount('hello world foo')).toBe(3);
  });

  it('handles multiple spaces', () => {
    expect(estimateTokenCount('a   b   c')).toBe(3);
  });
});
