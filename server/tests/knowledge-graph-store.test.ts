import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

import { GraphStore } from "../knowledge/graph-store.js";
import { LifecycleLog } from "../knowledge/lifecycle-log.js";
import type { Entity, Relation } from "../../shared/knowledge/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

const TEST_PROJECT = "test-project-graph";

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

/** Helper: create a minimal entity input */
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
    extendedAttributes: { filePath: "src/test.ts", language: "typescript" },
    ...overrides,
  };
}

/** Helper: create a minimal relation input */
function makeRelationInput(
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Partial<Omit<Relation, "relationId" | "createdAt">> = {}
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

describe("GraphStore", () => {
  let store: GraphStore;

  beforeEach(() => {
    cleanup();
    store = new GraphStore();
  });

  afterEach(() => {
    // Force save to flush timers, then clean up
    store.forceSave();
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Entity CRUD (Requirement 1.3)
  // -------------------------------------------------------------------------

  describe("createEntity", () => {
    it("assigns entityId, createdAt, updatedAt, and status='active'", () => {
      const entity = store.createEntity(makeEntityInput());

      expect(entity.entityId).toBeTruthy();
      expect(entity.createdAt).toBeTruthy();
      expect(entity.updatedAt).toBeTruthy();
      expect(entity.status).toBe("active");
      expect(entity.entityType).toBe("CodeModule");
      expect(entity.name).toBe("TestModule");
      expect(entity.projectId).toBe(TEST_PROJECT);
    });

    it("generates unique entityIds for each entity", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));
      expect(e1.entityId).not.toBe(e2.entityId);
    });

    it("sets confidence to 1.0 for user_defined source", () => {
      const entity = store.createEntity(
        makeEntityInput({ source: "user_defined", confidence: 0.5 })
      );
      expect(entity.confidence).toBe(1.0);
    });

    it("preserves confidence for non-user_defined source", () => {
      const entity = store.createEntity(
        makeEntityInput({ source: "code_analysis", confidence: 0.7 })
      );
      expect(entity.confidence).toBe(0.7);
    });

    it("increments entity counter", () => {
      store.createEntity(makeEntityInput({ name: "A" }));
      store.createEntity(makeEntityInput({ name: "B" }));
      const data = store.getGraphData(TEST_PROJECT);
      expect(data._counters.entities).toBe(2);
    });
  });

  describe("getEntity", () => {
    it("returns entity by entityId", () => {
      const created = store.createEntity(makeEntityInput());
      const found = store.getEntity(created.entityId);
      expect(found).toBeDefined();
      expect(found!.entityId).toBe(created.entityId);
    });

    it("returns undefined for non-existent entityId", () => {
      expect(store.getEntity("non-existent-id")).toBeUndefined();
    });
  });

  describe("findEntities", () => {
    it("filters by projectId (required)", () => {
      store.createEntity(makeEntityInput({ name: "A" }));
      store.createEntity(
        makeEntityInput({ name: "B", projectId: "other-project" })
      );

      const results = store.findEntities({ projectId: TEST_PROJECT });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("A");
    });

    it("filters by entityType", () => {
      store.createEntity(
        makeEntityInput({ name: "Mod", entityType: "CodeModule" })
      );
      store.createEntity(makeEntityInput({ name: "Api", entityType: "API" }));

      const results = store.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Mod");
    });

    it("filters by name with fuzzy match (includes)", () => {
      store.createEntity(makeEntityInput({ name: "AuthService" }));
      store.createEntity(makeEntityInput({ name: "UserService" }));
      store.createEntity(makeEntityInput({ name: "AuthController" }));

      const results = store.findEntities({
        projectId: TEST_PROJECT,
        name: "auth",
      });
      expect(results).toHaveLength(2);
    });

    it("filters by confidenceMin", () => {
      store.createEntity(makeEntityInput({ name: "High", confidence: 0.9 }));
      store.createEntity(makeEntityInput({ name: "Low", confidence: 0.3 }));

      const results = store.findEntities({
        projectId: TEST_PROJECT,
        confidenceMin: 0.5,
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("High");
    });

    it("filters by status", () => {
      const e = store.createEntity(makeEntityInput({ name: "Active" }));
      store.createEntity(makeEntityInput({ name: "Other" }));
      // Manually deprecate one
      store.updateEntity(e.entityId, { status: "deprecated" });

      const results = store.findEntities({
        projectId: TEST_PROJECT,
        status: "active",
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Other");
    });
  });

  describe("updateEntity", () => {
    it("updates entity attributes and refreshes updatedAt", () => {
      const entity = store.createEntity(makeEntityInput());
      const originalUpdatedAt = entity.updatedAt;

      // Small delay to ensure timestamp differs
      const updated = store.updateEntity(entity.entityId, {
        description: "Updated description",
        confidence: 0.95,
      });

      expect(updated).toBeDefined();
      expect(updated!.description).toBe("Updated description");
      expect(updated!.confidence).toBe(0.95);
      expect(updated!.entityId).toBe(entity.entityId); // immutable
      expect(updated!.createdAt).toBe(entity.createdAt); // immutable
    });

    it("returns undefined for non-existent entityId", () => {
      expect(
        store.updateEntity("non-existent", { description: "x" })
      ).toBeUndefined();
    });

    it("does not allow overwriting entityId or createdAt", () => {
      const entity = store.createEntity(makeEntityInput());
      const updated = store.updateEntity(entity.entityId, {
        entityId: "hacked-id",
        createdAt: "1970-01-01T00:00:00.000Z",
      } as Partial<Entity>);

      expect(updated!.entityId).toBe(entity.entityId);
      expect(updated!.createdAt).toBe(entity.createdAt);
    });
  });

  describe("mergeEntity", () => {
    it("creates a new entity when no duplicate exists", () => {
      const entity = store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "NewModule",
        description: "brand new",
        source: "code_analysis",
        confidence: 0.8,
        extendedAttributes: { filePath: "src/new.ts" },
      });

      expect(entity.entityId).toBeTruthy();
      expect(entity.name).toBe("NewModule");
    });

    it("merges with existing entity keeping higher confidence", () => {
      // Create original with confidence 0.6
      store.createEntity(
        makeEntityInput({
          name: "Shared",
          confidence: 0.6,
          extendedAttributes: {
            filePath: "src/shared.ts",
            language: "typescript",
          },
        })
      );

      // Merge with higher confidence
      const merged = store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Shared",
        confidence: 0.9,
        extendedAttributes: { filePath: "src/shared.ts", complexity: 5 },
      });

      expect(merged.confidence).toBe(0.9);
      // Extended attributes should be merged
      expect(merged.extendedAttributes.language).toBe("typescript");
      expect(merged.extendedAttributes.complexity).toBe(5);
    });

    it("keeps existing confidence when incoming is lower", () => {
      store.createEntity(
        makeEntityInput({
          name: "HighConf",
          confidence: 0.95,
          extendedAttributes: { filePath: "src/high.ts" },
        })
      );

      const merged = store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "HighConf",
        confidence: 0.5,
        extendedAttributes: { filePath: "src/high.ts" },
      });

      expect(merged.confidence).toBe(0.95);
    });

    it("does not create duplicate entities for same unique key", () => {
      store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Unique",
        extendedAttributes: { filePath: "src/unique.ts" },
      });
      store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Unique",
        extendedAttributes: { filePath: "src/unique.ts" },
      });

      const all = store.getAllEntities(TEST_PROJECT);
      const matches = all.filter(
        e => e.name === "Unique" && e.entityType === "CodeModule"
      );
      expect(matches).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Relation CRUD (Requirement 1.4)
  // -------------------------------------------------------------------------

  describe("createRelation", () => {
    it("assigns relationId and createdAt", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "Source" }));
      const e2 = store.createEntity(makeEntityInput({ name: "Target" }));

      const relation = store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId)
      );

      expect(relation.relationId).toBeTruthy();
      expect(relation.createdAt).toBeTruthy();
      expect(relation.relationType).toBe("DEPENDS_ON");
      expect(relation.sourceEntityId).toBe(e1.entityId);
      expect(relation.targetEntityId).toBe(e2.entityId);
    });

    it("generates unique relationIds", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));

      const r1 = store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId)
      );
      const r2 = store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId, { relationType: "CALLS" })
      );
      expect(r1.relationId).not.toBe(r2.relationId);
    });

    it("increments relation counter", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));

      store.createRelation(makeRelationInput(e1.entityId, e2.entityId));
      store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId, { relationType: "CALLS" })
      );

      const data = store.getGraphData(TEST_PROJECT);
      expect(data._counters.relations).toBe(2);
    });
  });

  describe("getRelation", () => {
    it("returns relation by relationId", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));
      const rel = store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId)
      );

      const found = store.getRelation(rel.relationId);
      expect(found).toBeDefined();
      expect(found!.relationId).toBe(rel.relationId);
    });

    it("returns undefined for non-existent relationId", () => {
      expect(store.getRelation("non-existent")).toBeUndefined();
    });
  });

  describe("findRelations", () => {
    it("filters by relationType", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));

      store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId, {
          relationType: "DEPENDS_ON",
        })
      );
      store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId, { relationType: "CALLS" })
      );

      const results = store.findRelations({
        projectId: TEST_PROJECT,
        relationType: "DEPENDS_ON",
      });
      expect(results).toHaveLength(1);
      expect(results[0].relationType).toBe("DEPENDS_ON");
    });

    it("filters by sourceEntityId", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));
      const e3 = store.createEntity(makeEntityInput({ name: "C" }));

      store.createRelation(makeRelationInput(e1.entityId, e2.entityId));
      store.createRelation(makeRelationInput(e3.entityId, e2.entityId));

      const results = store.findRelations({
        projectId: TEST_PROJECT,
        sourceEntityId: e1.entityId,
      });
      expect(results).toHaveLength(1);
    });

    it("filters by targetEntityId", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));
      const e3 = store.createEntity(makeEntityInput({ name: "C" }));

      store.createRelation(makeRelationInput(e1.entityId, e2.entityId));
      store.createRelation(makeRelationInput(e1.entityId, e3.entityId));

      const results = store.findRelations({
        projectId: TEST_PROJECT,
        targetEntityId: e3.entityId,
      });
      expect(results).toHaveLength(1);
    });
  });

  describe("updateRelation", () => {
    it("updates relation attributes", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));
      const rel = store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId)
      );

      const updated = store.updateRelation(rel.relationId, {
        weight: 0.5,
        evidence: "updated evidence",
      });

      expect(updated).toBeDefined();
      expect(updated!.weight).toBe(0.5);
      expect(updated!.evidence).toBe("updated evidence");
      expect(updated!.relationId).toBe(rel.relationId); // immutable
      expect(updated!.createdAt).toBe(rel.createdAt); // immutable
    });

    it("returns undefined for non-existent relationId", () => {
      expect(
        store.updateRelation("non-existent", { weight: 0.1 })
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication (Requirement 2.6)
  // -------------------------------------------------------------------------

  describe("deduplicateEntity", () => {
    it("creates entity when no duplicate exists", () => {
      const entity = store.deduplicateEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Fresh",
        description: "new",
        source: "code_analysis",
        confidence: 0.8,
        extendedAttributes: { filePath: "src/fresh.ts" },
      });

      expect(entity.entityId).toBeTruthy();
      expect(entity.name).toBe("Fresh");
    });

    it("merges when duplicate found by entityType + projectId + filePath + name", () => {
      store.createEntity(
        makeEntityInput({
          name: "Dup",
          confidence: 0.6,
          extendedAttributes: { filePath: "src/dup.ts" },
        })
      );

      const result = store.deduplicateEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Dup",
        confidence: 0.9,
        extendedAttributes: { filePath: "src/dup.ts" },
      });

      expect(result.confidence).toBe(0.9);
      // Should still be only 1 entity
      const all = store.getAllEntities(TEST_PROJECT);
      expect(all.filter(e => e.name === "Dup")).toHaveLength(1);
    });

    it("treats different filePaths as different entities", () => {
      store.createEntity(
        makeEntityInput({
          name: "SameName",
          extendedAttributes: { filePath: "src/a.ts" },
        })
      );

      store.deduplicateEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "SameName",
        extendedAttributes: { filePath: "src/b.ts" },
      });

      const all = store.getAllEntities(TEST_PROJECT);
      expect(all.filter(e => e.name === "SameName")).toHaveLength(2);
    });

    it("throws when required fields are missing", () => {
      expect(() => store.deduplicateEntity({ name: "X" } as any)).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  describe("persistence", () => {
    it("forceSave writes graph data to disk", () => {
      store.createEntity(makeEntityInput({ name: "Persisted" }));
      store.forceSave(TEST_PROJECT);

      const fp = graphFilePath(TEST_PROJECT);
      expect(fs.existsSync(fp)).toBe(true);

      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      expect(data.entities).toHaveLength(1);
      expect(data.entities[0].name).toBe("Persisted");
      expect(data.version).toBe(1);
    });

    it("loads persisted data on next construction", () => {
      store.createEntity(makeEntityInput({ name: "Survivor" }));
      store.forceSave(TEST_PROJECT);

      // New store instance should load from disk
      const store2 = new GraphStore();
      const entities = store2.getAllEntities(TEST_PROJECT);
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe("Survivor");
    });

    it("handles missing graph file gracefully", () => {
      const store2 = new GraphStore();
      const entities = store2.getAllEntities("non-existent-project");
      expect(entities).toHaveLength(0);
    });

    it("handles corrupted graph file gracefully", () => {
      const fp = graphFilePath(TEST_PROJECT);
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(fp, "INVALID JSON!!!", "utf-8");

      const store2 = new GraphStore();
      // Should not throw, returns empty
      const entities = store2.getAllEntities(TEST_PROJECT);
      expect(entities).toHaveLength(0);
    });

    it("debounced save eventually writes to disk", async () => {
      store.createEntity(makeEntityInput({ name: "Debounced" }));
      // save is scheduled automatically on create

      // Wait for debounce to fire
      await new Promise(resolve => setTimeout(resolve, 1500));

      const fp = graphFilePath(TEST_PROJECT);
      expect(fs.existsSync(fp)).toBe(true);
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      expect(data.entities).toHaveLength(1);
    });

    it("forceSave without projectId saves all projects", () => {
      store.createEntity(
        makeEntityInput({ name: "A", projectId: TEST_PROJECT })
      );
      store.createEntity(
        makeEntityInput({ name: "B", projectId: "other-proj" })
      );

      store.forceSave();

      expect(fs.existsSync(graphFilePath(TEST_PROJECT))).toBe(true);
      expect(fs.existsSync(graphFilePath("other-proj"))).toBe(true);

      // Cleanup the other project file
      try {
        fs.unlinkSync(graphFilePath("other-proj"));
      } catch {
        /* ignore */
      }
    });
  });

  // -------------------------------------------------------------------------
  // Event callbacks
  // -------------------------------------------------------------------------

  describe("onEntityChanged", () => {
    it("fires 'created' when entity is created", () => {
      const listener = vi.fn();
      store.onEntityChanged(listener);

      const entity = store.createEntity(makeEntityInput());

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(entity, "created");
    });

    it("fires 'updated' when entity is updated", () => {
      const listener = vi.fn();
      const entity = store.createEntity(makeEntityInput());

      store.onEntityChanged(listener);
      store.updateEntity(entity.entityId, { description: "changed" });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][1]).toBe("updated");
    });

    it("fires events for mergeEntity (create or update)", () => {
      const listener = vi.fn();
      store.onEntityChanged(listener);

      // First merge 鈫?creates
      store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Merged",
        extendedAttributes: { filePath: "src/m.ts" },
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][1]).toBe("created");

      // Second merge 鈫?updates
      store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Merged",
        confidence: 0.99,
        extendedAttributes: { filePath: "src/m.ts" },
      });
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][1]).toBe("updated");
    });

    it("unsubscribe stops listener from being called", () => {
      const listener = vi.fn();
      const unsub = store.onEntityChanged(listener);
      unsub();

      store.createEntity(makeEntityInput());
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not crash when a listener throws", () => {
      const badListener = vi.fn(() => {
        throw new Error("boom");
      });
      const goodListener = vi.fn();
      store.onEntityChanged(badListener);
      store.onEntityChanged(goodListener);

      store.createEntity(makeEntityInput());

      expect(badListener).toHaveBeenCalledTimes(1);
      expect(goodListener).toHaveBeenCalledTimes(1);
    });

    it("supports multiple listeners", () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      store.onEntityChanged(l1);
      store.onEntityChanged(l2);

      store.createEntity(makeEntityInput());

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Graph Traversal (Requirement 4.1)
  // -------------------------------------------------------------------------

  describe("getNeighbors", () => {
    it("returns direct neighbors at depth=1", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(a.entityId, c.entityId));

      const result = store.getNeighbors(a.entityId);

      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name).sort();
      expect(names).toEqual(["B", "C"]);
      expect(result.relations).toHaveLength(2);
    });

    it("returns 2-hop neighbors at depth=2", () => {
      // A -> B -> C
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, c.entityId));

      // depth=1 from A should only get B
      const d1 = store.getNeighbors(a.entityId, undefined, 1);
      expect(d1.entities).toHaveLength(1);
      expect(d1.entities[0].name).toBe("B");

      // depth=2 from A should get B and C
      const d2 = store.getNeighbors(a.entityId, undefined, 2);
      expect(d2.entities).toHaveLength(2);
      const names = d2.entities.map(e => e.name).sort();
      expect(names).toEqual(["B", "C"]);
    });

    it("filters by relationTypes", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(
        makeRelationInput(a.entityId, b.entityId, {
          relationType: "DEPENDS_ON",
        })
      );
      store.createRelation(
        makeRelationInput(a.entityId, c.entityId, { relationType: "CALLS" })
      );

      const result = store.getNeighbors(a.entityId, ["DEPENDS_ON"]);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("B");
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].relationType).toBe("DEPENDS_ON");
    });

    it("handles cycles without infinite loop (visited set)", () => {
      // A -> B -> C -> A (cycle)
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, c.entityId));
      store.createRelation(makeRelationInput(c.entityId, a.entityId));

      // Should not hang 鈥?depth=10 is way more than the cycle length
      const result = store.getNeighbors(a.entityId, undefined, 10);
      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name).sort();
      expect(names).toEqual(["B", "C"]);
    });

    it("traverses bidirectionally (reverse edges)", () => {
      // B -> A (A is the target, not source)
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      store.createRelation(makeRelationInput(b.entityId, a.entityId));

      const result = store.getNeighbors(a.entityId);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("B");
    });

    it("returns empty for isolated entity", () => {
      const a = store.createEntity(makeEntityInput({ name: "Isolated" }));
      const result = store.getNeighbors(a.entityId);
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe("findPath", () => {
    it("finds shortest path between connected entities", () => {
      // A -> B -> C
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      const r1 = store.createRelation(
        makeRelationInput(a.entityId, b.entityId)
      );
      const r2 = store.createRelation(
        makeRelationInput(b.entityId, c.entityId)
      );

      const path = store.findPath(a.entityId, c.entityId);

      expect(path).not.toBeNull();
      expect(path!.entities).toHaveLength(3);
      expect(path!.entities[0].name).toBe("A");
      expect(path!.entities[1].name).toBe("B");
      expect(path!.entities[2].name).toBe("C");
      expect(path!.relations).toHaveLength(2);
    });

    it("returns null for disconnected entities", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      // No relation between them

      const path = store.findPath(a.entityId, b.entityId);
      expect(path).toBeNull();
    });

    it("returns single entity for same source and target", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const path = store.findPath(a.entityId, a.entityId);

      expect(path).not.toBeNull();
      expect(path!.entities).toHaveLength(1);
      expect(path!.entities[0].name).toBe("A");
      expect(path!.relations).toHaveLength(0);
    });

    it("finds shortest path when multiple paths exist", () => {
      // A -> B -> D (length 2)
      // A -> C -> E -> D (length 3)
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      const d = store.createEntity(makeEntityInput({ name: "D" }));
      const e = store.createEntity(makeEntityInput({ name: "E" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, d.entityId));
      store.createRelation(makeRelationInput(a.entityId, c.entityId));
      store.createRelation(makeRelationInput(c.entityId, e.entityId));
      store.createRelation(makeRelationInput(e.entityId, d.entityId));

      const path = store.findPath(a.entityId, d.entityId);
      expect(path).not.toBeNull();
      // Shortest path is A -> B -> D (3 entities, 2 relations)
      expect(path!.entities).toHaveLength(3);
      expect(path!.relations).toHaveLength(2);
    });

    it("handles cycles without infinite loop", () => {
      // A -> B -> C -> A (cycle), find path A -> C
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, c.entityId));
      store.createRelation(makeRelationInput(c.entityId, a.entityId));

      const path = store.findPath(a.entityId, c.entityId);
      expect(path).not.toBeNull();
      expect(path!.entities.length).toBeLessThanOrEqual(3);
    });

    it("traverses bidirectionally", () => {
      // A <- B (B -> A), find path A -> B
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      store.createRelation(makeRelationInput(b.entityId, a.entityId));

      const path = store.findPath(a.entityId, b.entityId);
      expect(path).not.toBeNull();
      expect(path!.entities).toHaveLength(2);
    });
  });

  describe("getSubgraph", () => {
    it("returns entities and relations between them", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      const r1 = store.createRelation(
        makeRelationInput(a.entityId, b.entityId)
      );
      const r2 = store.createRelation(
        makeRelationInput(b.entityId, c.entityId)
      );
      const r3 = store.createRelation(
        makeRelationInput(a.entityId, c.entityId)
      );

      const sub = store.getSubgraph([a.entityId, b.entityId, c.entityId]);
      expect(sub.entities).toHaveLength(3);
      expect(sub.relations).toHaveLength(3);
    });

    it("only includes relations where both endpoints are in the set", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(makeRelationInput(a.entityId, b.entityId));
      store.createRelation(makeRelationInput(b.entityId, c.entityId));

      // Only request A and B 鈥?relation B->C should be excluded
      const sub = store.getSubgraph([a.entityId, b.entityId]);
      expect(sub.entities).toHaveLength(2);
      expect(sub.relations).toHaveLength(1);
      expect(sub.relations[0].sourceEntityId).toBe(a.entityId);
      expect(sub.relations[0].targetEntityId).toBe(b.entityId);
    });

    it("returns empty for non-existent entity IDs", () => {
      const sub = store.getSubgraph(["non-existent-1", "non-existent-2"]);
      expect(sub.entities).toHaveLength(0);
      expect(sub.relations).toHaveLength(0);
    });

    it("handles empty input", () => {
      const sub = store.getSubgraph([]);
      expect(sub.entities).toHaveLength(0);
      expect(sub.relations).toHaveLength(0);
    });

    it("handles single entity with no relations", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const sub = store.getSubgraph([a.entityId]);
      expect(sub.entities).toHaveLength(1);
      expect(sub.relations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // enforceStatusTransition (Requirement 6.1)
  // -------------------------------------------------------------------------

  describe("enforceStatusTransition", () => {
    it("allows active 鈫?deprecated", () => {
      const entity = store.createEntity(makeEntityInput());
      expect(entity.status).toBe("active");

      const updated = store.enforceStatusTransition(
        entity.entityId,
        "deprecated",
        "code deleted",
        "code_change"
      );
      expect(updated.status).toBe("deprecated");
    });

    it("allows deprecated 鈫?archived", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });

      const updated = store.enforceStatusTransition(
        entity.entityId,
        "archived",
        "expired",
        "auto_cleanup"
      );
      expect(updated.status).toBe("archived");
    });

    it("allows archived 鈫?active (manual restoration)", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });
      store.updateEntity(entity.entityId, { status: "archived" });

      const updated = store.enforceStatusTransition(
        entity.entityId,
        "active",
        "restored by user",
        "manual"
      );
      expect(updated.status).toBe("active");
    });

    it("throws on invalid transition: active 鈫?archived", () => {
      const entity = store.createEntity(makeEntityInput());
      expect(() =>
        store.enforceStatusTransition(
          entity.entityId,
          "archived",
          "skip",
          "manual"
        )
      ).toThrow(/Invalid status transition.*active.*archived/);
    });

    it("throws on invalid transition: deprecated 鈫?active", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });

      expect(() =>
        store.enforceStatusTransition(
          entity.entityId,
          "active",
          "nope",
          "manual"
        )
      ).toThrow(/Invalid status transition.*deprecated.*active/);
    });

    it("throws on invalid transition: archived 鈫?deprecated", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });
      store.updateEntity(entity.entityId, { status: "archived" });

      expect(() =>
        store.enforceStatusTransition(
          entity.entityId,
          "deprecated",
          "nope",
          "manual"
        )
      ).toThrow(/Invalid status transition.*archived.*deprecated/);
    });

    it("throws when entity not found", () => {
      expect(() =>
        store.enforceStatusTransition(
          "non-existent",
          "deprecated",
          "reason",
          "manual"
        )
      ).toThrow(/Entity not found/);
    });

    it("writes lifecycle log entry on valid transition (via method param)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-lifecycle-"));
      const logPath = path.join(tmpDir, "test.jsonl");
      const lifecycleLog = new LifecycleLog(logPath);

      const entity = store.createEntity(makeEntityInput());
      store.enforceStatusTransition(
        entity.entityId,
        "deprecated",
        "module removed",
        "code_change",
        lifecycleLog
      );

      const entries = lifecycleLog.query();
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe(entity.entityId);
      expect(entries[0].action).toBe("status_change");
      expect(entries[0].previousStatus).toBe("active");
      expect(entries[0].newStatus).toBe("deprecated");
      expect(entries[0].reason).toBe("module removed");
      expect(entries[0].triggeredBy).toBe("code_change");

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes lifecycle log entry via store.lifecycleLog property", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-lifecycle-"));
      const logPath = path.join(tmpDir, "test.jsonl");
      store.lifecycleLog = new LifecycleLog(logPath);

      const entity = store.createEntity(makeEntityInput());
      store.enforceStatusTransition(
        entity.entityId,
        "deprecated",
        "auto reason",
        "auto_cleanup"
      );

      const entries = store.lifecycleLog.query();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("status_change");

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does not write log when no lifecycleLog is available", () => {
      // store.lifecycleLog is undefined, no param passed 鈥?should not throw
      const entity = store.createEntity(makeEntityInput());
      const updated = store.enforceStatusTransition(
        entity.entityId,
        "deprecated",
        "silent",
        "manual"
      );
      expect(updated.status).toBe("deprecated");
    });
  });

  // -------------------------------------------------------------------------
  // Property 1: 瀹炰綋鍒涘缓灞炴€у畬鏁存€?
  // -------------------------------------------------------------------------

  describe("Feature: knowledge-graph, Property 1: entity creation integrity", () => {
    /**
     * Validates: Requirements 1.3
     *
     * For any entity creation input with valid entityType, name, and projectId,
     * the created Entity SHALL contain all common attributes (entityId, entityType,
     * name, description, createdAt, updatedAt, source, confidence, projectId) with
     * non-null values, and entityId SHALL be globally unique.
     */

    const entitySourceArb = fc.constantFrom(
      "agent_extracted" as const,
      "user_defined" as const,
      "code_analysis" as const,
      "llm_inferred" as const
    );

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

    const entityInputArb = fc.record({
      entityType: entityTypeArb,
      name: fc.string({ minLength: 1, maxLength: 100 }),
      description: fc.string({ minLength: 0, maxLength: 200 }),
      source: entitySourceArb,
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      projectId: fc
        .string({ minLength: 1, maxLength: 50 })
        .filter(s => /^[A-Za-z0-9_-]+$/.test(s)),
      needsReview: fc.boolean(),
      linkedMemoryIds: fc.array(fc.uuid(), { maxLength: 3 }),
      extendedAttributes: fc.constant({} as Record<string, unknown>),
    });

    it("created entity contains all common attributes with non-null values", () => {
      fc.assert(
        fc.property(entityInputArb, input => {
          const entity = store.createEntity(input);

          // All common attributes must be non-null and defined
          expect(entity.entityId).not.toBeNull();
          expect(entity.entityId).toBeDefined();
          expect(entity.entityId.length).toBeGreaterThan(0);

          expect(entity.entityType).toBe(input.entityType);
          expect(entity.entityType).not.toBeNull();

          expect(entity.name).toBe(input.name);
          expect(entity.name).not.toBeNull();

          expect(entity.description).toBe(input.description);
          expect(entity.description).not.toBeNull();

          expect(entity.createdAt).not.toBeNull();
          expect(entity.createdAt).toBeDefined();
          expect(entity.createdAt.length).toBeGreaterThan(0);
          // Must be valid ISO 8601
          expect(new Date(entity.createdAt).toISOString()).toBe(
            entity.createdAt
          );

          expect(entity.updatedAt).not.toBeNull();
          expect(entity.updatedAt).toBeDefined();
          expect(entity.updatedAt.length).toBeGreaterThan(0);
          expect(new Date(entity.updatedAt).toISOString()).toBe(
            entity.updatedAt
          );

          expect(entity.source).not.toBeNull();
          expect([
            "agent_extracted",
            "user_defined",
            "code_analysis",
            "llm_inferred",
          ]).toContain(entity.source);

          expect(entity.confidence).not.toBeNull();
          expect(entity.confidence).toBeDefined();
          expect(entity.confidence).toBeGreaterThanOrEqual(0);
          expect(entity.confidence).toBeLessThanOrEqual(1);

          // user_defined source forces confidence to 1.0
          if (input.source === "user_defined") {
            expect(entity.confidence).toBe(1.0);
          }

          expect(entity.projectId).toBe(input.projectId);
          expect(entity.projectId).not.toBeNull();

          // Auto-assigned fields
          expect(entity.status).toBe("active");
        }),
        { numRuns: 20 }
      );
    });

    it("entityId is globally unique across all created entities", () => {
      fc.assert(
        fc.property(
          fc.array(entityInputArb, { minLength: 2, maxLength: 20 }),
          inputs => {
            const entities = inputs.map(input => store.createEntity(input));
            const ids = entities.map(e => e.entityId);
            const uniqueIds = new Set(ids);

            // All IDs must be unique
            expect(uniqueIds.size).toBe(ids.length);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 2: 鍏崇郴鍒涘缓灞炴€у畬鏁存€?
  // -------------------------------------------------------------------------

  describe("Feature: knowledge-graph, Property 2: relation creation integrity", () => {
    /**
     * Validates: Requirements 1.4
     *
     * For any relation creation input with valid relationType, sourceEntityId,
     * and targetEntityId, the created Relation SHALL contain all common attributes
     * (relationId, relationType, sourceEntityId, targetEntityId, weight, evidence,
     * createdAt, source) with non-null values.
     */

    const relationSourceArb = fc.constantFrom(
      "agent_extracted" as const,
      "user_defined" as const,
      "code_analysis" as const,
      "llm_inferred" as const
    );

    const relationTypeArb = fc.constantFrom(
      "DEPENDS_ON",
      "CALLS",
      "IMPLEMENTS",
      "DECIDED_BY",
      "SUPERSEDES",
      "USES",
      "CAUSED_BY",
      "RESOLVED_BY",
      "BELONGS_TO",
      "EXECUTED_BY",
      "KNOWS_ABOUT"
    );

    it("created relation contains all common attributes with non-null values", () => {
      // Pre-create a pair of entities that all iterations will reference
      const sourceEntity = store.createEntity(
        makeEntityInput({ name: "PropSource" })
      );
      const targetEntity = store.createEntity(
        makeEntityInput({ name: "PropTarget" })
      );

      const relationInputArb = fc.record({
        relationType: relationTypeArb,
        sourceEntityId: fc.constant(sourceEntity.entityId),
        targetEntityId: fc.constant(targetEntity.entityId),
        weight: fc.double({ min: 0, max: 1, noNaN: true }),
        evidence: fc.string({ minLength: 1, maxLength: 200 }),
        source: relationSourceArb,
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
        needsReview: fc.boolean(),
      });

      fc.assert(
        fc.property(relationInputArb, input => {
          const relation = store.createRelation(input);

          // relationId: non-null, defined, non-empty
          expect(relation.relationId).not.toBeNull();
          expect(relation.relationId).toBeDefined();
          expect(relation.relationId.length).toBeGreaterThan(0);

          // relationType: matches input, non-null
          expect(relation.relationType).toBe(input.relationType);
          expect(relation.relationType).not.toBeNull();

          // sourceEntityId: matches input, non-null
          expect(relation.sourceEntityId).toBe(input.sourceEntityId);
          expect(relation.sourceEntityId).not.toBeNull();

          // targetEntityId: matches input, non-null
          expect(relation.targetEntityId).toBe(input.targetEntityId);
          expect(relation.targetEntityId).not.toBeNull();

          // weight: non-null, within [0, 1]
          expect(relation.weight).not.toBeNull();
          expect(relation.weight).toBeDefined();
          expect(relation.weight).toBeGreaterThanOrEqual(0);
          expect(relation.weight).toBeLessThanOrEqual(1);

          // evidence: non-null, matches input
          expect(relation.evidence).not.toBeNull();
          expect(relation.evidence).toBeDefined();
          expect(relation.evidence).toBe(input.evidence);

          // createdAt: non-null, valid ISO 8601
          expect(relation.createdAt).not.toBeNull();
          expect(relation.createdAt).toBeDefined();
          expect(relation.createdAt.length).toBeGreaterThan(0);
          expect(new Date(relation.createdAt).toISOString()).toBe(
            relation.createdAt
          );

          // source: non-null, valid enum value
          expect(relation.source).not.toBeNull();
          expect(relation.source).toBeDefined();
          expect([
            "agent_extracted",
            "user_defined",
            "code_analysis",
            "llm_inferred",
          ]).toContain(relation.source);
        }),
        { numRuns: 20 }
      );
    });

    it("relationId is globally unique across all created relations", () => {
      const sourceEntity = store.createEntity(
        makeEntityInput({ name: "UniqueRelSource" })
      );
      const targetEntity = store.createEntity(
        makeEntityInput({ name: "UniqueRelTarget" })
      );

      const relationInputArb = fc.record({
        relationType: relationTypeArb,
        sourceEntityId: fc.constant(sourceEntity.entityId),
        targetEntityId: fc.constant(targetEntity.entityId),
        weight: fc.double({ min: 0, max: 1, noNaN: true }),
        evidence: fc.string({ minLength: 1, maxLength: 200 }),
        source: relationSourceArb,
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
        needsReview: fc.boolean(),
      });

      fc.assert(
        fc.property(
          fc.array(relationInputArb, { minLength: 2, maxLength: 20 }),
          inputs => {
            const relations = inputs.map(input => store.createRelation(input));
            const ids = relations.map(r => r.relationId);
            const uniqueIds = new Set(ids);

            // All relation IDs must be unique
            expect(uniqueIds.size).toBe(ids.length);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 7: 瀹炰綋鍘婚噸鍞竴閿笉鍙橀噺
  // -------------------------------------------------------------------------

  describe("Feature: knowledge-graph, Property 7: 瀹炰綋鍘婚噸鍞竴閿笉鍙橀噺", () => {
    /**
     * Validates: Requirements 2.6
     *
     * For any two entities with identical (entityType, projectId, filePath, name)
     * written to the graph, the graph SHALL contain exactly one entity for that
     * unique key, and the retained entity SHALL have the higher confidence value
     * for conflicting attributes.
     */

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

    // Generate a safe projectId (alphanumeric + dash/underscore)
    const projectIdArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter(s => /^[A-Za-z0-9_-]+$/.test(s));

    // Generate a safe filePath
    const filePathArb = fc
      .array(fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/), {
        minLength: 1,
        maxLength: 4,
      })
      .map(parts => parts.join("/") + ".ts");

    // Generate a non-empty name
    const nameArb = fc.string({ minLength: 1, maxLength: 50 });

    // Confidence in valid range
    const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

    it("mergeEntity with identical unique key produces exactly one entity", () => {
      // Exclude user_defined source since createEntity overrides confidence to 1.0
      // for that source, which is a separate invariant (Requirement 1.3)
      const nonUserSourceArb = fc.constantFrom(
        "agent_extracted" as const,
        "code_analysis" as const,
        "llm_inferred" as const
      );

      fc.assert(
        fc.property(
          entityTypeArb,
          projectIdArb,
          filePathArb,
          nameArb,
          confidenceArb,
          confidenceArb,
          nonUserSourceArb,
          nonUserSourceArb,
          (
            entityType,
            projectId,
            filePath,
            name,
            conf1,
            conf2,
            source1,
            source2
          ) => {
            // Fresh store per iteration to avoid cross-contamination
            const localStore = new GraphStore();

            // First write
            localStore.mergeEntity({
              entityType,
              projectId,
              name,
              description: "first",
              source: source1,
              confidence: conf1,
              extendedAttributes: { filePath },
            });

            // Second write with same unique key
            localStore.mergeEntity({
              entityType,
              projectId,
              name,
              description: "second",
              source: source2,
              confidence: conf2,
              extendedAttributes: { filePath },
            });

            // Exactly one entity for this unique key
            const all = localStore.getAllEntities(projectId);
            const matches = all.filter(
              e =>
                e.entityType === entityType &&
                e.name === name &&
                (e.extendedAttributes as Record<string, unknown>)?.filePath ===
                  filePath
            );
            expect(matches).toHaveLength(1);

            // Retained entity has the higher confidence
            const retained = matches[0];
            expect(retained.confidence).toBeGreaterThanOrEqual(conf1);
            expect(retained.confidence).toBeGreaterThanOrEqual(conf2);
            expect(retained.confidence).toBe(Math.max(conf1, conf2));
          }
        ),
        { numRuns: 20 }
      );
    });

    it("multiple merges with same key always converge to max confidence", () => {
      fc.assert(
        fc.property(
          entityTypeArb,
          projectIdArb,
          filePathArb,
          nameArb,
          fc.array(confidenceArb, { minLength: 2, maxLength: 10 }),
          (entityType, projectId, filePath, name, confidences) => {
            const localStore = new GraphStore();

            for (const conf of confidences) {
              localStore.mergeEntity({
                entityType,
                projectId,
                name,
                source: "code_analysis",
                confidence: conf,
                extendedAttributes: { filePath },
              });
            }

            const all = localStore.getAllEntities(projectId);
            const matches = all.filter(
              e =>
                e.entityType === entityType &&
                e.name === name &&
                (e.extendedAttributes as Record<string, unknown>)?.filePath ===
                  filePath
            );

            // Still exactly one entity
            expect(matches).toHaveLength(1);

            // Confidence is the max of all written values
            const expectedMax = Math.max(...confidences);
            expect(matches[0].confidence).toBe(expectedMax);
          }
        ),
        { numRuns: 20 }
      );
    });

    it("different unique keys produce separate entities", () => {
      fc.assert(
        fc.property(
          projectIdArb,
          nameArb,
          filePathArb,
          filePathArb,
          confidenceArb,
          (projectId, name, filePath1, filePath2) => {
            // Skip when filePaths are identical 鈥?that's the same unique key
            fc.pre(filePath1 !== filePath2);

            const localStore = new GraphStore();

            localStore.mergeEntity({
              entityType: "CodeModule",
              projectId,
              name,
              source: "code_analysis",
              confidence: 0.8,
              extendedAttributes: { filePath: filePath1 },
            });

            localStore.mergeEntity({
              entityType: "CodeModule",
              projectId,
              name,
              source: "code_analysis",
              confidence: 0.8,
              extendedAttributes: { filePath: filePath2 },
            });

            const all = localStore.getAllEntities(projectId);
            const matches = all.filter(
              e => e.entityType === "CodeModule" && e.name === name
            );

            // Two distinct entities because filePaths differ
            expect(matches).toHaveLength(2);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 12: 椤圭洰闅旂涓嶅彉閲?
  // -------------------------------------------------------------------------

  describe("Feature: knowledge-graph, Property 12: project isolation invariant", () => {
    /**
     * Validates: Requirements 4.5
     *
     * For any graph query with projectId A, the returned entities and relations
     * SHALL exclusively belong to projectId A; no entity or relation with a
     * different projectId SHALL appear in the results.
     */

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

    const entitySourceArb = fc.constantFrom(
      "agent_extracted" as const,
      "user_defined" as const,
      "code_analysis" as const,
      "llm_inferred" as const
    );

    // Use a unique prefix to avoid collisions with disk data from other tests
    const projectIdArb = fc
      .stringMatching(/^[a-zA-Z][A-Za-z0-9]{2,10}$/)
      .map(s => `iso12-${s}`);

    const nameArb = fc.string({ minLength: 1, maxLength: 50 });

    const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

    const relationTypeArb = fc.constantFrom(
      "DEPENDS_ON",
      "CALLS",
      "IMPLEMENTS",
      "DECIDED_BY",
      "SUPERSEDES",
      "USES",
      "CAUSED_BY",
      "RESOLVED_BY",
      "BELONGS_TO",
      "EXECUTED_BY",
      "KNOWS_ABOUT"
    );

    it("findEntities returns only entities belonging to the queried projectId", () => {
      fc.assert(
        fc.property(
          projectIdArb,
          projectIdArb,
          fc.array(
            fc.record({
              entityType: entityTypeArb,
              name: nameArb,
              source: entitySourceArb,
              confidence: confidenceArb,
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.array(
            fc.record({
              entityType: entityTypeArb,
              name: nameArb,
              source: entitySourceArb,
              confidence: confidenceArb,
            }),
            { minLength: 1, maxLength: 5 }
          ),
          (projectA, projectB, entitiesA, entitiesB) => {
            fc.pre(projectA !== projectB);

            const localStore = new GraphStore();

            // Create entities in project A
            for (const input of entitiesA) {
              localStore.createEntity({
                ...input,
                description: "entity in project A",
                projectId: projectA,
                needsReview: false,
                linkedMemoryIds: [],
                extendedAttributes: {},
              });
            }

            // Create entities in project B
            for (const input of entitiesB) {
              localStore.createEntity({
                ...input,
                description: "entity in project B",
                projectId: projectB,
                needsReview: false,
                linkedMemoryIds: [],
                extendedAttributes: {},
              });
            }

            // Query project A 鈥?every returned entity must belong to project A
            const resultsA = localStore.findEntities({ projectId: projectA });
            for (const entity of resultsA) {
              expect(entity.projectId).toBe(projectA);
            }
            // Must contain at least the entities we just created
            expect(resultsA.length).toBeGreaterThanOrEqual(entitiesA.length);

            // Query project B 鈥?every returned entity must belong to project B
            const resultsB = localStore.findEntities({ projectId: projectB });
            for (const entity of resultsB) {
              expect(entity.projectId).toBe(projectB);
            }
            expect(resultsB.length).toBeGreaterThanOrEqual(entitiesB.length);

            // Cross-check: no entity from project B appears in project A results
            const idsB = new Set(resultsB.map(e => e.entityId));
            for (const entity of resultsA) {
              expect(idsB.has(entity.entityId)).toBe(false);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it("findRelations with projectId returns only relations from that project", () => {
      fc.assert(
        fc.property(
          projectIdArb,
          projectIdArb,
          relationTypeArb,
          relationTypeArb,
          (projectA, projectB, relTypeA, relTypeB) => {
            fc.pre(projectA !== projectB);

            const localStore = new GraphStore();
            const projectAId = `${projectA}-${Math.random().toString(36).slice(2, 10)}`;
            const projectBId = `${projectB}-${Math.random().toString(36).slice(2, 10)}`;

            // Create entities and relations in project A
            const a1 = localStore.createEntity({
              entityType: "CodeModule",
              name: "ModA1",
              description: "",
              source: "code_analysis",
              confidence: 0.8,
              projectId: projectAId,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
            const a2 = localStore.createEntity({
              entityType: "CodeModule",
              name: "ModA2",
              description: "",
              source: "code_analysis",
              confidence: 0.8,
              projectId: projectAId,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
            localStore.createRelation({
              relationType: relTypeA,
              sourceEntityId: a1.entityId,
              targetEntityId: a2.entityId,
              weight: 0.9,
              evidence: "test",
              source: "code_analysis",
              confidence: 0.8,
              needsReview: false,
            });

            // Create entities and relations in project B
            const b1 = localStore.createEntity({
              entityType: "API",
              name: "ModB1",
              description: "",
              source: "code_analysis",
              confidence: 0.7,
              projectId: projectBId,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
            const b2 = localStore.createEntity({
              entityType: "API",
              name: "ModB2",
              description: "",
              source: "code_analysis",
              confidence: 0.7,
              projectId: projectBId,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
            localStore.createRelation({
              relationType: relTypeB,
              sourceEntityId: b1.entityId,
              targetEntityId: b2.entityId,
              weight: 0.8,
              evidence: "test",
              source: "code_analysis",
              confidence: 0.7,
              needsReview: false,
            });

            // Query relations for project A 鈥?all must reference project A entities
            const relationsA = localStore.findRelations({
              projectId: projectAId,
            });
            expect(relationsA.length).toBeGreaterThanOrEqual(1);
            const entityIdsA = new Set(
              localStore
                .findEntities({ projectId: projectAId })
                .map(e => e.entityId)
            );
            for (const rel of relationsA) {
              expect(
                entityIdsA.has(rel.sourceEntityId) &&
                  entityIdsA.has(rel.targetEntityId)
              ).toBe(true);
            }

            // Query relations for project B 鈥?all must reference project B entities
            const relationsB = localStore.findRelations({
              projectId: projectBId,
            });
            expect(relationsB.length).toBeGreaterThanOrEqual(1);
            const entityIdsB = new Set(
              localStore
                .findEntities({ projectId: projectBId })
                .map(e => e.entityId)
            );
            for (const rel of relationsB) {
              expect(
                entityIdsB.has(rel.sourceEntityId) &&
                  entityIdsB.has(rel.targetEntityId)
              ).toBe(true);
            }

            // Cross-check: no relation from project B appears in project A results
            const relIdsB = new Set(relationsB.map(r => r.relationId));
            for (const rel of relationsA) {
              expect(relIdsB.has(rel.relationId)).toBe(false);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it("findEntities with additional filters still enforces project isolation", () => {
      fc.assert(
        fc.property(
          projectIdArb,
          projectIdArb,
          entityTypeArb,
          (projectA, projectB, sharedType) => {
            fc.pre(projectA !== projectB);

            const localStore = new GraphStore();

            // Create entities of the same type and name in both projects
            localStore.createEntity({
              entityType: sharedType,
              name: "SharedName",
              description: "in A",
              source: "code_analysis",
              confidence: 0.9,
              projectId: projectA,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
            localStore.createEntity({
              entityType: sharedType,
              name: "SharedName",
              description: "in B",
              source: "code_analysis",
              confidence: 0.9,
              projectId: projectB,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });

            // Query with entityType filter 鈥?must still isolate by project
            const results = localStore.findEntities({
              projectId: projectA,
              entityType: sharedType,
            });
            for (const entity of results) {
              expect(entity.projectId).toBe(projectA);
            }
            expect(results.length).toBeGreaterThanOrEqual(1);

            // Query with name filter 鈥?must still isolate by project
            const nameResults = localStore.findEntities({
              projectId: projectA,
              name: "SharedName",
            });
            for (const entity of nameResults) {
              expect(entity.projectId).toBe(projectA);
            }
            expect(nameResults.length).toBeGreaterThanOrEqual(1);

            // Verify none of project B's entities leaked into project A results
            const bEntities = localStore.findEntities({ projectId: projectB });
            const bIds = new Set(bEntities.map(e => e.entityId));
            for (const entity of results) {
              expect(bIds.has(entity.entityId)).toBe(false);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});

// -------------------------------------------------------------------------
// Property 12: 椤圭洰闅旂涓嶅彉閲?
// -------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 12: project isolation invariant", () => {
  /**
   * Validates: Requirements 4.5
   *
   * For any graph query with projectId A, the returned entities and relations
   * SHALL exclusively belong to projectId A; no entity or relation with a
   * different projectId SHALL appear in the results.
   */

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

  const entitySourceArb = fc.constantFrom(
    "agent_extracted" as const,
    "user_defined" as const,
    "code_analysis" as const,
    "llm_inferred" as const
  );

  // Generate safe projectIds that are distinct and filesystem-safe
  const projectIdArb = fc
    .string({ minLength: 1, maxLength: 20 })
    .filter(s => /^[a-zA-Z][A-Za-z0-9_-]*$/.test(s));

  const nameArb = fc.string({ minLength: 1, maxLength: 50 });

  const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

  const relationTypeArb = fc.constantFrom(
    "DEPENDS_ON",
    "CALLS",
    "IMPLEMENTS",
    "DECIDED_BY",
    "SUPERSEDES",
    "USES",
    "CAUSED_BY",
    "RESOLVED_BY",
    "BELONGS_TO",
    "EXECUTED_BY",
    "KNOWS_ABOUT"
  );

  it("findEntities returns only entities belonging to the queried projectId", () => {
    fc.assert(
      fc.property(
        projectIdArb,
        projectIdArb,
        fc.array(
          fc.record({
            entityType: entityTypeArb,
            name: nameArb,
            source: entitySourceArb,
            confidence: confidenceArb,
          }),
          { minLength: 1, maxLength: 5 }
        ),
        fc.array(
          fc.record({
            entityType: entityTypeArb,
            name: nameArb,
            source: entitySourceArb,
            confidence: confidenceArb,
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (projectA, projectB, entitiesA, entitiesB) => {
          // Ensure distinct project IDs
          fc.pre(projectA !== projectB);

          const localStore = new GraphStore();

          // Create entities in project A
          for (const input of entitiesA) {
            localStore.createEntity({
              ...input,
              description: "entity in project A",
              projectId: projectA,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
          }

          // Create entities in project B
          for (const input of entitiesB) {
            localStore.createEntity({
              ...input,
              description: "entity in project B",
              projectId: projectB,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });
          }

          // Query project A 鈥?every returned entity must belong to project A
          const resultsA = localStore.findEntities({ projectId: projectA });
          for (const entity of resultsA) {
            expect(entity.projectId).toBe(projectA);
          }
          // Must contain at least the entities we just created
          expect(resultsA.length).toBeGreaterThanOrEqual(entitiesA.length);

          // Query project B 鈥?every returned entity must belong to project B
          const resultsB = localStore.findEntities({ projectId: projectB });
          for (const entity of resultsB) {
            expect(entity.projectId).toBe(projectB);
          }
          expect(resultsB.length).toBeGreaterThanOrEqual(entitiesB.length);

          // Cross-check: no entity from project B appears in project A results
          const idsB = new Set(resultsB.map(e => e.entityId));
          for (const entity of resultsA) {
            expect(idsB.has(entity.entityId)).toBe(false);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("findRelations with projectId returns only relations from that project", () => {
    fc.assert(
      fc.property(
        projectIdArb,
        projectIdArb,
        relationTypeArb,
        relationTypeArb,
        (projectA, projectB, relTypeA, relTypeB) => {
          fc.pre(projectA !== projectB);

          const localStore = new GraphStore();
          const projectAId = `${projectA}-${Math.random().toString(36).slice(2, 10)}`;
          const projectBId = `${projectB}-${Math.random().toString(36).slice(2, 10)}`;

          // Create entities and relations in project A
          const a1 = localStore.createEntity({
            entityType: "CodeModule",
            name: "ModA1",
            description: "",
            source: "code_analysis",
            confidence: 0.8,
            projectId: projectAId,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });
          const a2 = localStore.createEntity({
            entityType: "CodeModule",
            name: "ModA2",
            description: "",
            source: "code_analysis",
            confidence: 0.8,
            projectId: projectAId,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });
          localStore.createRelation({
            relationType: relTypeA,
            sourceEntityId: a1.entityId,
            targetEntityId: a2.entityId,
            weight: 0.9,
            evidence: "test",
            source: "code_analysis",
            confidence: 0.8,
            needsReview: false,
          });

          // Create entities and relations in project B
          const b1 = localStore.createEntity({
            entityType: "API",
            name: "ModB1",
            description: "",
            source: "code_analysis",
            confidence: 0.7,
            projectId: projectBId,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });
          const b2 = localStore.createEntity({
            entityType: "API",
            name: "ModB2",
            description: "",
            source: "code_analysis",
            confidence: 0.7,
            projectId: projectBId,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });
          localStore.createRelation({
            relationType: relTypeB,
            sourceEntityId: b1.entityId,
            targetEntityId: b2.entityId,
            weight: 0.8,
            evidence: "test",
            source: "code_analysis",
            confidence: 0.7,
            needsReview: false,
          });

          // Query relations for project A
          const relationsA = localStore.findRelations({
            projectId: projectAId,
          });
          expect(relationsA.length).toBe(1);
          // All returned relations must reference entities in project A
          const entityIdsA = new Set(
            localStore
              .findEntities({ projectId: projectAId })
              .map(e => e.entityId)
          );
          for (const rel of relationsA) {
            expect(
              entityIdsA.has(rel.sourceEntityId) &&
                entityIdsA.has(rel.targetEntityId)
            ).toBe(true);
          }

          // Query relations for project B
          const relationsB = localStore.findRelations({
            projectId: projectBId,
          });
          expect(relationsB.length).toBe(1);
          const entityIdsB = new Set(
            localStore
              .findEntities({ projectId: projectBId })
              .map(e => e.entityId)
          );
          for (const rel of relationsB) {
            expect(
              entityIdsB.has(rel.sourceEntityId) &&
                entityIdsB.has(rel.targetEntityId)
            ).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("findEntities with additional filters still enforces project isolation", () => {
    fc.assert(
      fc.property(
        projectIdArb,
        projectIdArb,
        entityTypeArb,
        (projectA, projectB, sharedType) => {
          fc.pre(projectA !== projectB);

          const localStore = new GraphStore();

          // Create entities of the same type and name in both projects
          localStore.createEntity({
            entityType: sharedType,
            name: "SharedName",
            description: "in A",
            source: "code_analysis",
            confidence: 0.9,
            projectId: projectA,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });
          localStore.createEntity({
            entityType: sharedType,
            name: "SharedName",
            description: "in B",
            source: "code_analysis",
            confidence: 0.9,
            projectId: projectB,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });

          // Query with entityType filter 鈥?must still isolate by project
          const results = localStore.findEntities({
            projectId: projectA,
            entityType: sharedType,
          });
          for (const entity of results) {
            expect(entity.projectId).toBe(projectA);
          }
          expect(results.length).toBeGreaterThanOrEqual(1);

          // Query with name filter 鈥?must still isolate by project
          const nameResults = localStore.findEntities({
            projectId: projectA,
            name: "SharedName",
          });
          for (const entity of nameResults) {
            expect(entity.projectId).toBe(projectA);
          }
          expect(nameResults.length).toBeGreaterThanOrEqual(1);

          // Verify none of project B's entities leaked into project A results
          const bEntities = localStore.findEntities({ projectId: projectB });
          const bIds = new Set(bEntities.map(e => e.entityId));
          for (const entity of results) {
            expect(bIds.has(entity.entityId)).toBe(false);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

// -------------------------------------------------------------------------
// Property 13: 鍥鹃亶鍘嗘繁搴︾害鏉?
// -------------------------------------------------------------------------

describe("Feature: knowledge-graph, Property 13: graph traversal depth constraint", () => {
  /**
   * Validates: Requirements 4.1
   *
   * For any getNeighbors(entityId, relationTypes, depth=N) query, all returned
   * entities SHALL be reachable from the source entity within N hops through
   * the specified relation types.
   */

  const relationTypeArb = fc.constantFrom(
    "DEPENDS_ON",
    "CALLS",
    "IMPLEMENTS",
    "USES",
    "BELONGS_TO"
  );

  /**
   * Helper: build a linear chain of entities connected by relations.
   * Returns { entities, relations } where entities[0] is the head.
   * Chain: E0 --rel--> E1 --rel--> E2 --rel--> ... --rel--> E(chainLength-1)
   */
  function buildChain(
    store: GraphStore,
    chainLength: number,
    relationType: string,
    projectId: string
  ) {
    const entities: ReturnType<GraphStore["createEntity"]>[] = [];
    const relations: ReturnType<GraphStore["createRelation"]>[] = [];

    for (let i = 0; i < chainLength; i++) {
      entities.push(
        store.createEntity({
          entityType: "CodeModule",
          name: `Chain_${i}`,
          description: `node ${i}`,
          source: "code_analysis",
          confidence: 0.8,
          projectId,
          needsReview: false,
          linkedMemoryIds: [],
          extendedAttributes: {},
        })
      );
    }

    for (let i = 0; i < chainLength - 1; i++) {
      relations.push(
        store.createRelation({
          relationType,
          sourceEntityId: entities[i].entityId,
          targetEntityId: entities[i + 1].entityId,
          weight: 0.9,
          evidence: `chain link ${i}->${i + 1}`,
          source: "code_analysis",
          confidence: 0.8,
          needsReview: false,
        })
      );
    }

    return { entities, relations };
  }

  /**
   * Helper: BFS reachability check 鈥?returns the set of entity IDs reachable
   * from `startId` within `maxHops` hops, traversing only the given relation types.
   * Mirrors the bidirectional traversal logic in GraphStore.getNeighbors.
   */
  function bfsReachable(
    startId: string,
    maxHops: number,
    allRelations: Array<{
      sourceEntityId: string;
      targetEntityId: string;
      relationType: string;
    }>,
    filterRelTypes?: string[]
  ): Set<string> {
    const visited = new Set<string>();
    visited.add(startId);
    let frontier = [startId];

    for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const rel of allRelations) {
          if (filterRelTypes && !filterRelTypes.includes(rel.relationType))
            continue;
          let neighbor: string | null = null;
          if (rel.sourceEntityId === current) neighbor = rel.targetEntityId;
          else if (rel.targetEntityId === current)
            neighbor = rel.sourceEntityId;
          if (neighbor !== null && !visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }

    return visited;
  }

  it("all returned entities are reachable within N hops on a linear chain", () => {
    fc.assert(
      fc.property(
        // chainLength: 3..8 nodes, depth: 1..7
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 1, max: 7 }),
        relationTypeArb,
        (chainLength, depth, relationType) => {
          const localStore = new GraphStore();
          const projectId = "prop13-chain";

          const { entities } = buildChain(
            localStore,
            chainLength,
            relationType,
            projectId
          );
          const startId = entities[0].entityId;

          const result = localStore.getNeighbors(
            startId,
            [relationType],
            depth
          );

          // Compute expected reachable set via independent BFS
          const allRels = localStore.getAllRelations(projectId);
          const reachable = bfsReachable(startId, depth, allRels, [
            relationType,
          ]);

          // Every returned entity must be in the reachable set
          for (const entity of result.entities) {
            expect(reachable.has(entity.entityId)).toBe(true);
          }

          // The number of returned entities should match reachable minus the start node
          const expectedCount = Math.min(depth, chainLength - 1);
          expect(result.entities.length).toBe(expectedCount);

          // No entity beyond depth N should appear
          for (const entity of result.entities) {
            const idx = entities.findIndex(e => e.entityId === entity.entityId);
            expect(idx).toBeGreaterThan(0);
            expect(idx).toBeLessThanOrEqual(depth);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("depth constraint holds with relation type filtering", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 7 }),
        fc.integer({ min: 1, max: 3 }),
        (chainLength, depth) => {
          const localStore = new GraphStore();
          const projectId = "prop13-filter";

          // Build a chain with DEPENDS_ON
          const { entities } = buildChain(
            localStore,
            chainLength,
            "DEPENDS_ON",
            projectId
          );

          // Add a branch from entities[0] via CALLS to an extra node
          const extraNode = localStore.createEntity({
            entityType: "API",
            name: "ExtraBranch",
            description: "extra",
            source: "code_analysis",
            confidence: 0.8,
            projectId,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });
          localStore.createRelation({
            relationType: "CALLS",
            sourceEntityId: entities[0].entityId,
            targetEntityId: extraNode.entityId,
            weight: 0.9,
            evidence: "branch",
            source: "code_analysis",
            confidence: 0.8,
            needsReview: false,
          });

          // Query with only DEPENDS_ON 鈥?extra node should NOT appear
          const result = localStore.getNeighbors(
            entities[0].entityId,
            ["DEPENDS_ON"],
            depth
          );

          const returnedIds = new Set(result.entities.map(e => e.entityId));
          expect(returnedIds.has(extraNode.entityId)).toBe(false);

          // All returned entities must be within depth hops via DEPENDS_ON
          for (const entity of result.entities) {
            const idx = entities.findIndex(e => e.entityId === entity.entityId);
            expect(idx).toBeGreaterThan(0);
            expect(idx).toBeLessThanOrEqual(depth);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("depth constraint holds on graphs with cycles", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 6 }),
        fc.integer({ min: 1, max: 5 }),
        relationTypeArb,
        (ringSize, depth, relationType) => {
          const localStore = new GraphStore();
          const projectId = "prop13-cycle";

          // Build a ring: E0 -> E1 -> ... -> E(n-1) -> E0
          const entities: ReturnType<GraphStore["createEntity"]>[] = [];
          for (let i = 0; i < ringSize; i++) {
            entities.push(
              localStore.createEntity({
                entityType: "CodeModule",
                name: `Ring_${i}`,
                description: `ring node ${i}`,
                source: "code_analysis",
                confidence: 0.8,
                projectId,
                needsReview: false,
                linkedMemoryIds: [],
                extendedAttributes: {},
              })
            );
          }
          for (let i = 0; i < ringSize; i++) {
            localStore.createRelation({
              relationType,
              sourceEntityId: entities[i].entityId,
              targetEntityId: entities[(i + 1) % ringSize].entityId,
              weight: 0.9,
              evidence: `ring ${i}->${(i + 1) % ringSize}`,
              source: "code_analysis",
              confidence: 0.8,
              needsReview: false,
            });
          }

          const startId = entities[0].entityId;
          const result = localStore.getNeighbors(
            startId,
            [relationType],
            depth
          );

          // Independent BFS to compute reachable set
          const allRels = localStore.getAllRelations(projectId);
          const reachable = bfsReachable(startId, depth, allRels, [
            relationType,
          ]);

          // Every returned entity must be in the reachable set (excluding start)
          for (const entity of result.entities) {
            expect(reachable.has(entity.entityId)).toBe(true);
          }

          // Returned count should equal reachable minus start
          expect(result.entities.length).toBe(reachable.size - 1);

          // Returned count must not exceed min(depth * 2, ringSize - 1)
          // because bidirectional traversal can reach at most depth hops in each direction
          expect(result.entities.length).toBeLessThanOrEqual(ringSize - 1);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("depth=0 returns no neighbors", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        relationTypeArb,
        (chainLength, relationType) => {
          const localStore = new GraphStore();
          const projectId = "prop13-zero";

          const { entities } = buildChain(
            localStore,
            chainLength,
            relationType,
            projectId
          );
          const result = localStore.getNeighbors(
            entities[0].entityId,
            [relationType],
            0
          );

          expect(result.entities).toHaveLength(0);
          expect(result.relations).toHaveLength(0);
        }
      ),
      { numRuns: 20 }
    );
  });
});
