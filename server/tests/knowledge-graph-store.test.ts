import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function makeEntityInput(overrides: Partial<Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">> = {}) {
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
        makeEntityInput({ source: "user_defined", confidence: 0.5 }),
      );
      expect(entity.confidence).toBe(1.0);
    });

    it("preserves confidence for non-user_defined source", () => {
      const entity = store.createEntity(
        makeEntityInput({ source: "code_analysis", confidence: 0.7 }),
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
        makeEntityInput({ name: "B", projectId: "other-project" }),
      );

      const results = store.findEntities({ projectId: TEST_PROJECT });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("A");
    });

    it("filters by entityType", () => {
      store.createEntity(makeEntityInput({ name: "Mod", entityType: "CodeModule" }));
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
        store.updateEntity("non-existent", { description: "x" }),
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
          extendedAttributes: { filePath: "src/shared.ts", language: "typescript" },
        }),
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
        }),
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
        (e) => e.name === "Unique" && e.entityType === "CodeModule",
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
        makeRelationInput(e1.entityId, e2.entityId),
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

      const r1 = store.createRelation(makeRelationInput(e1.entityId, e2.entityId));
      const r2 = store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId, { relationType: "CALLS" }),
      );
      expect(r1.relationId).not.toBe(r2.relationId);
    });

    it("increments relation counter", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));

      store.createRelation(makeRelationInput(e1.entityId, e2.entityId));
      store.createRelation(
        makeRelationInput(e1.entityId, e2.entityId, { relationType: "CALLS" }),
      );

      const data = store.getGraphData(TEST_PROJECT);
      expect(data._counters.relations).toBe(2);
    });
  });

  describe("getRelation", () => {
    it("returns relation by relationId", () => {
      const e1 = store.createEntity(makeEntityInput({ name: "A" }));
      const e2 = store.createEntity(makeEntityInput({ name: "B" }));
      const rel = store.createRelation(makeRelationInput(e1.entityId, e2.entityId));

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

      store.createRelation(makeRelationInput(e1.entityId, e2.entityId, { relationType: "DEPENDS_ON" }));
      store.createRelation(makeRelationInput(e1.entityId, e2.entityId, { relationType: "CALLS" }));

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
      const rel = store.createRelation(makeRelationInput(e1.entityId, e2.entityId));

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
        store.updateRelation("non-existent", { weight: 0.1 }),
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
        }),
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
      expect(all.filter((e) => e.name === "Dup")).toHaveLength(1);
    });

    it("treats different filePaths as different entities", () => {
      store.createEntity(
        makeEntityInput({
          name: "SameName",
          extendedAttributes: { filePath: "src/a.ts" },
        }),
      );

      store.deduplicateEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "SameName",
        extendedAttributes: { filePath: "src/b.ts" },
      });

      const all = store.getAllEntities(TEST_PROJECT);
      expect(all.filter((e) => e.name === "SameName")).toHaveLength(2);
    });

    it("throws when required fields are missing", () => {
      expect(() =>
        store.deduplicateEntity({ name: "X" } as any),
      ).toThrow();
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
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const fp = graphFilePath(TEST_PROJECT);
      expect(fs.existsSync(fp)).toBe(true);
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      expect(data.entities).toHaveLength(1);
    });

    it("forceSave without projectId saves all projects", () => {
      store.createEntity(makeEntityInput({ name: "A", projectId: TEST_PROJECT }));
      store.createEntity(
        makeEntityInput({ name: "B", projectId: "other-proj" }),
      );

      store.forceSave();

      expect(fs.existsSync(graphFilePath(TEST_PROJECT))).toBe(true);
      expect(fs.existsSync(graphFilePath("other-proj"))).toBe(true);

      // Cleanup the other project file
      try {
        fs.unlinkSync(graphFilePath("other-proj"));
      } catch { /* ignore */ }
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

      // First merge → creates
      store.mergeEntity({
        entityType: "CodeModule",
        projectId: TEST_PROJECT,
        name: "Merged",
        extendedAttributes: { filePath: "src/m.ts" },
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][1]).toBe("created");

      // Second merge → updates
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
      const names = result.entities.map((e) => e.name).sort();
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
      const names = d2.entities.map((e) => e.name).sort();
      expect(names).toEqual(["B", "C"]);
    });

    it("filters by relationTypes", () => {
      const a = store.createEntity(makeEntityInput({ name: "A" }));
      const b = store.createEntity(makeEntityInput({ name: "B" }));
      const c = store.createEntity(makeEntityInput({ name: "C" }));
      store.createRelation(
        makeRelationInput(a.entityId, b.entityId, { relationType: "DEPENDS_ON" }),
      );
      store.createRelation(
        makeRelationInput(a.entityId, c.entityId, { relationType: "CALLS" }),
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

      // Should not hang — depth=10 is way more than the cycle length
      const result = store.getNeighbors(a.entityId, undefined, 10);
      expect(result.entities).toHaveLength(2);
      const names = result.entities.map((e) => e.name).sort();
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
      const r1 = store.createRelation(makeRelationInput(a.entityId, b.entityId));
      const r2 = store.createRelation(makeRelationInput(b.entityId, c.entityId));

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
      const r1 = store.createRelation(makeRelationInput(a.entityId, b.entityId));
      const r2 = store.createRelation(makeRelationInput(b.entityId, c.entityId));
      const r3 = store.createRelation(makeRelationInput(a.entityId, c.entityId));

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

      // Only request A and B — relation B->C should be excluded
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
    it("allows active → deprecated", () => {
      const entity = store.createEntity(makeEntityInput());
      expect(entity.status).toBe("active");

      const updated = store.enforceStatusTransition(
        entity.entityId, "deprecated", "code deleted", "code_change",
      );
      expect(updated.status).toBe("deprecated");
    });

    it("allows deprecated → archived", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });

      const updated = store.enforceStatusTransition(
        entity.entityId, "archived", "expired", "auto_cleanup",
      );
      expect(updated.status).toBe("archived");
    });

    it("allows archived → active (manual restoration)", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });
      store.updateEntity(entity.entityId, { status: "archived" });

      const updated = store.enforceStatusTransition(
        entity.entityId, "active", "restored by user", "manual",
      );
      expect(updated.status).toBe("active");
    });

    it("throws on invalid transition: active → archived", () => {
      const entity = store.createEntity(makeEntityInput());
      expect(() =>
        store.enforceStatusTransition(entity.entityId, "archived", "skip", "manual"),
      ).toThrow(/Invalid status transition.*active.*archived/);
    });

    it("throws on invalid transition: deprecated → active", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });

      expect(() =>
        store.enforceStatusTransition(entity.entityId, "active", "nope", "manual"),
      ).toThrow(/Invalid status transition.*deprecated.*active/);
    });

    it("throws on invalid transition: archived → deprecated", () => {
      const entity = store.createEntity(makeEntityInput());
      store.updateEntity(entity.entityId, { status: "deprecated" });
      store.updateEntity(entity.entityId, { status: "archived" });

      expect(() =>
        store.enforceStatusTransition(entity.entityId, "deprecated", "nope", "manual"),
      ).toThrow(/Invalid status transition.*archived.*deprecated/);
    });

    it("throws when entity not found", () => {
      expect(() =>
        store.enforceStatusTransition("non-existent", "deprecated", "reason", "manual"),
      ).toThrow(/Entity not found/);
    });

    it("writes lifecycle log entry on valid transition (via method param)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-lifecycle-"));
      const logPath = path.join(tmpDir, "test.jsonl");
      const lifecycleLog = new LifecycleLog(logPath);

      const entity = store.createEntity(makeEntityInput());
      store.enforceStatusTransition(
        entity.entityId, "deprecated", "module removed", "code_change", lifecycleLog,
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
        entity.entityId, "deprecated", "auto reason", "auto_cleanup",
      );

      const entries = store.lifecycleLog.query();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("status_change");

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does not write log when no lifecycleLog is available", () => {
      // store.lifecycleLog is undefined, no param passed — should not throw
      const entity = store.createEntity(makeEntityInput());
      const updated = store.enforceStatusTransition(
        entity.entityId, "deprecated", "silent", "manual",
      );
      expect(updated.status).toBe("deprecated");
    });
  });
});
