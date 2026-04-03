/**
 * 检索层单元测试
 *
 * Feature: vector-db-rag-pipeline
 * Requirements: 4.4, 4.5
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SearchHit } from '../rag/store/vector-store-adapter.js';
import { rrfMerge } from '../rag/retrieval/rrf-merger.js';
import { ContextExpander } from '../rag/retrieval/context-expander.js';
import { MetadataStore, type RagChunkMetadataRow } from '../rag/store/metadata-store.js';

const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const META_PATH = resolve(__dn, '../../data/test_retrieval_unit_meta.json');

function cleanup() { if (existsSync(META_PATH)) unlinkSync(META_PATH); }

function makeRow(sourceId: string, idx: number): RagChunkMetadataRow {
  return {
    chunk_id: `task_result:${sourceId}:${idx}`,
    source_type: 'task_result',
    source_id: sourceId,
    project_id: 'proj-test',
    chunk_index: idx,
    content_hash: 'abcdef0123456789',
    token_count: 100,
    code_language: null,
    function_signature: null,
    agent_id: null,
    ingested_at: new Date().toISOString(),
    last_accessed_at: new Date().toISOString(),
    storage_tier: 'hot',
    metadata_json: JSON.stringify({ content: `chunk ${idx}` }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RRF 合并具体数值验证
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('rrfMerge', () => {
  it('computes correct RRF scores for known inputs', () => {
    const semantic: SearchHit[] = [
      { id: 'A', score: 0.9 },
      { id: 'B', score: 0.8 },
      { id: 'C', score: 0.7 },
    ];
    const keyword: SearchHit[] = [
      { id: 'B', score: 0.95 },
      { id: 'D', score: 0.85 },
      { id: 'A', score: 0.75 },
    ];

    const merged = rrfMerge(semantic, keyword, 60);

    // B appears at rank 1 in semantic (1/(60+2)) and rank 0 in keyword (1/(60+1))
    // A appears at rank 0 in semantic (1/(60+1)) and rank 2 in keyword (1/(60+3))
    const scoreB = 1 / 62 + 1 / 61;
    const scoreA = 1 / 61 + 1 / 63;

    const mergedB = merged.find(h => h.id === 'B')!;
    const mergedA = merged.find(h => h.id === 'A')!;

    expect(mergedB.score).toBeCloseTo(scoreB, 6);
    expect(mergedA.score).toBeCloseTo(scoreA, 6);

    // B should rank higher than A (appears in both, better combined rank)
    expect(mergedB.score).toBeGreaterThan(mergedA.score);
  });

  it('handles empty lists', () => {
    expect(rrfMerge([], []).length).toBe(0);
    expect(rrfMerge([{ id: 'A', score: 1 }], []).length).toBe(1);
    expect(rrfMerge([], [{ id: 'A', score: 1 }]).length).toBe(1);
  });

  it('handles single-item lists', () => {
    const merged = rrfMerge([{ id: 'A', score: 1 }], [{ id: 'A', score: 1 }]);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('A');
    // Score = 1/(60+1) + 1/(60+1) = 2/61
    expect(merged[0].score).toBeCloseTo(2 / 61, 6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ContextExpander 边界测试
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('ContextExpander', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('does not expand when windowSize is 0', () => {
    const store = new MetadataStore(META_PATH);
    store.upsert(makeRow('src-1', 0));
    store.upsert(makeRow('src-1', 1));

    const expander = new ContextExpander(store);
    const results = expander.expand([{
      chunkId: 'task_result:src-1:0',
      score: 0.9, content: 'c0', sourceType: 'task_result',
      sourceId: 'src-1', metadata: {} as any, totalCandidates: 2,
    }], 0);

    expect(results.length).toBe(1);
  });

  it('expands first chunk (index 0) — no previous chunk', () => {
    const store = new MetadataStore(META_PATH);
    for (let i = 0; i < 5; i++) store.upsert(makeRow('src-1', i));

    const expander = new ContextExpander(store);
    const results = expander.expand([{
      chunkId: 'task_result:src-1:0',
      score: 0.9, content: 'c0', sourceType: 'task_result',
      sourceId: 'src-1', metadata: {} as any, totalCandidates: 5,
    }], 1);

    const ids = results.map(r => r.chunkId);
    expect(ids).toContain('task_result:src-1:0');
    expect(ids).toContain('task_result:src-1:1');
    expect(ids).not.toContain('task_result:src-1:-1'); // doesn't exist
    expect(results.length).toBe(2);
  });

  it('expands last chunk — no next chunk', () => {
    const store = new MetadataStore(META_PATH);
    for (let i = 0; i < 5; i++) store.upsert(makeRow('src-1', i));

    const expander = new ContextExpander(store);
    const results = expander.expand([{
      chunkId: 'task_result:src-1:4',
      score: 0.9, content: 'c4', sourceType: 'task_result',
      sourceId: 'src-1', metadata: {} as any, totalCandidates: 5,
    }], 1);

    const ids = results.map(r => r.chunkId);
    expect(ids).toContain('task_result:src-1:4');
    expect(ids).toContain('task_result:src-1:3');
    expect(results.length).toBe(2);
  });

  it('deduplicates when expanding overlapping hits', () => {
    const store = new MetadataStore(META_PATH);
    for (let i = 0; i < 5; i++) store.upsert(makeRow('src-1', i));

    const expander = new ContextExpander(store);
    const results = expander.expand([
      { chunkId: 'task_result:src-1:1', score: 0.9, content: 'c1', sourceType: 'task_result', sourceId: 'src-1', metadata: {} as any, totalCandidates: 5 },
      { chunkId: 'task_result:src-1:2', score: 0.8, content: 'c2', sourceType: 'task_result', sourceId: 'src-1', metadata: {} as any, totalCandidates: 5 },
    ], 1);

    // Chunks 0,1,2,3 should be present (no duplicates)
    const ids = new Set(results.map(r => r.chunkId));
    expect(ids.size).toBe(results.length); // no duplicates
  });
});
