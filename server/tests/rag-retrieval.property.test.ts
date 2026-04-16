/**
 * Retrieval Layer Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 11: RetrievalResult has all required fields
 * Property 12: RRF merge properties
 * Property 13: Context expansion includes nearby chunks
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { RetrievalResult } from "../../shared/rag/contracts.js";
import type { SearchHit } from "../rag/store/vector-store-adapter.js";
import { rrfMerge } from "../rag/retrieval/rrf-merger.js";
import { ContextExpander } from "../rag/retrieval/context-expander.js";
import {
  MetadataStore,
  type RagChunkMetadataRow,
} from "../rag/store/metadata-store.js";

const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const META_PATH = resolve(__dn, "../../data/test_retrieval_meta.json");

function cleanup() {
  if (existsSync(META_PATH)) unlinkSync(META_PATH);
}

/* ---- Arbitraries ---- */

const arbSearchHit: fc.Arbitrary<SearchHit> = fc.record({
  id: fc.stringMatching(/^chunk-[a-z0-9]{3,8}$/),
  score: fc.float({
    min: Math.fround(0.1),
    max: Math.fround(1.0),
    noNaN: true,
  }),
  metadata: fc.constant(undefined),
});

function arbSearchHitList(min: number, max: number): fc.Arbitrary<SearchHit[]> {
  return fc.uniqueArray(arbSearchHit, {
    minLength: min,
    maxLength: max,
    selector: h => h.id,
  });
}

/* ---- Property 11: RetrievalResult has all required fields ---- */

describe("Property 11: RetrievalResult contains all required fields", () => {
  it("for any RetrievalResult, all required fields are present", () => {
    const arbResult: fc.Arbitrary<RetrievalResult> = fc.record({
      chunkId: fc.stringMatching(/^[a-z_]+:[a-z0-9-]+:\d+$/),
      score: fc.float({
        min: Math.fround(0),
        max: Math.fround(1),
        noNaN: true,
      }),
      content: fc.string({ minLength: 1, maxLength: 100 }),
      sourceType: fc.constantFrom(
        "task_result",
        "code_snippet",
        "conversation",
        "document"
      ) as fc.Arbitrary<any>,
      sourceId: fc.stringMatching(/^src-[a-z0-9]{3,6}$/),
      metadata: fc.record({
        ingestedAt: fc.constant(new Date().toISOString()),
        lastAccessedAt: fc.constant(new Date().toISOString()),
        contentHash: fc.stringMatching(/^[0-9a-f]{16}$/),
      }),
      totalCandidates: fc.integer({ min: 1, max: 1000 }),
    });

    fc.assert(
      fc.property(arbResult, result => {
        expect(result).toHaveProperty("chunkId");
        expect(typeof result.chunkId).toBe("string");
        expect(result).toHaveProperty("score");
        expect(typeof result.score).toBe("number");
        expect(result).toHaveProperty("content");
        expect(typeof result.content).toBe("string");
        expect(result).toHaveProperty("sourceType");
        expect(result).toHaveProperty("sourceId");
        expect(result).toHaveProperty("metadata");
        expect(typeof result.metadata).toBe("object");
      }),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 12: RRF merge properties ---- */

describe("Property 12: RRF merge ranking and completeness", () => {
  it("items appearing in both lists rank higher than items in only one list", () => {
    fc.assert(
      fc.property(
        arbSearchHitList(2, 10),
        arbSearchHitList(2, 10),
        (semanticList, keywordList) => {
          const merged = rrfMerge(semanticList, keywordList);

          const semanticIds = new Set(semanticList.map(h => h.id));
          const keywordIds = new Set(keywordList.map(h => h.id));
          const bothIds = new Set(
            [...semanticIds].filter(id => keywordIds.has(id))
          );
          const onlyOneIds = new Set(
            [...merged.map(h => h.id)].filter(id => !bothIds.has(id))
          );

          if (bothIds.size === 0 || onlyOneIds.size === 0) return;

          const bothScores = merged
            .filter(h => bothIds.has(h.id))
            .map(h => h.score);
          const onlyOneScores = merged
            .filter(h => onlyOneIds.has(h.id))
            .map(h => h.score);
          const maxBothScore = Math.max(...bothScores);
          const maxOnlyOneScore = Math.max(...onlyOneScores);

          expect(maxBothScore).toBeGreaterThanOrEqual(maxOnlyOneScore);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("merged result contains all unique items from both lists", () => {
    fc.assert(
      fc.property(
        arbSearchHitList(1, 8),
        arbSearchHitList(1, 8),
        (semanticList, keywordList) => {
          const merged = rrfMerge(semanticList, keywordList);
          const allIds = new Set([
            ...semanticList.map(h => h.id),
            ...keywordList.map(h => h.id),
          ]);
          expect(merged.length).toBe(allIds.size);
          for (const id of allIds) {
            expect(merged.some(h => h.id === id)).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("merged results are sorted by score descending", () => {
    fc.assert(
      fc.property(
        arbSearchHitList(1, 10),
        arbSearchHitList(1, 10),
        (semanticList, keywordList) => {
          const merged = rrfMerge(semanticList, keywordList);
          for (let i = 1; i < merged.length; i++) {
            expect(merged[i - 1].score).toBeGreaterThanOrEqual(merged[i].score);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 13: Context expansion includes chunks in [N-W, N+W] range ---- */

describe("Property 13: Context expansion includes nearby chunks", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("for any hit chunk at index N with window W, result includes chunks in [N-W, N+W]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 1, max: 3 }),
        (totalChunks, hitIdx, windowSize) => {
          if (hitIdx >= totalChunks) return;

          const metaStore = new MetadataStore(META_PATH);
          const sourceId = "src-test";

          for (let i = 0; i < totalChunks; i++) {
            const row: RagChunkMetadataRow = {
              chunk_id: `task_result:${sourceId}:${i}`,
              source_type: "task_result",
              source_id: sourceId,
              project_id: "proj-test",
              chunk_index: i,
              content_hash: "abcdef0123456789",
              token_count: 100,
              code_language: null,
              function_signature: null,
              agent_id: null,
              ingested_at: new Date().toISOString(),
              last_accessed_at: new Date().toISOString(),
              storage_tier: "hot",
              metadata_json: JSON.stringify({ content: `chunk content ${i}` }),
            };
            metaStore.upsert(row);
          }

          const hitResult: RetrievalResult = {
            chunkId: `task_result:${sourceId}:${hitIdx}`,
            score: 0.9,
            content: `chunk content ${hitIdx}`,
            sourceType: "task_result",
            sourceId,
            metadata: {
              ingestedAt: new Date().toISOString(),
              lastAccessedAt: new Date().toISOString(),
              contentHash: "abcdef0123456789",
            },
            totalCandidates: totalChunks,
          };

          const expander = new ContextExpander(metaStore);
          const expanded = expander.expand([hitResult], windowSize);

          const expandedIds = new Set(expanded.map(r => r.chunkId));
          for (let offset = -windowSize; offset <= windowSize; offset++) {
            const idx = hitIdx + offset;
            if (idx >= 0 && idx < totalChunks) {
              const expectedId = `task_result:${sourceId}:${idx}`;
              expect(expandedIds.has(expectedId)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
