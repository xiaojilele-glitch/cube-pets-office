import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { GraphStore } from "../knowledge/graph-store.js";
import { OntologyRegistry } from "../knowledge/ontology-registry.js";
import { KnowledgeGraphQuery } from "../knowledge/query-service.js";
import { KnowledgeService } from "../knowledge/knowledge-service.js";
import type {
  VectorStore,
  VectorSearchHit,
} from "../knowledge/knowledge-service.js";
import type { Entity } from "../../shared/knowledge/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

const TEST_PROJECT = "test-project-ks";

function graphFilePath(projectId: string): string {
  return path.join(DATA_DIR, `graph-${projectId}.json`);
}

function cleanup(): void {
  try {
    const fp = graphFilePath(TEST_PROJECT);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    // ignore
  }
}

function makeEntityInput(
  overrides: Partial<
    Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">
  > = {}
) {
  return {
    entityType: "CodeModule",
    name: "TestModule",
    description: "A test module",
    source: "code_analysis" as const,
    confidence: 0.8,
    projectId: TEST_PROJECT,
    needsReview: false,
    linkedMemoryIds: [],
    extendedAttributes: {},
    ...overrides,
  };
}

/** Simple mock vector store for testing */
function createMockVectorStore(hits: VectorSearchHit[]): VectorStore {
  return {
    search: async () => hits,
  };
}

describe("KnowledgeService", () => {
  let store: GraphStore;
  let registry: OntologyRegistry;
  let queryService: KnowledgeGraphQuery;

  beforeEach(() => {
    cleanup();
    store = new GraphStore();
    registry = new OntologyRegistry();
    queryService = new KnowledgeGraphQuery(store, registry);
  });

  afterEach(() => {
    store.forceSave();
    cleanup();
  });

  // -----------------------------------------------------------------------
  // query returns structuredResults from graph
  // -----------------------------------------------------------------------

  describe("query returns structuredResults from graph", () => {
    it("returns graph entities in structuredResults", async () => {
      store.createEntity(
        makeEntityInput({ name: "AuthModule", confidence: 0.9 })
      );
      store.createEntity(
        makeEntityInput({ name: "PaymentModule", confidence: 0.85 })
      );

      const service = new KnowledgeService(queryService, store);
      const result = await service.query("find modules", TEST_PROJECT);

      expect(result.structuredResults.entities).toHaveLength(2);
      const names = result.structuredResults.entities.map(e => e.name).sort();
      expect(names).toEqual(["AuthModule", "PaymentModule"]);
    });

    it("returns empty structuredResults when no entities exist", async () => {
      const service = new KnowledgeService(queryService, store);
      const result = await service.query("find modules", TEST_PROJECT);

      expect(result.structuredResults.entities).toHaveLength(0);
      expect(result.structuredResults.relations).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // preferStructured mode prioritizes graph results in summary
  // -----------------------------------------------------------------------

  describe("preferStructured mode", () => {
    it("labels graph results as Primary in mergedSummary", async () => {
      store.createEntity(makeEntityInput({ name: "GraphEntity" }));

      const mockVS = createMockVectorStore([
        { id: "v1", content: "semantic hit", score: 0.9 },
      ]);

      const service = new KnowledgeService(queryService, store, mockVS);
      const result = await service.query("test", TEST_PROJECT, {
        mode: "preferStructured",
      });

      expect(result.mergedSummary).toContain(
        "Knowledge Graph Results — Primary"
      );
      expect(result.mergedSummary).toContain(
        "Semantic Search Results — Supplementary"
      );
      // Graph section should appear before semantic section
      const graphIdx = result.mergedSummary.indexOf(
        "Knowledge Graph Results — Primary"
      );
      const semanticIdx = result.mergedSummary.indexOf(
        "Semantic Search Results — Supplementary"
      );
      expect(graphIdx).toBeLessThan(semanticIdx);
    });

    it("still shows graph results when no semantic results", async () => {
      store.createEntity(makeEntityInput({ name: "OnlyGraph" }));

      const service = new KnowledgeService(queryService, store);
      const result = await service.query("test", TEST_PROJECT, {
        mode: "preferStructured",
      });

      expect(result.mergedSummary).toContain(
        "Knowledge Graph Results — Primary"
      );
      expect(result.mergedSummary).toContain("OnlyGraph");
    });
  });

  // -----------------------------------------------------------------------
  // preferSemantic mode notes semantic results in summary
  // -----------------------------------------------------------------------

  describe("preferSemantic mode", () => {
    it("labels semantic results as Primary in mergedSummary", async () => {
      store.createEntity(makeEntityInput({ name: "GraphEntity" }));

      const mockVS = createMockVectorStore([
        { id: "v1", content: "important semantic result", score: 0.95 },
      ]);

      const service = new KnowledgeService(queryService, store, mockVS);
      const result = await service.query("test", TEST_PROJECT, {
        mode: "preferSemantic",
      });

      expect(result.mergedSummary).toContain(
        "Semantic Search Results — Primary"
      );
      expect(result.mergedSummary).toContain(
        "Knowledge Graph Results — Supplementary"
      );
      // Semantic section should appear before graph section
      const semanticIdx = result.mergedSummary.indexOf(
        "Semantic Search Results — Primary"
      );
      const graphIdx = result.mergedSummary.indexOf(
        "Knowledge Graph Results — Supplementary"
      );
      expect(semanticIdx).toBeLessThan(graphIdx);
    });

    it("falls back to graph results when no semantic results", async () => {
      store.createEntity(makeEntityInput({ name: "FallbackGraph" }));

      const service = new KnowledgeService(queryService, store);
      const result = await service.query("test", TEST_PROJECT, {
        mode: "preferSemantic",
      });

      expect(result.mergedSummary).toContain("Knowledge Graph Results");
      expect(result.mergedSummary).toContain(
        "No semantic search results available"
      );
    });
  });

  // -----------------------------------------------------------------------
  // balanced mode works as default
  // -----------------------------------------------------------------------

  describe("balanced mode (default)", () => {
    it("uses balanced mode when no options provided", async () => {
      store.createEntity(makeEntityInput({ name: "BalancedEntity" }));

      const mockVS = createMockVectorStore([
        { id: "v1", content: "balanced semantic", score: 0.8 },
      ]);

      const service = new KnowledgeService(queryService, store, mockVS);
      const result = await service.query("test", TEST_PROJECT);

      // Balanced mode: both sections present without Primary/Supplementary labels
      expect(result.mergedSummary).toContain("[Knowledge Graph Results]");
      expect(result.mergedSummary).toContain("[Semantic Search Results]");
      expect(result.mergedSummary).not.toContain("Primary");
      expect(result.mergedSummary).not.toContain("Supplementary");
    });

    it("returns 'no results' message when both sources are empty", async () => {
      const service = new KnowledgeService(queryService, store);
      const result = await service.query("nothing here", TEST_PROJECT, {
        mode: "balanced",
      });

      expect(result.mergedSummary).toContain("No results found");
    });
  });

  // -----------------------------------------------------------------------
  // Returns empty semanticResults when no vectorStore
  // -----------------------------------------------------------------------

  describe("no vectorStore", () => {
    it("returns empty semanticResults when vectorStore is not provided", async () => {
      store.createEntity(makeEntityInput({ name: "GraphOnly" }));

      const service = new KnowledgeService(queryService, store);
      const result = await service.query("test", TEST_PROJECT);

      expect(result.semanticResults).toEqual([]);
      expect(result.structuredResults.entities).toHaveLength(1);
    });

    it("returns empty semanticResults when vectorStore is null", async () => {
      const service = new KnowledgeService(queryService, store, null);
      const result = await service.query("test", TEST_PROJECT);

      expect(result.semanticResults).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Vector store integration
  // -----------------------------------------------------------------------

  describe("with vectorStore", () => {
    it("returns semantic hits in semanticResults", async () => {
      const hits: VectorSearchHit[] = [
        { id: "v1", content: "First result", score: 0.95 },
        { id: "v2", content: "Second result", score: 0.8 },
      ];
      const mockVS = createMockVectorStore(hits);

      const service = new KnowledgeService(queryService, store, mockVS);
      const result = await service.query("test", TEST_PROJECT);

      expect(result.semanticResults).toHaveLength(2);
      expect(result.semanticResults).toEqual(hits);
    });

    it("handles vectorStore search failure gracefully", async () => {
      const failingVS: VectorStore = {
        search: async () => {
          throw new Error("Vector DB down");
        },
      };

      store.createEntity(makeEntityInput({ name: "StillWorks" }));

      const service = new KnowledgeService(queryService, store, failingVS);
      const result = await service.query("test", TEST_PROJECT);

      // Should still return graph results even if vector search fails
      expect(result.structuredResults.entities).toHaveLength(1);
      expect(result.semanticResults).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // mergedSummary content
  // -----------------------------------------------------------------------

  describe("mergedSummary content", () => {
    it("includes entity names and types in structured section", async () => {
      store.createEntity(
        makeEntityInput({
          name: "MyService",
          entityType: "CodeModule",
          confidence: 0.9,
        })
      );

      const service = new KnowledgeService(queryService, store);
      const result = await service.query("test", TEST_PROJECT);

      expect(result.mergedSummary).toContain("MyService");
      expect(result.mergedSummary).toContain("CodeModule");
    });

    it("annotates low-confidence entities in summary", async () => {
      store.createEntity(makeEntityInput({ name: "Shaky", confidence: 0.3 }));

      const service = new KnowledgeService(queryService, store);
      const result = await service.query("test", TEST_PROJECT);

      expect(result.mergedSummary).toContain("Shaky");
      expect(result.mergedSummary).toContain("[low confidence]");
    });

    it("includes semantic hit scores and content preview", async () => {
      const mockVS = createMockVectorStore([
        {
          id: "v1",
          content: "A relevant document about architecture",
          score: 0.92,
        },
      ]);

      const service = new KnowledgeService(queryService, store, mockVS);
      const result = await service.query("test", TEST_PROJECT);

      expect(result.mergedSummary).toContain("0.92");
      expect(result.mergedSummary).toContain("architecture");
    });
  });

  // -----------------------------------------------------------------------
  // syncEntityToVectorStore
  // -----------------------------------------------------------------------

  describe("syncEntityToVectorStore", () => {
    it("writes to vector store and updates linkedMemoryIds", async () => {
      const entity = store.createEntity(
        makeEntityInput({
          name: "SyncModule",
          description: "Module to sync",
          confidence: 0.9,
        })
      );

      const upsertedIds: Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
      }> = [];
      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async (id, content, metadata) => {
          upsertedIds.push({ id, content, metadata });
          return `mem-${id}`;
        },
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncEntityToVectorStore(entity);

      // Verify upsert was called with correct data
      expect(upsertedIds).toHaveLength(1);
      expect(upsertedIds[0].id).toBe(entity.entityId);
      expect(upsertedIds[0].content).toContain("SyncModule");
      expect(upsertedIds[0].content).toContain("Module to sync");
      expect(upsertedIds[0].metadata.linkedEntityId).toBe(entity.entityId);
      expect(upsertedIds[0].metadata.entityType).toBe("CodeModule");
      expect(upsertedIds[0].metadata.projectId).toBe(TEST_PROJECT);

      // Verify entity's linkedMemoryIds was updated
      const updated = store.getEntity(entity.entityId);
      expect(updated).toBeDefined();
      expect(updated!.linkedMemoryIds).toContain(`mem-${entity.entityId}`);
    });

    it("skips when no vectorStore is provided", async () => {
      const entity = store.createEntity(makeEntityInput({ name: "NoVS" }));

      const service = new KnowledgeService(queryService, store);
      // Should not throw
      await service.syncEntityToVectorStore(entity);

      // linkedMemoryIds should remain empty
      const updated = store.getEntity(entity.entityId);
      expect(updated!.linkedMemoryIds).toEqual([]);
    });

    it("skips when vectorStore has no upsert method", async () => {
      const entity = store.createEntity(makeEntityInput({ name: "NoUpsert" }));

      const mockVS: VectorStore = {
        search: async () => [],
        // no upsert
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncEntityToVectorStore(entity);

      const updated = store.getEntity(entity.entityId);
      expect(updated!.linkedMemoryIds).toEqual([]);
    });

    it("does not duplicate linkedMemoryIds on repeated sync", async () => {
      const entity = store.createEntity(makeEntityInput({ name: "DedupSync" }));

      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async id => `mem-${id}`,
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncEntityToVectorStore(entity);
      // Sync again — same memoryId should not be duplicated
      const afterFirst = store.getEntity(entity.entityId)!;
      await service.syncEntityToVectorStore(afterFirst);

      const updated = store.getEntity(entity.entityId);
      const memIds = updated!.linkedMemoryIds.filter(
        id => id === `mem-${entity.entityId}`
      );
      expect(memIds).toHaveLength(1);
    });

    it("includes extended attributes in summary", async () => {
      const entity = store.createEntity(
        makeEntityInput({
          name: "AttrModule",
          description: "Has attrs",
          extendedAttributes: {
            filePath: "src/foo.ts",
            language: "typescript",
          },
        })
      );

      let capturedContent = "";
      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async (_id, content) => {
          capturedContent = content;
          return "mem-1";
        },
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncEntityToVectorStore(entity);

      expect(capturedContent).toContain("filePath: src/foo.ts");
      expect(capturedContent).toContain("language: typescript");
    });
  });

  // -----------------------------------------------------------------------
  // syncMemoryCandidatesToGraph
  // -----------------------------------------------------------------------

  describe("syncMemoryCandidatesToGraph", () => {
    it("skips when no vectorStore", async () => {
      const service = new KnowledgeService(queryService, store);
      // Should not throw and should be a no-op
      await service.syncMemoryCandidatesToGraph(TEST_PROJECT);

      // No entities should have been created
      const entities = store.findEntities({ projectId: TEST_PROJECT });
      expect(entities).toHaveLength(0);
    });

    it("skips when vectorStore has no listRecent method", async () => {
      const mockVS: VectorStore = {
        search: async () => [],
        // no listRecent
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncMemoryCandidatesToGraph(TEST_PROJECT);

      const entities = store.findEntities({ projectId: TEST_PROJECT });
      expect(entities).toHaveLength(0);
    });

    it("creates entities with needsReview: true from candidates", async () => {
      const mockVS: VectorStore = {
        search: async () => [],
        listRecent: async () => [
          {
            id: "mem-1",
            content: "Business rule: all orders require approval",
            score: 0.8,
          },
          {
            id: "mem-2",
            content: "Architecture: use event sourcing for audit",
            score: 0.7,
          },
        ],
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncMemoryCandidatesToGraph(TEST_PROJECT);

      const entities = store.findEntities({ projectId: TEST_PROJECT });
      expect(entities).toHaveLength(2);

      for (const entity of entities) {
        expect(entity.needsReview).toBe(true);
        expect(entity.source).toBe("llm_inferred");
        expect(entity.confidence).toBe(0.5);
        expect(entity.projectId).toBe(TEST_PROJECT);
        expect(entity.linkedMemoryIds.length).toBeGreaterThan(0);
      }
    });

    it("updates vector memory with linkedEntityId when upsert is available", async () => {
      const upsertCalls: Array<{
        id: string;
        metadata: Record<string, unknown>;
      }> = [];
      const mockVS: VectorStore = {
        search: async () => [],
        listRecent: async () => [
          { id: "mem-1", content: "Some knowledge candidate", score: 0.9 },
        ],
        upsert: async (id, _content, metadata) => {
          upsertCalls.push({ id, metadata });
          return id;
        },
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncMemoryCandidatesToGraph(TEST_PROJECT);

      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0].id).toBe("mem-1");
      expect(upsertCalls[0].metadata.linkedEntityId).toBeDefined();
    });

    it("handles empty candidates list gracefully", async () => {
      const mockVS: VectorStore = {
        search: async () => [],
        listRecent: async () => [],
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      await service.syncMemoryCandidatesToGraph(TEST_PROJECT);

      const entities = store.findEntities({ projectId: TEST_PROJECT });
      expect(entities).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // startEntitySync — entity change listener triggers sync
  // -----------------------------------------------------------------------

  describe("startEntitySync", () => {
    it("triggers sync on entity created", async () => {
      const upsertCalls: string[] = [];
      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async id => {
          upsertCalls.push(id);
          return `mem-${id}`;
        },
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      service.startEntitySync();

      // Create an entity — should trigger async sync
      store.createEntity(makeEntityInput({ name: "AutoSync" }));

      // Wait for async fire-and-forget to complete
      await vi.waitFor(
        () => {
          expect(upsertCalls.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 1000 }
      );

      service.stopEntitySync();
    });

    it("triggers sync on entity updated", async () => {
      const upsertCalls: string[] = [];
      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async id => {
          upsertCalls.push(id);
          return `mem-${id}`;
        },
      };

      const entity = store.createEntity(
        makeEntityInput({ name: "UpdateSync" })
      );

      const service = new KnowledgeService(queryService, store, mockVS);
      service.startEntitySync();

      // The create above happened before startEntitySync, so clear any calls
      upsertCalls.length = 0;

      store.updateEntity(entity.entityId, { description: "Updated desc" });

      await vi.waitFor(
        () => {
          expect(upsertCalls.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 1000 }
      );

      service.stopEntitySync();
    });

    it("does not duplicate listeners on multiple startEntitySync calls", async () => {
      let upsertCount = 0;
      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async id => {
          upsertCount++;
          return `mem-${id}`;
        },
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      service.startEntitySync();
      service.startEntitySync(); // second call should be no-op

      store.createEntity(makeEntityInput({ name: "NoDup" }));

      // Wait for the async chain to settle:
      // create → sync (upsert) → updateEntity (linkedMemoryIds) → sync again (upsert, but memId already present so no updateEntity)
      await vi.waitFor(
        () => {
          expect(upsertCount).toBeGreaterThanOrEqual(2);
        },
        { timeout: 1000 }
      );

      // With a single listener: create triggers 1 upsert, the linkedMemoryIds update triggers 1 more = 2.
      // If duplicate listeners were registered, we'd see 4.
      expect(upsertCount).toBe(2);

      service.stopEntitySync();
    });

    it("stopEntitySync removes the listener", async () => {
      const upsertCalls: string[] = [];
      const mockVS: VectorStore = {
        search: async () => [],
        upsert: async id => {
          upsertCalls.push(id);
          return `mem-${id}`;
        },
      };

      const service = new KnowledgeService(queryService, store, mockVS);
      service.startEntitySync();
      service.stopEntitySync();

      store.createEntity(makeEntityInput({ name: "AfterStop" }));

      // Give async a chance to fire (it shouldn't)
      await new Promise(r => setTimeout(r, 50));

      expect(upsertCalls).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// Feature: knowledge-graph, Property 14: 统一检索模式行为
// Validates: Requirements 5.1
// ---------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 14: 统一检索模式行为", () => {
  const PBT_PROJECT = "test-project-ks-pbt";

  function pbtGraphFilePath(): string {
    return path.join(DATA_DIR, `graph-${PBT_PROJECT}.json`);
  }

  function pbtCleanup(): void {
    try {
      const fp = pbtGraphFilePath();
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Generators
  // -------------------------------------------------------------------------

  /** Generate 1-5 entity names (non-empty alphanumeric strings) */
  const entityNamesArb = fc.array(
    fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,19}$/),
    { minLength: 1, maxLength: 5 }
  );

  /** Generate 1-5 vector search hits with scores in [0, 1] */
  const vectorHitsArb = fc.array(
    fc.record({
      id: fc.stringMatching(/^v-[a-z0-9]{1,8}$/),
      content: fc.string({ minLength: 1, maxLength: 80 }),
      score: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { minLength: 1, maxLength: 5 }
  );

  /** Generate a query mode */
  const modeArb = fc.constantFrom(
    "preferStructured" as const,
    "preferSemantic" as const,
    "balanced" as const
  );

  // -------------------------------------------------------------------------
  // Property: preferStructured ranks structured higher than semantic
  // -------------------------------------------------------------------------

  it("preferStructured: structured results appear before semantic results in mergedSummary", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityNamesArb,
        vectorHitsArb,
        async (entityNames, vectorHits) => {
          pbtCleanup();
          const store = new GraphStore();
          const registry = new OntologyRegistry();
          const queryService = new KnowledgeGraphQuery(store, registry);

          // Seed graph with entities
          for (const name of entityNames) {
            store.createEntity({
              entityType: "CodeModule",
              name,
              description: `Desc for ${name}`,
              source: "code_analysis",
              confidence: 0.8,
              projectId: PBT_PROJECT,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
          }

          const mockVS: VectorStore = {
            search: async () => vectorHits,
          };

          const service = new KnowledgeService(queryService, store, mockVS);
          const result = await service.query("test", PBT_PROJECT, {
            mode: "preferStructured",
          });

          // Structured results should be present
          expect(
            result.structuredResults.entities.length
          ).toBeGreaterThanOrEqual(1);
          // Semantic results should be present
          expect(result.semanticResults.length).toBeGreaterThanOrEqual(1);

          // In mergedSummary, graph section (Primary) must appear before semantic section (Supplementary)
          const graphIdx = result.mergedSummary.indexOf(
            "Knowledge Graph Results — Primary"
          );
          const semanticIdx = result.mergedSummary.indexOf(
            "Semantic Search Results — Supplementary"
          );
          expect(graphIdx).toBeGreaterThanOrEqual(0);
          expect(semanticIdx).toBeGreaterThanOrEqual(0);
          expect(graphIdx).toBeLessThan(semanticIdx);

          store.forceSave();
          pbtCleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Property: preferSemantic ranks semantic higher than structured
  // -------------------------------------------------------------------------

  it("preferSemantic: semantic results appear before structured results in mergedSummary", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityNamesArb,
        vectorHitsArb,
        async (entityNames, vectorHits) => {
          pbtCleanup();
          const store = new GraphStore();
          const registry = new OntologyRegistry();
          const queryService = new KnowledgeGraphQuery(store, registry);

          for (const name of entityNames) {
            store.createEntity({
              entityType: "CodeModule",
              name,
              description: `Desc for ${name}`,
              source: "code_analysis",
              confidence: 0.8,
              projectId: PBT_PROJECT,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
          }

          const mockVS: VectorStore = {
            search: async () => vectorHits,
          };

          const service = new KnowledgeService(queryService, store, mockVS);
          const result = await service.query("test", PBT_PROJECT, {
            mode: "preferSemantic",
          });

          expect(
            result.structuredResults.entities.length
          ).toBeGreaterThanOrEqual(1);
          expect(result.semanticResults.length).toBeGreaterThanOrEqual(1);

          // In mergedSummary, semantic section (Primary) must appear before graph section (Supplementary)
          const semanticIdx = result.mergedSummary.indexOf(
            "Semantic Search Results — Primary"
          );
          const graphIdx = result.mergedSummary.indexOf(
            "Knowledge Graph Results — Supplementary"
          );
          expect(semanticIdx).toBeGreaterThanOrEqual(0);
          expect(graphIdx).toBeGreaterThanOrEqual(0);
          expect(semanticIdx).toBeLessThan(graphIdx);

          store.forceSave();
          pbtCleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Property: balanced mode mixes results by relevance (no Primary/Supplementary)
  // -------------------------------------------------------------------------

  it("balanced: results are mixed without priority labels", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityNamesArb,
        vectorHitsArb,
        async (entityNames, vectorHits) => {
          pbtCleanup();
          const store = new GraphStore();
          const registry = new OntologyRegistry();
          const queryService = new KnowledgeGraphQuery(store, registry);

          for (const name of entityNames) {
            store.createEntity({
              entityType: "CodeModule",
              name,
              description: `Desc for ${name}`,
              source: "code_analysis",
              confidence: 0.8,
              projectId: PBT_PROJECT,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
          }

          const mockVS: VectorStore = {
            search: async () => vectorHits,
          };

          const service = new KnowledgeService(queryService, store, mockVS);
          const result = await service.query("test", PBT_PROJECT, {
            mode: "balanced",
          });

          expect(
            result.structuredResults.entities.length
          ).toBeGreaterThanOrEqual(1);
          expect(result.semanticResults.length).toBeGreaterThanOrEqual(1);

          // Balanced mode: both sections present without Primary/Supplementary labels
          expect(result.mergedSummary).toContain("[Knowledge Graph Results]");
          expect(result.mergedSummary).toContain("[Semantic Search Results]");
          expect(result.mergedSummary).not.toContain("Primary");
          expect(result.mergedSummary).not.toContain("Supplementary");

          store.forceSave();
          pbtCleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Property: mode parameter consistently determines ranking across all modes
  // -------------------------------------------------------------------------

  it("mode parameter consistently determines the ranking strategy for any input", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityNamesArb,
        vectorHitsArb,
        modeArb,
        async (entityNames, vectorHits, mode) => {
          pbtCleanup();
          const store = new GraphStore();
          const registry = new OntologyRegistry();
          const queryService = new KnowledgeGraphQuery(store, registry);

          for (const name of entityNames) {
            store.createEntity({
              entityType: "CodeModule",
              name,
              description: `Desc for ${name}`,
              source: "code_analysis",
              confidence: 0.8,
              projectId: PBT_PROJECT,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
          }

          const mockVS: VectorStore = {
            search: async () => vectorHits,
          };

          const service = new KnowledgeService(queryService, store, mockVS);
          const result = await service.query("test", PBT_PROJECT, { mode });

          // Both result types should always be populated
          expect(
            result.structuredResults.entities.length
          ).toBeGreaterThanOrEqual(1);
          expect(result.semanticResults.length).toBeGreaterThanOrEqual(1);
          expect(result.mergedSummary.length).toBeGreaterThan(0);

          switch (mode) {
            case "preferStructured": {
              // Graph ranked higher (Primary), semantic is Supplementary
              expect(result.mergedSummary).toContain("Primary");
              expect(result.mergedSummary).toContain(
                "Knowledge Graph Results — Primary"
              );
              const gIdx = result.mergedSummary.indexOf(
                "Knowledge Graph Results — Primary"
              );
              const sIdx = result.mergedSummary.indexOf(
                "Semantic Search Results — Supplementary"
              );
              expect(gIdx).toBeLessThan(sIdx);
              break;
            }
            case "preferSemantic": {
              // Semantic ranked higher (Primary), graph is Supplementary
              expect(result.mergedSummary).toContain("Primary");
              expect(result.mergedSummary).toContain(
                "Semantic Search Results — Primary"
              );
              const sIdx = result.mergedSummary.indexOf(
                "Semantic Search Results — Primary"
              );
              const gIdx = result.mergedSummary.indexOf(
                "Knowledge Graph Results — Supplementary"
              );
              expect(sIdx).toBeLessThan(gIdx);
              break;
            }
            case "balanced": {
              // Mixed by relevance — no priority labels
              expect(result.mergedSummary).not.toContain("Primary");
              expect(result.mergedSummary).not.toContain("Supplementary");
              expect(result.mergedSummary).toContain(
                "[Knowledge Graph Results]"
              );
              expect(result.mergedSummary).toContain(
                "[Semantic Search Results]"
              );
              break;
            }
          }

          store.forceSave();
          pbtCleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// Feature: knowledge-graph, Property 15: 图谱到向量同步双向链接
// Validates: Requirements 5.4
// ---------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 15: 图谱到向量同步双向链接", () => {
  const PBT_PROJECT = "test-project-sync-pbt";

  function syncPbtGraphFilePath(): string {
    return path.join(DATA_DIR, `graph-${PBT_PROJECT}.json`);
  }

  function syncPbtCleanup(): void {
    try {
      const fp = syncPbtGraphFilePath();
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Generators
  // -------------------------------------------------------------------------

  /** Generate a valid entity name (alphanumeric, starts with letter) */
  const entityNameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,19}$/);

  /** Generate a valid entity type from the core types */
  const entityTypeArb = fc.constantFrom(
    "CodeModule",
    "API",
    "BusinessRule",
    "ArchitectureDecision",
    "TechStack",
    "Agent",
    "Role",
    "Mission",
    "Bug",
    "Config"
  );

  /** Generate a valid source */
  const sourceArb = fc.constantFrom(
    "agent_extracted" as const,
    "user_defined" as const,
    "code_analysis" as const,
    "llm_inferred" as const
  );

  /** Generate a confidence value in [0.0, 1.0] */
  const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

  /** Generate a description string */
  const descriptionArb = fc.string({ minLength: 0, maxLength: 60 });

  /** Generate a unique memory ID prefix to simulate vector store behavior */
  const memoryPrefixArb = fc.stringMatching(/^mem-[a-z0-9]{1,8}$/);

  // -------------------------------------------------------------------------
  // Property: After syncEntityToVectorStore, bidirectional links are established
  // -------------------------------------------------------------------------

  it("after sync, entity.linkedMemoryIds contains the vector memory ID and upsert metadata carries linkedEntityId", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityNameArb,
        entityTypeArb,
        sourceArb,
        confidenceArb,
        descriptionArb,
        memoryPrefixArb,
        async (
          name,
          entityType,
          source,
          confidence,
          description,
          memoryPrefix
        ) => {
          syncPbtCleanup();
          const store = new GraphStore();

          // Create entity in graph
          const entity = store.createEntity({
            entityType,
            name,
            description,
            source,
            confidence,
            projectId: PBT_PROJECT,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });

          // Track what the vector store receives
          let capturedMetadata: Record<string, unknown> | null = null;
          const returnedMemoryId = `${memoryPrefix}-${entity.entityId}`;

          const mockVS: VectorStore = {
            search: async () => [],
            upsert: async (_id, _content, metadata) => {
              capturedMetadata = metadata;
              return returnedMemoryId;
            },
          };

          const registry = new OntologyRegistry();
          const queryService = new KnowledgeGraphQuery(store, registry);
          const service = new KnowledgeService(queryService, store, mockVS);

          await service.syncEntityToVectorStore(entity);

          // --- Verify direction 1: entity → vector store ---
          // The entity's linkedMemoryIds should contain the returned memory ID
          const updatedEntity = store.getEntity(entity.entityId);
          expect(updatedEntity).toBeDefined();
          expect(updatedEntity!.linkedMemoryIds).toContain(returnedMemoryId);

          // --- Verify direction 2: vector store → entity ---
          // The upsert metadata should carry linkedEntityId referencing the entity
          expect(capturedMetadata).not.toBeNull();
          expect(capturedMetadata!.linkedEntityId).toBe(entity.entityId);

          store.forceSave();
          syncPbtCleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
