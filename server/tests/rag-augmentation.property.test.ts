/**
 * Augmentation Pipeline Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 14: Reranker preserves result set
 * Property 15: Injected chunks total tokens <= budget
 * Property 16: TokenBudgetManager labels all chunks correctly
 * Property 17: AugmentationLogger records all required fields
 * Property 27: Each chunk status is exactly one of injected/pruned/below_threshold
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  RetrievalResult,
  SourceType,
} from "../../shared/rag/contracts.js";
import { NoopReranker, LLMReranker } from "../rag/augmentation/reranker.js";
import { TokenBudgetManager } from "../rag/augmentation/token-budget-manager.js";
import { AugmentationLogger } from "../rag/augmentation/augmentation-logger.js";
import { resetRAGConfigCache } from "../rag/config.js";

const __fn = fileURLToPath(import.meta.url);
const __dn = dirname(__fn);
const LOG_PATH = resolve(__dn, "../../data/test_aug_log.json");

function cleanup() {
  if (existsSync(LOG_PATH)) unlinkSync(LOG_PATH);
}

/* ---- Arbitraries ---- */

const arbRetrievalResult: fc.Arbitrary<RetrievalResult> = fc.record({
  chunkId: fc.stringMatching(/^[a-z_]+:[a-z0-9-]+:\d+$/),
  score: fc.float({
    min: Math.fround(0.1),
    max: Math.fround(1.0),
    noNaN: true,
  }),
  content: fc
    .array(
      fc
        .string({ minLength: 1, maxLength: 8 })
        .filter(s => s.trim().length > 0),
      { minLength: 5, maxLength: 50 }
    )
    .map(w => w.join(" ")),
  sourceType: fc.constantFrom(
    "task_result",
    "code_snippet",
    "document"
  ) as fc.Arbitrary<SourceType>,
  sourceId: fc.stringMatching(/^src-[a-z0-9]{3,6}$/),
  metadata: fc.constant({
    ingestedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    contentHash: "abcdef0123456789",
  }),
  totalCandidates: fc.integer({ min: 1, max: 100 }),
});

function arbResultList(min: number, max: number) {
  return fc.uniqueArray(arbRetrievalResult, {
    minLength: min,
    maxLength: max,
    selector: r => r.chunkId,
  });
}

/* ---- Property 14: Reranker preserves result set (permutation only) ---- */

describe("Property 14: Reranker preserves result set", () => {
  it("NoopReranker preserves the exact same set of results", async () => {
    await fc.assert(
      fc.asyncProperty(arbResultList(1, 10), async results => {
        const reranker = new NoopReranker();
        const reranked = await reranker.rerank("test query", results);
        expect(reranked.length).toBe(results.length);
        const originalIds = new Set(results.map(r => r.chunkId));
        const rerankedIds = new Set(reranked.map(r => r.chunkId));
        expect(rerankedIds).toEqual(originalIds);
      }),
      { numRuns: 20 }
    );
  });

  it("LLMReranker preserves the exact same set of results (permutation only)", async () => {
    await fc.assert(
      fc.asyncProperty(arbResultList(1, 10), async results => {
        const reranker = new LLMReranker();
        const reranked = await reranker.rerank("test query", results);
        expect(reranked.length).toBe(results.length);
        const originalIds = new Set(results.map(r => r.chunkId));
        const rerankedIds = new Set(reranked.map(r => r.chunkId));
        expect(rerankedIds).toEqual(originalIds);
      }),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 15: Injected chunks total tokens <= budget ---- */

describe("Property 15: Injected chunks total tokens never exceed budget", () => {
  it("injected chunks total tokens never exceed budget", () => {
    fc.assert(
      fc.property(
        arbResultList(1, 15),
        fc.integer({ min: 50, max: 2000 }),
        (results, budget) => {
          const manager = new TokenBudgetManager(budget, 0);
          const allocation = manager.allocate(results);

          expect(allocation.injectedTokens).toBeLessThanOrEqual(budget);

          for (const c of allocation.chunks) {
            if (c.status === "injected") {
              expect(c.result.sourceType).toBeDefined();
              expect(c.result.sourceId).toBeDefined();
              expect(typeof c.result.score).toBe("number");
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 16: TokenBudgetManager labels all chunks correctly ---- */

describe("Property 16: TokenBudgetManager labels all chunks regardless of mode", () => {
  beforeEach(() => {
    resetRAGConfigCache();
  });

  it("TokenBudgetManager labels all chunks with a valid status", () => {
    fc.assert(
      fc.property(arbResultList(1, 10), results => {
        const manager = new TokenBudgetManager(4096, 0.3);
        const allocation = manager.allocate(results);

        expect(allocation.chunks.length).toBe(results.length);

        for (const c of allocation.chunks) {
          expect(["injected", "pruned", "below_threshold"]).toContain(c.status);
        }
      }),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 17: AugmentationLogger records all required fields ---- */

describe("Property 17: AugmentationLogger records all required fields", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("for any augmentation log entry, all required fields are present", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^task-[a-z0-9]{3,6}$/),
        fc.stringMatching(/^agent-[a-z]{2,5}$/),
        fc.stringMatching(/^proj-[a-z0-9]{3,6}$/),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 5000 }),
        (taskId, agentId, projectId, tokenUsage, latencyMs) => {
          const logger = new AugmentationLogger(LOG_PATH);
          const record = logger.log({
            taskId,
            agentId,
            projectId,
            mode: "auto",
            retrievedChunkIds: ["chunk-1", "chunk-2"],
            injectedChunkIds: ["chunk-1"],
            prunedChunkIds: ["chunk-2"],
            tokenUsage,
            latencyMs,
          });

          expect(record.logId).toBeDefined();
          expect(record.taskId).toBe(taskId);
          expect(record.agentId).toBe(agentId);
          expect(record.projectId).toBe(projectId);
          expect(record.retrievedChunkIds).toEqual(["chunk-1", "chunk-2"]);
          expect(record.injectedChunkIds).toEqual(["chunk-1"]);
          expect(record.tokenUsage).toBe(tokenUsage);
          expect(record.latencyMs).toBe(latencyMs);
          expect(record.timestamp).toBeDefined();
        }
      ),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 27: Each chunk status is exactly one of injected/pruned/below_threshold ---- */

describe("Property 27: Chunk status is exactly one valid value", () => {
  it("each chunk has exactly one status: injected, pruned, or below_threshold", () => {
    fc.assert(
      fc.property(
        arbResultList(1, 15),
        fc.integer({ min: 50, max: 2000 }),
        (results, budget) => {
          const manager = new TokenBudgetManager(budget, 0.3);
          const allocation = manager.allocate(results);

          const validStatuses = new Set([
            "injected",
            "pruned",
            "below_threshold",
          ]);

          for (const chunk of allocation.chunks) {
            expect(validStatuses.has(chunk.status)).toBe(true);
            expect(typeof chunk.status).toBe("string");
          }

          const injected = allocation.chunks.filter(
            c => c.status === "injected"
          ).length;
          const pruned = allocation.chunks.filter(
            c => c.status === "pruned"
          ).length;
          const belowThreshold = allocation.chunks.filter(
            c => c.status === "below_threshold"
          ).length;
          expect(injected + pruned + belowThreshold).toBe(
            allocation.chunks.length
          );
        }
      ),
      { numRuns: 20 }
    );
  });
});
