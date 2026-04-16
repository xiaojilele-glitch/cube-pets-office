/**
 * Observability Property Tests
 *
 * Feature: vector-db-rag-pipeline
 * Property 24: Quota enforcement rejects when vector count >= maxVectors
 * Property 25: Sum of per-operation token counts equals total
 * Property 26: When RAG_ENABLED=false, config.enabled is false
 */

import { describe, expect, it, beforeEach } from "vitest";
import fc from "fast-check";

import { QuotaManager } from "../rag/observability/quota-manager.js";
import { RAGMetrics } from "../rag/observability/metrics.js";
import { getRAGConfig, resetRAGConfigCache } from "../rag/config.js";

/* ---- Property 24: Quota enforcement ---- */

describe("Property 24: Quota enforcement rejects at maxVectors", () => {
  beforeEach(() => resetRAGConfigCache());

  it("when vector count reaches max quota, new ingestion is rejected", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), maxVectors => {
        process.env.RAG_QUOTA = JSON.stringify({
          "proj-quota": { maxVectors, maxDailyEmbeddingTokens: 999999 },
        });
        resetRAGConfigCache();

        try {
          const manager = new QuotaManager();

          const belowResult = manager.checkVectorQuota(
            "proj-quota",
            maxVectors - 1
          );
          expect(belowResult.allowed).toBe(true);

          const atResult = manager.checkVectorQuota("proj-quota", maxVectors);
          expect(atResult.allowed).toBe(false);
          expect(atResult.reason).toBeDefined();

          const aboveResult = manager.checkVectorQuota(
            "proj-quota",
            maxVectors + 100
          );
          expect(aboveResult.allowed).toBe(false);

          const noQuota = manager.checkVectorQuota(
            "proj-no-quota",
            maxVectors + 100
          );
          expect(noQuota.allowed).toBe(true);
        } finally {
          delete process.env.RAG_QUOTA;
          resetRAGConfigCache();
        }
      }),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 25: Token count summation ---- */

describe("Property 25: Sum of per-operation token counts equals total", () => {
  it("sum of per-operation token counts equals total token count", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom("embedding", "augmentation"),
            tokens: fc.integer({ min: 1, max: 10000 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        operations => {
          const metrics = new RAGMetrics();

          let embeddingTotal = 0;
          let augmentationTotal = 0;

          for (const op of operations) {
            if (op.type === "embedding") {
              metrics.recordEmbeddingCall(op.tokens);
              embeddingTotal += op.tokens;
            } else {
              metrics.recordAugmentation(op.tokens);
              augmentationTotal += op.tokens;
            }
          }

          const snap = metrics.snapshot();
          expect(snap.embeddingCost.tokenCount).toBe(embeddingTotal);
          expect(snap.augmentation.tokenUsage).toBe(augmentationTotal);

          const totalTracked =
            snap.embeddingCost.tokenCount + snap.augmentation.tokenUsage;
          expect(totalTracked).toBe(embeddingTotal + augmentationTotal);
        }
      ),
      { numRuns: 20 }
    );
  });
});

/* ---- Property 26: RAG_ENABLED=false disables config ---- */

describe("Property 26: RAG_ENABLED=false disables config", () => {
  beforeEach(() => resetRAGConfigCache());

  it("when rag.enabled=false, config reflects disabled state", () => {
    process.env.RAG_ENABLED = "false";
    resetRAGConfigCache();

    try {
      const config = getRAGConfig(process.env, { noCache: true });
      expect(config.enabled).toBe(false);
    } finally {
      delete process.env.RAG_ENABLED;
      resetRAGConfigCache();
    }
  });
});
