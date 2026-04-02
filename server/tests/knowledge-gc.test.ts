import { beforeEach, describe, expect, it } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

import { GraphStore } from "../knowledge/graph-store.js";
import { LifecycleLog } from "../knowledge/lifecycle-log.js";
import { KnowledgeGarbageCollector } from "../knowledge/garbage-collector.js";
import type { Entity, EntitySource } from "../../shared/knowledge/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT = "test-project";

function makeEntity(
  store: GraphStore,
  overrides?: Partial<Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">>,
): Entity {
  return store.createEntity({
    entityType: overrides?.entityType ?? "CodeModule",
    name: overrides?.name ?? `entity-${Math.random().toString(36).slice(2, 8)}`,
    description: overrides?.description ?? "test entity",
    source: overrides?.source ?? ("code_analysis" as EntitySource),
    confidence: overrides?.confidence ?? 0.8,
    projectId: overrides?.projectId ?? PROJECT,
    needsReview: overrides?.needsReview ?? false,
    linkedMemoryIds: overrides?.linkedMemoryIds ?? [],
    extendedAttributes: overrides?.extendedAttributes ?? {},
  });
}

/** Backdate an entity's timestamps by mutating the store data directly. */
function backdateEntity(
  store: GraphStore,
  entityId: string,
  daysAgo: number,
): void {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const data = store.getGraphData(PROJECT);
  const entity = data.entities.find((e) => e.entityId === entityId);
  if (entity) {
    entity.createdAt = date;
    entity.updatedAt = date;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string;
let store: GraphStore;
let lifecycleLog: LifecycleLog;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-test-"));
  store = new GraphStore();
  lifecycleLog = new LifecycleLog(path.join(tmpDir, "lifecycle.jsonl"));
  store.lifecycleLog = lifecycleLog;
});

// -------------------------------------------------------------------------
// archiveExpiredDeprecated
// -------------------------------------------------------------------------

describe("archiveExpiredDeprecated", () => {
  it("archives deprecated entities older than archiveAfterDays", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      archiveAfterDays: 90,
    });

    const entity = makeEntity(store);
    // Deprecate it
    store.enforceStatusTransition(entity.entityId, "deprecated", "old", "manual", lifecycleLog);
    // Backdate so it's older than 90 days
    backdateEntity(store, entity.entityId, 100);

    const count = gc.archiveExpiredDeprecated();
    expect(count).toBe(1);

    const updated = store.getEntity(entity.entityId);
    expect(updated?.status).toBe("archived");
  });

  it("skips recently deprecated entities", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      archiveAfterDays: 90,
    });

    const entity = makeEntity(store);
    store.enforceStatusTransition(entity.entityId, "deprecated", "recent", "manual", lifecycleLog);
    // Only 10 days old — should NOT be archived
    backdateEntity(store, entity.entityId, 10);

    const count = gc.archiveExpiredDeprecated();
    expect(count).toBe(0);

    const updated = store.getEntity(entity.entityId);
    expect(updated?.status).toBe("deprecated");
  });

  it("writes lifecycle log entries with triggeredBy=auto_cleanup", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      archiveAfterDays: 5,
    });

    const entity = makeEntity(store);
    store.enforceStatusTransition(entity.entityId, "deprecated", "old", "manual", lifecycleLog);
    backdateEntity(store, entity.entityId, 10);

    gc.archiveExpiredDeprecated();

    const logs = lifecycleLog.query({ entityId: entity.entityId, action: "status_change" });
    // Should have at least 2: one from enforceStatusTransition (deprecated), one from GC (archived)
    const archiveLog = logs.find((l) => l.newStatus === "archived");
    expect(archiveLog).toBeDefined();
    expect(archiveLog!.triggeredBy).toBe("auto_cleanup");
  });
});

// -------------------------------------------------------------------------
// deleteLowQualityEntities
// -------------------------------------------------------------------------

describe("deleteLowQualityEntities", () => {
  it("deletes old low-confidence entities with no relations", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      lowConfidenceThreshold: 0.3,
      lowConfidenceMaxAgeDays: 30,
    });

    const entity = makeEntity(store, { confidence: 0.1 });
    backdateEntity(store, entity.entityId, 45);

    const count = gc.deleteLowQualityEntities();
    expect(count).toBe(1);

    // Entity should be physically removed
    expect(store.getEntity(entity.entityId)).toBeUndefined();
  });

  it("keeps entities that have relations", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      lowConfidenceThreshold: 0.3,
      lowConfidenceMaxAgeDays: 30,
    });

    const entity = makeEntity(store, { confidence: 0.1 });
    const other = makeEntity(store, { confidence: 0.9 });
    backdateEntity(store, entity.entityId, 45);

    // Create a relation referencing the low-confidence entity
    store.createRelation({
      relationType: "DEPENDS_ON",
      sourceEntityId: other.entityId,
      targetEntityId: entity.entityId,
      weight: 1.0,
      evidence: "test",
      source: "code_analysis",
      confidence: 0.9,
      needsReview: false,
    });

    const count = gc.deleteLowQualityEntities();
    expect(count).toBe(0);

    // Entity should still exist
    expect(store.getEntity(entity.entityId)).toBeDefined();
  });

  it("keeps entities younger than lowConfidenceMaxAgeDays", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      lowConfidenceThreshold: 0.3,
      lowConfidenceMaxAgeDays: 30,
    });

    const entity = makeEntity(store, { confidence: 0.1 });
    // Only 5 days old
    backdateEntity(store, entity.entityId, 5);

    const count = gc.deleteLowQualityEntities();
    expect(count).toBe(0);
    expect(store.getEntity(entity.entityId)).toBeDefined();
  });

  it("keeps entities with confidence above threshold", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      lowConfidenceThreshold: 0.3,
      lowConfidenceMaxAgeDays: 30,
    });

    const entity = makeEntity(store, { confidence: 0.5 });
    backdateEntity(store, entity.entityId, 45);

    const count = gc.deleteLowQualityEntities();
    expect(count).toBe(0);
    expect(store.getEntity(entity.entityId)).toBeDefined();
  });

  it("writes lifecycle log for deleted entities", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      lowConfidenceThreshold: 0.3,
      lowConfidenceMaxAgeDays: 30,
    });

    const entity = makeEntity(store, { confidence: 0.1 });
    backdateEntity(store, entity.entityId, 45);

    gc.deleteLowQualityEntities();

    const logs = lifecycleLog.query({
      entityId: entity.entityId,
      action: "garbage_collect",
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].triggeredBy).toBe("auto_cleanup");
  });
});

// -------------------------------------------------------------------------
// mergeDuplicateEntities
// -------------------------------------------------------------------------

describe("mergeDuplicateEntities", () => {
  it("merges entities with identical names in same type and project", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog);

    makeEntity(store, { name: "UserService", entityType: "CodeModule", confidence: 0.6 });
    makeEntity(store, { name: "UserService", entityType: "CodeModule", confidence: 0.9 });

    const count = gc.mergeDuplicateEntities();
    expect(count).toBe(1);

    // Only one entity should remain
    const remaining = store.findEntities({ projectId: PROJECT, entityType: "CodeModule", name: "UserService" });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].confidence).toBe(0.9);
  });

  it("merges entities with similar names (containment)", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      duplicateSimilarityThreshold: 0.9,
    });

    makeEntity(store, { name: "UserService", entityType: "CodeModule", confidence: 0.7 });
    makeEntity(store, { name: "userservice", entityType: "CodeModule", confidence: 0.5 });

    const count = gc.mergeDuplicateEntities();
    expect(count).toBe(1);

    const remaining = store.findEntities({ projectId: PROJECT, entityType: "CodeModule" });
    const userServices = remaining.filter((e) => e.name.toLowerCase().includes("userservice"));
    expect(userServices).toHaveLength(1);
    expect(userServices[0].confidence).toBe(0.7);
  });

  it("does not merge entities with different types", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog);

    makeEntity(store, { name: "UserService", entityType: "CodeModule", confidence: 0.6 });
    makeEntity(store, { name: "UserService", entityType: "API", confidence: 0.9 });

    const count = gc.mergeDuplicateEntities();
    expect(count).toBe(0);
  });

  it("does not merge entities with different projects", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog);

    makeEntity(store, { name: "UserService", entityType: "CodeModule", projectId: "proj-a", confidence: 0.6 });
    makeEntity(store, { name: "UserService", entityType: "CodeModule", projectId: "proj-b", confidence: 0.9 });

    const count = gc.mergeDuplicateEntities();
    expect(count).toBe(0);
  });

  it("keeps higher-confidence entity and merges extendedAttributes", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog);

    makeEntity(store, {
      name: "AuthModule",
      entityType: "CodeModule",
      confidence: 0.9,
      extendedAttributes: { filePath: "/src/auth.ts", language: "typescript" },
    });
    makeEntity(store, {
      name: "AuthModule",
      entityType: "CodeModule",
      confidence: 0.5,
      extendedAttributes: { filePath: "/src/auth.ts", complexity: 12 },
    });

    gc.mergeDuplicateEntities();

    const remaining = store.findEntities({ projectId: PROJECT, entityType: "CodeModule", name: "AuthModule" });
    expect(remaining).toHaveLength(1);
    // Winner's attrs take precedence, loser's fill gaps
    expect(remaining[0].extendedAttributes).toMatchObject({
      filePath: "/src/auth.ts",
      language: "typescript",
      complexity: 12,
    });
  });

  it("writes lifecycle log for merged entities", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog);

    makeEntity(store, { name: "Dup", entityType: "CodeModule", confidence: 0.9 });
    makeEntity(store, { name: "Dup", entityType: "CodeModule", confidence: 0.3 });

    gc.mergeDuplicateEntities();

    const logs = lifecycleLog.query({ action: "merge" });
    expect(logs).toHaveLength(1);
    expect(logs[0].triggeredBy).toBe("auto_cleanup");
  });
});

// -------------------------------------------------------------------------
// run()
// -------------------------------------------------------------------------

describe("run", () => {
  it("executes all three phases and returns combined GCResult", () => {
    const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
      archiveAfterDays: 5,
      lowConfidenceThreshold: 0.3,
      lowConfidenceMaxAgeDays: 10,
    });

    // Phase 1 candidate: deprecated + old
    const deprecated = makeEntity(store, { confidence: 0.8 });
    store.enforceStatusTransition(deprecated.entityId, "deprecated", "old", "manual", lifecycleLog);
    backdateEntity(store, deprecated.entityId, 20);

    // Phase 2 candidate: low confidence + old + no relations
    const lowQuality = makeEntity(store, { confidence: 0.1 });
    backdateEntity(store, lowQuality.entityId, 15);

    // Phase 3 candidate: duplicate names
    makeEntity(store, { name: "DupService", entityType: "API", confidence: 0.9 });
    makeEntity(store, { name: "DupService", entityType: "API", confidence: 0.4 });

    const result = gc.run();

    expect(result.archived).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
