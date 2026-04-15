import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import fs from "fs";
import path from "path";
import os from "os";

import { LifecycleLog } from "../knowledge/lifecycle-log.js";
import { GraphStore } from "../knowledge/graph-store.js";
import { KnowledgeGarbageCollector } from "../knowledge/garbage-collector.js";
import type { Entity, EntityStatus, LifecycleLogEntry } from "../../shared/knowledge/types.js";

// Use a temp directory for test isolation
let tmpDir: string;
let logFilePath: string;
let log: LifecycleLog;

function makeEntry(overrides?: Partial<LifecycleLogEntry>): LifecycleLogEntry {
  return {
    entityId: "ent-001",
    action: "status_change",
    reason: "test reason",
    previousStatus: "active",
    newStatus: "deprecated",
    timestamp: "2025-01-15T10:00:00.000Z",
    triggeredBy: "manual",
    ...overrides,
  };
}

describe("LifecycleLog", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-log-test-"));
    logFilePath = path.join(tmpDir, "lifecycle-log.jsonl");
    log = new LifecycleLog(logFilePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // append
  // -------------------------------------------------------------------------

  describe("append", () => {
    it("writes a single entry as a JSON line", () => {
      const entry = makeEntry();
      log.append(entry);

      const raw = fs.readFileSync(logFilePath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(entry);
    });

    it("appends multiple entries as separate lines", () => {
      log.append(makeEntry({ entityId: "e1" }));
      log.append(makeEntry({ entityId: "e2" }));
      log.append(makeEntry({ entityId: "e3" }));

      const raw = fs.readFileSync(logFilePath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).entityId).toBe("e1");
      expect(JSON.parse(lines[1]).entityId).toBe("e2");
      expect(JSON.parse(lines[2]).entityId).toBe("e3");
    });

    it("creates the directory if it doesn't exist", () => {
      const nestedPath = path.join(tmpDir, "nested", "deep", "log.jsonl");
      const nestedLog = new LifecycleLog(nestedPath);
      nestedLog.append(makeEntry());

      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // query 鈥?no filters
  // -------------------------------------------------------------------------

  describe("query (no filters)", () => {
    it("returns all entries when no filters are provided", () => {
      log.append(makeEntry({ entityId: "a" }));
      log.append(makeEntry({ entityId: "b" }));

      const results = log.query();
      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe("a");
      expect(results[1].entityId).toBe("b");
    });

    it("returns empty array when file does not exist", () => {
      const missingLog = new LifecycleLog(path.join(tmpDir, "nope.jsonl"));
      expect(missingLog.query()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // query 鈥?filters
  // -------------------------------------------------------------------------

  describe("query (with filters)", () => {
    beforeEach(() => {
      log.append(makeEntry({
        entityId: "e1",
        action: "status_change",
        triggeredBy: "manual",
        timestamp: "2025-01-10T00:00:00.000Z",
      }));
      log.append(makeEntry({
        entityId: "e2",
        action: "garbage_collect",
        triggeredBy: "auto_cleanup",
        timestamp: "2025-01-15T00:00:00.000Z",
      }));
      log.append(makeEntry({
        entityId: "e1",
        action: "merge",
        triggeredBy: "auto_cleanup",
        timestamp: "2025-01-20T00:00:00.000Z",
      }));
      log.append(makeEntry({
        entityId: "e3",
        action: "review",
        triggeredBy: "review",
        timestamp: "2025-01-25T00:00:00.000Z",
      }));
    });

    it("filters by entityId", () => {
      const results = log.query({ entityId: "e1" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.entityId === "e1")).toBe(true);
    });

    it("filters by action", () => {
      const results = log.query({ action: "garbage_collect" });
      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe("e2");
    });

    it("filters by triggeredBy", () => {
      const results = log.query({ triggeredBy: "auto_cleanup" });
      expect(results).toHaveLength(2);
    });

    it("filters by since (ISO 8601 timestamp)", () => {
      const results = log.query({ since: "2025-01-16T00:00:00.000Z" });
      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe("e1"); // merge at Jan 20
      expect(results[1].entityId).toBe("e3"); // review at Jan 25
    });

    it("combines multiple filters", () => {
      const results = log.query({
        entityId: "e1",
        triggeredBy: "auto_cleanup",
      });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("merge");
    });

    it("returns empty array when no entries match", () => {
      const results = log.query({ entityId: "nonexistent" });
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("handles corrupted lines gracefully 鈥?skips invalid JSON", () => {
      // Write a mix of valid and invalid lines
      fs.writeFileSync(
        logFilePath,
        [
          JSON.stringify(makeEntry({ entityId: "valid1" })),
          "THIS IS NOT JSON",
          JSON.stringify(makeEntry({ entityId: "valid2" })),
          "{broken json",
        ].join("\n"),
        "utf-8",
      );

      const results = log.query();
      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe("valid1");
      expect(results[1].entityId).toBe("valid2");
    });

    it("handles empty file gracefully", () => {
      fs.writeFileSync(logFilePath, "", "utf-8");
      expect(log.query()).toEqual([]);
    });

    it("handles file with only whitespace/newlines", () => {
      fs.writeFileSync(logFilePath, "\n\n  \n", "utf-8");
      expect(log.query()).toEqual([]);
    });
  });
});


// ---------------------------------------------------------------------------
// Property-Based Tests 鈥?瀹炰綋鐘舵€佹満杞崲鍚堟硶鎬?
// Feature: knowledge-graph, Property 16: 瀹炰綋鐘舵€佹満杞崲鍚堟硶鎬?
// Validates: Requirements 6.1
// ---------------------------------------------------------------------------

const ALL_STATUSES: EntityStatus[] = ["active", "deprecated", "archived"];

const VALID_TRANSITIONS: ReadonlyMap<EntityStatus, EntityStatus> = new Map([
  ["active", "deprecated"],
  ["deprecated", "archived"],
  ["archived", "active"],
]);

const DATA_DIR_GRAPH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../data/knowledge",
);
const TEST_PROJECT_PBT = "test-lifecycle-pbt";

function graphFilePath(projectId: string): string {
  return path.join(DATA_DIR_GRAPH, `graph-${projectId}.json`);
}

function cleanupGraph(): void {
  try {
    const fp = graphFilePath(TEST_PROJECT_PBT);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    // ignore
  }
}

/** Create an entity with a specific initial status via valid transition chain */
function createEntityWithStatus(
  store: GraphStore,
  lifecycleLog: LifecycleLog,
  targetStatus: EntityStatus,
): Entity {
  const entity = store.createEntity({
    entityType: "CodeModule",
    name: `entity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "PBT test entity",
    source: "code_analysis",
    confidence: 0.8,
    projectId: TEST_PROJECT_PBT,
    needsReview: false,
    linkedMemoryIds: [],
    extendedAttributes: {},
  });

  // New entities start as "active". Walk the transition chain to reach targetStatus.
  if (targetStatus === "active") return entity;

  // active 鈫?deprecated
  store.enforceStatusTransition(entity.entityId, "deprecated", "pbt", "manual", lifecycleLog);
  if (targetStatus === "deprecated") return store.getEntity(entity.entityId)!;

  // deprecated 鈫?archived
  store.enforceStatusTransition(entity.entityId, "archived", "pbt", "manual", lifecycleLog);
  return store.getEntity(entity.entityId)!;
}

describe("Property 16: entity state transition legality", () => {
  let store: GraphStore;
  let lifecycleLog: LifecycleLog;
  let logTmpDir: string;

  beforeEach(() => {
    cleanupGraph();
    logTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-pbt-"));
    lifecycleLog = new LifecycleLog(path.join(logTmpDir, "lifecycle-log.jsonl"));
    store = new GraphStore(lifecycleLog);
  });

  afterEach(() => {
    cleanupGraph();
    fs.rmSync(logTmpDir, { recursive: true, force: true });
  });

  // Arbitraries
  const statusArb = fc.constantFrom<EntityStatus>(...ALL_STATUSES);
  const transitionArb = fc.record({ from: statusArb, to: statusArb });

  it("valid transitions succeed and update entity status", () => {
    const validTransitions: Array<{ from: EntityStatus; to: EntityStatus }> = [
      { from: "active", to: "deprecated" },
      { from: "deprecated", to: "archived" },
      { from: "archived", to: "active" },
    ];

    fc.assert(
      fc.property(fc.constantFrom(...validTransitions), ({ from, to }) => {
        const entity = createEntityWithStatus(store, lifecycleLog, from);
        expect(entity.status).toBe(from);

        const updated = store.enforceStatusTransition(
          entity.entityId,
          to,
          "pbt-valid-transition",
          "manual",
          lifecycleLog,
        );

        expect(updated.status).toBe(to);
        expect(store.getEntity(entity.entityId)!.status).toBe(to);
      }),
      { numRuns: 20 },
    );
  });

  it("invalid transitions are rejected and entity status is unchanged", () => {
    fc.assert(
      fc.property(transitionArb, ({ from, to }) => {
        // Skip valid transitions
        if (VALID_TRANSITIONS.get(from) === to) return;

        const entity = createEntityWithStatus(store, lifecycleLog, from);
        expect(entity.status).toBe(from);

        expect(() =>
          store.enforceStatusTransition(
            entity.entityId,
            to,
            "pbt-invalid-transition",
            "manual",
            lifecycleLog,
          ),
        ).toThrow(/Invalid status transition/);

        // Status must remain unchanged
        expect(store.getEntity(entity.entityId)!.status).toBe(from);
      }),
      { numRuns: 20 },
    );
  });

  it("all status pairs are partitioned into exactly valid or invalid", () => {
    fc.assert(
      fc.property(transitionArb, ({ from, to }) => {
        const entity = createEntityWithStatus(store, lifecycleLog, from);
        const isValid = VALID_TRANSITIONS.get(from) === to;

        if (isValid) {
          const updated = store.enforceStatusTransition(
            entity.entityId,
            to,
            "pbt-partition",
            "manual",
            lifecycleLog,
          );
          expect(updated.status).toBe(to);
        } else {
          expect(() =>
            store.enforceStatusTransition(
              entity.entityId,
              to,
              "pbt-partition",
              "manual",
              lifecycleLog,
            ),
          ).toThrow();
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests 鈥?鐢熷懡鍛ㄦ湡鏃ュ織瀹屾暣鎬?
// Feature: knowledge-graph, Property 20: 鐢熷懡鍛ㄦ湡鏃ュ織瀹屾暣鎬?
// Validates: Requirements 6.5
// ---------------------------------------------------------------------------

describe("Property 20: lifecycle log completeness", () => {
  let store: GraphStore;
  let lifecycleLog: LifecycleLog;
  let logTmpDir: string;

  beforeEach(() => {
    cleanupGraph();
    logTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-p20-"));
    lifecycleLog = new LifecycleLog(path.join(logTmpDir, "lifecycle-log.jsonl"));
    store = new GraphStore(lifecycleLog);
  });

  afterEach(() => {
    cleanupGraph();
    fs.rmSync(logTmpDir, { recursive: true, force: true });
  });

  // Arbitrary: valid status transitions
  const validTransitionArb = fc.constantFrom<{
    from: EntityStatus;
    to: EntityStatus;
    triggeredBy: LifecycleLogEntry["triggeredBy"];
  }>(
    { from: "active", to: "deprecated", triggeredBy: "manual" },
    { from: "active", to: "deprecated", triggeredBy: "code_change" },
    { from: "deprecated", to: "archived", triggeredBy: "auto_cleanup" },
    { from: "deprecated", to: "archived", triggeredBy: "manual" },
    { from: "archived", to: "active", triggeredBy: "manual" },
  );

  const reasonArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
    (s) => s.trim().length > 0,
  );

  it("status transition produces a log entry with all required fields", () => {
    fc.assert(
      fc.property(validTransitionArb, reasonArb, (transition, reason) => {
        // Create entity at the required starting status
        const entity = createEntityWithStatus(store, lifecycleLog, transition.from);

        // Clear the log to isolate this transition's entry
        const logPath = path.join(logTmpDir, "lifecycle-log.jsonl");
        fs.writeFileSync(logPath, "", "utf-8");

        // Perform the status transition
        store.enforceStatusTransition(
          entity.entityId,
          transition.to,
          reason,
          transition.triggeredBy,
          lifecycleLog,
        );

        // Query the log for this entity's entries
        const entries = lifecycleLog.query({ entityId: entity.entityId });
        expect(entries.length).toBeGreaterThanOrEqual(1);

        // Find the entry matching this transition
        const logEntry = entries.find(
          (e) => e.action === "status_change" && e.newStatus === transition.to,
        );
        expect(logEntry).toBeDefined();

        // Verify all required fields exist and are correct
        expect(logEntry!.entityId).toBe(entity.entityId);
        expect(logEntry!.action).toBe("status_change");
        expect(logEntry!.reason).toBe(reason);
        expect(logEntry!.timestamp).toBeTruthy();
        expect(new Date(logEntry!.timestamp).toISOString()).toBe(logEntry!.timestamp);
        expect(logEntry!.triggeredBy).toBe(transition.triggeredBy);
      }),
      { numRuns: 20 },
    );
  });

  it("garbage collection (archive expired deprecated) produces log entries", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (entityCount) => {
          // Clear log
          const logPath = path.join(logTmpDir, "lifecycle-log.jsonl");
          fs.writeFileSync(logPath, "", "utf-8");

          const entityIds: string[] = [];

          for (let i = 0; i < entityCount; i++) {
            // Create entity, transition to deprecated
            const entity = store.createEntity({
              entityType: "CodeModule",
              name: `gc-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              description: "GC test entity",
              source: "code_analysis",
              confidence: 0.8,
              projectId: TEST_PROJECT_PBT,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });

            // Transition to deprecated
            store.enforceStatusTransition(
              entity.entityId,
              "deprecated",
              "test-deprecation",
              "manual",
              lifecycleLog,
            );

            // Backdate updatedAt so GC considers it expired
            // updateEntity makes updatedAt immutable (always sets to now),
            // so we directly mutate the entity in the store's data array.
            const storedEntity = store.getAllEntities(TEST_PROJECT_PBT)
              .find((e) => e.entityId === entity.entityId)!;
            storedEntity.updatedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

            entityIds.push(entity.entityId);
          }

          // Clear log again to only capture GC entries
          fs.writeFileSync(logPath, "", "utf-8");

          const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
            archiveAfterDays: 90,
            lowConfidenceThreshold: 0.3,
            lowConfidenceMaxAgeDays: 30,
            duplicateSimilarityThreshold: 0.9,
          });

          const archived = gc.archiveExpiredDeprecated();
          expect(archived).toBe(entityCount);

          // Verify each entity has a corresponding log entry
          for (const entityId of entityIds) {
            const entries = lifecycleLog.query({ entityId });
            const archiveEntry = entries.find(
              (e) => e.action === "status_change" && e.newStatus === "archived",
            );
            expect(archiveEntry).toBeDefined();
            expect(archiveEntry!.entityId).toBe(entityId);
            expect(archiveEntry!.reason).toBeTruthy();
            expect(archiveEntry!.timestamp).toBeTruthy();
            expect(archiveEntry!.triggeredBy).toBe("auto_cleanup");
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it("garbage collection (delete low quality) produces log entries", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.double({ min: 0.01, max: 0.29, noNaN: true }),
        (entityCount, confidence) => {
          // Clear log
          const logPath = path.join(logTmpDir, "lifecycle-log.jsonl");
          fs.writeFileSync(logPath, "", "utf-8");

          const entityIds: string[] = [];

          for (let i = 0; i < entityCount; i++) {
            const entity = store.createEntity({
              entityType: "CodeModule",
              name: `gc-lowq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              description: "Low quality test entity",
              source: "llm_inferred",
              confidence,
              projectId: TEST_PROJECT_PBT,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            });

            // Backdate createdAt so GC considers it old enough
            // updateEntity makes createdAt immutable, so we directly mutate.
            const storedEntity = store.getAllEntities(TEST_PROJECT_PBT)
              .find((e) => e.entityId === entity.entityId)!;
            storedEntity.createdAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

            entityIds.push(entity.entityId);
          }

          // Clear log to only capture GC entries
          fs.writeFileSync(logPath, "", "utf-8");

          const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
            archiveAfterDays: 90,
            lowConfidenceThreshold: 0.3,
            lowConfidenceMaxAgeDays: 30,
            duplicateSimilarityThreshold: 0.9,
          });

          const deleted = gc.deleteLowQualityEntities();
          expect(deleted).toBe(entityCount);

          // Verify each entity has a corresponding log entry
          for (const entityId of entityIds) {
            const entries = lifecycleLog.query({ entityId });
            const gcEntry = entries.find((e) => e.action === "garbage_collect");
            expect(gcEntry).toBeDefined();
            expect(gcEntry!.entityId).toBe(entityId);
            expect(gcEntry!.reason).toBeTruthy();
            expect(gcEntry!.timestamp).toBeTruthy();
            expect(gcEntry!.triggeredBy).toBe("auto_cleanup");
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it("entity merge produces log entries for merged (loser) entities", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 1.0, noNaN: true }),
        fc.double({ min: 0.1, max: 0.49, noNaN: true }),
        (winnerConfidence, loserConfidence) => {
          // Clear log
          const logPath = path.join(logTmpDir, "lifecycle-log.jsonl");
          fs.writeFileSync(logPath, "", "utf-8");

          // Create two entities with identical names (similarity = 1.0)
          const baseName = `merge-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const winner = store.createEntity({
            entityType: "CodeModule",
            name: baseName,
            description: "Winner entity",
            source: "code_analysis",
            confidence: winnerConfidence,
            projectId: TEST_PROJECT_PBT,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });

          const loser = store.createEntity({
            entityType: "CodeModule",
            name: baseName,
            description: "Loser entity",
            source: "code_analysis",
            confidence: loserConfidence,
            projectId: TEST_PROJECT_PBT,
            needsReview: false,
            linkedMemoryIds: [],
            extendedAttributes: {},
          });

          // Clear log to only capture merge entries
          fs.writeFileSync(logPath, "", "utf-8");

          const gc = new KnowledgeGarbageCollector(store, lifecycleLog, {
            archiveAfterDays: 90,
            lowConfidenceThreshold: 0.3,
            lowConfidenceMaxAgeDays: 30,
            duplicateSimilarityThreshold: 0.9,
          });

          const merged = gc.mergeDuplicateEntities();
          expect(merged).toBeGreaterThanOrEqual(1);

          // The loser entity should have a merge log entry
          const entries = lifecycleLog.query({ entityId: loser.entityId });
          const mergeEntry = entries.find((e) => e.action === "merge");
          expect(mergeEntry).toBeDefined();
          expect(mergeEntry!.entityId).toBe(loser.entityId);
          expect(mergeEntry!.reason).toContain(winner.entityId);
          expect(mergeEntry!.timestamp).toBeTruthy();
          expect(mergeEntry!.triggeredBy).toBe("auto_cleanup");
        },
      ),
      { numRuns: 20 },
    );
  });
});

