import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { GraphStore } from "../knowledge/graph-store.js";
import { OntologyRegistry } from "../knowledge/ontology-registry.js";
import { KnowledgeGraphQuery } from "../knowledge/query-service.js";
import type { Entity, Relation } from "../../shared/knowledge/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

const TEST_PROJECT = "test-project-query";
const OTHER_PROJECT = "other-project";

function graphFilePath(projectId: string): string {
  return path.join(DATA_DIR, `graph-${projectId}.json`);
}

function cleanup(): void {
  for (const pid of [TEST_PROJECT, OTHER_PROJECT]) {
    try {
      const fp = graphFilePath(pid);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }
}

function makeEntityInput(
  overrides: Partial<Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">> = {},
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

function makeRelationInput(
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Partial<Omit<Relation, "relationId" | "createdAt">> = {},
) {
  return {
    relationType: "DEPENDS_ON",
    sourceEntityId,
    targetEntityId,
    weight: 0.9,
    evidence: "import statement",
    source: "code_analysis" as const,
    confidence: 0.85,
    needsReview: false,
    ...overrides,
  };
}

describe("KnowledgeGraphQuery", () => {
  let store: GraphStore;
  let registry: OntologyRegistry;
  let query: KnowledgeGraphQuery;

  beforeEach(() => {
    cleanup();
    store = new GraphStore();
    registry = new OntologyRegistry();
    query = new KnowledgeGraphQuery(store, registry);
  });

  afterEach(() => {
    store.forceSave();
    cleanup();
  });

  // -------------------------------------------------------------------------
  // findEntities — confidence 降序排序 (Req 4.4)
  // -------------------------------------------------------------------------

  describe("findEntities", () => {
    it("returns results sorted by confidence descending", async () => {
      store.createEntity(makeEntityInput({ name: "Low", confidence: 0.3 }));
      store.createEntity(makeEntityInput({ name: "High", confidence: 0.95 }));
      store.createEntity(makeEntityInput({ name: "Mid", confidence: 0.6 }));

      const results = await query.findEntities({ projectId: TEST_PROJECT });

      expect(results).toHaveLength(3);
      expect(results[0].name).toBe("High");
      expect(results[1].name).toBe("Mid");
      expect(results[2].name).toBe("Low");

      // Verify monotonically decreasing confidence
      for (let i = 1; i < results.length; i++) {
        expect(results[i].confidence).toBeLessThanOrEqual(results[i - 1].confidence);
      }
    });
  });

  // -------------------------------------------------------------------------
  // contextSummary — 低置信度标注 (Req 4.4)
  // -------------------------------------------------------------------------

  describe("contextSummary low-confidence annotation", () => {
    it("annotates entities with confidence < 0.5 as [low confidence]", async () => {
      const e1 = store.createEntity(makeEntityInput({ name: "Solid", confidence: 0.9 }));
      const e2 = store.createEntity(makeEntityInput({ name: "Shaky", confidence: 0.3 }));
      store.createRelation(makeRelationInput(e1.entityId, e2.entityId));

      const result = await query.getNeighbors(e1.entityId, [], 1);

      expect(result.contextSummary).toContain("Shaky");
      expect(result.contextSummary).toContain("[low confidence]");
      // High-confidence entity should NOT have the annotation
      expect(result.contextSummary).not.toMatch(/Solid.*\[low confidence\]/);
    });

    it("does not annotate entities with confidence >= 0.5", async () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A", confidence: 0.9 }));
      const e2 = store.createEntity(makeEntityInput({ name: "B", confidence: 0.5 }));
      store.createRelation(makeRelationInput(e1.entityId, e2.entityId));

      const result = await query.getNeighbors(e1.entityId, [], 1);

      expect(result.contextSummary).not.toContain("[low confidence]");
    });
  });

  // -------------------------------------------------------------------------
  // getNeighbors (Req 4.1)
  // -------------------------------------------------------------------------

  describe("getNeighbors", () => {
    it("returns correct QueryResult with entities, relations, and contextSummary", async () => {
      const center = store.createEntity(makeEntityInput({ name: "Center" }));
      const neighbor = store.createEntity(makeEntityInput({ name: "Neighbor" }));
      store.createRelation(makeRelationInput(center.entityId, neighbor.entityId));

      const result = await query.getNeighbors(center.entityId, [], 1);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("Neighbor");
      expect(result.relations).toHaveLength(1);
      expect(result.isPartial).toBe(false);
      expect(result.contextSummary).toContain("Neighbor");
    });

    it("respects depth parameter", async () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, c.entityId));

      // depth=1 should only reach B
      const depth1 = await query.getNeighbors(a.entityId, [], 1);
      expect(depth1.entities).toHaveLength(1);
      expect(depth1.entities[0].name).toBe("B");

      // depth=2 should reach B and C
      const depth2 = await query.getNeighbors(a.entityId, [], 2);
      expect(depth2.entities).toHaveLength(2);
      const names = depth2.entities.map((e) => e.name).sort();
      expect(names).toEqual(["B", "C"]);
    });
  });

  // -------------------------------------------------------------------------
  // findPath (Req 4.1)
  // -------------------------------------------------------------------------

  describe("findPath", () => {
    it("returns correct QueryResult for existing path", async () => {
      const a = store.createEntity(makeEntityInput({ name: "Start" }));
      const b = store.createEntity(makeEntityInput({ name: "Middle" }));
      const c = store.createEntity(makeEntityInput({ name: "End" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, c.entityId));

      const result = await query.findPath(a.entityId, c.entityId);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      expect(result.relations.length).toBeGreaterThanOrEqual(1);
      expect(result.isPartial).toBe(false);
      expect(result.contextSummary).toBeTruthy();
    });

    it("returns empty result with message when no path exists", async () => {
      const a = store.createEntity(makeEntityInput({ name: "Isolated1" }));
      const b = store.createEntity(makeEntityInput({ name: "Isolated2" }));

      const result = await query.findPath(a.entityId, b.entityId);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
      expect(result.contextSummary).toContain("No path found");
    });
  });

  // -------------------------------------------------------------------------
  // subgraph (Req 4.1)
  // -------------------------------------------------------------------------

  describe("subgraph", () => {
    it("returns correct QueryResult with entities and inter-relations", async () => {
      const a = store.createEntity(makeEntityInput({ name: "NodeA" }));
      const b = store.createEntity(makeEntityInput({ name: "NodeB" }));
      const c = store.createEntity(makeEntityInput({ name: "NodeC" }));
      const relAB = store.createRelation(makeRelationInput(a.entityId, b.entityId));
      const relBC = store.createRelation(makeRelationInput(b.entityId, c.entityId));

      const result = await query.subgraph([a.entityId, b.entityId, c.entityId]);

      expect(result.entities).toHaveLength(3);
      expect(result.relations).toHaveLength(2);
      expect(result.isPartial).toBe(false);
      expect(result.contextSummary).toContain("3 entities");
    });

    it("only includes relations between requested entities", async () => {
      const a = store.createEntity(makeEntityInput({ name: "In1" }));
      const b = store.createEntity(makeEntityInput({ name: "In2" }));
      const outside = store.createEntity(makeEntityInput({ name: "Outside" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, outside.entityId));

      const result = await query.subgraph([a.entityId, b.entityId]);

      expect(result.entities).toHaveLength(2);
      // Only the A→B relation should be included, not B→Outside
      expect(result.relations).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 项目隔离 (Req 4.5)
  // -------------------------------------------------------------------------

  describe("project isolation", () => {
    it("findEntities only returns entities from the requested project", async () => {
      store.createEntity(makeEntityInput({ name: "Mine", projectId: TEST_PROJECT }));
      store.createEntity(makeEntityInput({ name: "Theirs", projectId: OTHER_PROJECT }));

      const results = await query.findEntities({ projectId: TEST_PROJECT });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Mine");
    });

    it("getNeighbors filters out entities from other projects", async () => {
      const center = store.createEntity(makeEntityInput({ name: "Center", projectId: TEST_PROJECT }));
      const sameProject = store.createEntity(makeEntityInput({ name: "Same", projectId: TEST_PROJECT }));
      const otherProject = store.createEntity(makeEntityInput({ name: "Other", projectId: OTHER_PROJECT }));

      store.createRelation(makeRelationInput(center.entityId, sameProject.entityId));
      store.createRelation(makeRelationInput(center.entityId, otherProject.entityId));

      const result = await query.getNeighbors(center.entityId, [], 1);

      // Only the same-project neighbor should appear
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("Same");
    });

    it("subgraph filters out entities from other projects", async () => {
      const a = store.createEntity(makeEntityInput({ name: "A", projectId: TEST_PROJECT }));
      const b = store.createEntity(makeEntityInput({ name: "B", projectId: OTHER_PROJECT }));

      const result = await query.subgraph([a.entityId, b.entityId]);

      // Only entity A (same project as first entity) should remain
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("A");
    });
  });

  // -------------------------------------------------------------------------
  // naturalLanguageQuery (Req 4.2, 4.3)
  // -------------------------------------------------------------------------

  describe("naturalLanguageQuery", () => {
    it("returns correct results when LLM translates successfully", async () => {
      // Seed some entities
      store.createEntity(makeEntityInput({ name: "AuthService", entityType: "CodeModule", confidence: 0.9 }));
      store.createEntity(makeEntityInput({ name: "PaymentAPI", entityType: "API", confidence: 0.85 }));

      // Mock LLM that returns a structured query targeting CodeModule
      const mockLLM = {
        generate: async (_prompt: string) =>
          JSON.stringify({ entityType: "CodeModule", name: null, confidenceMin: 0.0 }),
      };
      query.llmProvider = mockLLM;

      const result = await query.naturalLanguageQuery("What code modules exist?", TEST_PROJECT);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("AuthService");
      expect(result.entities[0].entityType).toBe("CodeModule");
      expect(result.isPartial).toBe(false);
      expect(result.contextSummary).toContain("AuthService");
    });

    it("returns empty result with message when no LLM provider is set", async () => {
      // query has no llmProvider by default in this test suite
      const result = await query.naturalLanguageQuery("What modules exist?", TEST_PROJECT);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
      expect(result.isPartial).toBe(false);
      expect(result.contextSummary).toContain("Natural language query requires LLM provider");
    });

    it("handles LLM failure gracefully and returns fallback result", async () => {
      store.createEntity(makeEntityInput({ name: "SomeModule" }));

      const mockLLM = {
        generate: async (_prompt: string): Promise<string> => {
          throw new Error("LLM service unavailable");
        },
      };
      query.llmProvider = mockLLM;

      const result = await query.naturalLanguageQuery("Find all modules", TEST_PROJECT);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
      expect(result.isPartial).toBe(false);
      expect(result.contextSummary).toContain("LLM translation failed");
    });

    it("handles LLM returning unparseable response gracefully", async () => {
      const mockLLM = {
        generate: async (_prompt: string) => "Sorry, I cannot help with that.",
      };
      query.llmProvider = mockLLM;

      const result = await query.naturalLanguageQuery("What is the architecture?", TEST_PROJECT);

      expect(result.entities).toHaveLength(0);
      expect(result.contextSummary).toContain("LLM translation failed");
    });

    it("uses name filter from LLM response for fuzzy matching", async () => {
      store.createEntity(makeEntityInput({ name: "UserService", entityType: "CodeModule" }));
      store.createEntity(makeEntityInput({ name: "PaymentService", entityType: "CodeModule" }));

      const mockLLM = {
        generate: async (_prompt: string) =>
          JSON.stringify({ entityType: "CodeModule", name: "User", confidenceMin: 0.0 }),
      };
      query.llmProvider = mockLLM;

      const result = await query.naturalLanguageQuery("Tell me about the user service", TEST_PROJECT);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("UserService");
    });
  });

  // -------------------------------------------------------------------------
  // findArchitectureDecisions — 版本链查询 (Req 6.4)
  // -------------------------------------------------------------------------

  describe("findArchitectureDecisions", () => {
    function makeDecision(name: string, overrides: Record<string, unknown> = {}) {
      return makeEntityInput({
        entityType: "ArchitectureDecision",
        name,
        confidence: 0.9,
        extendedAttributes: {
          context: "ctx",
          decision: "dec",
          alternatives: [],
          consequences: "cons",
        },
        ...overrides,
      });
    }

    it("default query returns only latest (non-superseded) decisions", async () => {
      // Create a chain: D3 supersedes D2, D2 supersedes D1
      const d1 = store.createEntity(makeDecision("Decision-v1"));
      const d2 = store.createEntity(makeDecision("Decision-v2"));
      const d3 = store.createEntity(makeDecision("Decision-v3"));

      // SUPERSEDES: new → old
      store.createRelation(makeRelationInput(d2.entityId, d1.entityId, { relationType: "SUPERSEDES" }));
      store.createRelation(makeRelationInput(d3.entityId, d2.entityId, { relationType: "SUPERSEDES" }));

      const result = await query.findArchitectureDecisions(TEST_PROJECT);

      // Only D3 (latest, not superseded by anything) should be returned
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("Decision-v3");
      expect(result.relations).toHaveLength(0);
      expect(result.isPartial).toBe(false);
    });

    it("includeHistory: true returns full chain ordered by createdAt", async () => {
      // Create decisions with explicit createdAt ordering
      const d1 = store.createEntity(makeDecision("Decision-v1"));
      // Small delay to ensure different createdAt timestamps
      const d2 = store.createEntity(makeDecision("Decision-v2"));
      const d3 = store.createEntity(makeDecision("Decision-v3"));

      store.createRelation(makeRelationInput(d2.entityId, d1.entityId, { relationType: "SUPERSEDES" }));
      store.createRelation(makeRelationInput(d3.entityId, d2.entityId, { relationType: "SUPERSEDES" }));

      const result = await query.findArchitectureDecisions(TEST_PROJECT, { includeHistory: true });

      // All 3 decisions returned, ordered by createdAt ascending
      expect(result.entities).toHaveLength(3);
      expect(result.entities[0].name).toBe("Decision-v1");
      expect(result.entities[1].name).toBe("Decision-v2");
      expect(result.entities[2].name).toBe("Decision-v3");

      // SUPERSEDES relations included
      expect(result.relations).toHaveLength(2);
      expect(result.isPartial).toBe(false);
    });

    it("single decision with no chain is returned in both modes", async () => {
      store.createEntity(makeDecision("Standalone-Decision"));

      // Default mode
      const defaultResult = await query.findArchitectureDecisions(TEST_PROJECT);
      expect(defaultResult.entities).toHaveLength(1);
      expect(defaultResult.entities[0].name).toBe("Standalone-Decision");

      // History mode
      const historyResult = await query.findArchitectureDecisions(TEST_PROJECT, { includeHistory: true });
      expect(historyResult.entities).toHaveLength(1);
      expect(historyResult.entities[0].name).toBe("Standalone-Decision");
    });

    it("returns empty result when no decisions exist", async () => {
      const result = await query.findArchitectureDecisions(TEST_PROJECT);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
      expect(result.contextSummary).toContain("No architecture decisions found");
    });

    it("contextSummary lists the returned decisions", async () => {
      store.createEntity(makeDecision("Use-PostgreSQL"));

      const result = await query.findArchitectureDecisions(TEST_PROJECT);

      expect(result.contextSummary).toContain("Use-PostgreSQL");
    });
  });
});
